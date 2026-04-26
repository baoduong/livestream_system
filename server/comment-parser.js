// Comment parser — extract phone number and product code from comment text
// Examples:
//   "mã 35, 0902576947"       → { phone: "0902576947", code: "35" }
//   "khách mới nhé: 0903425232" → { phone: "0903425232", code: null }
//   "090.222.3334"             → { phone: "0902223334", code: null }
//   "09079 078 870"            → { phone: "09079078870", code: null }
//   "35"                       → { phone: null, code: "35" }
//   "67"                       → { phone: null, code: "67" }
//   "mã 35, sdt 090.222.3334" → { phone: "0902223334", code: "35" }

// ─── Phone extraction ────────────────────────────────────────────────────────
// Vietnamese phone: starts with 0, 10-11 digits, may have dots/spaces/dashes
const PHONE_PATTERNS = [
  // 0xx.xxx.xxxx or 0xx-xxx-xxxx or 0xx xxx xxxx
  /\b(0\d{2})[.\-\s](\d{3})[.\-\s](\d{4})\b/g,
  // 0xxxx xxx xxx or 0xxxx-xxx-xxx
  /\b(0\d{4})[.\-\s](\d{3})[.\-\s](\d{3})\b/g,
  // 0xxxxxxxxx (10 digits straight)
  /\b(0\d{9})\b/g,
  // 0xxxxxxxxxx (11 digits straight)
  /\b(0\d{10})\b/g,
]

function extractPhone(text) {
  if (!text) return null

  for (const pattern of PHONE_PATTERNS) {
    pattern.lastIndex = 0
    const match = pattern.exec(text)
    if (match) {
      // Join all captured groups, remove non-digits
      const raw = match[0].replace(/[.\-\s]/g, '')
      // Must be 10-11 digits starting with 0
      if (/^0\d{9,10}$/.test(raw)) {
        return raw
      }
    }
  }
  return null
}

// ─── Product code extraction ─────────────────────────────────────────────────
// Patterns:
//   "mã 35" "ma 35" "Mã: 35" → code = "35"
//   Just a number alone: "35" "67" → code = "35"
//   Number with k: "35k" → code = "35"

function extractCode(text) {
  if (!text) return null

  // Pattern 1: explicit "mã" keyword
  const maMatch = text.match(/(?:mã|ma|M[aã])\s*:?\s*(\d+)/i)
  if (maMatch) return maMatch[1]

  // Pattern 2: standalone number (not a phone number)
  // Remove phone numbers first to avoid false positives
  let cleaned = text
  for (const pattern of PHONE_PATTERNS) {
    cleaned = cleaned.replace(pattern, '')
  }

  // Look for standalone numbers (1-4 digits, optionally followed by k)
  const codeMatch = cleaned.match(/\b(\d{1,4})k?\b/)
  if (codeMatch) {
    const num = codeMatch[1]
    // Ignore if it looks like a year or very large number
    if (parseInt(num) > 0 && parseInt(num) < 10000) {
      return num
    }
  }

  return null
}

// ─── Full comment parser ─────────────────────────────────────────────────────
export function parseComment(text) {
  return {
    phone: extractPhone(text),
    code: extractCode(text),
    raw: text,
  }
}

// ─── Tests ───────────────────────────────────────────────────────────────────
export function runParserTests() {
  const tests = [
    { input: 'mã 35, 0902576947', expect: { phone: '0902576947', code: '35' } },
    { input: 'khách mới nhé shop ơi: 0903425232', expect: { phone: '0903425232', code: null } },
    { input: '090.222.3334', expect: { phone: '0902223334', code: null } },
    { input: '09079 078 870', expect: { phone: '09079078870', code: null } },
    { input: '35', expect: { phone: null, code: '35' } },
    { input: '67', expect: { phone: null, code: '67' } },
    { input: 'mã 35, sdt 090.222.3334', expect: { phone: '0902223334', code: '35' } },
    { input: 'Cho em 1 áo sơ mi', expect: { phone: null, code: '1' } },
    { input: 'Ma: 120, 0901234567', expect: { phone: '0901234567', code: '120' } },
    { input: '35k', expect: { phone: null, code: '35' } },
  ]

  let pass = 0
  for (const t of tests) {
    const result = parseComment(t.input)
    const phoneOk = result.phone === t.expect.phone
    const codeOk = result.code === t.expect.code
    const ok = phoneOk && codeOk
    console.log(`${ok ? '✅' : '❌'} "${t.input}" → phone=${result.phone} code=${result.code}${!ok ? ` (expected phone=${t.expect.phone} code=${t.expect.code})` : ''}`)
    if (ok) pass++
  }
  console.log(`\n${pass}/${tests.length} tests passed`)
  return pass === tests.length
}