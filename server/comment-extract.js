// Extract customer info from comment using local Ollama model
// Uses OpenAI-compatible API at localhost:11434

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434'
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'ollama-extract-information:latest'

// VN phone pattern: 0xxx (10 digits) or +84xxx
const VN_PHONE_RE = /^(?:\+?84|0)\d{9}$/

function isVnPhone(s) {
  if (!s) return false
  return VN_PHONE_RE.test(s.replace(/[\s\-\.]/g, ''))
}

export async function extractCommentInfo(commentText) {
  try {
    const res = await fetch(`${OLLAMA_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        messages: [{ role: 'user', content: commentText }],
        temperature: 0,
      }),
    })

    if (!res.ok) {
      console.error(`[extract] Ollama HTTP ${res.status}`)
      return null
    }

    const data = await res.json()
    const content = data.choices?.[0]?.message?.content
    if (!content) return null

    const parsed = JSON.parse(content)
    let phone = parsed.phone || null
    let address = parsed.address || null
    const orderNumber = parsed.order_number || null

    // Fix: if phone is empty but order_number looks like a phone
    if (!phone && isVnPhone(orderNumber)) {
      phone = orderNumber
    }
    // Fix: if phone doesn't match VN pattern, discard
    if (phone && !isVnPhone(phone)) {
      phone = null
    }

    // Normalize phone
    if (phone) {
      phone = phone.replace(/[\s\-\.]/g, '')
      if (phone.startsWith('+84')) phone = '0' + phone.slice(3)
      if (phone.startsWith('84') && phone.length > 10) phone = '0' + phone.slice(2)
    }

    // Clean empty address
    if (address && !address.trim()) address = null

    console.log(`[extract] "${commentText}" → phone=${phone || '-'} addr=${address || '-'}`)
    return { phone, address, orderNumber: isVnPhone(orderNumber) ? null : orderNumber }
  } catch (err) {
    console.error(`[extract] Error: ${err.message}`)
    return null
  }
}
