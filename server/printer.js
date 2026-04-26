import { execFile } from 'child_process'
import { removeDiacritics } from './vn-ascii.js'

const PRINTER_HOST = process.env.PRINTER_HOST || '192.168.1.100'
const PRINTER_PORT = parseInt(process.env.PRINTER_PORT || '9100')

// ESC/POS commands
const ESC = '\x1b'
const GS = '\x1d'
const CMD = {
  INIT: `${ESC}\x40`,
  FONT_B: `${ESC}\x4d\x01`,
  CENTER: `${ESC}\x61\x01`,
  LEFT: `${ESC}\x61\x00`,
  BOLD_ON: `${ESC}\x45\x01`,
  BOLD_OFF: `${ESC}\x45\x00`,
  // Name/phone: double height (30px equivalent)
  SIZE_MED: `${ESC}\x21\x11`,
  // Product: double width + double height (45px equivalent — biggest ESC/POS)
  SIZE_BIG: `${ESC}\x21\x31`,
  // Normal small
  SIZE_SM: `${ESC}\x21\x01`,
  // Line spacing
  LINE_WIDE: `${ESC}\x33\x60`,   // 96 dots — extra spacing for big text
  LINE_NORMAL: `${ESC}\x32`,
  CUT: `${GS}\x56\x42\x00`,
}

// Send via nc
function sendToPrinter(data) {
  return new Promise((resolve, reject) => {
    const child = execFile('nc', ['-w', '3', PRINTER_HOST, String(PRINTER_PORT)], {
      timeout: 8000,
    }, (err) => {
      if (err) return reject(new Error(`Printer error: ${err.message}`))
      resolve(true)
    })
    child.stdin.write(Buffer.from(data, 'utf-8'))
    child.stdin.end()
  })
}

function vnTime(iso) {
  const d = iso ? new Date(iso) : new Date()
  return d.toLocaleString('vi-VN', { timeZone: 'Asia/Saigon', hour12: false })
}

// Print order receipt — matches HTML v4 layout
export async function printOrderReceipt({ orderId, customerName, phone, productInfo, commentId, createdAt }) {
  const vn = removeDiacritics

  const receipt = [
    CMD.INIT,
    CMD.FONT_B,
    CMD.CENTER,
    CMD.LINE_WIDE,
    // Order ID + time — small
    CMD.SIZE_SM,
    `#${orderId} | ${vnTime(createdAt)}\n`,
    '\n',
    // Name — medium, bold, center
    CMD.SIZE_MED,
    CMD.BOLD_ON,
    `${vn(customerName)}\n`,
    CMD.BOLD_OFF,
    // Phone — medium, center
    phone ? `${phone}\n` : '',
    '\n',
    // Product — BIG, bold, center
    CMD.SIZE_BIG,
    CMD.BOLD_ON,
    `${vn(productInfo)}\n`,
    CMD.BOLD_OFF,
    // Reset + cut
    CMD.SIZE_SM,
    CMD.LINE_NORMAL,
    '\n',
    CMD.CUT,
  ].join('')

  await sendToPrinter(receipt)
  console.log(`[print] Order #${orderId} printed`)
  return true
}

// Print test page
export async function printTestPage() {
  const data = [
    CMD.INIT,
    CMD.FONT_B,
    CMD.CENTER,
    CMD.SIZE_BIG,
    `TEST\n`,
    CMD.SIZE_SM,
    `${PRINTER_HOST}:${PRINTER_PORT}\n`,
    `${vnTime()}\n`,
    '\n',
    CMD.CUT,
  ].join('')

  await sendToPrinter(data)
  console.log('[print] Test page printed')
  return true
}

// Print shipping label (VNPost order)
export async function printShippingLabel({ orderCode, receiverName, receiverPhone }) {
  const name = removeDiacritics(receiverName || 'N/A')
  const phone = receiverPhone || 'N/A'
  const code = orderCode || 'N/A'

  // 3x for order code, 2x for name/phone
  const SIZE_3X = `${GS}\x21\x22`
  const SIZE_2X = `${GS}\x21\x11`
  const LINE_EXTRA = `${ESC}\x33\x80`

  const data = [
    CMD.INIT,
    CMD.CENTER,
    LINE_EXTRA,
    SIZE_3X,
    `${code}\n`,
    SIZE_2X,
    `${name}\n`,
    `${phone}\n`,
    '\n',
    CMD.CUT,
  ].join('')

  await sendToPrinter(data)
  console.log(`[print] Shipping label: ${code} ${name} ${phone}`)
  return true
}

export { PRINTER_HOST, PRINTER_PORT }