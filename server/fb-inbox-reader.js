// Read FB Page Inbox via Playwright (Business Suite)
// Usage:
//   node server/fb-inbox-reader.js                  -- list conversations
//   node server/fb-inbox-reader.js --read "Tám Bà"  -- read messages from specific person
//   node server/fb-inbox-reader.js --limit 20       -- limit results
//   node server/fb-inbox-reader.js --screenshot     -- save screenshot

import { chromium } from 'playwright'
import { config } from 'dotenv'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
config({ path: path.join(__dirname, '../.env') })

const C_USER = process.env.FB_COOKIE_C_USER || ''
const XS = process.env.FB_COOKIE_XS || ''
const DATR = process.env.FB_COOKIE_DATR || ''
const FR = process.env.FB_COOKIE_FR || ''
const SB = process.env.FB_COOKIE_SB || ''
const FB_PAGE_ID = process.env.FB_PAGE_ID || '107811450656942'

const args = process.argv.slice(2)
const getArg = (name) => {
  const idx = args.indexOf(name)
  return idx >= 0 && args[idx + 1] ? args[idx + 1] : null
}
const limit = parseInt(getArg('--limit') || '20')
const readTarget = getArg('--read')
const doScreenshot = args.includes('--screenshot')

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

// UI noise patterns to filter out
const UI_NOISE = [
  'Hộp thư', 'Messenger', 'Instagram', 'WhatsApp', 'Tìm kiếm', 'Quản lý',
  'Tạo', 'Meta Business Suite', 'Tất cả tin nhắn', 'Chưa đọc', 'Ưu tiên',
  'Trao đổi thêm', 'Bình luận trên', 'Kết nối với', 'Lúc khác', 'Trạng thái',
  'Đang có mặt', 'Cài đặt', 'Thông tin chi tiết', 'Tạo quảng cáo', 'Quy trình',
  'Xem thêm', 'Tin trả lời', 'Nội dung', 'Trình quản lý', 'Công cụ', 'Quảng cáo',
  'Tất cả công cụ', 'Chỉnh sửa', 'Trợ giúp', 'Đóng', 'Liên kết', 'Nền tảng',
  'Mở menu', 'Chỉ định cuộc', 'Xem trang cá nhân', 'Mục khác', 'Thu gọn',
  'Chi tiết liên hệ', 'Bổ sung chi tiết', 'Thêm chi tiết', 'Chia sẻ dữ liệu',
  'Hoạt động', 'Khuyên dùng', 'Đánh dấu', 'Trạng thái đơn', 'Tạo đơn đặt hàng',
  'Giai đoạn khách', 'Xem trong Trung tâm', 'Stage Selector', 'Tiếp nhận',
  'Nhãn', 'Quản lý nhãn', 'Ghi chú', 'Theo dõi', 'Thêm ghi chú', 'Ảnh được chia sẻ',
  'Lời nhắc', 'Không có lời nhắc', 'Lên lịch', 'Trang chủ', 'Thông báo',
  'Trả lời trong Messenger', 'Trả lời tin nhắn', 'Hãy kết nối', 'Tìm hiểu thêm',
  'Hệ thống đã tự động', 'Đã tự động tạo', 'Mới', 'new s',
]

function isNoise(text) {
  const t = text.trim()
  if (t.length < 2) return true
  if (/^\d{1,2}:\d{2}$/.test(t)) return true // pure time "08:37"
  if (/^Hôm nay/.test(t)) return true
  if (/^Hôm qua$/.test(t)) return true
  if (/^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(t)) return true // pure date
  if (/^\d{1,2}:\d{2}\s+\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(t)) return true // "12:17 3/11/25"
  if (/^\d{1,2}:\d{2}\s+T\d$/.test(t)) return true // "18:02 T2"
  if (UI_NOISE.some(n => t.startsWith(n))) return true
  if (t === 'Ok' || t === 'Mở' || t === 'Kết nối') return true
  return false
}

// ─── List conversations ──────────────────────────────────────────────────────
async function listConversations(page) {
  return await page.evaluate((uiNoise) => {
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

      // Must have time pattern
      const timeLine = lines.find(l => /^\d{1,2}:\d{2}$/.test(l))
      if (!timeLine) continue

      // Must be in left sidebar (x < 500)
      const rect = el.getBoundingClientRect()
      if (rect.x > 500 || rect.width < 50) continue

      const msgLines = lines.filter(l =>
        l !== name && l !== timeLine &&
        !uiNoise.some(s => l.startsWith(s)) &&
        !/^\d+$/.test(l) && !/^\d+ new/.test(l)
      )
      const message = msgLines[0] || ''
      const tags = lines.filter(l =>
        ['Ưu tiên', 'Tiếp nhận', 'Đã đặt'].some(t => l.includes(t))
      )

      results.push({
        name,
        lastMessage: message.slice(0, 200),
        time: timeLine,
        tags: tags.length > 0 ? tags : undefined,
        _area: rect.width * rect.height,
        _y: rect.y,
      })
    }

    // Dedup by name — keep smallest area (most specific element)
    const byName = new Map()
    for (const r of results) {
      const existing = byName.get(r.name)
      if (!existing || r._area < existing._area) {
        byName.set(r.name, r)
      }
    }

    return [...byName.values()]
      .sort((a, b) => a._y - b._y)
      .map(({ _area, _y, ...rest }) => rest)
  }, UI_NOISE)
}

// ─── Read specific conversation ──────────────────────────────────────────────
async function readConversation(page, targetName) {
  console.log(`[inbox] Looking for: ${targetName}`)

  // Click on the conversation in sidebar
  const clicked = await page.evaluate((name) => {
    const nameLower = name.toLowerCase()
    const candidates = []
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT)
    while (walker.nextNode()) {
      const el = walker.currentNode
      const text = el.innerText?.trim()
      if (!text) continue
      
      const firstLine = text.split('\n')[0].trim()
      // Exact match OR partial match (contains)
      if (firstLine.toLowerCase() !== nameLower && !firstLine.toLowerCase().includes(nameLower)) continue
      
      const rect = el.getBoundingClientRect()
      if (rect.x > 500 || rect.width < 100 || rect.height < 30 || rect.height > 150) continue
      if (rect.y < 100) continue
      // Prefer exact match
      const isExact = firstLine.toLowerCase() === nameLower
      candidates.push({ el, area: rect.width * rect.height, y: rect.y, exact: isExact })
    }
    
    if (candidates.length === 0) return null
    
    // Prefer exact matches, then smallest area
    candidates.sort((a, b) => (b.exact - a.exact) || (a.area - b.area))
    const chosen = candidates[0]
    chosen.el.click()
    return chosen.el.innerText.split('\n')[0].trim()
  }, targetName)

  if (!clicked) {
    console.log(`[inbox] Not found: ${targetName}`)
    return []
  }

  console.log(`[inbox] Opened: ${clicked}`)
  await sleep(4000)

  // Extract messages from center panel (x: 460-900)
  const messages = await page.evaluate((noiseList) => {
    const results = []
    const seen = new Set()
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT)

    while (walker.nextNode()) {
      const el = walker.currentNode
      const rect = el.getBoundingClientRect()

      // Center panel only (between sidebar and right panel)
      if (rect.x < 450 || rect.x > 920) continue
      if (rect.height < 10 || rect.height > 200) continue
      if (rect.y < 120) continue // skip header

      const text = el.innerText?.trim()
      if (!text || text.length < 2 || text.length > 500) continue

      // Skip if contains newlines (probably a container, not a message)
      if (text.includes('\n') && el.children.length > 2) continue

      // Skip noise
      if (noiseList.some(n => text.startsWith(n))) continue
      if (/^\d{1,2}:\d{2}$/.test(text)) continue // pure time
      if (/^\d{1,2}:\d{2}\s+T\d/.test(text)) continue
      if (/^Hôm (nay|qua)/.test(text)) continue
      if (text === 'Ok' && el.children.length > 0) continue

      // Skip duplicates
      if (seen.has(text)) continue
      seen.add(text)

      // Determine if sent by page (blue bubble = right aligned) or customer (left)
      const isFromPage = rect.x > 600

      results.push({
        from: isFromPage ? 'page' : 'customer',
        text: text.replace(/\n/g, ' ').slice(0, 300),
        _y: rect.y,
      })
    }

    return results
      .sort((a, b) => a._y - b._y)
      .map(({ _y, ...rest }) => rest)
  }, UI_NOISE)

  return messages
}

// ─── Main ────────────────────────────────────────────────────────────────────
async function main() {
  if (!C_USER || !XS) {
    console.error('[inbox] Missing FB cookies in .env')
    process.exit(1)
  }

  console.log(`[inbox] Mode: ${readTarget ? `read "${readTarget}"` : 'list'}`)

  const { browser, context } = await createBrowser()
  const page = await context.newPage()

  await page.route('**/*', route => {
    if (['media', 'font'].includes(route.request().resourceType())) return route.abort()
    return route.continue()
  })

  console.log('[inbox] Opening inbox...')
  await page.goto(`https://business.facebook.com/latest/inbox/all?asset_id=${FB_PAGE_ID}`, {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  })
  await sleep(8000)

  if (doScreenshot) {
    const ssPath = path.join(__dirname, '../data/inbox-screenshot.png')
    await page.screenshot({ path: ssPath, fullPage: false })
    console.log(`[inbox] Screenshot: ${ssPath}`)
  }

  if (readTarget) {
    const messages = await readConversation(page, readTarget)
    console.log(`\n[inbox] ${messages.length} messages:`)
    messages.forEach((m, i) => {
      const prefix = m.from === 'page' ? '→' : '←'
      console.log(`  ${prefix} ${m.text}`)
    })
    console.log('\n[inbox] JSON:')
    console.log(JSON.stringify(messages, null, 2))
  } else {
    const conversations = await listConversations(page)
    console.log(`\n[inbox] ${conversations.length} conversations:`)
    conversations.slice(0, limit).forEach((c, i) => {
      const tags = c.tags ? ` [${c.tags.join(', ')}]` : ''
      console.log(`  ${i + 1}. ${c.name} (${c.time}): "${c.lastMessage}"${tags}`)
    })
    console.log('\n[inbox] JSON:')
    console.log(JSON.stringify(conversations.slice(0, limit), null, 2))
  }

  await browser.close()
}

main().catch(err => {
  console.error('[inbox] Fatal:', err.message)
  process.exit(1)
})
