// Import customer addresses from VNPost contact list
// Match by phone number → update address in our DB
// Usage: node server/import-addresses.js data/vnpost-contacts.json

import Database from 'better-sqlite3'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DB_PATH = path.join(__dirname, '../data/livestream.db')
const db = new Database(DB_PATH)

const inputFile = process.argv[2]
if (!inputFile) {
  console.error('Usage: node server/import-addresses.js <contacts.json>')
  process.exit(1)
}

// Read contacts JSON
const raw = fs.readFileSync(inputFile, 'utf-8')
const contacts = JSON.parse(raw)

if (!Array.isArray(contacts)) {
  console.error('JSON must be an array of contact objects')
  process.exit(1)
}

// Normalize phone: remove spaces, +84 → 0, keep last 9-10 digits
function normalizePhone(phone) {
  if (!phone) return null
  let p = phone.replace(/[\s\-\.+]/g, '')
  // Remove country code
  if (p.startsWith('84') && p.length > 10) p = '0' + p.slice(2)
  if (p.startsWith('+84')) p = '0' + p.slice(3)
  // Keep only digits
  p = p.replace(/\D/g, '')
  if (p.length < 9) return null
  return p
}

// Build address string from contact
function buildAddress(contact) {
  const parts = []
  if (contact.address?.trim()) parts.push(contact.address.trim())
  if (contact.commune?.trim()) parts.push(contact.commune.trim())
  if (contact.district?.trim()) parts.push(contact.district.trim())
  if (contact.province?.trim()) parts.push(contact.province.trim())
  return parts.join(', ') || null
}

// Prepare statements
const findByPhone = db.prepare('SELECT id, name, phone, address FROM customers WHERE phone = ?')
const updateAddress = db.prepare('UPDATE customers SET address = ? WHERE id = ?')
const updateBlacklist = db.prepare(`
  UPDATE customers SET blacklisted = 1, blacklist_reason = 'Bom hàng (VNPost)', blacklisted_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  WHERE id = ? AND (blacklisted IS NULL OR blacklisted = 0)
`)

let matched = 0
let updated = 0
let blacklisted = 0
let skipped = 0

console.log(`[import] Processing ${contacts.length} contacts...`)

for (const contact of contacts) {
  const phone = normalizePhone(contact.phone)
  if (!phone) {
    skipped++
    continue
  }

  const customer = findByPhone.get(phone)
  if (!customer) {
    skipped++
    continue
  }

  matched++

  // Update address if we have one
  const address = buildAddress(contact)
  if (address && !customer.address) {
    updateAddress.run(address, customer.id)
    updated++
    console.log(`[import] #${customer.id} ${customer.name} → ${address}`)
  }

  // Sync blacklist status
  if (contact.isBlacklist) {
    updateBlacklist.run(customer.id)
    blacklisted++
    console.log(`[import] #${customer.id} ${customer.name} → BLACKLISTED`)
  }
}

console.log(`\n[import] Done!`)
console.log(`  Total contacts: ${contacts.length}`)
console.log(`  Matched by phone: ${matched}`)
console.log(`  Address updated: ${updated}`)
console.log(`  Blacklisted: ${blacklisted}`)
console.log(`  Skipped (no match): ${skipped}`)

db.close()
