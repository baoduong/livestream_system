#!/usr/bin/env node
// Lookup customer info by name, phone, or facebook ID
// Usage: node server/lookup-customer.js --name "Kim Tiến"
//        node server/lookup-customer.js --phone "0769318836"
//        node server/lookup-customer.js --fbid "5125269640854514"

import Database from 'better-sqlite3'
import path from 'path'
import { fileURLToPath } from 'url'
import { config } from 'dotenv'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
config({ path: path.join(__dirname, '../.env') })

const DB_PATH = path.join(__dirname, '../data/livestream.db')
const db = new Database(DB_PATH)
const FB_TOKEN = process.env.FB_PAGE_TOKEN || ''

// Parse args
const args = process.argv.slice(2)
const flags = {}
for (let i = 0; i < args.length; i += 2) {
  flags[args[i].replace(/^--/, '')] = args[i + 1]
}

async function fetchAvatar(fbUserId) {
  if (!fbUserId || !FB_TOKEN) return null
  try {
    const res = await fetch(
      `https://graph.facebook.com/v19.0/${fbUserId}/picture?type=large&redirect=false&access_token=${FB_TOKEN}`
    )
    if (!res.ok) return null
    const data = await res.json()
    return data?.data?.url || null
  } catch { return null }
}

async function main() {
  let customers = []

  if (flags.name) {
    customers = db.prepare('SELECT * FROM customers WHERE name LIKE ? ORDER BY id DESC LIMIT 10').all(`%${flags.name}%`)
  } else if (flags.phone) {
    customers = db.prepare('SELECT * FROM customers WHERE phone LIKE ? ORDER BY id DESC LIMIT 10').all(`%${flags.phone}%`)
  } else if (flags.fbid) {
    customers = db.prepare('SELECT * FROM customers WHERE facebook_author_id = ? ORDER BY id DESC LIMIT 10').all(flags.fbid)
  } else if (flags.id) {
    const c = db.prepare('SELECT * FROM customers WHERE id = ?').get(+flags.id)
    if (c) customers = [c]
  } else {
    console.log('Usage: node lookup-customer.js --name "tên" | --phone "sđt" | --fbid "fb_id" | --id 123')
    process.exit(1)
  }

  if (customers.length === 0) {
    console.log('Không tìm thấy khách hàng.')
    process.exit(0)
  }

  // Get order counts per customer
  const orderCount = db.prepare('SELECT customer_id, COUNT(*) as total FROM orders GROUP BY customer_id')
    .all()
    .reduce((acc, r) => { acc[r.customer_id] = r.total; return acc }, {})

  for (const c of customers) {
    // Fetch avatar if has FB ID
    let avatarUrl = c.avatar_url
    if (!avatarUrl && c.facebook_author_id) {
      avatarUrl = await fetchAvatar(c.facebook_author_id)
    }

    console.log(`── Khách #${c.id} ──`)
    console.log(`Tên:      ${c.name}`)
    console.log(`SĐT:      ${c.phone || '(chưa có)'}`)
    console.log(`Địa chỉ:  ${c.address || '(chưa có)'}`)
    console.log(`Facebook:  ${c.facebook_url || (c.facebook_author_id ? `https://facebook.com/${c.facebook_author_id}` : '(chưa có)')}`)
    console.log(`Avatar:    ${avatarUrl || '(chưa có)'}`)
    console.log(`Đơn hàng:  ${orderCount[c.id] || 0}`)
    console.log(`Bom hàng:  ${c.blacklisted ? `⚠️ CÓ — ${c.blacklist_reason}` : 'Không'}`)
    console.log()
  }

  db.close()
}

main()
