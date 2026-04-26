import Database from 'better-sqlite3'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../data/livestream.db')

const db = new Database(DB_PATH)
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

// ─── Schema migration v2 ────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS customers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    phone TEXT,
    address TEXT,
    facebook_url TEXT,
    avatar_url TEXT,
    facebook_author_id TEXT,
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
`)

// ─── Migrate existing tables (add missing columns) ──────────────────────────
function addColumnIfMissing(table, column, type) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all()
  if (!cols.find(c => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`)
    console.log(`[db] Added ${table}.${column}`)
  }
}

addColumnIfMissing('customers', 'facebook_author_id', 'TEXT')
addColumnIfMissing('customers', 'first_seen_at', "TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))")
addColumnIfMissing('customers', 'last_seen_at', "TEXT DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))")
addColumnIfMissing('orders', 'code', 'TEXT')
addColumnIfMissing('orders', 'status', "TEXT DEFAULT 'pending'")
addColumnIfMissing('orders', 'amount', 'INTEGER DEFAULT 0')
addColumnIfMissing('orders', 'note', 'TEXT')
addColumnIfMissing('orders', 'source', 'TEXT')
addColumnIfMissing('orders', 'confirmed_at', 'TEXT')
addColumnIfMissing('customers', 'blacklisted', 'INTEGER DEFAULT 0')
addColumnIfMissing('customers', 'blacklist_reason', 'TEXT')
addColumnIfMissing('customers', 'blacklisted_at', 'TEXT')

// Generate order code: DH001, DH002...
function nextOrderCode() {
  const row = db.prepare('SELECT MAX(id) as maxId FROM orders').get()
  const next = (row.maxId || 0) + 1
  return `DH${String(next).padStart(3, '0')}`
}

console.log(`[db] SQLite initialized: ${DB_PATH}`)

export { db as default, DB_PATH, nextOrderCode }