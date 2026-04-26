// Facebook Inbox Order Confirmation Service
// Flow: gửi đơn → chờ reply → tạo VNPost → thông báo Discord
//
// Usage:
//   node server/fb-order-confirm.js --customer-id 123
//   node server/fb-order-confirm.js --customer-id 123 --order-id 456 --price "150k" --images "a.jpg,b.jpg"
//
// Service chạy tối đa 12h, tắt khi tất cả đơn đã được xác nhận hoặc timeout

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

const MAX_WAIT_MS = 12 * 60 * 60 * 1000  // 12 hours
const MAX_INTERVAL = 10 * 60 * 60 * 1000  // Max 10 hours between checks
let checkInterval = 30000  // Start at 30s, exponential backoff

// ─── Helpers ─────────────────────────────────────────────────────────────────
function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }
function rand(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min }

async function notifyDiscord(message) {
  try {
    await fetch(`https://discord.com/api/v10/channels/${DISCORD_CHANNEL}/messages`, {
      method: 'POST',
      headers: { 'Authorization': `Bot ${DISCORD_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: message }),
    })
  } catch {}
}

// ─── Parse args ──────────────────────────────────────────────────────────────
function parseArgs() {
  const args = process.argv.slice(2)
  const flags = {}
  for (let i = 0; i < args.length; i += 2) {
    flags[args[i].replace(/^--/, '')] = args[i + 1]
  }
  return flags
}

// ─── Build order message ─────────────────────────────────────────────────────
function buildOrderMessage(order, customer) {
  return [
    `📦 Xác nhận đơn hàng #${order.id}`,
    ``,
    `Sản phẩm: ${order.product_info}`,
    order.price ? `💰 Tổng: ${order.price}` : '',
    ``,
    `Vui lòng reply "OK" hoặc "Xác nhận" để mình chuẩn bị giao hàng nhé!`,
    `❤️ Cảm ơn ${customer.name} đã mua hàng!`,
  ].filter(Boolean).join('\n')
}

// ─── Send message in Page Inbox ──────────────────────────────────────────────
async function sendMessage(page, customerName, message) {
  console.log(`[send] Searching inbox for: ${customerName}`)

  // Go to inbox
  await page.goto(`https://www.facebook.com/${FB_PAGE_ID}/inbox/`, {
    waitUntil: 'domcontentloaded', timeout: 20000
  })
  await sleep(5000)

  // Search for customer
  const searchInput = await page.$('input[placeholder*="Tìm kiếm"], input[aria-label*="Tìm kiếm"], input[type="search"]')
  if (!searchInput) {
    console.log('[send] Search input not found')
    return false
  }

  await searchInput.click()
  await sleep(500)
  await searchInput.fill(customerName)
  await sleep(3000)

  // Click first result
  const result = await page.$(`text="${customerName}"`)
  if (!result) {
    console.log(`[send] "${customerName}" not found in inbox`)
    await notifyDiscord(`⚠️ Khách **${customerName}** chưa inbox Page. Hãy nhắn tin trước.`)
    return false
  }

  await result.click()
  await sleep(3000)

  // Type and send message
  const msgInput = await page.$('[aria-label*="Nhập tin nhắn"], [aria-label*="Aa"], [role="textbox"]')
  if (!msgInput) {
    console.log('[send] Message input not found')
    return false
  }

  await msgInput.click()
  await sleep(500)
  // Type line by line for multi-line
  for (const line of message.split('\n')) {
    await page.keyboard.type(line, { delay: 30 })
    await page.keyboard.down('Shift')
    await page.keyboard.press('Enter')
    await page.keyboard.up('Shift')
  }
  await sleep(500)
  await page.keyboard.press('Enter')
  await sleep(2000)

  console.log(`[send] ✅ Message sent to ${customerName}`)
  return true
}

// ─── Check for reply (stay on conversation page) ─────────────────────────────
// After sending message, page stays on the conversation.
// Just read latest messages without navigating away.
let lastMessageCount = 0

async function checkReply(page) {
  try {
    // Read messages currently visible in conversation
    const messages = await page.evaluate(() => {
      const msgs = document.querySelectorAll('[role="row"], [data-testid*="message"], [dir="auto"]')
      return [...msgs].slice(-10).map(m => m.innerText?.trim()).filter(t => t && t.length > 0 && t.length < 200)
    })

    // Skip if no new messages
    if (messages.length <= lastMessageCount) return null
    
    // Only check new messages (after our sent message)
    const newMessages = messages.slice(lastMessageCount)
    lastMessageCount = messages.length

    // Check if customer confirmed
    const confirmPatterns = ['ok', 'xác nhận', 'đồng ý', 'confirmed', 'đúng', 'được', 'yes', 'oke', 'okie', 'nhận', 'đặt']
    for (const msg of newMessages) {
      const lower = msg.toLowerCase().trim()
      if (confirmPatterns.some(p => lower.includes(p))) {
        return msg
      }
    }

    return null
  } catch {
    return null
  }
}

// ─── Create VNPost order ─────────────────────────────────────────────────────
async function createVNPostOrder(order, customer) {
  // TODO: Implement VNPost API integration
  // For now, log and notify
  console.log(`[vnpost] Creating order for ${customer.name}`)
  console.log(`[vnpost] Product: ${order.product_info}`)
  console.log(`[vnpost] Address: ${customer.address || 'N/A'}`)
  console.log(`[vnpost] Phone: ${customer.phone || 'N/A'}`)

  // Notify Discord
  await notifyDiscord([
    `✅ **Đơn hàng #${order.id} đã được xác nhận!**`,
    `👤 Khách: ${customer.name}`,
    `📱 SĐT: ${customer.phone || 'Chưa có'}`,
    `📍 Địa chỉ: ${customer.address || 'Chưa có'}`,
    `📦 Sản phẩm: ${order.product_info}`,
    order.price ? `💰 Giá: ${order.price}` : '',
    ``,
    `🚚 Đang tạo đơn VietNamPost...`,
  ].filter(Boolean).join('\n'))

  return true
}

// ─── Main service ────────────────────────────────────────────────────────────
async function main() {
  const flags = parseArgs()
  const customerId = flags['customer-id'] ? +flags['customer-id'] : null
  const orderId = flags['order-id'] ? +flags['order-id'] : null
  const price = flags.price || ''
  const imagePaths = flags.images ? flags.images.split(',') : []

  if (!customerId) {
    console.error('Usage: node fb-order-confirm.js --customer-id 123 [--order-id 456] [--price "150k"]')
    process.exit(1)
  }

  // Get customer + order from DB
  const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(customerId)
  if (!customer) {
    console.error(`Customer #${customerId} not found`)
    process.exit(1)
  }

  let order = null
  if (orderId) {
    order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId)
  } else {
    // Get latest order for this customer
    order = db.prepare('SELECT * FROM orders WHERE customer_id = ? ORDER BY created_date DESC LIMIT 1').get(customerId)
  }

  if (!order) {
    order = { id: 0, product_info: flags.product || 'Đơn hàng', price }
  }
  order.price = price || order.price || ''

  console.log(`[service] Order confirm service started`)
  console.log(`[service] Customer: ${customer.name} (#${customerId})`)
  console.log(`[service] Order: #${order.id} - ${order.product_info}`)
  console.log(`[service] Max wait: 12h | Poll: 30s → exponential → max 10h`)

  // Start browser
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
  await page.route('**/*', route => {
    if (['media', 'font'].includes(route.request().resourceType())) return route.abort()
    return route.continue()
  })

  // 1. Send order message
  const message = buildOrderMessage(order, customer)
  const sent = await sendMessage(page, customer.name, message)

  if (!sent) {
    console.log('[service] Failed to send message. Exiting.')
    await browser.close()
    db.close()
    process.exit(1)
  }

  // Record current message count so we only check NEW replies
  lastMessageCount = await page.evaluate(() => {
    const msgs = document.querySelectorAll('[role="row"], [data-testid*="message"], [dir="auto"]')
    return [...msgs].filter(m => m.innerText?.trim()).length
  })
  console.log(`[service] Baseline messages: ${lastMessageCount}`)

  await notifyDiscord(`📨 Đã gửi đơn hàng #${order.id} cho **${customer.name}**. Đang chờ xác nhận (tối đa 12h)...`)

  // 2. Poll for reply
  const startTime = Date.now()
  let confirmed = false

  while (Date.now() - startTime < MAX_WAIT_MS) {
    await sleep(checkInterval + rand(0, 5000))
    // Exponential backoff: 30s → 60s → 120s → ... → max 10h
    checkInterval = Math.min(checkInterval * 1.5, MAX_INTERVAL)

    // Random action to stay alive
    await page.mouse.move(rand(100, 800), rand(100, 600)).catch(() => {})

    const reply = await checkReply(page)
    if (reply) {
      console.log(`[service] ✅ Customer confirmed: "${reply}"`)
      confirmed = true
      break
    }

    const elapsed = Math.floor((Date.now() - startTime) / 60000)
    const nextCheck = Math.floor(checkInterval / 1000)
    console.log(`[service] No reply yet (${elapsed}min elapsed, next check in ${nextCheck}s)`)
  }

  // 3. Handle result
  if (confirmed) {
    await createVNPostOrder(order, customer)
  } else {
    console.log('[service] ⏰ Timeout — no reply after 12 hours')
    await notifyDiscord(`⏰ Khách **${customer.name}** chưa xác nhận đơn #${order.id} sau 12 giờ.`)
  }

  // Cleanup
  await browser.close()
  db.close()
  console.log('[service] Done.')
}

main().catch(err => {
  console.error('[service] Fatal:', err.message)
  process.exit(1)
})

process.on('SIGINT', () => { db.close(); process.exit(0) })
process.on('SIGTERM', () => { db.close(); process.exit(0) })
