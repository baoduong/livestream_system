// Facebook Business Suite Login + Interaction Script
// Uses persistent browser profile
// Usage: 
//   node server/fb-interact.js login                    # Login vào Business Suite
//   node server/fb-interact.js reply "Tên" "Nội dung"   # Reply inbox

import { chromium } from 'playwright'
import { config } from 'dotenv'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
config({ path: path.join(__dirname, '../.env') })

const FB_PAGE_ID = process.env.FB_PAGE_ID || '107811450656942'
const PROFILE_DIR = path.join(__dirname, '..', 'data', 'browser-profile')
const SS_PATH = path.join(__dirname, '..', 'data', 'interact-screenshot.png')

if (!fs.existsSync(PROFILE_DIR)) fs.mkdirSync(PROFILE_DIR, { recursive: true })

function rand(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

async function launch() {
  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--disable-features=IsolateOrigins,site-per-process',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-infobars',
      '--window-size=1440,900',
    ],
    locale: 'vi-VN',
    timezoneId: 'Asia/Ho_Chi_Minh',
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
  })

  const page = context.pages()[0] || await context.newPage()
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false })
  })

  return { context, page }
}

// ─── Check if logged into Business Suite ─────────────────────────────────────
async function isLoggedIn(page) {
  const url = page.url()
  return url.includes('business.facebook.com') && !url.includes('loginpage') && !url.includes('login')
}

// ─── Login to Business Suite ─────────────────────────────────────────────────
async function loginBusinessSuite(page, username, password) {
  // Step 1: Login to Facebook first
  console.log('[login] Step 1: Login to Facebook...')
  await page.goto('https://www.facebook.com', { waitUntil: 'domcontentloaded', timeout: 30000 })
  await sleep(3000)

  let fbUrl = page.url()
  if (fbUrl.includes('login') || (await page.title()).toLowerCase().includes('log in') || (await page.title()).toLowerCase().includes('facebook')) {
    // Check if already logged in (homepage has different elements)
    const loginForm = await page.$('input[name="email"], #email')
    if (loginForm) {
      console.log('[login] Filling login form on Facebook...')
      
      const emailInput = await page.$('input[name="email"], #email')
      if (emailInput) {
        await emailInput.click()
        await sleep(300)
        await emailInput.fill(username)
        await sleep(500)
      }

      const passInput = await page.$('input[name="pass"], #pass')
      if (passInput) {
        await passInput.click()
        await sleep(300)
        await passInput.fill(password)
        await sleep(500)
      }

      const loginBtn = await page.$('button[name="login"], button[type="submit"], button[data-testid="royal_login_button"]')
      if (loginBtn) {
        await loginBtn.click()
        console.log('[login] Clicked login')
      } else {
        await page.keyboard.press('Enter')
      }

      await sleep(8000)

      // Check for 2FA
      const currentUrl = page.url()
      if (currentUrl.includes('checkpoint') || currentUrl.includes('two_step')) {
        console.log('[login] ⚠️ 2FA required — please complete in browser')
        while (true) {
          await sleep(5000)
          const u = page.url()
          if (!u.includes('checkpoint') && !u.includes('two_step') && !u.includes('login')) break
          console.log('[login] Waiting for 2FA...')
        }
      }

      await page.screenshot({ path: SS_PATH })
      fbUrl = page.url()
      console.log(`[login] After FB login: ${fbUrl}`)
    } else {
      console.log('[login] Already logged into Facebook')
    }
  } else {
    console.log('[login] Already logged into Facebook')
  }

  // Step 2: Navigate to Business Suite
  console.log('[login] Step 2: Opening Business Suite...')
  await page.goto(`https://business.facebook.com/latest/home?asset_id=${FB_PAGE_ID}`, {
    waitUntil: 'domcontentloaded', timeout: 30000
  })
  await sleep(8000)

  if (await isLoggedIn(page)) {
    console.log('[login] ✅ Business Suite login successful! Profile saved.')
    await page.screenshot({ path: SS_PATH })
    return true
  }

  // Might need to click through "Đăng nhập bằng Facebook" on BS page
  try {
    const fbBtn = await page.locator('text=Đăng nhập bằng Facebook').first()
    if (await fbBtn.isVisible({ timeout: 3000 })) {
      await fbBtn.click()
      console.log('[login] Clicked "Đăng nhập bằng Facebook" on Business Suite')
      await sleep(8000)
    }
  } catch {}

  // Re-check
  if (await isLoggedIn(page)) {
    console.log('[login] ✅ Business Suite login successful!')
    await page.screenshot({ path: SS_PATH })
    return true
  }

  console.log('[login] ❌ Login failed')
  await page.screenshot({ path: SS_PATH })
  return false
}

// ─── Find and reply in inbox ─────────────────────────────────────────────────
async function replyInbox(page, targetName, replyText) {
  console.log(`[inbox] Opening inbox...`)
  await page.goto(`https://business.facebook.com/latest/inbox/all?asset_id=${FB_PAGE_ID}`, {
    waitUntil: 'domcontentloaded', timeout: 30000
  })
  await sleep(5000)

  if (!await isLoggedIn(page)) {
    return { ok: false, error: 'not_logged_in' }
  }

  await page.screenshot({ path: SS_PATH })
  console.log(`[inbox] Looking for "${targetName}"...`)

  // Search for the person
  const searchBox = await page.$('input[placeholder*="Tìm kiếm"], input[aria-label*="Tìm kiếm"], input[type="search"]')
  if (searchBox) {
    await searchBox.click()
    await sleep(500)
    await searchBox.fill(targetName)
    await sleep(3000)
  }

  // Find conversation by scanning visible text
  const found = await page.evaluate((name) => {
    const elements = document.querySelectorAll('span, div, a')
    for (const el of elements) {
      if (el.textContent.trim() === name || el.textContent.includes(name)) {
        if (el.closest('a, div[role="row"], div[role="listitem"], div[tabindex]')) {
          el.closest('a, div[role="row"], div[role="listitem"], div[tabindex]').click()
          return true
        }
      }
    }
    return false
  }, targetName)

  if (!found) {
    console.log(`[inbox] ❌ "${targetName}" not found`)
    await page.screenshot({ path: SS_PATH })
    return { ok: false, error: 'not_found', screenshot: SS_PATH }
  }

  console.log(`[inbox] Found "${targetName}", opening conversation...`)
  await sleep(3000)
  await page.screenshot({ path: SS_PATH })

  // Find textbox and type reply
  const textbox = await page.$('div[role="textbox"][contenteditable="true"], div[aria-label*="Nhắn tin"], div[aria-label*"message" i]')
  if (!textbox) {
    console.log('[inbox] ❌ Message input not found')
    await page.screenshot({ path: SS_PATH })
    return { ok: false, error: 'no_textbox', screenshot: SS_PATH }
  }

  await textbox.click()
  await sleep(300)
  await textbox.fill(replyText)
  await sleep(1000)

  // Send
  await page.keyboard.press('Enter')
  console.log(`[inbox] ✅ Sent to ${targetName}: "${replyText}"`)
  await sleep(2000)
  await page.screenshot({ path: SS_PATH })

  return { ok: true, screenshot: SS_PATH }
}

// ─── Main ────────────────────────────────────────────────────────────────────
const [,, action, arg1, arg2] = process.argv

async function main() {
  const { context, page } = await launch()

  try {
    if (action === 'login') {
      const username = arg1 || ''
      const password = arg2 || ''
      if (!username || !password) {
        console.log('Usage: node fb-interact.js login "username" "password"')
        process.exit(1)
      }
      await loginBusinessSuite(page, username, password)

    } else if (action === 'reply') {
      if (!arg1 || !arg2) {
        console.log('Usage: node fb-interact.js reply "Tên người" "Nội dung"')
        process.exit(1)
      }

      // Check login first
      await page.goto(`https://business.facebook.com/latest/home?asset_id=${FB_PAGE_ID}`, {
        waitUntil: 'domcontentloaded', timeout: 30000
      })
      await sleep(3000)

      if (!await isLoggedIn(page)) {
        console.log('[interact] Not logged in. Run: node fb-interact.js login "user" "pass"')
        process.exit(1)
      }

      const result = await replyInbox(page, arg1, arg2)
      console.log(JSON.stringify(result, null, 2))

    } else {
      console.log('Commands:')
      console.log('  login "username" "password"  — Login to Business Suite')
      console.log('  reply "Tên người" "Nội dung" — Reply in inbox')
    }
  } finally {
    await context.close()
  }
}

main().catch(err => {
  console.error('[interact] Fatal:', err.message)
  process.exit(1)
})
