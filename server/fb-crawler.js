// Facebook Live Comment Crawler v4 — STEALTH mode
// Full anti-detection: all cookies, realistic browser profile, human behavior
//
// Usage: node server/fb-crawler.js [video-url]
// Requires: FB_COOKIE_* in .env

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
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3001'
const FB_PAGE_ID = process.env.FB_PAGE_ID || '107811450656942'
const FB_PAGE_TOKEN = process.env.FB_PAGE_TOKEN || ''

if (!C_USER || !XS) {
  console.error('[crawler] Missing FB_COOKIE_C_USER or FB_COOKIE_XS in .env')
  process.exit(1)
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function rand(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }
function decodeUnicode(str) {
  return str.replace(/\\u([0-9a-fA-F]{4})/g, (_, code) => String.fromCharCode(parseInt(code, 16)))
}
// Gaussian-like random for more natural timing
function gaussRand(mean, stddev) {
  const u1 = Math.random()
  const u2 = Math.random()
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
  return Math.max(mean * 0.3, Math.round(mean + z * stddev))
}

// ─── Extract comments from GraphQL response ─────────────────────────────────
function extractComments(text) {
  const comments = []
  const chunks = text.split('TopLevelCommentsEdge')

  for (const chunk of chunks) {
    const authorMatch = chunk.match(/"author":\{"__typename":"User","id":"(\d{5,})","name":"([^"]+)"/)
    if (!authorMatch) continue

    const bodyMatch = chunk.match(/"body":\{"text":"([^"]{0,500})"/)
    const commentText = bodyMatch ? decodeUnicode(bodyMatch[1]) : ''
    const name = decodeUnicode(authorMatch[2])
    const userId = authorMatch[1]

    // Skip page's own comments
    if (userId === '107811450656942' || userId === '100055680767712') continue

    const timeMatch = chunk.match(/"created_time":(\d+)/)
    const createdTime = timeMatch ? parseInt(timeMatch[1]) : null

    const commentIdMatch = chunk.match(/comment_id=(\d+)/)
    const fbCommentId = commentIdMatch ? commentIdMatch[1] : null

    const picMatch = chunk.match(/"profile_picture_depth_0":\{"uri":"([^"]+)"/)
    const avatarUrl = picMatch ? picMatch[1].replace(/\\/g, '') : null

    comments.push({ fbCommentId, userId, name, text: commentText, createdTime, avatarUrl })
  }

  return comments
}

// ─── Push comment to backend ─────────────────────────────────────────────────
const seenCommentIds = new Set()

async function pushComment(comment) {
  // Always update avatar if available (URLs expire)
  if (comment.avatarUrl && comment.userId) {
    fetch(`${BACKEND_URL}/api/comments/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customerName: comment.name,
        commentText: '__avatar_update__',
        avatarUrl: comment.avatarUrl,
        facebookUserId: comment.userId,
        platform: 'system',
      }),
    }).catch(() => {})
  }

  const key = comment.fbCommentId || `${comment.name}:${comment.text}`
  if (seenCommentIds.has(key)) return false
  seenCommentIds.add(key)

  try {
    const res = await fetch(`${BACKEND_URL}/api/comments/import`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customerName: comment.name,
        commentText: comment.text,
        facebookUserId: comment.userId,
        facebookUrl: `https://facebook.com/${comment.userId}`,
        avatarUrl: comment.avatarUrl || null,
        platform: 'facebook',
        createdAt: comment.createdTime ? new Date(comment.createdTime * 1000).toISOString() : undefined,
      }),
    })
    if (!res.ok) return false
    console.log(`[comment] ${comment.name}: ${comment.text.slice(0, 50)}`)
    return true
  } catch (err) {
    console.error(`[push] Error: ${err.message}`)
    return false
  }
}

// ─── Find live video URL → Business Suite Live Producer ─────────────────────
async function findLiveVideoUrl() {
  if (process.argv[2]) return process.argv[2]

  // Step 1: Get live post from Graph API
  if (FB_PAGE_TOKEN) {
    try {
      const liveRes = await fetch(
        `https://graph.facebook.com/${FB_PAGE_ID}/live_videos?fields=id,status&limit=5&access_token=${FB_PAGE_TOKEN}`
      )
      const liveData = await liveRes.json()
      const livePost = liveData.data?.find(v => v.status === 'LIVE')

      if (!livePost) {
        console.log('[crawler] No active live video found — exiting')
        // Notify Discord
        try {
          await fetch('http://localhost:18789/api/message', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'send',
              channel: 'discord',
              channelId: '1492732763609235479',
              message: '⚠️ Crawler: Không tìm thấy live video nào đang LIVE.'
            })
          })
        } catch {}
        process.exit(1)
      }

      if (livePost) {
        // Step 2: Get video_id from post
        const videoRes = await fetch(
          `https://graph.facebook.com/${livePost.id}?fields=video&access_token=${FB_PAGE_TOKEN}`
        )
        const videoData = await videoRes.json()
        const videoId = videoData.video?.id

        if (videoId) {
          const url = `https://business.facebook.com/live/producer/dashboard/${videoId}/COMMENTS/`
          console.log(`[crawler] Auto-detected live: post=${livePost.id} video=${videoId}`)
          return url
        }
      }
      console.log('[crawler] No active live video found')
    } catch (err) {
      console.log('[crawler] No FB_PAGE_TOKEN — cannot auto-detect')
    }
  }

  console.log('[crawler] No live video URL available — exiting')
  process.exit(1)
}

// ─── Human-like mouse movement (Bézier curve) ───────────────────────────────
async function humanMove(page, toX, toY) {
  const from = await page.evaluate(() => ({ x: window._mouseX || 640, y: window._mouseY || 450 }))
  const steps = rand(8, 15)
  // Control point for Bézier
  const cpX = (from.x + toX) / 2 + rand(-100, 100)
  const cpY = (from.y + toY) / 2 + rand(-50, 50)

  for (let i = 1; i <= steps; i++) {
    const t = i / steps
    const x = (1 - t) ** 2 * from.x + 2 * (1 - t) * t * cpX + t ** 2 * toX
    const y = (1 - t) ** 2 * from.y + 2 * (1 - t) * t * cpY + t ** 2 * toY
    await page.mouse.move(x, y)
    await sleep(rand(5, 25))
  }
  // Track position
  await page.evaluate(({ x, y }) => { window._mouseX = x; window._mouseY = y }, { x: toX, y: toY })
}

// ─── Human-like click ────────────────────────────────────────────────────────
async function humanClick(page, selector, timeout = 3000) {
  const el = await page.waitForSelector(selector, { timeout })
  if (!el) return false
  const box = await el.boundingBox()
  if (!box) return false
  // Click at random point within element (not center)
  const x = box.x + rand(Math.floor(box.width * 0.2), Math.floor(box.width * 0.8))
  const y = box.y + rand(Math.floor(box.height * 0.2), Math.floor(box.height * 0.8))
  await humanMove(page, x, y)
  await sleep(rand(50, 200)) // hover before click
  await page.mouse.down()
  await sleep(rand(40, 120)) // hold duration
  await page.mouse.up()
  return true
}

// ─── Realistic user behavior ─────────────────────────────────────────────────
async function simulateHuman(page) {
  const action = rand(1, 12)
  try {
    switch (action) {
      case 1: // Scroll down slowly
        await page.mouse.wheel(0, rand(30, 120))
        break
      case 2: // Scroll up slightly (overshoot correction)
        await page.mouse.wheel(0, -rand(10, 50))
        break
      case 3: // Move mouse to random spot
        await humanMove(page, rand(200, 900), rand(100, 700))
        break
      case 4: // Hover over comment area
        await humanMove(page, rand(300, 700), rand(300, 600))
        await sleep(rand(500, 2000)) // read comment
        break
      case 5: // Micro-movements (idle fidget)
        for (let i = 0; i < rand(2, 4); i++) {
          const dx = rand(-15, 15)
          const dy = rand(-10, 10)
          await page.mouse.move(640 + dx, 400 + dy)
          await sleep(rand(100, 400))
        }
        break
      case 6: // Pause (reading)
        await sleep(rand(1000, 4000))
        break
      case 7: // Move to top-right (menu area)
        await humanMove(page, rand(900, 1100), rand(40, 120))
        await sleep(rand(300, 800))
        break
      case 8: // Slow scroll then stop
        await page.mouse.wheel(0, rand(40, 80))
        await sleep(rand(200, 600))
        await page.mouse.wheel(0, rand(10, 30))
        break
      default: // Do nothing (natural idle)
        await sleep(rand(300, 1500))
        break
    }
  } catch {}
}

// ─── Main ────────────────────────────────────────────────────────────────────
async function main() {
  console.log('[crawler] FB Live Crawler v4 — STEALTH mode')
  console.log(`[crawler] c_user: ${C_USER.slice(0, 8)}...`)

  // ─── Stealth browser launch ────────────────────────────────────────────
  const browser = await chromium.launch({
    headless: false, // headed mode — harder to detect
    args: [
      '--disable-blink-features=AutomationControlled',
      '--disable-features=IsolateOrigins,site-per-process',
      '--disable-dev-shm-usage',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-infobars',
      '--window-size=1440,900',
      '--disable-backgrounding-occluded-windows',
    ],
  })

  // ─── Realistic browser context ─────────────────────────────────────────
  // Use latest Chrome UA matching real system
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
    locale: 'vi-VN',
    timezoneId: 'Asia/Ho_Chi_Minh',
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2, // Retina
    hasTouch: false,
    colorScheme: 'light',
    permissions: ['notifications'],
    geolocation: { latitude: 10.8231, longitude: 106.6297 }, // HCM
    extraHTTPHeaders: {
      'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7',
      'sec-ch-ua': '"Chromium";v="136", "Google Chrome";v="136", "Not.A/Brand";v="99"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"macOS"',
    },
  })

  // ─── All FB cookies ────────────────────────────────────────────────────
  const cookies = [
    { name: 'c_user', value: C_USER, domain: '.facebook.com', path: '/' },
    { name: 'xs', value: XS, domain: '.facebook.com', path: '/' },
  ]
  if (DATR) cookies.push({ name: 'datr', value: DATR, domain: '.facebook.com', path: '/' })
  if (FR) cookies.push({ name: 'fr', value: FR, domain: '.facebook.com', path: '/' })
  if (SB) cookies.push({ name: 'sb', value: SB, domain: '.facebook.com', path: '/' })
  await context.addCookies(cookies)

  const page = await context.newPage()

  // ─── Anti-detection scripts ────────────────────────────────────────────
  await page.addInitScript(() => {
    // Remove webdriver flag
    Object.defineProperty(navigator, 'webdriver', { get: () => false })

    // Chrome runtime
    window.chrome = {
      runtime: { onConnect: { addListener: () => {} }, onMessage: { addListener: () => {} } },
      loadTimes: () => ({
        commitLoadTime: Date.now() / 1000,
        connectionInfo: 'h2',
        finishDocumentLoadTime: Date.now() / 1000 + 0.5,
        finishLoadTime: Date.now() / 1000 + 1,
        firstPaintAfterLoadTime: 0,
        firstPaintTime: Date.now() / 1000 + 0.3,
        navigationType: 'Other',
        npnNegotiatedProtocol: 'h2',
        requestTime: Date.now() / 1000 - 0.5,
        startLoadTime: Date.now() / 1000 - 0.3,
        wasAlternateProtocolAvailable: false,
        wasFetchedViaSpdy: true,
        wasNpnNegotiated: true,
      }),
      csi: () => ({ pageT: Date.now(), startE: Date.now(), onloadT: Date.now() }),
    }

    // Plugins
    Object.defineProperty(navigator, 'plugins', {
      get: () => {
        const arr = [
          { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
          { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '' },
          { name: 'Native Client', filename: 'internal-nacl-plugin', description: '' },
        ]
        arr.refresh = () => {}
        return arr
      }
    })

    // Languages
    Object.defineProperty(navigator, 'languages', { get: () => ['vi-VN', 'vi', 'en-US', 'en'] })

    // Hardware concurrency
    Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 10 })

    // Platform
    Object.defineProperty(navigator, 'platform', { get: () => 'MacIntel' })

    // Screen
    Object.defineProperty(screen, 'colorDepth', { get: () => 30 })

    // WebGL vendor
    const getParam = WebGLRenderingContext.prototype.getParameter
    WebGLRenderingContext.prototype.getParameter = function(param) {
      if (param === 37445) return 'Apple' // UNMASKED_VENDOR
      if (param === 37446) return 'Apple M1 Pro' // UNMASKED_RENDERER
      return getParam.call(this, param)
    }

    // Notification permission
    Object.defineProperty(Notification, 'permission', { get: () => 'default' })

    // Track mouse position for humanMove
    window._mouseX = 640
    window._mouseY = 450
    document.addEventListener('mousemove', e => {
      window._mouseX = e.clientX
      window._mouseY = e.clientY
    })
  })

  // ─── Block only heavy media (keep images for stealth) ──────────────────
  await page.route('**/*', route => {
    const url = route.request().url()
    // Only block video streaming
    if (url.includes('.mp4') || url.includes('.m3u8') ||
        url.includes('/live_manifest') || url.includes('/dash_manifest') ||
        (url.includes('.ts') && url.includes('fbcdn'))) return route.abort()
    return route.continue()
  })

  // ─── GraphQL interceptor ───────────────────────────────────────────────
  let totalComments = 0
  let totalPushed = 0

  page.on('response', async (response) => {
    try {
      const url = response.url()
      const ct = response.headers()['content-type'] || ''
      if (!ct.includes('json') && !ct.includes('text')) return
      const text = await response.text()
      // Log all responses > 50KB to debug
      if (text.length > 50000) {
        console.log(`[response] ${url.slice(0, 80)} | size=${text.length}`)
      }
      if (!text.includes('"author"') || text.length < 1000) return

      const comments = extractComments(text)
      comments.sort((a, b) => (a.createdTime || 0) - (b.createdTime || 0))

      for (const c of comments) {
        totalComments++
        if (await pushComment(c)) {
          totalPushed++
        }
      }
    } catch {}
  })

  // ─── Navigate ──────────────────────────────────────────────────────────
  const videoUrl = await findLiveVideoUrl()
  console.log(`[crawler] Opening: ${videoUrl}`)

  // Go to FB homepage first (like a real user)
  await page.goto('https://www.facebook.com', { waitUntil: 'domcontentloaded', timeout: 30000 })
  await sleep(rand(2000, 4000))
  // Check login state
  const url = page.url()
  const title = await page.title()
  console.log(`[crawler] After FB.com: url=${url} title=${title}`)
  if (url.includes('login') || title.toLowerCase().includes('log in')) {
    console.log('[crawler] NOT LOGGED IN — cookies rejected')
    await browser.close()
    process.exit(1)
  }
  await simulateHuman(page) // natural idle on homepage

  // Then navigate to live video
  await page.goto(videoUrl, { waitUntil: 'domcontentloaded', timeout: 30000 })
  await sleep(rand(3000, 6000))

  // Check the actual URL we're on
  const afterUrl = page.url()
  console.log(`[crawler] After nav: ${afterUrl}`)

  // Click comments tab
  try {
    await humanClick(page, 'text=Bình luận', 5000)
    console.log('[crawler] Clicked Bình luận')
    await sleep(rand(1000, 2000))
  } catch {}

  // Debug: capture page state
  await sleep(3000)
  const pageState = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('[role="button"], button, div'))
      .filter(el => el.textContent.trim())
      .slice(0, 20)
      .map(el => `${el.tagName}[aria-label="${el.getAttribute('aria-label')}" role="${el.getAttribute('role')}"] "${el.textContent.trim().slice(0, 30)}"`)
    return {
      url: window.location.href,
      title: document.title,
      elements: btns,
      commentsCount: document.querySelectorAll('[data-pagelet*="Comment"], [aria-label*="comment" i]').length
    }
  })
  console.log(`[crawler] Page state:`, JSON.stringify(pageState, null, 2))

  console.log('[crawler] Watching for comments...')

  // ─── Main loop: refresh with human-like timing ─────────────────────────
  let tick = 0
  let refreshing = false

  async function refreshComments() {
    if (refreshing) return
    refreshing = true
    try {
      // Try primary selector
      const btn = await page.$('div[aria-label="Làm mới"]')
      if (btn) {
        console.log('[refresh] Found Làm mới button, clicking...')
        await humanClick(page, 'div[aria-label="Làm mới"]', 3000)
        console.log('[refresh] Clicked OK')
      } else {
        console.log('[refresh] div[aria-label="Làm mới"] NOT FOUND')
        // Try fallback
        const fallback = await page.$('[aria-label*="refresh" i], [aria-label*="reload" i]')
        if (fallback) {
          console.log('[refresh] Using fallback button')
          await humanClick(page, fallback, 3000)
        }
      }
    } catch (err) {
      console.error(`[refresh] Error: ${err.message}`)
    }
    refreshing = false
  }

  async function loop() {
    console.log('[loop] Started')
    while (true) {
      try {
        tick++
        if (tick % 5 === 0) console.log(`[loop] tick=${tick}`)

        // Refresh comments
        await refreshComments()

        // Human simulation after refresh (random)
        if (rand(1, 3) === 1) {
          await simulateHuman(page)
        }

        // Stats every 30 ticks
        if (tick % 30 === 0) {
          console.log(`[crawler] Stats: ${totalComments} seen, ${totalPushed} pushed, ${seenCommentIds.size} unique`)
        }

        // Variable delay: mostly 2-3s, occasionally longer (human-like)
        const delay = rand(1, 20) === 1
          ? rand(5000, 10000)  // 5% chance of long pause (distracted)
          : gaussRand(2500, 400) // Normal: ~2.5s ± 0.4s
        await sleep(delay)
      } catch (err) {
        console.error(`[loop] Error: ${err.message} at tick ${tick}`)
        await sleep(3000)
      }
    }
  }

  console.log('[crawler] About to start loop...')
  loop().catch(err => {
    console.error('[loop] Fatal:', err.message)
    process.exit(1)
  })

  // ─── Graceful shutdown ─────────────────────────────────────────────────
  const shutdown = async () => {
    console.log(`[crawler] Shutdown: ${totalPushed} comments pushed`)
    try { await browser.close() } catch {}
    process.exit(0)
  }

  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

main().catch(err => {
  console.error('[crawler] Fatal:', err.message)
  process.exit(1)
})
