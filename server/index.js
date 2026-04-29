import dotenv from 'dotenv'
dotenv.config()

import express from 'express'
import cors from 'cors'
import path from 'path'
import { fileURLToPath } from 'url'
import {
  createCustomer, findCustomer, searchCustomers,
  createOrder, listAllOrders, listByShipped, getOrderCounts,
  startLiveSession, endLiveSession, getActiveLiveSession,
  addComment, getComment, getCommentByReference, listSessionComments,
  confirmComment, skipComment, setCommentCustomerId, getSessionCommentCounts,
  resetSessionComments,
  blacklistCustomer, unblacklistCustomer, isCustomerBlacklisted,
  listBlacklistedCustomers, isBlacklistedByFacebookId,
} from './db.js'
import { printOrderReceipt, printTestPage, printShippingLabel, PRINTER_HOST, PRINTER_PORT } from './printer.js'
import { FacebookLivePoller } from './facebook-live.js'
import { mountAgentCliRoutes } from './agent-cli-routes.js'
import { parseComment } from './comment-parser.js'
import { extractCommentInfo } from './comment-extract.js'
import db from './db.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PORT = process.env.PORT || 3001
const FAKE_FEED_MS = parseInt(process.env.FAKE_FEED_MS || '0')
const FB_PAGE_TOKEN = process.env.FB_PAGE_TOKEN || ''
const FB_PAGE_ID = process.env.FB_PAGE_ID || ''

// ─── Comment products for fake feed ─────────────────────────────────────────
const PRODUCTS = [
  'áo sơ mi trắng', 'quần jeans xanh', 'váy hoa nhí', 'áo phông basic',
  'áo khoác gió', 'chân váy chữ A', 'quần short thể thao', 'áo len cổ lọ',
  'đầm công sở', 'áo blazer', 'quần baggy', 'áo tank top', 'váy midi',
]

function getAllCustomers() {
  return db.prepare('SELECT * FROM customers').all()
}

// ─── Active session tracking ─────────────────────────────────────────────────
let activeSessionId = null
const activeSession = getActiveLiveSession()
if (activeSession) {
  activeSessionId = activeSession.id
  console.log(`[session] Resumed active session #${activeSessionId}`)
} else if (FAKE_FEED_MS > 0) {
  // Dev mode: auto-create session for fake feed
  const session = startLiveSession({ title: 'Dev session' })
  activeSessionId = session.id
  console.log(`[session] Dev mode: auto-created session #${activeSessionId}`)
}

// ─── Comment ref counter ─────────────────────────────────────────────────────
let lastRefNum = 0
const maxRef = db.prepare("SELECT ref FROM comments ORDER BY id DESC LIMIT 1").get()
if (maxRef?.ref) {
  const m = maxRef.ref.match(/(\d+)/)
  if (m) lastRefNum = parseInt(m[1])
}
console.log(`[ref] Starting at cmt_${String(lastRefNum + 1).padStart(3, '0')}`)

function nextRef() {
  lastRefNum++
  return `cmt_${String(lastRefNum).padStart(3, '0')}`
}

// ─── Format DB comment → API shape ──────────────────────────────────────────
function formatComment(c) {
  // Check if customer is new (first_seen_at within last 24h)
  let isNewCustomer = false
  let customerAvatar = null
  if (c.customer_id) {
    const cust = db.prepare('SELECT first_seen_at, avatar_url FROM customers WHERE id = ?').get(c.customer_id)
    if (cust?.first_seen_at) {
      const firstSeen = new Date(cust.first_seen_at)
      isNewCustomer = (Date.now() - firstSeen.getTime()) < 24 * 60 * 60 * 1000
    }
    customerAvatar = cust?.avatar_url || null
  }
  return {
    id: c.ref,
    dbId: c.id,
    customerName: c.customer_name,
    commentText: c.comment_text,
    avatarUrl: c.avatar_url || customerAvatar,
    customerId: c.customer_id,
    facebookUserId: c.facebook_user_id,
    facebookUrl: c.facebook_url,
    fbCommentId: c.fb_comment_id,
    platform: c.platform,
    status: c.status,
    createdAt: c.created_at,
    handledAt: c.handled_at,
    blacklisted: !!c.customer_blacklisted,
    missingPhone: c.customer_id ? !c.customer_phone : true,
    missingAddress: c.customer_id ? !c.customer_address : true,
    isNewCustomer,
  }
}

// ─── Get current state from DB ──────────────────────────────────────────────
function getStateFromDb() {
  if (!activeSessionId) {
    return { pendingComments: [], confirmedOrders: [], counts: { pending: 0, confirmed: 0, skipped: 0 }, updatedAt: new Date().toISOString() }
  }
  const pending = listSessionComments(activeSessionId, 'pending').map(formatComment)
  const confirmed = listSessionComments(activeSessionId, 'confirmed').map(formatComment)
  const counts = getSessionCommentCounts(activeSessionId)
  return { pendingComments: pending, confirmedOrders: confirmed, counts, updatedAt: new Date().toISOString() }
}

// ─── Fake feed ──────────────────────────────────────────────────────────────
function makeComment() {
  const customers = getAllCustomers()
  const ref = nextRef()
  if (customers.length === 0) {
    return addComment({
      ref, live_session_id: activeSessionId,
      customer_name: 'Khách', comment_text: `#${lastRefNum}`, platform: 'live',
    })
  }
  const customer = customers[Math.floor(Math.random() * customers.length)]
  const product = PRODUCTS[Math.floor(Math.random() * PRODUCTS.length)]
  return addComment({
    ref, live_session_id: activeSessionId,
    customer_name: customer.name, comment_text: `Cho em 1 ${product} ạ`,
    avatar_url: customer.avatar_url || null, customer_id: customer.id,
    facebook_url: customer.facebook_url || null, platform: 'live',
  })
}

// ─── SSE clients ─────────────────────────────────────────────────────────────
const sseClients = new Set()

function broadcast(event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
  for (const res of sseClients) {
    try { res.write(msg) } catch { sseClients.delete(res) }
  }
}

// ─── Fake feed timer ─────────────────────────────────────────────────────────
if (FAKE_FEED_MS > 0) {
  setInterval(() => {
    if (!activeSessionId) return  // skip if no active session
    const dbComment = makeComment()
    const comment = formatComment(dbComment)
    console.log(`[fake] ${comment.id} ${comment.customerName}: ${comment.commentText}`)
    broadcast('new-comment', comment)
  }, FAKE_FEED_MS)
  console.log(`[feed] Fake feed enabled: ${FAKE_FEED_MS}ms`)
} else {
  console.log('[feed] Fake feed disabled')
}

// ─── Facebook Live integration ──────────────────────────────────────────────
let fbPoller = null

function addCommentToFeed(item) {
  // Skip if FB comment already exists
  if (item.fbCommentId) {
    const existing = db.prepare('SELECT id FROM comments WHERE fb_comment_id = ?').get(item.fbCommentId)
    if (existing) return null
  }
  const ref = nextRef()

  // Auto-create customer from FB comment if new
  let customerId = null
  let isNewCustomer = false
  if (item.facebookUserId) {
    const existing = db.prepare('SELECT id FROM customers WHERE facebook_author_id = ?').get(item.facebookUserId)
    if (existing) {
      customerId = existing.id
      // Update last_seen
      db.prepare("UPDATE customers SET last_seen_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?").run(customerId)
    } else {
      // New customer!
      const customer = createCustomer({
        name: item.customerName,
        facebook_author_id: item.facebookUserId,
        avatar_url: item.avatarUrl || null,
        facebook_url: item.facebookUserId ? `https://facebook.com/${item.facebookUserId}` : null,
      })
      customerId = customer.id
      isNewCustomer = true
      console.log(`[customer] New from live: #${customerId} ${item.customerName}`)
    }
  }

  const dbComment = addComment({
    ref,
    live_session_id: activeSessionId,
    customer_name: item.customerName,
    comment_text: item.commentText || '',
    avatar_url: item.avatarUrl || null,
    customer_id: customerId,
    facebook_user_id: item.facebookUserId || null,
    facebook_url: item.facebookUserId ? `https://facebook.com/${item.facebookUserId}` : null,
    fb_comment_id: item.fbCommentId || null,
    platform: item.platform || 'facebook',
  })
  const comment = formatComment(dbComment)
  comment.isNewCustomer = isNewCustomer
  // Check blacklist by facebook ID
  if (item.facebookUserId) {
    const bl = isBlacklistedByFacebookId(item.facebookUserId)
    if (bl) comment.blacklisted = true
  }
  broadcast('new-comment', comment)
  return comment
}

// if (FB_PAGE_TOKEN && FB_PAGE_ID) {
//   fbPoller = new FacebookLivePoller({
//     pageAccessToken: FB_PAGE_TOKEN,
//     pageId: FB_PAGE_ID,
//     onComment: (item) => {
//       // Trigger crawler to fetch full comment data
//       broadcast('crawler-trigger', { trigger: true, source: 'poller', commentId: item.fbCommentId || null })
//     },
//     onError: (msg) => console.error(msg),
//   })
//   fbPoller.startAutoDetect()
//   console.log(`[fb] Facebook Live polling enabled (trigger only)`)
// } else {
//   console.log('[fb] Facebook Live disabled (set FB_PAGE_TOKEN + FB_PAGE_ID)')
// }

// ─── Express app ─────────────────────────────────────────────────────────────
const app = express()
app.use(cors())
app.use(express.json())

mountAgentCliRoutes(app)

function errorRes(res, code, error, message) {
  res.status(code).json({ error, message })
}

// ── Health ───────────────────────────────────────────────────────────────────
app.get('/health', (req, res) => res.send('ok'))

// ── SSE stream ───────────────────────────────────────────────────────────────
app.get('/api/stream', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  })
  res.write('\n')

  const initData = getStateFromDb()
  res.write(`event: init\ndata: ${JSON.stringify(initData)}\n\n`)

  sseClients.add(res)
  console.log(`[sse] Connected (${sseClients.size})`)

  req.on('close', () => {
    sseClients.delete(res)
    console.log(`[sse] Disconnected (${sseClients.size})`)
  })
})

// ── GET /api/state ───────────────────────────────────────────────────────────
app.get('/api/state', (req, res) => {
  res.json(getStateFromDb())
})

// ── POST /api/comments/:id/confirm → create order in DB ─────────────────────
app.post('/api/comments/:id/confirm', async (req, res) => {
  const { id } = req.params
  const dbComment = getCommentByReference(id)
  if (!dbComment || dbComment.status !== 'pending') {
    return errorRes(res, 404, 'not_found', 'Comment not found or already handled')
  }

  const item = formatComment(dbComment)

  // Resolve customer + parse comment
  let order = null
  let printError = null
  try {
    const parsed = parseComment(item.commentText)
    // Only use Ollama for complex comments (has phone/address mixed in)
    // Simple comments (just a number/code) → regex is enough
    const isSimple = /^\s*(?:m[aã]\s*:?\s*)?\d{1,4}k?\s*$/i.test(item.commentText.trim())
       || /^\s*[a-z]\s*\d{1,4}\s*$/i.test(item.commentText.trim())
    let extracted = null
    if (!isSimple) {
      extracted = await extractCommentInfo(item.commentText)
    }
    const phone = extracted?.phone || parsed.phone
    const address = extracted?.address || null

    let customerId = item.customerId
    if (!customerId) {
      if (phone) {
        const existing = db.prepare('SELECT id FROM customers WHERE phone = ?').get(phone)
        if (existing) customerId = existing.id
      }
      if (!customerId && item.facebookUserId) {
        const existing = db.prepare('SELECT id FROM customers WHERE facebook_author_id = ?').get(item.facebookUserId)
        if (existing) {
          customerId = existing.id
          if (phone) {
            db.prepare('UPDATE customers SET phone = ? WHERE id = ? AND phone IS NULL').run(phone, customerId)
          }
        }
      }
      if (!customerId) {
        const customer = createCustomer({
          name: item.customerName,
          phone: phone,
          address: address,
          facebook_author_id: item.facebookUserId || null,
          avatar_url: item.avatarUrl || null,
          facebook_url: item.facebookUrl || null,
        })
        customerId = customer.id
        console.log(`[customer] New: #${customerId} ${item.customerName} ${phone || ''}`)
      }
    } else {
      // Update existing customer with new info
      if (phone) {
        db.prepare('UPDATE customers SET phone = ? WHERE id = ? AND phone IS NULL').run(phone, customerId)
      }
      if (address) {
        db.prepare('UPDATE customers SET address = ? WHERE id = ? AND address IS NULL').run(address, customerId)
      }
    }

    if (customerId && !dbComment.customer_id) {
      setCommentCustomerId(dbComment.id, customerId)
    }

    const productInfo = parsed.code
      ? `[Mã ${parsed.code}] ${item.commentText}`
      : item.commentText

    // Print receipt (skip if printer disabled)
    const customer = findCustomer(customerId)
    const PRINTER_ENABLED = process.env.PRINTER_ENABLED !== 'false'
    if (PRINTER_ENABLED) {
      try {
        await printOrderReceipt({
          orderId: '---',
          customerName: item.customerName,
          phone: customer?.phone || phone || null,
          productInfo: productInfo,
          commentId: item.id,
          createdAt: new Date().toISOString(),
        })
      } catch (err) {
        printError = err.message
        console.error(`[print] Error:`, err.message)
        return res.json({ ok: false, printError, item: { id: item.id, status: 'pending' } })
      }
    }

    // Print OK → confirm comment + create order
    const confirmed = confirmComment(dbComment.id)
    const confirmedItem = formatComment(confirmed)

    order = createOrder({
      customer_id: customerId,
      product_info: productInfo,
      source_comment_id: item.id,
    })
    console.log(`[order] #${order.id} | ${item.customerName} | ${productInfo}${parsed.phone ? ' | SĐT: ' + parsed.phone : ''}`)

    // Broadcast updated item (with new phone/address info) before confirming
    const updatedDbComment = getCommentByReference(id)
    if (updatedDbComment) {
      const updatedItem = formatComment(updatedDbComment)
      broadcast('updated', updatedItem)
    }

    broadcast('confirmed', { id: confirmedItem.id, item: confirmedItem, order })
    res.json({ ok: true, item: { id: confirmedItem.id, status: confirmedItem.status }, order, printError: null })

  } catch (err) {
    console.error(`[order] Error:`, err.message)
    errorRes(res, 500, 'server_error', err.message)
  }
})

// ── POST /api/comments/:id/skip ──────────────────────────────────────────────
app.post('/api/comments/:id/skip', (req, res) => {
  const { id } = req.params
  const dbComment = getCommentByReference(id)
  if (!dbComment || dbComment.status !== 'pending') {
    return errorRes(res, 404, 'not_found', 'Comment not found or already handled')
  }

  const skipped = skipComment(dbComment.id)
  const item = formatComment(skipped)

  broadcast('skipped', { id: item.id })
  res.json({ ok: true, item: { id: item.id, status: item.status } })
})

// ── POST /api/comments/:id/update ────────────────────────────────────────────
// Update customer info (phone, address) without confirming
app.post('/api/comments/:id/update', (req, res) => {
  const { id } = req.params
  const { phone, address, customerName } = req.body

  const dbComment = getCommentByReference(id)
  if (!dbComment) return errorRes(res, 404, 'not_found', 'Comment not found')

  // Update customer info if provided
  if (phone !== undefined || address !== undefined || customerName !== undefined) {
    const updates = []
    const stmt = []
    if (phone !== undefined) { updates.push('phone = ?'); stmt.push(phone || null) }
    if (address !== undefined) { updates.push('address = ?'); stmt.push(address || null) }
    if (customerName !== undefined) { updates.push('name = ?'); stmt.push(customerName || null) }
    if (updates.length > 0) {
      stmt.push(dbComment.customer_id)
      db.prepare(`UPDATE customers SET ${updates.join(', ')} WHERE id = ?`).run(...stmt)
    }
  }

  // Re-fetch and format updated item
  const refreshed = getCommentByReference(id)
  if (!refreshed) return errorRes(res, 404, 'not_found', 'Comment not found after update')

  const item = formatComment(refreshed)
  broadcast('updated', item)
  res.json({ ok: true, item })
})

// ── POST /api/comments/import ────────────────────────────────────────────────
app.post('/api/comments/import', (req, res) => {
  const { customerName, commentText, platform, avatarUrl, customerId, facebookUrl, facebookUserId, createdAt } = req.body
  if (!customerName || !customerName.trim()) {
    return errorRes(res, 400, 'invalid_input', 'customerName is required.')
  }
  const safeCommentText = (commentText || '').trim() || '(no text)'

  // Handle avatar update from crawler
  if (commentText === '__avatar_update__' && facebookUserId) {
    const customer = db.prepare('SELECT id FROM customers WHERE facebook_author_id = ?').get(facebookUserId)
    if (customer && avatarUrl) {
      db.prepare("UPDATE customers SET avatar_url = ? WHERE id = ?").run(avatarUrl, customer.id)
      console.log(`[import] Avatar updated for #${customer.id}`)
    }
    return res.json({ ok: true, type: 'avatar_update' })
  }

  // Auto-create/find customer by facebookUserId
  let resolvedCustomerId = customerId || null
  if (!resolvedCustomerId && facebookUserId) {
    const existing = db.prepare('SELECT id FROM customers WHERE facebook_author_id = ?').get(facebookUserId)
    if (existing) {
      resolvedCustomerId = existing.id
      db.prepare("UPDATE customers SET last_seen_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?").run(resolvedCustomerId)
      // Update avatar if missing
      if (avatarUrl) {
        db.prepare("UPDATE customers SET avatar_url = ? WHERE id = ?").run(avatarUrl, resolvedCustomerId)
      }
    } else {
      const customer = createCustomer({
        name: customerName.trim(),
        facebook_author_id: facebookUserId,
        avatar_url: avatarUrl || null,
        facebook_url: facebookUrl || null,
      })
      resolvedCustomerId = customer.id
      console.log(`[import] New customer #${resolvedCustomerId} ${customerName}`)
    }
  }

  const ref = nextRef()
  const dbComment = addComment({
    ref,
    live_session_id: activeSessionId,
    customer_name: customerName.trim(),
    comment_text: safeCommentText,
    avatar_url: avatarUrl || null,
    customer_id: resolvedCustomerId,
    facebook_user_id: facebookUserId || null,
    facebook_url: facebookUrl || null,
    platform: platform?.trim() || 'facebook',
    created_at: createdAt || null,
  })
  const item = formatComment(dbComment)

  broadcast('new-comment', item)
  res.json({ ok: true, item })
})

// ── POST /api/comments/add-demo ──────────────────────────────────────────────
app.post('/api/comments/add-demo', (req, res) => {
  const dbComment = makeComment()
  const item = formatComment(dbComment)

  broadcast('new-comment', item)
  res.json({ ok: true, item })
})

// ── POST /api/reset-demo ─────────────────────────────────────────────────────
app.post('/api/reset-demo', (req, res) => {
  if (activeSessionId) {
    resetSessionComments(activeSessionId)
  }
  broadcast('reset', {})
  res.json({ ok: true })
})

// ── Live session management ──────────────────────────────────────────────────
app.post('/api/live-session/start', (req, res) => {
  const { fb_video_id, fb_live_url, title } = req.body || {}
  const session = startLiveSession({ fb_video_id, fb_live_url, title })
  activeSessionId = session.id
  console.log(`[session] Started #${session.id}`)
  res.json({ ok: true, session })
})

app.post('/api/live-session/end', (req, res) => {
  if (!activeSessionId) {
    return errorRes(res, 400, 'no_active_session', 'No active session')
  }
  const session = endLiveSession(activeSessionId)
  activeSessionId = null
  console.log(`[session] Ended #${session.id}`)
  res.json({ ok: true, session })
})

app.get('/api/live-session/active', (req, res) => {
  const session = getActiveLiveSession()
  const counts = session ? getSessionCommentCounts(session.id) : null
  res.json({ session, counts })
})

// ── DB API routes ────────────────────────────────────────────────────────────

app.get('/api/customers', (req, res) => {
  const { name, phone } = req.query
  if (name || phone) return res.json(searchCustomers({ name, phone }))
  const all = db.prepare('SELECT * FROM customers ORDER BY id DESC').all()
  res.json(all)
})

app.get('/api/orders', (req, res) => {
  const { shipped, limit = 50, offset = 0 } = req.query
  if (shipped !== undefined) {
    return res.json(listByShipped(shipped === 'true', { limit: +limit, offset: +offset }))
  }
  res.json(listAllOrders({ limit: +limit, offset: +offset }))
})

app.get('/api/orders/counts', (req, res) => {
  res.json(getOrderCounts())
})

app.post('/api/printer/test', async (req, res) => {
  try {
    await printTestPage()
    res.json({ ok: true, printer: `${PRINTER_HOST}:${PRINTER_PORT}` })
  } catch (err) {
    res.status(500).json({ error: 'printer_error', message: err.message })
  }
})

app.get('/api/printer/status', (req, res) => {
  import('net').then(netMod => {
    const client = new netMod.default.Socket()
    client.setTimeout(2000)
    client.connect(PRINTER_PORT, PRINTER_HOST, () => {
      client.destroy()
      res.json({ online: true, host: PRINTER_HOST, port: PRINTER_PORT })
    })
    client.on('error', () => {
      client.destroy()
      res.json({ online: false, host: PRINTER_HOST, port: PRINTER_PORT })
    })
    client.on('timeout', () => {
      client.destroy()
      res.json({ online: false, host: PRINTER_HOST, port: PRINTER_PORT })
    })
  })
})

// ── Facebook Webhook ──────────────────────────────────────────────────────
const FB_VERIFY_TOKEN = process.env.FB_VERIFY_TOKEN || 'livestream_webhook_2026'

app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode']
  const token = req.query['hub.verify_token']
  const challenge = req.query['hub.challenge']
  console.log(`[webhook] Verification attempt: mode=${mode} token=${token}`)
  if (mode === 'subscribe' && token === FB_VERIFY_TOKEN) {
    console.log('[webhook] Verified!')
    return res.status(200).send(challenge)
  }
  res.sendStatus(403)
})

app.post('/webhook', (req, res) => {
  const body = req.body
  console.log(`[webhook] Received: object=${body.object} entry_count=${(body.entry || []).length}`)
  // Log raw payload for debugging
  import('fs').then(fs => {
    fs.appendFileSync('data/webhook.log', `[${new Date().toISOString()}] ${JSON.stringify(body)}\n`)
  }).catch(() => {})
  console.log(`[webhook] Raw:`, JSON.stringify(body).slice(0, 500))

  if (body.object === 'page') {
    for (const entry of (body.entry || [])) {
      for (const change of (entry.changes || [])) {
        const commentId = change.value?.comment_id || null
        console.log(`[webhook] Signal: ${change.field}${commentId ? ' comment=' + commentId : ''}`)
        broadcast('crawler-trigger', { trigger: true, source: 'webhook', field: change.field, commentId })
      }
    }
  }
  res.sendStatus(200)
})

// ── Facebook Live API ─────────────────────────────────────────────────────

app.get('/api/fb/status', (req, res) => {
  res.json({
    enabled: !!fbPoller,
    running: fbPoller?.isRunning() || false,
    videoId: fbPoller?.getVideoId() || null,
    pageId: FB_PAGE_ID || null,
    activeSessionId,
  })
})

app.post('/api/fb/start', async (req, res) => {
  if (!fbPoller) {
    return res.status(400).json({ error: 'fb_not_configured', message: 'Set FB_PAGE_TOKEN + FB_PAGE_ID' })
  }
  const { videoId } = req.body || {}
  if (videoId) {
    await fbPoller.startWithVideoId(videoId)
  } else {
    await fbPoller.startAutoDetect()
  }
  res.json({ ok: true, running: fbPoller.isRunning(), videoId: fbPoller.getVideoId() })
})

app.post('/api/fb/stop', (req, res) => {
  if (fbPoller) fbPoller.stop()
  res.json({ ok: true, running: false })
})

app.get('/api/fb/live', async (req, res) => {
  if (!fbPoller) {
    return res.status(400).json({ error: 'fb_not_configured' })
  }
  const video = await fbPoller.findLiveVideo()
  res.json({ video })
})

// ── Customer blacklist API ──────────────────────────────────────────────

app.post('/api/customers/:id/blacklist', (req, res) => {
  const { id } = req.params
  const { reason } = req.body || {}
  const customer = findCustomer(+id)
  if (!customer) return errorRes(res, 404, 'not_found', 'Customer not found')
  const updated = blacklistCustomer(+id, reason || 'Bom hàng')
  console.log(`[blacklist] #${id} ${updated.name} - ${reason || 'Bom hàng'}`)
  res.json({ ok: true, customer: updated })
})

app.post('/api/customers/:id/unblacklist', (req, res) => {
  const { id } = req.params
  const customer = findCustomer(+id)
  if (!customer) return errorRes(res, 404, 'not_found', 'Customer not found')
  const updated = unblacklistCustomer(+id)
  console.log(`[blacklist] Removed #${id} ${updated.name}`)
  res.json({ ok: true, customer: updated })
})

app.get('/api/customers/blacklisted', (req, res) => {
  res.json(listBlacklistedCustomers())
})

app.listen(PORT, () => {
  console.log(`[server] Running on http://localhost:${PORT}`)
  console.log(`[server] SSE: /api/stream`)
  console.log(`[server] Printer: ${PRINTER_HOST}:${PRINTER_PORT}`)
  console.log(`[server] Facebook: ${FB_PAGE_TOKEN ? 'configured' : 'not configured'}`)
  console.log(`[server] Active session: ${activeSessionId || 'none'}`)
})
