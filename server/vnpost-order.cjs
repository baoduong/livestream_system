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
 *   node vnpost-order.js create '{"senderPhone":"0706059928","receiverPhone":"0979078870","receiverName":"Test","receiverAddress":"123 ABC","weight":500}'
 *   node vnpost-order.js status DH88514176
 *   node vnpost-order.js search "0979078870"
 *   node vnpost-order.js list "2026-04-01 00:00" "2026-04-20 23:59"
 *   node vnpost-order.js cancel d8838a0b834e4b7d90c2a06cdf5e89d6
 */

const fs = require('fs');
const path = require('path');

const CONFIG = {
  API_BASE: 'https://api-pre-my.vnpost.vn',
  API_ORDER: '/myvnp-web/v1/OrderHdr',
  API_PROFILE: '/myvnp-web/v1/user/profile',
  API_SEARCH: '/myvnp-web/v1/OrderHdr/search',
  API_SEARCH_V2: '/myvnp-web/v1/OrderHdr/searchAllByParamV2',
  API_CANCEL: '/myvnp-web/v1/order-correction/createCase',
  CAPKEY: '19001111'
};

const TOKEN_FILE = path.join(__dirname, '../data/vnpost-token.json');
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
};

function loadToken() {
  try {
    const data = fs.readFileSync(TOKEN_FILE, 'utf8');
    const config = JSON.parse(data);
    if (!config.token) throw new Error('No token found');
    return config.token;
  } catch (e) {
    console.error('❌ No token found. Please login first:', TOKEN_FILE);
    process.exit(1);
  }
}

function apiCall(endpoint, method = 'GET', body = null) {
  const token = loadToken();
  const headers = {
    'Authorization': `Bearer ${token}`,
    'capikey': CONFIG.CAPKEY,
    'Content-Type': 'application/json',
    'Referer': 'https://my.vnpost.vn/'
  };
  
  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);
  
  const url = CONFIG.API_BASE + endpoint;
  console.log(`[API] ${method} ${url}`);
  
  const http = require('https').request(url, opts, (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
      if (res.statusCode === 401) {
        console.error('❌ Token expired. Please refresh token.');
        process.exit(1);
      }
      if (res.statusCode >= 400) {
        console.error(`❌ API Error: ${res.statusCode}`, data);
        process.exit(1);
      }
      try {
        const json = JSON.parse(data);
        console.log(JSON.stringify(json, null, 2));
      } catch (e) {
        console.log(data);
      }
    });
  });
  
  http.on('error', console.error);
  if (body) http.write(JSON.stringify(body));
  http.end();
}

/**
 * Create Order
 */
function createOrder(args) {
  let order;
  
  if (args.startsWith('{')) {
    order = JSON.parse(args);
  } else if (fs.existsSync(args)) {
    order = JSON.parse(fs.readFileSync(args, 'utf8'));
  } else {
    console.error('Invalid JSON or file not found:', args);
    process.exit(1);
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
    contentNote: order.contentNote || 'Hàng thông thường',
    categoryIds: [{ id: 2, name: 'Hàng thông thường' }],
    sendType: '1',
    deliveryTime: order.deliveryTime || 'N'
  };
  
  if (!fullOrder.provinceCode && order.senderProvinceCode) {
    fullOrder.provinceCode = order.senderProvinceCode;
    fullOrder.districtCode = order.senderDistrictCode;
    fullOrder.communeCode = order.senderCommuneCode;
  }
  
  console.log('📦 Creating order...');
  apiCall(CONFIG.API_ORDER, 'POST', fullOrder);
}

/**
 * Check Order Status
 */
function checkStatus(orderCode) {
  console.log(`🔍 Checking status for: ${orderCode}`);
  apiCall(`${CONFIG.API_ORDER}/${orderCode}`, 'GET');
}

/**
 * Search Orders
 */
function searchOrders(query) {
  console.log(`🔍 Searching orders: ${query}`);
  apiCall(CONFIG.API_SEARCH, 'POST', {
    searchContent: query,
    pageInfo: { pageSize: 20, pageIndex: 1 }
  });
}

/**
 * List All Orders
 */
function listAllOrders(fromDate, toDate) {
  console.log(`📋 Listing all orders...`);
  const body = {
    isInternational: '0',
    toDateFromDate: [fromDate || '2026-01-01 00:00', toDate || new Date().toISOString().slice(0, 10) + ' 23:59'],
    orgCode: ['C006661231'],
    owner: 'MYVNP_C_732318',
    lstStatus: [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,101,102,103,104,105,106,107,108,109,110,111],
    orderType: '1',
    isNewAddress: 1
  };
  apiCall(`${CONFIG.API_SEARCH_V2}?page=0&size=1000`, 'POST', body);
}

/**
 * Cancel Order (caseTypeId=9)
 */
function cancelOrder(orderId) {
  console.log(`🗑️ Cancelling order: ${orderId}`);
  apiCall(`${CONFIG.API_CANCEL}?oldOrderId=${orderId}&caseTypeId=9`, 'POST', {});
}

// Main
const cmd = process.argv[2];
const arg = process.argv[3];

switch (cmd) {
  case 'create':
    createOrder(arg || process.argv.slice(3).join(' '));
    break;
  case 'status':
    checkStatus(arg);
    break;
  case 'search':
    searchOrders(arg);
    break;
  case 'list':
    listAllOrders(process.argv[3], process.argv[4]);
    break;
  case 'cancel':
    cancelOrder(arg);
    break;
  default:
    console.log(`
📦 VNPost Order Management

Usage: node vnpost-order.js <command> [options]

Commands:
  create <json>       Create order
  status <code>      Check order status  
  search <query>     Search orders
  list [from] [to]   List all orders
  cancel <orderId>   Cancel order (caseTypeId=9)

Examples:
  node vnpost-order.js create '{"senderPhone":"0706059928","receiverPhone":"0979078870","receiverName":"Test","receiverAddress":"123 ABC","weight":500}'
  node vnpost-order.js status DH88514176
  node vnpost-order.js search "0979078870"
  node vnpost-order.js list "2026-04-01 00:00" "2026-04-20 23:59"
  node vnpost-order.js cancel d8838a0b834e4b7d90c2a06cdf5e89d6
`);
}
