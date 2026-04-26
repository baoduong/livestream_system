// Send order confirmation via Facebook Page Inbox
// Uses Playwright to send message in existing conversation
//
// Usage: node server/fb-send-order.js --customer "Tên khách" --order "Đơn #123" --price "150k" --images img1.jpg,img2.jpg,img3.jpg

import { chromium } from 'playwright'
import { config } from 'dotenv'
import path from 'path'
import { fileURLToPath } from 'url'
import Database from 'better-sqlite3'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
config({ path: path.join(__dirname, '../.env') })

const DB_PATH = path.join(__dirname, '../data/livestream.db')
const db = new Database(DB_PATH)

const C_USER = process.env.FB_COOKIE_C_USER || ''
const XS = process.env.FB_COOKIE_XS || ''
const FB_PAGE_ID = process.env.FB_PAGE_ID || '107811450656942'
const DISCORD_CHANNEL = '1492732763609235479'
const DISCORD_TOKEN = process.env.DISCORD_TOKEN || ''

// ─── Parse args ──────────────────────────────────────────────────────────────
function parseArgs() {
  const args = process.argv.slice(2)
  const flags = {}
  for (let i = 0; i < args.length; i += 2) {
    flags[args[i].replace(/^--/, '')] = args[i + 1]
  }
  return flags
}

// ─── Send Discord notification ───────────────────────────────────────────────
async function notifyDiscord(message) {
  try {
    await fetch(`https://discord.com/api/v10/channels/${DISCORD_CHANNEL}/messages`, {
      method: 'POST',
      headers: { 'Authorization': `Bot ${DISCORD_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: message }),
    })
  } catch {}
}

// ─── Main: send message via Page Inbox ───────────────────────────────────────
export async function sendOrderMessage({ customerName, customerId, orderInfo, price, imagePaths }) {
  if (!C_USER || !XS) {
    console.error('[send] Missing cookies')
    return { success: false, error: 'missing_cookies' }
  }

  // Find customer FB info
  let fbUserId = null
  if (customerId) {
    const customer = db.prepare('SELECT facebook_author_id, name FROM customers WHERE id = ?').get(customerId)
    if (customer?.facebook_author_id) fbUserId = customer.facebook_author_id
    if (!customerName) customerName = customer?.name
  }

  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
    locale: 'vi-VN',
    viewport: { width: 1280, height: 900 },
  })
  await context.addCookies([
    { name: 'c_user', value: C_USER, domain: '.facebook.com', path: '/' },
    { name: 'xs', value: XS, domain: '.facebook.com', path: '/' },
  ])

  const page = await context.newPage()

  try {
    // 1. Go to Page Inbox
    console.log(`[send] Opening Page inbox...`)
    await page.goto(`https://www.facebook.com/${FB_PAGE_ID}/inbox/`, {
      waitUntil: 'domcontentloaded', timeout: 20000
    })
    await page.waitForTimeout(5000)

    // 2. Search for customer in inbox
    console.log(`[send] Searching for: ${customerName}`)

    // Try to find search input in inbox
    const searchInput = await page.$('input[placeholder*="Tìm kiếm"], input[aria-label*="Tìm kiếm"], input[type="search"]')
    if (searchInput) {
      await searchInput.click()
      await page.waitForTimeout(500)
      await searchInput.fill(customerName)
      await page.waitForTimeout(3000)

      // Click on first result
      const result = await page.$(`text="${customerName}"`)
      if (result) {
        await result.click()
        await page.waitForTimeout(3000)
        console.log(`[send] Found conversation with ${customerName}`)
      } else {
        console.log(`[send] ⚠️ Customer "${customerName}" not found in inbox`)
        await notifyDiscord(`⚠️ Khách **${customerName}** chưa inbox Page. Hãy nhắn tin trước để gửi đơn hàng.`)
        await browser.close()
        return { success: false, error: 'no_conversation' }
      }
    } else {
      console.log('[send] ⚠️ Search input not found in inbox')
      await browser.close()
      return { success: false, error: 'inbox_ui_changed' }
    }

    // 3. Type message
    const message = `📦 Xác nhận đơn hàng\n\n${orderInfo}\n💰 Tổng: ${price}\n\nCảm ơn bạn đã mua hàng! ❤️`
    console.log(`[send] Typing message...`)

    const messageInput = await page.$('[aria-label*="Nhập tin nhắn"], [aria-label*="Aa"], [role="textbox"]')
    if (messageInput) {
      await messageInput.click()
      await page.waitForTimeout(500)
      await messageInput.fill(message)
      await page.waitForTimeout(1000)

      // Send with Enter
      await page.keyboard.press('Enter')
      await page.waitForTimeout(2000)
      console.log(`[send] ✅ Message sent to ${customerName}`)
    } else {
      console.log('[send] ⚠️ Message input not found')
      await browser.close()
      return { success: false, error: 'message_input_not_found' }
    }

    // 4. Upload images (if provided)
    if (imagePaths && imagePaths.length > 0) {
      console.log(`[send] Uploading ${imagePaths.length} images...`)
      const fileInput = await page.$('input[type="file"]')
      if (fileInput) {
        for (const imgPath of imagePaths) {
          await fileInput.setInputFiles(imgPath)
          await page.waitForTimeout(2000)
        }
        // Send images
        await page.keyboard.press('Enter')
        await page.waitForTimeout(3000)
        console.log(`[send] ✅ Images sent`)
      } else {
        console.log('[send] ⚠️ File input not found, images not sent')
      }
    }

    await browser.close()
    console.log(`[send] Done! Order message sent to ${customerName}`)
    return { success: true }

  } catch (err) {
    console.error(`[send] Error: ${err.message}`)
    await browser.close()
    return { success: false, error: err.message }
  }
}

// ─── CLI mode ────────────────────────────────────────────────────────────────
const flags = parseArgs()
if (flags.customer || flags.id) {
  const result = await sendOrderMessage({
    customerName: flags.customer,
    customerId: flags.id ? +flags.id : null,
    orderInfo: flags.order || 'Đơn hàng của bạn',
    price: flags.price || '',
    imagePaths: flags.images ? flags.images.split(',') : [],
  })
  console.log('Result:', result)
  db.close()
}
