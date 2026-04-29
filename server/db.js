import Database from 'better-sqlite3'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DB_PATH = path.join(__dirname, '../data/livestream.db')

// ─── Initialize database ─────────────────────────────────────────────────────
const db = new Database(DB_PATH)

// Enable WAL mode for better concurrent reads
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

// ─── Schema migration ────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS customers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    phone TEXT,
    address TEXT,
    facebook_url TEXT,
    avatar_url TEXT,
    facebook_author_id TEXT,
    blacklisted INTEGER NOT NULL DEFAULT 0,
    blacklist_reason TEXT,
    blacklisted_at TEXT,
    first_seen_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    last_seen_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT UNIQUE,
    customer_id INTEGER NOT NULL REFERENCES customers(id),
    status TEXT NOT NULL DEFAULT 'pending',
    amount INTEGER DEFAULT 0,
    product_info TEXT,
    note TEXT,
    source TEXT,
    source_comment_id TEXT,
    shipped INTEGER NOT NULL DEFAULT 0,
    created_date TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_date TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    confirmed_at TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_orders_customer_id ON orders(customer_id);
  CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
  CREATE INDEX IF NOT EXISTS idx_orders_shipped ON orders(shipped);
  CREATE INDEX IF NOT EXISTS idx_orders_created_date ON orders(created_date);
  CREATE INDEX IF NOT EXISTS idx_orders_updated_date ON orders(updated_date);
  CREATE INDEX IF NOT EXISTS idx_orders_code ON orders(code);
  CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(phone);
  CREATE INDEX IF NOT EXISTS idx_customers_facebook_author_id ON customers(facebook_author_id);
  CREATE INDEX IF NOT EXISTS idx_customers_name ON customers(name);

  CREATE TABLE IF NOT EXISTS live_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    fb_video_id TEXT,
    fb_live_url TEXT,
    title TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    started_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    ended_at TEXT,
    created_date TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_date TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  CREATE TABLE IF NOT EXISTS comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ref TEXT UNIQUE,
    live_session_id INTEGER REFERENCES live_sessions(id),
    customer_name TEXT NOT NULL,
    comment_text TEXT NOT NULL DEFAULT '',
    avatar_url TEXT,
    customer_id INTEGER REFERENCES customers(id),
    facebook_user_id TEXT,
    facebook_url TEXT,
    fb_comment_id TEXT,
    platform TEXT DEFAULT 'facebook',
    status TEXT NOT NULL DEFAULT 'pending',
    handled_at TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  CREATE INDEX IF NOT EXISTS idx_comments_status ON comments(status);
  CREATE INDEX IF NOT EXISTS idx_comments_live_session_id ON comments(live_session_id);
  CREATE INDEX IF NOT EXISTS idx_comments_ref ON comments(ref);
  CREATE INDEX IF NOT EXISTS idx_comments_fb_comment_id ON comments(fb_comment_id);

  CREATE INDEX IF NOT EXISTS idx_live_sessions_status ON live_sessions(status);
  CREATE INDEX IF NOT EXISTS idx_live_sessions_started_at ON live_sessions(started_at);
`)

console.log(`[db] SQLite initialized: ${DB_PATH}`)

// ─── Prepared statements ─────────────────────────────────────────────────────

// Customers
const insertCustomer = db.prepare(`
  INSERT INTO customers (name, phone, address, facebook_url, avatar_url, facebook_author_id)
  VALUES (@name, @phone, @address, @facebook_url, @avatar_url, @facebook_author_id)
`)

const getCustomerById = db.prepare(`
  SELECT * FROM customers WHERE id = ?
`)

const searchCustomersByName = db.prepare(`
  SELECT * FROM customers WHERE name LIKE ? ORDER BY id DESC
`)

const searchCustomersByPhone = db.prepare(`
  SELECT * FROM customers WHERE phone LIKE ? ORDER BY id DESC
`)

// Orders
const insertOrder = db.prepare(`
  INSERT INTO orders (customer_id, product_info, source_comment_id)
  VALUES (@customer_id, @product_info, @source_comment_id)
`)

const updateOrder = db.prepare(`
  UPDATE orders
  SET product_info = @product_info,
      source_comment_id = @source_comment_id,
      shipped = @shipped,
      updated_date = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE id = @id
`)

const updateOrderShipped = db.prepare(`
  UPDATE orders
  SET shipped = @shipped,
      updated_date = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE id = @id
`)

const getOrderById = db.prepare(`
  SELECT
    o.id, o.customer_id, o.product_info, o.shipped,
    o.source_comment_id, o.created_date, o.updated_date,
    c.name, c.phone, c.address, c.facebook_url, c.avatar_url
  FROM orders o
  JOIN customers c ON c.id = o.customer_id
  WHERE o.id = ?
`)

const listOrders = db.prepare(`
  SELECT
    o.id, o.customer_id, o.product_info, o.shipped,
    o.source_comment_id, o.created_date, o.updated_date,
    c.name, c.phone, c.address, c.facebook_url, c.avatar_url
  FROM orders o
  JOIN customers c ON c.id = o.customer_id
  ORDER BY o.created_date DESC
  LIMIT ? OFFSET ?
`)

const listOrdersByShipped = db.prepare(`
  SELECT
    o.id, o.customer_id, o.product_info, o.shipped,
    o.source_comment_id, o.created_date, o.updated_date,
    c.name, c.phone, c.address, c.facebook_url, c.avatar_url
  FROM orders o
  JOIN customers c ON c.id = o.customer_id
  WHERE o.shipped = ?
  ORDER BY o.created_date DESC
  LIMIT ? OFFSET ?
`)

const listOrdersByCreatedDate = db.prepare(`
  SELECT
    o.id, o.customer_id, o.product_info, o.shipped,
    o.source_comment_id, o.created_date, o.updated_date,
    c.name, c.phone, c.address, c.facebook_url, c.avatar_url
  FROM orders o
  JOIN customers c ON c.id = o.customer_id
  WHERE o.created_date BETWEEN ? AND ?
  ORDER BY o.created_date DESC
  LIMIT ? OFFSET ?
`)

const listOrdersByUpdatedDate = db.prepare(`
  SELECT
    o.id, o.customer_id, o.product_info, o.shipped,
    o.source_comment_id, o.created_date, o.updated_date,
    c.name, c.phone, c.address, c.facebook_url, c.avatar_url
  FROM orders o
  JOIN customers c ON c.id = o.customer_id
  WHERE o.updated_date BETWEEN ? AND ?
  ORDER BY o.updated_date DESC
  LIMIT ? OFFSET ?
`)

const countOrders = db.prepare(`SELECT COUNT(*) as total FROM orders`)
const countOrdersByShipped = db.prepare(`SELECT COUNT(*) as total FROM orders WHERE shipped = ?`)

// ─── Exported functions ──────────────────────────────────────────────────────

function formatOrder(row) {
  if (!row) return null
  return {
    id: row.id,
    customer_id: row.customer_id,
    product_info: row.product_info,
    shipped: !!row.shipped,
    source_comment_id: row.source_comment_id,
    created_date: row.created_date,
    updated_date: row.updated_date,
    customer: {
      name: row.name,
      phone: row.phone,
      address: row.address,
      facebook_url: row.facebook_url,
      avatar_url: row.avatar_url,
    },
  }
}

// ── Customer operations ──────────────────────────────────────────────────────

export function createCustomer({ name, phone = null, address = null, facebook_url = null, avatar_url = null, facebook_author_id = null }) {
  if (!name || !name.trim()) throw new Error('name is required')
  const result = insertCustomer.run({ name: name.trim(), phone, address, facebook_url, avatar_url, facebook_author_id })
  return getCustomerById.get(result.lastInsertRowid)
}

export function findCustomer(id) {
  return getCustomerById.get(id) || null
}

export function searchCustomers({ name, phone }) {
  if (name) return searchCustomersByName.all(`%${name}%`)
  if (phone) return searchCustomersByPhone.all(`%${phone}%`)
  return []
}

// ── Order operations ─────────────────────────────────────────────────────────

export function createOrder({ customer_id, product_info, source_comment_id = null }) {
  if (!customer_id) throw new Error('customer_id is required')
  if (!product_info || !product_info.trim()) throw new Error('product_info is required')

  // Verify customer exists
  const customer = getCustomerById.get(customer_id)
  if (!customer) throw new Error('customer not found')

  const result = insertOrder.run({
    customer_id,
    product_info: product_info.trim(),
    source_comment_id,
  })
  return formatOrder(getOrderById.get(result.lastInsertRowid))
}

export function updateOrderInfo({ id, product_info, source_comment_id, shipped }) {
  const existing = getOrderById.get(id)
  if (!existing) throw new Error('order not found')

  updateOrder.run({
    id,
    product_info: product_info ?? existing.product_info,
    source_comment_id: source_comment_id ?? existing.source_comment_id,
    shipped: shipped !== undefined ? (shipped ? 1 : 0) : existing.shipped,
  })
  return formatOrder(getOrderById.get(id))
}

export function setOrderShipped(id, shipped) {
  const existing = getOrderById.get(id)
  if (!existing) throw new Error('order not found')

  updateOrderShipped.run({ id, shipped: shipped ? 1 : 0 })
  return formatOrder(getOrderById.get(id))
}

export function getOrder(id) {
  return formatOrder(getOrderById.get(id))
}

export function listAllOrders({ limit = 50, offset = 0 } = {}) {
  return listOrders.all(limit, offset).map(formatOrder)
}

export function listByShipped(shipped, { limit = 50, offset = 0 } = {}) {
  return listOrdersByShipped.all(shipped ? 1 : 0, limit, offset).map(formatOrder)
}

export function listByCreatedDate(from, to, { limit = 50, offset = 0 } = {}) {
  return listOrdersByCreatedDate.all(from, to, limit, offset).map(formatOrder)
}

export function listByUpdatedDate(from, to, { limit = 50, offset = 0 } = {}) {
  return listOrdersByUpdatedDate.all(from, to, limit, offset).map(formatOrder)
}

export function getOrderCounts() {
  return {
    total: countOrders.get().total,
    unshipped: countOrdersByShipped.get(0).total,
    shipped: countOrdersByShipped.get(1).total,
  }
}

// ── Live session operations ──────────────────────────────────────────────────

const insertSession = db.prepare(`
  INSERT INTO live_sessions (fb_video_id, fb_live_url, title)
  VALUES (@fb_video_id, @fb_live_url, @title)
`)

const getSessionById = db.prepare('SELECT * FROM live_sessions WHERE id = ?')
const getActiveSession = db.prepare("SELECT * FROM live_sessions WHERE status = 'active' ORDER BY started_at DESC LIMIT 1")
const listSessions = db.prepare('SELECT * FROM live_sessions ORDER BY started_at DESC LIMIT ? OFFSET ?')

const endSessionStmt = db.prepare(`
  UPDATE live_sessions
  SET status = 'ended',
      ended_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
      updated_date = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE id = @id
`)

const updateSessionStmt = db.prepare(`
  UPDATE live_sessions
  SET fb_video_id = @fb_video_id,
      fb_live_url = @fb_live_url,
      title = @title,
      updated_date = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE id = @id
`)

// ── Comment operations (DB-backed) ──────────────────────────────────────────

const insertComment = db.prepare(`
  INSERT INTO comments (ref, live_session_id, customer_name, comment_text, avatar_url, customer_id, facebook_user_id, facebook_url, fb_comment_id, platform, status, created_at)
  VALUES (@ref, @live_session_id, @customer_name, @comment_text, @avatar_url, @customer_id, @facebook_user_id, @facebook_url, @fb_comment_id, @platform, @status, @created_at)
`)

const getCommentById = db.prepare('SELECT * FROM comments WHERE id = ?')
const getCommentByRef = db.prepare('SELECT * FROM comments WHERE ref = ?')

const listCommentsBySession = db.prepare(`
  SELECT c.*, cu.phone as customer_phone, cu.address as customer_address, cu.blacklisted as customer_blacklisted
  FROM comments c
  LEFT JOIN customers cu ON cu.id = c.customer_id
  WHERE c.live_session_id = ? ORDER BY c.created_at ASC
`)

const listCommentsBySessionAndStatus = db.prepare(`
  SELECT c.*, cu.phone as customer_phone, cu.address as customer_address, cu.blacklisted as customer_blacklisted
  FROM comments c
  LEFT JOIN customers cu ON cu.id = c.customer_id
  WHERE c.live_session_id = ? AND c.status = ? ORDER BY c.created_at ASC
`)

const updateCommentStatus = db.prepare(`
  UPDATE comments SET status = @status, handled_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = @id
`)

const updateCommentCustomerId = db.prepare(`
  UPDATE comments SET customer_id = ? WHERE id = ?
`)

const countCommentsBySession = db.prepare(`
  SELECT
    COUNT(*) FILTER (WHERE status = 'pending') as pending,
    COUNT(*) FILTER (WHERE status = 'confirmed') as confirmed,
    COUNT(*) FILTER (WHERE status = 'skipped') as skipped
  FROM comments WHERE live_session_id = ?
`)

const resetCommentsBySession = db.prepare(`
  DELETE FROM comments WHERE live_session_id = ?
`)

export function addComment({ ref, live_session_id, customer_name, comment_text = '', avatar_url = null, customer_id = null, facebook_user_id = null, facebook_url = null, fb_comment_id = null, platform = 'facebook', created_at = null }) {
  const result = insertComment.run({
    ref, live_session_id, customer_name, comment_text, avatar_url, customer_id,
    facebook_user_id, facebook_url, fb_comment_id, platform, status: 'pending',
    created_at: created_at || new Date().toISOString()
  })
  return getCommentById.get(result.lastInsertRowid)
}

export function getComment(id) {
  return getCommentById.get(id) || null
}

export function getCommentByReference(ref) {
  return getCommentByRef.get(ref) || null
}

export function listSessionComments(sessionId, status = null) {
  if (status) return listCommentsBySessionAndStatus.all(sessionId, status)
  return listCommentsBySession.all(sessionId)
}

export function confirmComment(id) {
  updateCommentStatus.run({ id, status: 'confirmed' })
  return getCommentById.get(id)
}

export function skipComment(id) {
  updateCommentStatus.run({ id, status: 'skipped' })
  return getCommentById.get(id)
}

export function setCommentCustomerId(commentId, customerId) {
  updateCommentCustomerId.run(customerId, commentId)
}

export function getSessionCommentCounts(sessionId) {
  return countCommentsBySession.get(sessionId) || { pending: 0, confirmed: 0, skipped: 0 }
}

export function resetSessionComments(sessionId) {
  resetCommentsBySession.run(sessionId)
}

export function startLiveSession({ fb_video_id = null, fb_live_url = null, title = null } = {}) {
  // If video_id provided, check if session already exists for this video
  if (fb_video_id) {
    const existing = db.prepare('SELECT * FROM live_sessions WHERE fb_video_id = ? AND status = ?').get(fb_video_id, 'active')
    if (existing) {
      console.log(`[session] Resuming existing session #${existing.id} for video ${fb_video_id}`)
      return existing
    }
  }

  // End any existing active session first
  const active = getActiveSession.get()
  if (active) {
    endSessionStmt.run({ id: active.id })
  }
  const result = insertSession.run({ fb_video_id, fb_live_url, title })
  return getSessionById.get(result.lastInsertRowid)
}

export function endLiveSession(id) {
  const session = getSessionById.get(id)
  if (!session) throw new Error('session not found')
  if (session.status === 'ended') throw new Error('session already ended')
  endSessionStmt.run({ id })
  return getSessionById.get(id)
}

export function getActiveLiveSession() {
  return getActiveSession.get() || null
}

export function getLiveSession(id) {
  return getSessionById.get(id) || null
}

export function updateLiveSession({ id, fb_video_id, fb_live_url, title }) {
  const session = getSessionById.get(id)
  if (!session) throw new Error('session not found')
  updateSessionStmt.run({
    id,
    fb_video_id: fb_video_id ?? session.fb_video_id,
    fb_live_url: fb_live_url ?? session.fb_live_url,
    title: title ?? session.title,
  })
  return getSessionById.get(id)
}

export function listLiveSessions({ limit = 20, offset = 0 } = {}) {
  return listSessions.all(limit, offset)
}

// ── Cleanup ──────────────────────────────────────────────────────────────────

// ── Customer blacklist ───────────────────────────────────────────────────

const blacklistCustomerStmt = db.prepare(`
  UPDATE customers
  SET blacklisted = 1,
      blacklist_reason = @reason,
      blacklisted_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE id = @id
`)

const unblacklistCustomerStmt = db.prepare(`
  UPDATE customers
  SET blacklisted = 0, blacklist_reason = NULL, blacklisted_at = NULL
  WHERE id = ?
`)

const isBlacklistedStmt = db.prepare(`
  SELECT blacklisted, blacklist_reason, blacklisted_at FROM customers WHERE id = ?
`)

const listBlacklistedStmt = db.prepare(`
  SELECT * FROM customers WHERE blacklisted = 1 ORDER BY blacklisted_at DESC
`)

const isBlacklistedByFbIdStmt = db.prepare(`
  SELECT id, blacklisted, blacklist_reason FROM customers WHERE facebook_author_id = ? AND blacklisted = 1
`)

export function blacklistCustomer(id, reason = 'Bom hàng') {
  blacklistCustomerStmt.run({ id, reason })
  return getCustomerById.get(id)
}

export function unblacklistCustomer(id) {
  unblacklistCustomerStmt.run(id)
  return getCustomerById.get(id)
}

export function isCustomerBlacklisted(id) {
  const row = isBlacklistedStmt.get(id)
  return row ? !!row.blacklisted : false
}

export function getBlacklistInfo(id) {
  return isBlacklistedStmt.get(id) || null
}

export function listBlacklistedCustomers() {
  return listBlacklistedStmt.all()
}

export function isBlacklistedByFacebookId(fbId) {
  if (!fbId) return null
  return isBlacklistedByFbIdStmt.get(fbId) || null
}
export function closeDb() {
  db.close()
}

export default db