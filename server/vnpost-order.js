#!/usr/bin/env node
/**
 * VNPost Order Management Script
 * Usage: node vnpost-order.js <command> [options]
 * 
 * Commands:
 *   create <json>       - Create order (JSON string or file path)
 *   status <orderCode>  - Check order status
 *   search <query>     - Search orders
 *   list [from] [to]   - List all orders
 *   cancel <orderId>    - Cancel order (caseTypeId=9)
 * 
 * Examples:
 *   node vnpost-order.js create '{"receiverPhone":"0979078870","receiverName":"Test","receiverAddress":"123 ABC","weight":500}'
 *   node vnpost-order.js status DH88514176
 *   node vnpost-order.js search "0979078870"
 *   node vnpost-order.js list "2026-04-01 00:00" "2026-04-21 23:59"
 *   node vnpost-order.js cancel d8838a0b834e4b7d90c2a06cdf5e89d6
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { printShippingLabel } from './printer.js'
import { findProvinceCode } from './vnpost-provinces.js'
import { resolveAddress } from './vnpost-address-resolver.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const CONFIG = {
  API_BASE: 'https://api-pre-my.vnpost.vn',
  API_ORDER: '/myvnp-web/v1/OrderHdr',
  API_PROFILE: '/myvnp-web/v1/user/profile',
  API_SEARCH: '/myvnp-web/v1/OrderHdr/search',
  API_SEARCH_V2: '/myvnp-web/v1/OrderHdr/searchAllByParamV2',
  API_CANCEL: '/myvnp-web/v1/order-correction/createCase',
  CAPKEY: '19001111'
}

const TOKEN_FILE = path.join(__dirname, '../data/vnpost-token.json')
const DEFAULT_SENDER = {
  senderId: 20750567,
  senderPhone: '0706059928',
  senderName: 'Võ Thị Thu Vĩnh',
  senderAddress: '16/22A Tân An',
  senderProvinceCode: '57',
  senderDistrictCode: '5700',
  senderCommuneCode: '57136',
  senderContractNumber: '329/BĐNT-DTBU',
  namePrinted: 'Võ Thị Thu Vĩnh',
  phonePrinted: '0706059928',
  configPrintOrder: '1'
}

function loadToken() {
  try {
    const data = fs.readFileSync(TOKEN_FILE, 'utf8')
    const config = JSON.parse(data)
    if (!config.token) throw new Error('No token found')
    return config
  } catch (e) {
    console.error('❌ No token found. Please save token to:', TOKEN_FILE)
    process.exit(1)
  }
}

async function refreshAccessToken() {
  const config = loadToken()
  if (!config.refreshToken) {
    console.error('❌ No refresh token available')
    return null
  }
  console.log('[vnpost] Refreshing access token...')
  try {
    const res = await fetch(`${CONFIG.API_BASE}/myvnp-web/api/auth/refreshToken`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'capikey': CONFIG.CAPKEY,
        'Referer': 'https://my.vnpost.vn/'
      },
      body: JSON.stringify({ refreshToken: config.refreshToken })
    })
    if (!res.ok) {
      console.error('❌ Refresh failed:', res.status)
      return null
    }
    const data = await res.json()
    if (data.accessToken) {
      const newConfig = {
        token: data.accessToken,
        refreshToken: data.refreshToken || config.refreshToken,
        updated: new Date().toISOString()
      }
      fs.writeFileSync(TOKEN_FILE, JSON.stringify(newConfig))
      console.log('[vnpost] Token refreshed!')
      return data.accessToken
    }
    return null
  } catch (err) {
    console.error('❌ Refresh error:', err.message)
    return null
  }
}

async function apiCall(endpoint, method = 'GET', body = null) {
  let { token } = loadToken()
  const url = CONFIG.API_BASE + endpoint

  const doFetch = async (t) => {
    const opts = {
      method,
      headers: {
        'Authorization': `Bearer ${t}`,
        'capikey': CONFIG.CAPKEY,
        'Content-Type': 'application/json',
        'Referer': 'https://my.vnpost.vn/'
      },
    }
    if (body) opts.body = JSON.stringify(body)
    return fetch(url, opts)
  }

  try {
    let res = await doFetch(token)

    // Auto-refresh on 401
    if (res.status === 401) {
      const newToken = await refreshAccessToken()
      if (newToken) {
        res = await doFetch(newToken)
      } else {
        console.error('❌ Token expired and refresh failed. Login at my.vnpost.vn')
        process.exit(1)
      }
    }

    const text = await res.text()

    if (res.status >= 400) {
      console.error(`❌ API Error ${res.status}:`, text.slice(0, 500))
      process.exit(1)
    }

    try {
      const json = JSON.parse(text)
      return json
    } catch {
      return text
    }
  } catch (err) {
    console.error('❌ Network error:', err.message)
    process.exit(1)
  }
}

// ─── Create Order ────────────────────────────────────────────────────────────
async function createOrder(args) {
  let order
  if (args.startsWith('{')) {
    order = JSON.parse(args)
  } else if (fs.existsSync(args)) {
    order = JSON.parse(fs.readFileSync(args, 'utf8'))
  } else {
    console.error('❌ Invalid JSON or file not found:', args)
    process.exit(1)
  }

  // Auto-resolve address codes
  if (order.receiverAddress) {
    const resolved = resolveAddress(order.receiverAddress)
    if (!order.receiverProvinceCode && resolved.provinceCode) {
      order.receiverProvinceCode = resolved.provinceCode
      console.log(`[vnpost] Auto province: ${resolved.provinceCode}`)
    }
    if (!order.receiverCommuneCode && resolved.communeCode) {
      order.receiverCommuneCode = resolved.communeCode
      console.log(`[vnpost] Auto commune: ${resolved.communeCode}`)
    }
  }

  const fullOrder = {
    ...DEFAULT_SENDER,
    ...order,
    isNewAddress: 1,
    methodPay: '1',
    serviceCode: order.serviceCode || 'CTN009',
    vas: [],
    contractServiceCodes: order.contractServiceCodes || [
      { csc: 'ETN037', cc: '01', releaseNote: null },
      { csc: 'CTN009', cc: '01', releaseNote: null },
      { csc: 'CTN001', cc: '04', releaseNote: null }
    ],
    saleOrderCode: order.saleOrderCode || `BOT-${Date.now()}`,
    weight: order.weight || 500,
    dimWeight: order.dimWeight || 0,
    priceWeight: order.priceWeight || order.weight || 500,
    contentNote: order.contentNote || 'vải',
    categoryIds: [{ id: 2, name: 'Hàng thông thường' }],
    sendType: '1',
    deliveryTime: order.deliveryTime || 'N',
    // VNPost auto-resolve district from address text
    receiverDistrictCode: order.receiverDistrictCode || 'VNPOST',
    // Duplicate address fields for VNPost compatibility
    address: order.receiverAddress,
    provinceCode: order.receiverProvinceCode,
    districtCode: order.receiverDistrictCode || 'VNPOST',
    communeCode: order.receiverCommuneCode,
  }

  console.log('📦 Creating order...')
  const result = await apiCall(CONFIG.API_ORDER, 'POST', fullOrder)
  console.log(JSON.stringify(result, null, 2))

  // Auto-print shipping label if order created successfully
  if (result?.itemCode || result?.orderCode) {
    const code = result.itemCode || result.orderCode
    console.log(`\n🖨️ Printing shipping label...`)
    try {
      await printShippingLabel({
        orderCode: code,
        receiverName: fullOrder.receiverName,
        receiverPhone: fullOrder.receiverPhone,
      })
      console.log(`✅ Label printed: ${code}`)
    } catch (err) {
      console.error(`⚠️ Print failed: ${err.message}`)
    }
  }

  return result
}

// ─── Check Status ────────────────────────────────────────────────────────────
async function checkStatus(orderCode) {
  console.log(`🔍 Status: ${orderCode}`)
  const result = await apiCall(`${CONFIG.API_ORDER}/${orderCode}`, 'GET')
  console.log(JSON.stringify(result, null, 2))
  return result
}

// ─── Search Orders ───────────────────────────────────────────────────────────
async function searchOrders(query) {
  console.log(`🔍 Search: ${query}`)
  const result = await apiCall(CONFIG.API_SEARCH, 'POST', {
    searchContent: query,
    pageInfo: { pageSize: 20, pageIndex: 1 }
  })
  
  // Pretty print results
  if (result?.content?.length > 0) {
    console.log(`\n📋 ${result.content.length} orders found:`)
    for (const o of result.content) {
      console.log(`  ${o.orderCode || o.saleOrderCode} | ${o.receiverName} | ${o.receiverPhone} | ${o.statusName || 'N/A'} | ${o.createdDate || ''}`)
    }
  } else if (Array.isArray(result) && result.length > 0) {
    console.log(`\n📋 ${result.length} orders found:`)
    for (const o of result) {
      console.log(`  ${o.orderCode || o.saleOrderCode} | ${o.receiverName} | ${o.receiverPhone} | ${o.statusName || 'N/A'}`)
    }
  } else {
    console.log('No orders found.')
  }
  
  console.log('\n[JSON]:')
  console.log(JSON.stringify(result, null, 2))
  return result
}

// ─── List All Orders ─────────────────────────────────────────────────────────
async function listAllOrders(fromDate, toDate) {
  const from = fromDate || '2026-01-01 00:00'
  const to = toDate || new Date().toISOString().slice(0, 10) + ' 23:59'
  console.log(`📋 Orders from ${from} to ${to}`)

  const body = {
    isInternational: '0',
    toDateFromDate: [from, to],
    orgCode: ['C006661231'],
    owner: 'MYVNP_C_732318',
    lstStatus: [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,101,102,103,104,105,106,107,108,109,110,111],
    orderType: '1',
    isNewAddress: 1
  }

  const result = await apiCall(`${CONFIG.API_SEARCH_V2}?page=0&size=100`, 'POST', body)
  
  if (result?.content?.length > 0) {
    console.log(`\n📋 ${result.content.length} orders:`)
    for (const o of result.content) {
      const cod = o.codAmount ? ` COD:${o.codAmount}` : ''
      console.log(`  ${o.orderCode} | ${o.receiverName} | ${o.receiverPhone} | ${o.statusName}${cod} | ${o.createdDate}`)
    }
  } else {
    console.log('No orders found.')
  }

  console.log('\n[JSON]:')
  console.log(JSON.stringify(result, null, 2))
  return result
}

// ─── Cancel Order ────────────────────────────────────────────────────────────
async function cancelOrder(orderId) {
  console.log(`🗑️ Cancelling: ${orderId}`)
  const result = await apiCall(`${CONFIG.API_CANCEL}?oldOrderId=${orderId}&caseTypeId=9`, 'POST', {})
  console.log(JSON.stringify(result, null, 2))
  return result
}

// ─── Main ────────────────────────────────────────────────────────────────────
const cmd = process.argv[2]
const arg = process.argv[3]

switch (cmd) {
  case 'create':
    await createOrder(arg || process.argv.slice(3).join(' '))
    break
  case 'status':
    await checkStatus(arg)
    break
  case 'search':
    await searchOrders(arg)
    break
  case 'list':
    await listAllOrders(process.argv[3], process.argv[4])
    break
  case 'cancel':
    await cancelOrder(arg)
    break
  default:
    console.log(`
📦 VNPost Order Management

Commands:
  create <json>       Create order
  status <code>      Check order status  
  search <query>     Search orders
  list [from] [to]   List all orders
  cancel <orderId>   Cancel order

Examples:
  node vnpost-order.js create '{"receiverPhone":"0979078870","receiverName":"Test","receiverAddress":"123 ABC","weight":500}'
  node vnpost-order.js status DH88514176
  node vnpost-order.js search "0979078870"
  node vnpost-order.js list "2026-04-01 00:00" "2026-04-21 23:59"
`)
}
