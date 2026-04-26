// Facebook Live Comment Crawler v3 — PRIMARY comment source
// Intercepts GraphQL responses → pushes comments to backend API
// Replaces FB API polling entirely
//
// Usage: node server/fb-crawler.js [video-url]
// Requires: FB_COOKIE_C_USER + FB_COOKIE_XS in .env

import { chromium } from 'playwright'
import { config } from 'dotenv'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
config({ path: path.join(__dirname, '../.env') })

const C_USER = process.env.FB_COOKIE_C_USER || ''
const XS = process.env.FB_COOKIE_XS || ''
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3001'
const FB_PAGE_ID = process.env.FB_PAGE_ID || '107811450656942'

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

// ─── Extract comments from GraphQL response ─────────────────────────────────
function extractComments(text) {
  const comments = []

  // Split by TopLevelCommentsEdge — each chunk contains one comment
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

    // Extract created_time for proper ordering
    const timeMatch = chunk.match(/"created_time":(\d+)/)
    const createdTime = timeMatch ? parseInt(timeMatch[1]) : null

    // Comment ID
    const commentIdMatch = chunk.match(/comment_id=(\d+)/)
    const fbCommentId = commentIdMatch ? commentIdMatch[1] : null

    // Avatar from GraphQL
    const picMatch = chunk.match(/"profile_picture_depth_0":\{"uri":"([^"]+)"/)
    const avatarUrl = picMatch ? picMatch[1].replace(/\\/g, '') : null

    comments.push({
      fbCommentId,
      userId,
      name,
      text: commentText,
      createdTime,
      avatarUrl,
    })
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

  // Dedup by fbCommentId or text+name combo
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

// ─── Fetch avatar via Playwright page ────────────────────────────────────────
let avatarPage = null
const avatarCache = new Set() // user IDs already fetched

async function fetchAndSaveAvatar(userId, name) {
  if (avatarCache.has(userId) || !avatarPage) return
  avatarCache.add(userId)

  try {
    await avatarPage.goto(`https://www.facebook.com/profile.php?id=${userId}`, {
      waitUntil: 'domcontentloaded', timeout: 10000
    })
    await sleep(rand(1500, 3000))

    const avatar = await avatarPage.evaluate(() => {
      const og = document.querySelector('meta[property="og:image"]')
      if (og?.content && !og.content.includes('static')) return og.content
      const img = document.querySelector('image[preserveAspectRatio], svg image')
      if (img) return img.getAttribute('href') || null
      return null
    })

    if (avatar) {
      // Save to backend
      await fetch(`${BACKEND_URL}/api/comments/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerName: name,
          commentText: '__avatar_update__',
          avatarUrl: avatar,
          facebookUserId: userId,
          platform: 'system',
        }),
      }).catch(() => {})
      console.log(`[avatar] ${name} → ${avatar.slice(0, 60)}...`)
    }
  } catch {}
}

// ─── Random user actions (stealth) ───────────────────────────────────────────
async function randomAction(page) {
  const action = rand(1, 5)
  try {
    switch (action) {
      case 1: await page.mouse.wheel(0, rand(50, 200)); break
      case 2: await page.mouse.move(rand(100, 800), rand(100, 600)); break
      case 3: await page.mouse.move(rand(300, 700), rand(200, 400)); await sleep(rand(500, 1500)); break
      case 4: await page.mouse.wheel(0, -rand(20, 80)); break
      case 5: break
    }
  } catch {}
}

// ─── Find live video URL ─────────────────────────────────────────────────────
async function findLiveVideoUrl() {
  // CLI argument
  if (process.argv[2]) return process.argv[2]

  // Try backend API (if FB token available)
  try {
    const res = await fetch(`${BACKEND_URL}/api/fb/live`)
    const data = await res.json()
    if (data.video?.id) {
      return `https://www.facebook.com/${FB_PAGE_ID}/videos/${data.video.id}/`
    }
  } catch {}

  // Fallback: Page videos
  return `https://www.facebook.com/${FB_PAGE_ID}/videos/`
}

// ─── Main ────────────────────────────────────────────────────────────────────
async function main() {
  console.log('[crawler] FB Live Crawler v3 — PRIMARY mode')
  console.log(`[crawler] c_user: ${C_USER.slice(0, 8)}...`)

  const browser = await chromium.launch({
    headless: true,
    args: ['--disable-blink-features=AutomationControlled'],
  })

  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    locale: 'vi-VN',
    viewport: { width: 1280, height: 900 },
  })

  await context.addCookies([
    { name: 'c_user', value: C_USER, domain: '.facebook.com', path: '/' },
    { name: 'xs', value: XS, domain: '.facebook.com', path: '/' },
  ])

  // Main page — watch live video
  const page = await context.newPage()

  // Avatar page — fetch profiles
  avatarPage = await context.newPage()
  await avatarPage.route('**/*', route => {
    if (['media', 'font', 'stylesheet'].includes(route.request().resourceType())) return route.abort()
    return route.continue()
  })

  // Block video streaming only (save bandwidth, keep everything else for stealth)
  await page.route('**/*', route => {
    const url = route.request().url()
    // Block video streaming URLs (chiếm ~90% bandwidth)
    if (url.includes('.mp4') || url.includes('.m3u8') || url.includes('.ts') ||
        url.includes('/live_manifest') || url.includes('/dash_manifest') ||
        (url.includes('video') && url.includes('fbcdn'))) return route.abort()
    return route.continue()
  })

  // ─── GraphQL interceptor ───────────────────────────────────────────────
  let totalComments = 0
  let totalPushed = 0

  page.on('response', async (response) => {
    try {
      const ct = response.headers()['content-type'] || ''
      if (!ct.includes('json') && !ct.includes('text')) return

      const text = await response.text()
      if (!text.includes('"author"') || text.length < 1000) return

      const comments = extractComments(text)

      // Sort by FB created_time ASC (oldest first) to maintain correct order
      comments.sort((a, b) => (a.createdTime || 0) - (b.createdTime || 0))

      for (const c of comments) {
        totalComments++
        if (await pushComment(c)) {
          totalPushed++
          // Mark webhook comment as found
          // Queue avatar fetch (background, don't block)
          fetchAndSaveAvatar(c.userId, c.name).catch(() => {})
        }
      }
    } catch {}
  })

  // ─── Navigate to live video ────────────────────────────────────────────
  const videoUrl = await findLiveVideoUrl()
  console.log(`[crawler] Opening: ${videoUrl}`)
  await page.goto(videoUrl, { waitUntil: 'domcontentloaded', timeout: 30000 })
  await sleep(5000)

  // Click comments
  try {
    await page.click('text=Bình luận', { timeout: 5000 })
    console.log('[crawler] Clicked Bình luận')
  } catch {}

  console.log('[crawler] Watching for comments...')

  // ─── Click "Làm mới" button every 2-3s to refresh comments ──────────
  let tick = 0
  let refreshing = false

  async function refreshComments() {
    if (refreshing) return
    refreshing = true
    try {
      await page.click('div[aria-label="Làm mới"]', { timeout: 3000 })
    } catch {
      // Fallback: try finding by aria-label substring
      try {
        await page.evaluate(() => {
          for (const el of document.querySelectorAll('div[role="button"]')) {
            const label = el.getAttribute('aria-label') || ''
            if (label.includes('mới') || label.includes('reload') || label.includes('refresh')) {
              el.click(); return
            }
          }
        })
      } catch {}
    }
    refreshing = false
  }

  async function simulateUser() {
    const action = rand(1, 8)
    try {
      switch (action) {
        case 1: await page.mouse.wheel(0, rand(50, 150)); break
        case 2: await page.mouse.move(rand(400, 700), rand(200, 500)); break
        case 3: await page.mouse.wheel(0, -rand(30, 100)); break
        case 4: await page.mouse.move(rand(100, 300), rand(100, 400)); await sleep(rand(300, 800)); break
        default: break // natural pause
      }
    } catch {}
  }

  const mainLoop = setInterval(async () => {
    tick++
    // Refresh comments
    await refreshComments()
    // Random user simulation every 3-5 ticks
    if (tick % rand(3, 5) === 0) {
      await simulateUser()
    }
    // Stats every 30 ticks (~90s)
    if (tick % 30 === 0) {
      console.log(`[crawler] Stats: ${totalComments} seen, ${totalPushed} pushed, ${seenCommentIds.size} unique, ${avatarCache.size} avatars`)
    }
  }, rand(2000, 3000))

  // ─── Graceful shutdown ─────────────────────────────────────────────────
  const shutdown = async () => {
    console.log(`[crawler] Shutdown: ${totalPushed} comments pushed, ${avatarCache.size} avatars`)
    clearInterval(mainLoop)
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
