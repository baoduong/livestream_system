// FB Inbox Monitor — check for new messages and forward notifications
// Usage: node server/fb-inbox-monitor.js
// Runs continuously, checks inbox every 5 minutes

import { chromium } from 'playwright'
import { config } from 'dotenv'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
config({ path: path.join(__dirname, '../.env') })

const C_USER = process.env.FB_COOKIE_C_USER || ''
const XS = process.env.FB_COOKIE_XS || ''
const DATR = process.env.FB_COOKIE_DATR || ''
const FR = process.env.FB_COOKIE_FR || ''
const SB = process.env.FB_COOKIE_SB || ''
const FB_PAGE_ID = process.env.FB_PAGE_ID || '107811450656942'
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3001'
const CHECK_INTERVAL = parseInt(process.env.INBOX_CHECK_INTERVAL || '300000') // 5 min default
const STATE_FILE = path.join(__dirname, '../data/inbox-state.json')

// UI noise patterns
const UI_NOISE = [
  'Hộp thư', 'Messenger', 'Instagram', 'WhatsApp', 'Tìm kiếm', 'Quản lý',
  'Tạo', 'Meta Business Suite', 'Tất cả tin nhắn', 'Chưa đọc', 'Ưu tiên',
  'Trao đổi thêm', 'Bình luận trên', 'Kết nối với', 'Lúc khác', 'Trạng thái',
  'Đang có mặt', 'Cài đặt', 'Thông tin chi tiết', 'Tạo quảng cáo', 'Quy trình',
  'Xem thêm', 'Tin trả lời', 'Nội dung', 'Trình quản lý', 'Công cụ', 'Quảng cáo',
  'Tất cả công cụ', 'Chỉnh sửa', 'Trợ giúp', 'Đóng', 'Liên kết', 'Nền tảng',
]

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
  } catch {
    return { lastCheck: null, knownMessages: {} }
  }
}

function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2))
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

async function createBrowser() {
  const browser = await chromium.launch({
    headless: true,
    args: ['--disable-blink-features=AutomationControlled'],
  })
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    locale: 'vi-VN',
    viewport: { width: 1400, height: 900 },
  })
  const cookies = [
    { name: 'c_user', value: C_USER, domain: '.facebook.com', path: '/' },
    { name: 'xs', value: XS, domain: '.facebook.com', path: '/' },
  ]
  if (DATR) cookies.push({ name: 'datr', value: DATR, domain: '.facebook.com', path: '/' })
  if (FR) cookies.push({ name: 'fr', value: FR, domain: '.facebook.com', path: '/' })
  if (SB) cookies.push({ name: 'sb', value: SB, domain: '.facebook.com', path: '/' })
  await context.addCookies(cookies)
  return { browser, context }
}

async function checkInbox(page) {
  await page.goto(`https://business.facebook.com/latest/inbox/all?asset_id=${FB_PAGE_ID}`, {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  })
  await sleep(8000)

  // Extract conversations from sidebar
  const conversations = await page.evaluate((uiNoise) => {
    const results = []
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT)
    while (walker.nextNode()) {
      const el = walker.currentNode
      const text = el.innerText?.trim()
      if (!text || text.length > 500 || text.length < 5) continue
      const lines = text.split('\n').map(l => l.trim()).filter(Boolean)
      if (lines.length < 2 || lines.length > 10) continue
      const name = lines[0]
      if (name.length < 2 || name.length > 50) continue
      if (uiNoise.some(s => name.startsWith(s))) continue
      const timeLine = lines.find(l => /^\d{1,2}:\d{2}$/.test(l))
      if (!timeLine) continue
      const rect = el.getBoundingClientRect()
      if (rect.x > 500 || rect.width < 50) continue
      const msgLines = lines.filter(l =>
        l !== name && l !== timeLine &&
        !uiNoise.some(s => l.startsWith(s)) &&
        !/^\d+$/.test(l) && !/^\d+ new/.test(l)
      )
      results.push({
        name,
        lastMessage: (msgLines[0] || '').slice(0, 200),
        time: timeLine,
        _area: rect.width * rect.height,
        _y: rect.y,
      })
    }
    const byName = new Map()
    for (const r of results) {
      const existing = byName.get(r.name)
      if (!existing || r._area < existing._area) byName.set(r.name, r)
    }
    return [...byName.values()]
      .sort((a, b) => a._y - b._y)
      .map(({ _area, _y, ...rest }) => rest)
  }, UI_NOISE)

  return conversations
}

// Forward new messages via configured channels
async function forwardMessage(name, message, time) {
  const text = `📨 **${name}** (${time})\n${message}`
  
  // Forward to backend API (which can relay to Discord/Zalo)
  try {
    await fetch(`${BACKEND_URL}/api/agent-cli/inbox-alert`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, message, time, text }),
    }).catch(() => {})
  } catch {}

  console.log(`[inbox-monitor] 📨 ${name} (${time}): ${message}`)
}

async function run() {
  console.log(`[inbox-monitor] Starting — check every ${CHECK_INTERVAL / 1000}s`)
  
  const { browser, context } = await createBrowser()
  const page = await context.newPage()
  await page.route('**/*', route => {
    if (['media', 'font'].includes(route.request().resourceType())) return route.abort()
    return route.continue()
  })

  const state = loadState()

  while (true) {
    try {
      console.log(`[inbox-monitor] Checking inbox...`)
      const conversations = await checkInbox(page)
      
      let newCount = 0
      for (const conv of conversations) {
        const key = conv.name
        const msgKey = `${conv.name}:${conv.lastMessage}:${conv.time}`
        
        // Skip if we've seen this exact message
        if (state.knownMessages[key] === msgKey) continue
        
        // Skip messages from Page itself
        if (conv.lastMessage.startsWith('Bạn:')) continue
        
        // New message!
        state.knownMessages[key] = msgKey
        newCount++
        await forwardMessage(conv.name, conv.lastMessage, conv.time)
      }

      state.lastCheck = new Date().toISOString()
      saveState(state)
      
      if (newCount > 0) {
        console.log(`[inbox-monitor] ${newCount} new messages forwarded`)
      } else {
        console.log(`[inbox-monitor] No new messages`)
      }
    } catch (err) {
      console.error(`[inbox-monitor] Error: ${err.message}`)
    }

    // Wait before next check
    await sleep(CHECK_INTERVAL)
  }
}

// Graceful shutdown
process.on('SIGINT', () => { console.log('[inbox-monitor] Stopped'); process.exit(0) })
process.on('SIGTERM', () => { console.log('[inbox-monitor] Stopped'); process.exit(0) })

run().catch(err => {
  console.error('[inbox-monitor] Fatal:', err.message)
  process.exit(1)
})
