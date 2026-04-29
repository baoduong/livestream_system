// Facebook Comment Enricher — Primary comment source
// Uses Playwright persistent browser profile to intercept GraphQL responses
// from Business Suite Live Producer → extract comments with full user info
//
// Anti-detection: human-like behavior, Bézier mouse, random timing, stealth scripts

import { chromium } from 'playwright'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'
import EventEmitter from 'events'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PROFILE_DIR = path.join(__dirname, '..', 'data', 'browser-profile')

function decodeUnicode(str) {
  return str.replace(/\\u([0-9a-fA-F]{4})/g, (_, code) =>
    String.fromCharCode(parseInt(code, 16))
  )
}

function rand(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min
}
function sleep(ms) {
  return new Promise(r => setTimeout(r, ms))
}
// Gaussian random — more natural timing than uniform
function gaussRand(mean, stddev) {
  const u1 = Math.random()
  const u2 = Math.random()
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
  return Math.max(mean * 0.3, Math.round(mean + z * stddev))
}

// ─── Human-like mouse movement (Bézier curve) ───────────────────────────────
async function humanMove(page, toX, toY) {
  const from = await page.evaluate(() => ({
    x: window._mouseX || 640,
    y: window._mouseY || 450,
  }))
  const steps = rand(8, 15)
  const cpX = (from.x + toX) / 2 + rand(-100, 100)
  const cpY = (from.y + toY) / 2 + rand(-50, 50)

  for (let i = 1; i <= steps; i++) {
    const t = i / steps
    const x = (1 - t) ** 2 * from.x + 2 * (1 - t) * t * cpX + t ** 2 * toX
    const y = (1 - t) ** 2 * from.y + 2 * (1 - t) * t * cpY + t ** 2 * toY
    await page.mouse.move(x, y)
    await sleep(rand(5, 25))
  }
  await page.evaluate(({ x, y }) => {
    window._mouseX = x
    window._mouseY = y
  }, { x: toX, y: toY })
}

// ─── Human-like click ────────────────────────────────────────────────────────
async function humanClick(page, selectorOrElement, timeout = 3000) {
  let el
  if (typeof selectorOrElement === 'string') {
    el = await page.waitForSelector(selectorOrElement, { timeout })
  } else {
    el = selectorOrElement
  }
  if (!el) return false
  const box = await el.boundingBox()
  if (!box) return false
  const x = box.x + rand(Math.floor(box.width * 0.2), Math.floor(box.width * 0.8))
  const y = box.y + rand(Math.floor(box.height * 0.2), Math.floor(box.height * 0.8))
  await humanMove(page, x, y)
  await sleep(rand(50, 200))
  await page.mouse.down()
  await sleep(rand(40, 120))
  await page.mouse.up()
  return true
}

// ─── Realistic user behavior simulation ──────────────────────────────────────
async function simulateHuman(page) {
  const action = rand(1, 15)
  try {
    switch (action) {
      case 1:
        // Gentle scroll down
        await page.mouse.wheel(0, rand(30, 120))
        break
      case 2:
        // Scroll back up
        await page.mouse.wheel(0, -rand(10, 50))
        break
      case 3:
      case 4:
        // Random mouse movement
        await humanMove(page, rand(200, 1200), rand(100, 800))
        break
      case 5:
        // Mouse fidget (small movements)
        for (let i = 0; i < rand(2, 4); i++) {
          await page.mouse.move(640 + rand(-15, 15), 400 + rand(-10, 10))
          await sleep(rand(100, 400))
        }
        break
      case 6:
      case 7:
        // Idle pause (user reading/thinking)
        await sleep(rand(1000, 4000))
        break
      case 8:
        // Move to top area (like checking tabs)
        await humanMove(page, rand(900, 1100), rand(40, 120))
        await sleep(rand(300, 800))
        break
      case 9:
        // Double scroll
        await page.mouse.wheel(0, rand(40, 80))
        await sleep(rand(200, 600))
        await page.mouse.wheel(0, rand(10, 30))
        break
      case 10:
        // Move mouse to comments area
        await humanMove(page, rand(300, 800), rand(300, 700))
        await sleep(rand(200, 500))
        break
      case 11:
        // Hover over a random element briefly
        await humanMove(page, rand(100, 1300), rand(100, 800))
        await sleep(rand(500, 1500))
        await humanMove(page, rand(500, 900), rand(400, 600))
        break
      case 12:
        // Quick scroll then pause
        await page.mouse.wheel(0, rand(50, 100))
        await sleep(rand(1000, 3000))
        await page.mouse.wheel(0, -rand(20, 60))
        break
      default:
        // Just chill
        await sleep(rand(300, 1500))
        break
    }
  } catch {}
}

export class FacebookEnricher extends EventEmitter {
  constructor({ pageId, pageAccessToken, onComment, onError }) {
    super()
    this.pageId = pageId
    this.token = pageAccessToken
    this.onComment = onComment || (() => {})
    this.onError = onError || console.error
    this.context = null
    this.page = null
    this.running = false
    this.refreshCount = 0
    this.startTime = null

    // Cache: fbCommentId → { userId, name, text, avatarUrl }
    this.cache = new Map()
    this.pending = new Set()
  }

  // Extract comment user info from GraphQL response text
  _extractFromGraphQL(responseText) {
    const results = []
    const chunks = responseText.split('TopLevelCommentsEdge')

    for (const chunk of chunks) {
      const authorMatch = chunk.match(
        /"author":\{"__typename":"User","id":"(\d{5,})","name":"([^"]+)"/
      )
      if (!authorMatch) continue

      const userId = authorMatch[1]
      const name = decodeUnicode(authorMatch[2])

      // Skip page's own comments
      if (userId === this.pageId) continue

      const commentIdMatch = chunk.match(/comment_id=(\d+)/)
      const fbCommentId = commentIdMatch ? commentIdMatch[1] : null

      const bodyMatch = chunk.match(/"body":\{"text":"([^"]{0,500})"/)
      const text = bodyMatch ? decodeUnicode(bodyMatch[1]) : ''

      const picMatch = chunk.match(/"profile_picture_depth_0":\{"uri":"([^"]+)"/)
      const avatarUrl = picMatch ? picMatch[1].replace(/\\/g, '') : null

      if (fbCommentId) {
        results.push({ fbCommentId, userId, name, text, avatarUrl })
      }
    }

    return results
  }

  async start(videoId) {
    if (this.running) return
    this.running = true
    this.startTime = Date.now()

    console.log('[enricher] Starting Facebook Comment Enricher...')
    console.log(`[enricher] Profile: ${PROFILE_DIR}`)

    if (!fs.existsSync(PROFILE_DIR)) {
      fs.mkdirSync(PROFILE_DIR, { recursive: true })
    }

    try {
      this.context = await chromium.launchPersistentContext(PROFILE_DIR, {
        headless: true,
        args: [
          '--disable-blink-features=AutomationControlled',
          '--disable-features=IsolateOrigins,site-per-process',
          '--disable-dev-shm-usage',
          '--no-first-run',
          '--no-default-browser-check',
          '--disable-infobars',
          '--window-size=1440,900',
          '--disable-backgrounding-occluded-windows',
          '--disable-component-extensions-with-background-pages',
          '--disable-default-apps',
          '--disable-extensions',
          '--disable-hang-monitor',
          '--disable-popup-blocking',
          '--disable-prompt-on-repost',
          '--disable-sync',
          '--disable-translate',
          '--metrics-recording-only',
          '--no-service-autorun',
          '--password-store=basic',
        ],
        locale: 'vi-VN',
        timezoneId: 'Asia/Ho_Chi_Minh',
        viewport: { width: 1440, height: 900 },
        deviceScaleFactor: 2,
        hasTouch: false,
        colorScheme: 'light',
        permissions: ['notifications'],
        geolocation: { latitude: 10.8231, longitude: 106.6297 },
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
        extraHTTPHeaders: {
          'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7',
          'sec-ch-ua': '"Chromium";v="136", "Google Chrome";v="136", "Not.A/Brand";v="99"',
          'sec-ch-ua-mobile': '?0',
          'sec-ch-ua-platform': '"macOS"',
        },
      })

      this.page = this.context.pages()[0] || await this.context.newPage()

      // ─── Comprehensive anti-detection ──────────────────────────────────
      await this.page.addInitScript(() => {
        // Hide webdriver
        Object.defineProperty(navigator, 'webdriver', { get: () => false })
        
        // Remove Playwright/automation indicators
        delete window.__playwright
        delete window.__pw_manual
        
        // Override navigator properties
        Object.defineProperty(navigator, 'languages', { get: () => ['vi-VN', 'vi', 'en-US', 'en'] })
        Object.defineProperty(navigator, 'platform', { get: () => 'MacIntel' })
        Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 })
        Object.defineProperty(navigator, 'deviceMemory', { get: () => 8 })
        Object.defineProperty(navigator, 'maxTouchPoints', { get: () => 0 })
        
        // Chrome runtime mock
        window.chrome = {
          runtime: {
            connect: () => {},
            sendMessage: () => {},
            onMessage: { addListener: () => {} },
          },
          loadTimes: () => ({}),
          csi: () => ({}),
        }
        
        // Permissions API mock
        const originalQuery = window.navigator.permissions?.query
        if (originalQuery) {
          window.navigator.permissions.query = (parameters) => {
            if (parameters.name === 'notifications') {
              return Promise.resolve({ state: Notification.permission })
            }
            return originalQuery(parameters)
          }
        }
        
        // WebGL vendor/renderer (match real Chrome on Mac)
        const getParameter = WebGLRenderingContext.prototype.getParameter
        WebGLRenderingContext.prototype.getParameter = function (parameter) {
          if (parameter === 37445) return 'Google Inc. (Apple)'
          if (parameter === 37446) return 'ANGLE (Apple, Apple M1 Pro, OpenGL 4.1)'
          return getParameter.call(this, parameter)
        }
        
        // Plugin count (real Chrome has plugins)
        Object.defineProperty(navigator, 'plugins', {
          get: () => {
            const plugins = [
              { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer' },
              { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai' },
              { name: 'Native Client', filename: 'internal-nacl-plugin' },
            ]
            plugins.length = 3
            return plugins
          },
        })
        
        // Prevent iframe detection
        try {
          Object.defineProperty(HTMLIFrameElement.prototype, 'contentWindow', {
            get: function () {
              return window
            },
          })
        } catch {}
        
        // Mouse position tracking for humanMove
        window._mouseX = 640
        window._mouseY = 450
      })

      // Block heavy media (save bandwidth, reduce fingerprint)
      await this.page.route('**/*', route => {
        const url = route.request().url()
        const type = route.request().resourceType()
        // Block video streams
        if (url.includes('.mp4') || url.includes('.m3u8') || url.includes('/live_manifest') || url.includes('/dash_manifest'))
          return route.abort()
        // Block large images (except small avatars/icons)
        if (type === 'image' && url.includes('scontent') && !url.includes('50x50') && !url.includes('100x100'))
          return route.abort()
        return route.continue()
      })

      // Intercept GraphQL responses → extract comments
      this.page.on('response', async response => {
        try {
          const ct = response.headers()['content-type'] || ''
          if (!ct.includes('json') && !ct.includes('text')) return
          const text = await response.text()
          if (!text.includes('"author"') || text.length < 500) return

          const results = this._extractFromGraphQL(text)
          for (const r of results) {
            const prev = this.cache.get(r.fbCommentId)
            if (prev) continue

            this.cache.set(r.fbCommentId, r)
            console.log(`[enricher] Comment: ${r.name}: ${r.text || '(no text)'}`)

            this.onComment(r)
            this.emit('comment', r)
          }
        } catch {}
      })

      // Check login state
      console.log('[enricher] Checking login...')
      await this.page.goto('https://www.facebook.com', { waitUntil: 'domcontentloaded', timeout: 30000 })
      await sleep(rand(2000, 4000))
      // Do some human-like stuff on homepage
      await simulateHuman(this.page)

      const url = this.page.url()
      if (url.includes('login')) {
        console.error('[enricher] ❌ NOT LOGGED IN — run fb-crawler.js first with headless:false to login')
        this.running = false
        return false
      }
      console.log('[enricher] ✅ Logged in')

      // Natural navigation pause
      await sleep(rand(1000, 2000))
      await simulateHuman(this.page)

      // Navigate to Business Suite live producer comments
      const videoUrl = `https://business.facebook.com/live/producer/dashboard/${videoId}/COMMENTS/`
      console.log(`[enricher] Opening: ${videoUrl}`)
      await this.page.goto(videoUrl, { waitUntil: 'domcontentloaded', timeout: 30000 })
      await sleep(rand(4000, 7000))
      await simulateHuman(this.page)

      // Click comments tab
      try {
        await humanClick(this.page, 'text=Bình luận', 5000)
        console.log('[enricher] Clicked Bình luận tab')
        await sleep(rand(1500, 3000))
      } catch {}

      // Switch to "All comments" / "Newest" to avoid relevant comment filter
      await this._switchToAllComments()

      console.log('[enricher] ✅ Ready — watching GraphQL responses')

      // Start refresh loop with human behavior
      this._refreshLoop()

      return true
    } catch (err) {
      console.error(`[enricher] Failed to start: ${err.message}`)
      this.running = false
      return false
    }
  }

  // Switch comment filter from "Relevant" to "All comments" / "Newest"
  async _switchToAllComments() {
    try {
      // Business Suite Live Producer: look for filter dropdown
      // Common selectors: "Lọc bình luận", "Liên quan nhất", dropdown arrow near comments
      const filterSelectors = [
        // Vietnamese labels
        'text=Liên quan nhất',
        'text=Relevant',
        'text=Most relevant',
        'text=Bình luận liên quan nhất',
        // Generic dropdown near comments
        '[aria-label="Lọc bình luận"]',
        '[aria-label="Comment filter"]',
        '[aria-label="Filter comments"]',
      ]

      let clicked = false
      for (const sel of filterSelectors) {
        try {
          const el = await this.page.$(sel)
          if (el) {
            await humanClick(this.page, el, 2000)
            console.log(`[enricher] Clicked filter: ${sel}`)
            clicked = true
            await sleep(rand(1000, 2000))
            break
          }
        } catch {}
      }

      if (!clicked) {
        console.log('[enricher] No filter dropdown found (may already show all comments)')
        return
      }

      // Now click "All comments" / "Newest" / "Tất cả bình luận" / "Mới nhất"
      const allSelectors = [
        'text=Tất cả bình luận',
        'text=Mới nhất',
        'text=All comments',
        'text=Newest',
        'text=All Comments',
      ]

      for (const sel of allSelectors) {
        try {
          const el = await this.page.$(sel)
          if (el) {
            await humanClick(this.page, el, 2000)
            console.log(`[enricher] ✅ Switched to: ${sel}`)
            await sleep(rand(1500, 2500))
            return
          }
        } catch {}
      }

      console.log('[enricher] Could not find "All comments" option')
    } catch (err) {
      console.log(`[enricher] Filter switch failed: ${err.message}`)
    }
  }

  // Refresh loop with human-like behavior
  async _refreshLoop() {
    while (this.running && this.page) {
      try {
        this.refreshCount++

        // Try clicking refresh button with human-like click
        const btn = await this.page.$('div[aria-label="Làm mới"]')
        if (btn) {
          await humanClick(this.page, btn, 3000)
        } else {
          // Fallback: scroll to trigger load
          await this.page.mouse.wheel(0, rand(30, 80))
          await sleep(rand(300, 600))
          await this.page.mouse.wheel(0, -rand(10, 30))
        }

        // Random human behavior between refreshes (30% chance)
        if (rand(1, 3) === 1) {
          await simulateHuman(this.page)
        }

        // Occasionally do a longer pause (simulate distraction) — every ~20 refreshes
        if (rand(1, 20) === 1) {
          const longPause = rand(5000, 15000)
          console.log(`[enricher] Taking a break (${Math.round(longPause / 1000)}s)...`)
          await sleep(longPause)
          await simulateHuman(this.page)
        }

        // Variable timing: mostly 3-5s, occasionally faster or slower
        const delay = rand(1, 20) === 1
          ? rand(6000, 10000)  // 5% chance: slower refresh
          : gaussRand(4000, 800)  // Normal: ~4s ± 0.8s
        await sleep(delay)

        // Log stats periodically
        if (this.refreshCount % 100 === 0) {
          const elapsed = Math.round((Date.now() - this.startTime) / 60000)
          console.log(`[enricher] Stats: ${this.refreshCount} refreshes, ${this.cache.size} comments cached, ${elapsed}min elapsed`)
        }
      } catch (err) {
        console.error(`[enricher] Refresh error: ${err.message}`)
        await sleep(rand(3000, 5000))
      }
    }
  }

  // Request enrichment for a comment ID
  enrich(fbCommentId) {
    const shortId = fbCommentId.includes('_') ? fbCommentId.split('_').pop() : fbCommentId
    const cached = this.cache.get(shortId)
    if (cached) return cached
    this.pending.add(shortId)
    return null
  }

  enrichBatch(fbCommentIds) {
    const results = []
    for (const id of fbCommentIds) {
      const r = this.enrich(id)
      if (r) results.push(r)
    }
    return results
  }

  async stop() {
    this.running = false
    const elapsed = this.startTime ? Math.round((Date.now() - this.startTime) / 60000) : 0
    if (this.context) {
      try { await this.context.close() } catch {}
      this.context = null
      this.page = null
    }
    console.log(`[enricher] Stopped (${this.refreshCount} refreshes, ${this.cache.size} comments, ${elapsed}min)`)
  }

  isRunning() {
    return this.running
  }

  getCacheSize() {
    return this.cache.size
  }

  getPendingCount() {
    return this.pending.size
  }
}
