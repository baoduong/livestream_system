// Fetch all contacts from VNPost API and import addresses
// Matches by phone number with our customers DB

import Database from 'better-sqlite3'
import path from 'path'
import { fileURLToPath } from 'url'
import fs from 'fs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DB_PATH = path.join(__dirname, '../data/livestream.db')
const db = new Database(DB_PATH)

const TOKEN = process.env.VNPOST_TOKEN || 'eyJhbGciOiJIUzUxMiJ9.eyJpc3MiOiJKRmNhcC1XZWJBcGkiLCJleHAiOjE3NzYyNDQ2NDQsIm5iZiI6MTc3NjI0MDc0NCwiaWF0IjoxNzc2MjQwNzQ0LCJhaWQiOiJNWVZOUCIsInVpZCI6Ik1ZVk5QX0NfNzMyMzE4IiwidWZuIjoiRMawxqFuZyBUcmnhu4F1IELhuqNvIFV5w6puIiwib3JnIjoiQzAwNjY2MTIzMSIsIm9yZ0VtcGwiOiJDMDA2NDE0MjQ5IiwiZGlkIjoiZWU0ODYxN2RiOWZmYzExNTI1NWUyNmFjMTQwZGQ2M2YiLCJsY3AiOjE2ODg3MjIyNzMwMDAsImV4cGlyYXRpb25EYXRlIjo5MCwiaXNFbXBsb3llZSI6ZmFsc2UsIm93bmVyIjoiTVlWTlBfQ183MzIzMTgiLCJwaG9uZU51bWJlciI6Iis4NDkwNTc5NTI2NyIsIm9zIjoiV0VCIiwiaXNGaXJzdExvZ2luIjpmYWxzZX0.1gKHTDY4Ay5ZhwZejGaqW2dEkMaqCau6odCIcYTYt2a8PcgbqIIXPMmvukuLhlXm_C2A_SQjfo8ULRjizXWl8A'

const PAGE_SIZE = 100
const API_URL = 'https://api-pre-my.vnpost.vn/myvnp-web/v1/contact/searchByParam'

function normalizePhone(phone) {
  if (!phone) return null
  let p = phone.replace(/[\s\-\.+]/g, '')
  if (p.startsWith('84') && p.length > 10) p = '0' + p.slice(2)
  if (p.startsWith('+84')) p = '0' + p.slice(3)
  p = p.replace(/\D/g, '')
  if (p.length < 9) return null
  if (!p.startsWith('0')) p = '0' + p
  return p
}

function buildAddress(c) {
  const parts = []
  if (c.address?.trim()) parts.push(c.address.trim())
  if (c.commune?.trim()) parts.push(c.commune.trim())
  if (c.district?.trim()) parts.push(c.district.trim())
  if (c.province?.trim()) parts.push(c.province.trim())
  return parts.join(', ') || null
}

async function fetchPage(page) {
  const res = await fetch(`${API_URL}?page=${page}&size=${PAGE_SIZE}`, {
    method: 'POST',
    headers: {
      'accept': '*/*',
      'authorization': TOKEN,
      'capikey': '19001111',
      'content-type': 'application/json',
      'Referer': 'https://my.vnpost.vn/',
    },
    body: JSON.stringify({ isSender: false, isBlacklist: false }),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`)
  return res.json()
}

// Prepared statements
const findByPhone = db.prepare('SELECT id, name, phone, address FROM customers WHERE phone = ?')
const updateAddress = db.prepare('UPDATE customers SET address = ? WHERE id = ?')

async function main() {
  let page = 0
  let allContacts = []
  let totalPages = 1

  console.log('[vnpost] Fetching contacts...')

  while (page < totalPages) {
    const data = await fetchPage(page)
    
    // API returns array directly
    const contacts = Array.isArray(data) ? data : (data.content || data.data || [])
    
    if (page === 0) {
      // If array, check if we got a full page (means more pages)
      if (Array.isArray(data)) {
        // Estimate: keep fetching until we get less than PAGE_SIZE
        totalPages = contacts.length >= PAGE_SIZE ? 999 : 1
      } else {
        totalPages = data.totalPages || Math.ceil((data.totalElements || 0) / PAGE_SIZE)
      }
      console.log(`[vnpost] First page: ${contacts.length} contacts`)
    }

    allContacts.push(...contacts)
    console.log(`[vnpost] Page ${page + 1}: ${contacts.length} contacts (total so far: ${allContacts.length})`)
    
    // Stop if less than full page
    if (contacts.length < PAGE_SIZE) break
    
    page++
    // Small delay to avoid rate limit
    if (page < totalPages) await new Promise(r => setTimeout(r, 500))
  }

  // Save raw data
  const outFile = path.join(__dirname, '../data/vnpost-contacts.json')
  fs.writeFileSync(outFile, JSON.stringify(allContacts, null, 2))
  console.log(`[vnpost] Saved ${allContacts.length} contacts to ${outFile}`)

  // Match and update
  let matched = 0
  let updated = 0
  let skipped = 0

  for (const contact of allContacts) {
    const phone = normalizePhone(contact.phone)
    if (!phone) { skipped++; continue }

    const customer = findByPhone.get(phone)
    if (!customer) { skipped++; continue }

    matched++

    const address = buildAddress(contact)
    if (address && !customer.address) {
      updateAddress.run(address, customer.id)
      updated++
      console.log(`[match] #${customer.id} ${customer.name} (${phone}) → ${address}`)
    } else if (address && customer.address) {
      console.log(`[skip] #${customer.id} ${customer.name} already has address`)
    }
  }

  console.log(`\n[done] Results:`)
  console.log(`  VNPost contacts: ${allContacts.length}`)
  console.log(`  Matched by phone: ${matched}`)
  console.log(`  Address updated: ${updated}`)
  console.log(`  Skipped: ${skipped}`)

  db.close()
}

main().catch(err => {
  console.error('[error]', err.message)
  db.close()
  process.exit(1)
})
