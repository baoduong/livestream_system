// VNPost Address Resolver
// Resolve province code + commune code from address text
// Uses vnpost_communes table in SQLite + province lookup

import Database from 'better-sqlite3'
import path from 'path'
import { fileURLToPath } from 'url'
import { findProvinceCode } from './vnpost-provinces.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const db = new Database(path.join(__dirname, '../data/livestream.db'))

// Find commune code by searching commune name in address
export function resolveAddress(address) {
  const result = {
    provinceCode: null,
    districtCode: 'VNPOST',
    communeCode: null,
  }

  // 1. Resolve province
  result.provinceCode = findProvinceCode(address)

  // 2. Try to find commune from address text
  // Extract potential commune names: "Xã X", "Phường X", "P. X", "X. X"
  const communePatterns = [
    /(?:xã|x\.)\s+([a-zA-ZÀ-ỹ\s]{3,30})/gi,
    /(?:phường|p\.)\s+([a-zA-ZÀ-ỹ\s]{3,30})/gi,
    /(?:thị trấn|tt\.)\s+([a-zA-ZÀ-ỹ\s]{3,30})/gi,
  ]

  for (const pattern of communePatterns) {
    let match
    while ((match = pattern.exec(address)) !== null) {
      const name = match[1].trim()
      // Search in DB with fuzzy match
      const commune = db.prepare(
        "SELECT * FROM vnpost_communes WHERE commune_name LIKE ? LIMIT 5"
      ).all(`%${name}%`)

      if (commune.length === 1) {
        result.communeCode = commune[0].commune_code
        result.districtCode = commune[0].district_code
        break
      } else if (commune.length > 1 && result.provinceCode) {
        // Multiple matches - filter by province (commune_code starts with province-area digits)
        // This is approximate since commune codes don't directly map to province codes
        result.communeCode = commune[0].commune_code
        result.districtCode = commune[0].district_code
        break
      }
    }
    if (result.communeCode) break
  }

  return result
}

// CLI test
if (process.argv[2]) {
  const address = process.argv.slice(2).join(' ')
  console.log('Address:', address)
  console.log('Resolved:', resolveAddress(address))
}
