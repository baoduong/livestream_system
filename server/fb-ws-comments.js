// FB Live Comments via WebSocket (MQTT over WS) — Research Script
// Usage: node server/fb-ws-comments.js <video-id>
//
// Facebook uses MQTT over WebSocket at wss://gateway.facebook.com/ws/realtime
// to push live comments in real-time. This script:
// 1. Opens Business Suite Comments Dashboard via Playwright
// 2. Intercepts WebSocket frames
// 3. Dumps binary data for protocol analysis
// 4. Attempts to decode MQTT messages
//
// Protocol: MQTT 3.1.1 over WebSocket
// - Binary frames = MQTT packets
// - Comment data likely in PUBLISH packets (type 3)
// - Topic subscription happens automatically when page loads

import { chromium } from 'playwright'
import { config } from 'dotenv'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
config({ path: path.join(__dirname, '../.env') })

const C_USER = process.env.FB_COOKIE_C_USER || ''
const XS = process.env.FB_COOKIE_XS || ''
const DATR = process.env.FB_COOKIE_DATR || ''
const FR = process.env.FB_COOKIE_FR || ''
const SB = process.env.FB_COOKIE_SB || ''
const VIDEO_ID = process.argv[2]
const DUMP_DIR = path.join(__dirname, '../data/ws-dump')

if (!VIDEO_ID) {
  console.error('Usage: node server/fb-ws-comments.js <video-id>')
  process.exit(1)
}

// MQTT packet types
const MQTT_TYPES = {
  1: 'CONNECT', 2: 'CONNACK', 3: 'PUBLISH', 4: 'PUBACK',
  5: 'PUBREC', 6: 'PUBREL', 7: 'PUBCOMP', 8: 'SUBSCRIBE',
  9: 'SUBACK', 10: 'UNSUBSCRIBE', 11: 'UNSUBACK',
  12: 'PINGREQ', 13: 'PINGRESP', 14: 'DISCONNECT'
}

function parseMQTTType(buf) {
  if (!buf || buf.length === 0) return 'EMPTY'
  const byte0 = buf[0]
  const type = (byte0 >> 4) & 0x0f
  return MQTT_TYPES[type] || `UNKNOWN(${type})`
}

function decodeMQTTPublish(buf) {
  if (buf.length < 4) return null
  const byte0 = buf[0]
  const type = (byte0 >> 4) & 0x0f
  if (type !== 3) return null // Not PUBLISH
  
  // Decode remaining length (variable-length encoding)
  let multiplier = 1
  let remainingLength = 0
  let pos = 1
  let encodedByte
  do {
    if (pos >= buf.length) return null
    encodedByte = buf[pos++]
    remainingLength += (encodedByte & 127) * multiplier
    multiplier *= 128
  } while ((encodedByte & 128) !== 0)
  
  // Topic length (2 bytes)
  if (pos + 2 > buf.length) return null
  const topicLen = (buf[pos] << 8) | buf[pos + 1]
  pos += 2
  
  // Topic string
  if (pos + topicLen > buf.length) return null
  const topic = buf.slice(pos, pos + topicLen).toString('utf8')
  pos += topicLen
  
  // QoS check (from byte0 flags)
  const qos = (byte0 >> 1) & 0x03
  if (qos > 0) {
    pos += 2 // Skip packet ID
  }
  
  // Payload
  const payload = buf.slice(pos)
  
  return { topic, payload, payloadStr: payload.toString('utf8') }
}

async function main() {
  // Create dump directory
  fs.mkdirSync(DUMP_DIR, { recursive: true })
  
  const browser = await chromium.launch({ headless: false })
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
    locale: 'vi-VN',
    viewport: { width: 1400, height: 900 },
  })
  
  const cookies = [
    { name: 'c_user', value: C_USER, domain: '.facebook.com', path: '/' },
    { name: 'xs', value: XS, domain: '.facebook.com', path: '/' },
  ]
  if (DATR) cookies.push({ name: 'datr', value: DATR, domain: '.facebook.com', path: '/' })
  if (FR) cookies.push({ name: 'fr', value: FR, domain: '.facebook.com', path: '/' })
  if (SB) cookies.push({ name: 'sb', value: SB, domain: '.facebook.com', path: '/' })
  await context.addCookies(cookies)
  
  const page = await context.newPage()
  let frameCount = 0
  let publishCount = 0
  
  page.on('websocket', ws => {
    const url = ws.url()
    console.log(`[WS] Connected: ${url.slice(0, 80)}`)
    
    // Log SUBSCRIBE packets (to find comment topics)
    ws.on('framesent', frame => {
      const data = frame.payload
      if (!Buffer.isBuffer(data)) return
      const type = parseMQTTType(data)
      if (type === 'SUBSCRIBE') {
        console.log(`[WS-OUT] SUBSCRIBE size=${data.length}`)
        // Dump subscribe packet
        fs.writeFileSync(`${DUMP_DIR}/subscribe_${Date.now()}.bin`, data)
        // Try to extract topic
        try {
          const str = data.toString('utf8')
          console.log(`  Topics: ${str.replace(/[^\x20-\x7E]/g, '.').slice(0, 200)}`)
        } catch {}
      }
    })
    
    ws.on('framereceived', frame => {
      const data = frame.payload
      if (!Buffer.isBuffer(data)) return
      
      frameCount++
      const type = parseMQTTType(data)
      
      if (type === 'PUBLISH') {
        publishCount++
        const pub = decodeMQTTPublish(data)
        if (pub) {
          console.log(`[PUBLISH #${publishCount}] topic="${pub.topic}" payload=${pub.payload.length} bytes`)
          
          // Check if payload contains comment data
          const str = pub.payloadStr
          const hasComment = str.includes('comment') || str.includes('body') || str.includes('author') || str.includes('name')
          if (hasComment) {
            console.log(`  *** COMMENT DATA FOUND ***`)
            console.log(`  ${str.slice(0, 500)}`)
          }
          
          // Dump all PUBLISH payloads
          fs.writeFileSync(`${DUMP_DIR}/publish_${publishCount}_${pub.topic.replace(/\//g, '_')}.bin`, pub.payload)
        } else {
          console.log(`[PUBLISH #${publishCount}] decode failed, size=${data.length}`)
          fs.writeFileSync(`${DUMP_DIR}/publish_raw_${publishCount}.bin`, data)
        }
      } else if (type !== 'PINGRESP' && type !== 'PINGREQ') {
        console.log(`[WS-IN] ${type} size=${data.length}`)
      }
    })
    
    ws.on('close', () => console.log('[WS] Closed'))
  })
  
  // Also monitor GraphQL for comparison
  page.on('response', async (r) => {
    if (!r.url().includes('graphql')) return
    try {
      const t = await r.text()
      if (t.includes('TopLevelCommentsEdge')) {
        console.log(`[GQL] Comments response: ${t.length} bytes`)
      }
    } catch {}
  })
  
  const url = `https://business.facebook.com/live/producer/dashboard/${VIDEO_ID}/COMMENTS/`
  console.log(`[ws-comments] Opening: ${url}`)
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 })
  
  console.log(`[ws-comments] Page loaded. Waiting for WebSocket data...`)
  console.log(`[ws-comments] >>> COMMENT ON LIVE NOW TO SEE DATA <<<`)
  
  // Keep running until killed
  await new Promise(resolve => {
    process.on('SIGINT', resolve)
    process.on('SIGTERM', resolve)
    // Auto-stop after 5 minutes
    setTimeout(resolve, 300000)
  })
  
  console.log(`\n[ws-comments] Summary: ${frameCount} frames, ${publishCount} publishes`)
  console.log(`[ws-comments] Dumps saved to ${DUMP_DIR}/`)
  await browser.close()
}

main().catch(err => {
  console.error('[ws-comments] Fatal:', err.message)
  process.exit(1)
})
