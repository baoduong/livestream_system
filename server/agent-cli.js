// Agent CLI — shared execution logic
// Used by both CLI and HTTP routes
import db, { nextOrderCode } from './db-init.js'

// ─── Helpers ─────────────────────────────────────────────────────────────────
function cusId(raw) {
  if (!raw) return null
  const s = String(raw).replace(/^cus_/, '')
  const n = parseInt(s)
  return isNaN(n) ? null : n
}

function ordId(raw) {
  if (!raw) return null
  const s = String(raw).replace(/^ord_/, '')
  const n = parseInt(s)
  return isNaN(n) ? null : n
}

function formatCustomer(row) {
  if (!row) return null
  // Get order stats
  const stats = db.prepare(`
    SELECT COUNT(*) as total, MAX(created_date) as lastAt
    FROM orders WHERE customer_id = ?
  `).get(row.id)
  return {
    id: `cus_${row.id}`,
    numericId: row.id,
    name: row.name,
    phone: row.phone || null,
    address: row.address || null,
    facebookAuthorId: row.facebook_author_id || null,
    facebookProfileUrl: row.facebook_url || null,
    firstSeenAt: row.first_seen_at || null,
    lastSeenAt: row.last_seen_at || null,
    totalOrders: stats?.total || 0,
    lastOrderAt: stats?.lastAt || null,
  }
}

function formatOrder(row) {
  if (!row) return null
  return {
    id: `ord_${row.id}`,
    numericId: row.id,
    code: row.code || null,
    customerId: `cus_${row.customer_id}`,
    customerNumericId: row.customer_id,
    customerName: row.customer_name || row.name || null,
    status: row.status || 'pending',
    amount: row.amount || 0,
    note: row.note || null,
    source: row.source || null,
    createdAt: row.created_date,
    confirmedAt: row.confirmed_at || null,
  }
}

function envelope(command, args, ok, data, error, meta = {}) {
  return {
    ok,
    command,
    args,
    data: ok ? data : null,
    error: ok ? null : error,
    meta: {
      requestId: `req_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      timestamp: new Date().toISOString(),
      durationMs: meta.durationMs || 0,
      pagination: meta.pagination || null,
    },
  }
}

function errEnvelope(command, args, code, message, details = null) {
  return envelope(command, args, false, null, { code, message, details })
}

function validateDate(d) {
  return /^\d{4}-\d{2}-\d{2}$/.test(d)
}

function validateMatchMode(m) {
  return ['exact', 'prefix', 'contains'].includes(m)
}

function validateStatus(s) {
  return ['confirmed', 'pending', 'cancelled'].includes(s)
}

function paginate(limit, offset) {
  const l = Math.min(Math.max(parseInt(limit) || 20, 1), 50)
  const o = Math.max(parseInt(offset) || 0, 0)
  return { limit: l, offset: o }
}

// ─── Commands ────────────────────────────────────────────────────────────────

function customerFind(args) {
  const cmd = 'customer-find'
  const fields = ['customerId', 'phone', 'facebookAuthorId', 'name'].filter(f => args[f])
  if (fields.length !== 1) return errEnvelope(cmd, args, 'VALIDATION_ERROR', 'Exactly one lookup field is required: customerId, phone, facebookAuthorId, or name')

  const field = fields[0]
  if (field !== 'name' && args.match) return errEnvelope(cmd, args, 'VALIDATION_ERROR', 'match is only valid with name')
  if (args.match && !validateMatchMode(args.match)) return errEnvelope(cmd, args, 'VALIDATION_ERROR', `Invalid match mode: ${args.match}`)

  const { limit, offset } = paginate(args.limit, args.offset)
  let rows = []
  let matchMode = 'exact'

  if (field === 'customerId') {
    const id = cusId(args.customerId)
    if (!id) return errEnvelope(cmd, args, 'VALIDATION_ERROR', 'Invalid customerId format')
    const row = db.prepare('SELECT * FROM customers WHERE id = ?').get(id)
    rows = row ? [row] : []
  } else if (field === 'phone') {
    rows = db.prepare('SELECT * FROM customers WHERE phone = ?').all(args.phone)
  } else if (field === 'facebookAuthorId') {
    rows = db.prepare('SELECT * FROM customers WHERE facebook_author_id = ?').all(args.facebookAuthorId)
  } else if (field === 'name') {
    matchMode = args.match || 'contains'
    let pattern = args.name
    if (matchMode === 'prefix') pattern = `${args.name}%`
    else if (matchMode === 'contains') pattern = `%${args.name}%`
    rows = db.prepare('SELECT * FROM customers WHERE name LIKE ? LIMIT ? OFFSET ?').all(pattern, limit, offset)
  }

  const total = rows.length
  const customers = rows.map(formatCustomer)

  return envelope(cmd, args, true, { customers, count: customers.length, matchMode }, null, {
    pagination: field === 'name' ? { limit, offset, returned: customers.length, total, hasMore: total >= limit } : null,
  })
}

function customerOrders(args) {
  const cmd = 'customer-orders'
  const fields = ['customerId', 'phone', 'name'].filter(f => args[f])
  if (fields.length !== 1) return errEnvelope(cmd, args, 'VALIDATION_ERROR', 'Exactly one lookup field is required: customerId, phone, or name')

  const field = fields[0]
  if (field !== 'name' && args.match) return errEnvelope(cmd, args, 'VALIDATION_ERROR', 'match is only valid with name')
  if (args.match && !validateMatchMode(args.match)) return errEnvelope(cmd, args, 'VALIDATION_ERROR', `Invalid match mode: ${args.match}`)

  const { limit, offset } = paginate(args.limit, args.offset)
  const sortBy = args.sortBy || 'createdAt'
  const sortDir = args.sortDir || 'desc'
  if (!['createdAt', 'amount'].includes(sortBy)) return errEnvelope(cmd, args, 'VALIDATION_ERROR', 'sortBy must be createdAt or amount')
  if (!['asc', 'desc'].includes(sortDir)) return errEnvelope(cmd, args, 'VALIDATION_ERROR', 'sortDir must be asc or desc')

  const sortCol = sortBy === 'createdAt' ? 'o.created_date' : 'o.amount'

  // Find customers
  let customerRows = []
  if (field === 'customerId') {
    const id = cusId(args.customerId)
    if (!id) return errEnvelope(cmd, args, 'VALIDATION_ERROR', 'Invalid customerId format')
    const row = db.prepare('SELECT * FROM customers WHERE id = ?').get(id)
    customerRows = row ? [row] : []
  } else if (field === 'phone') {
    customerRows = db.prepare('SELECT * FROM customers WHERE phone = ?').all(args.phone)
  } else if (field === 'name') {
    const mode = args.match || 'contains'
    let pattern = args.name
    if (mode === 'prefix') pattern = `${args.name}%`
    else if (mode === 'contains') pattern = `%${args.name}%`
    customerRows = db.prepare('SELECT * FROM customers WHERE name LIKE ?').all(pattern)
  }

  if (customerRows.length === 0) return errEnvelope(cmd, args, 'NOT_FOUND', 'Customer not found')

  const customers = customerRows.map(c => {
    const orders = db.prepare(`
      SELECT o.*, c.name as customer_name FROM orders o
      JOIN customers c ON c.id = o.customer_id
      WHERE o.customer_id = ?
      ORDER BY ${sortCol} ${sortDir}
      LIMIT ? OFFSET ?
    `).all(c.id, limit, offset).map(formatOrder)

    return {
      id: `cus_${c.id}`,
      numericId: c.id,
      name: c.name,
      orders,
    }
  })

  return envelope(cmd, args, true, { customers, count: customers.length })
}

function ordersFind(args) {
  const cmd = 'orders-find'
  const fields = ['id', 'code'].filter(f => args[f])
  if (fields.length !== 1) return errEnvelope(cmd, args, 'VALIDATION_ERROR', 'Exactly one of id or code is required')

  let row
  if (args.id) {
    const id = ordId(args.id)
    if (!id) return errEnvelope(cmd, args, 'VALIDATION_ERROR', 'Invalid order id format')
    row = db.prepare('SELECT o.*, c.name as customer_name FROM orders o JOIN customers c ON c.id = o.customer_id WHERE o.id = ?').get(id)
  } else {
    row = db.prepare('SELECT o.*, c.name as customer_name FROM orders o JOIN customers c ON c.id = o.customer_id WHERE o.code = ?').get(args.code)
  }

  if (!row) return errEnvelope(cmd, args, 'NOT_FOUND', 'Order not found')
  return envelope(cmd, args, true, { order: formatOrder(row) })
}

function ordersList(args) {
  const cmd = 'orders-list'
  if (!args.from) return errEnvelope(cmd, args, 'VALIDATION_ERROR', 'from is required')
  if (!args.to) return errEnvelope(cmd, args, 'VALIDATION_ERROR', 'to is required')
  if (!validateDate(args.from)) return errEnvelope(cmd, args, 'VALIDATION_ERROR', 'from must be YYYY-MM-DD')
  if (!validateDate(args.to)) return errEnvelope(cmd, args, 'VALIDATION_ERROR', 'to must be YYYY-MM-DD')
  if (args.from > args.to) return errEnvelope(cmd, args, 'VALIDATION_ERROR', 'from must be <= to')
  if (args.status && !validateStatus(args.status)) return errEnvelope(cmd, args, 'VALIDATION_ERROR', `Invalid status: ${args.status}`)

  const { limit, offset } = paginate(args.limit, args.offset)
  const sortBy = args.sortBy || 'createdAt'
  const sortDir = args.sortDir || 'desc'
  if (!['createdAt', 'amount'].includes(sortBy)) return errEnvelope(cmd, args, 'VALIDATION_ERROR', 'sortBy must be createdAt or amount')
  if (!['asc', 'desc'].includes(sortDir)) return errEnvelope(cmd, args, 'VALIDATION_ERROR', 'sortDir must be asc or desc')

  const sortCol = sortBy === 'createdAt' ? 'o.created_date' : 'o.amount'
  const fromDate = `${args.from}T00:00:00.000Z`
  const toDate = `${args.to}T23:59:59.999Z`

  let where = 'WHERE o.created_date BETWEEN ? AND ?'
  const params = [fromDate, toDate]
  if (args.status) { where += ' AND o.status = ?'; params.push(args.status) }

  const total = db.prepare(`SELECT COUNT(*) as c FROM orders o ${where}`).get(...params).c
  const rows = db.prepare(`
    SELECT o.*, c.name as customer_name FROM orders o
    JOIN customers c ON c.id = o.customer_id
    ${where} ORDER BY ${sortCol} ${sortDir} LIMIT ? OFFSET ?
  `).all(...params, limit, offset)

  return envelope(cmd, args, true, { orders: rows.map(formatOrder), count: rows.length }, null, {
    pagination: { limit, offset, returned: rows.length, total, hasMore: offset + rows.length < total },
  })
}

function ordersSummary(args) {
  const cmd = 'orders-summary'
  if (!args.from) return errEnvelope(cmd, args, 'VALIDATION_ERROR', 'from is required')
  if (!args.to) return errEnvelope(cmd, args, 'VALIDATION_ERROR', 'to is required')
  if (!validateDate(args.from)) return errEnvelope(cmd, args, 'VALIDATION_ERROR', 'from must be YYYY-MM-DD')
  if (!validateDate(args.to)) return errEnvelope(cmd, args, 'VALIDATION_ERROR', 'to must be YYYY-MM-DD')
  if (args.from > args.to) return errEnvelope(cmd, args, 'VALIDATION_ERROR', 'from must be <= to')

  const fromDate = `${args.from}T00:00:00.000Z`
  const toDate = `${args.to}T23:59:59.999Z`

  const row = db.prepare(`
    SELECT
      COUNT(*) as totalOrders,
      COALESCE(SUM(CASE WHEN status = 'confirmed' THEN 1 ELSE 0 END), 0) as confirmedOrders,
      COALESCE(SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END), 0) as pendingOrders,
      COALESCE(SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END), 0) as cancelledOrders,
      COALESCE(SUM(CASE WHEN status = 'confirmed' THEN amount ELSE 0 END), 0) as totalRevenue
    FROM orders WHERE created_date BETWEEN ? AND ?
  `).get(fromDate, toDate)

  return envelope(cmd, args, true, row)
}

function ordersSearch(args) {
  const cmd = 'orders-search'
  if (!args.customerName) return errEnvelope(cmd, args, 'VALIDATION_ERROR', 'customerName is required')
  if (args.match && !validateMatchMode(args.match)) return errEnvelope(cmd, args, 'VALIDATION_ERROR', `Invalid match mode: ${args.match}`)
  if ((args.from && !args.to) || (args.to && !args.from)) return errEnvelope(cmd, args, 'VALIDATION_ERROR', 'from and to must both be provided')
  if (args.from && !validateDate(args.from)) return errEnvelope(cmd, args, 'VALIDATION_ERROR', 'from must be YYYY-MM-DD')
  if (args.to && !validateDate(args.to)) return errEnvelope(cmd, args, 'VALIDATION_ERROR', 'to must be YYYY-MM-DD')
  if (args.from && args.to && args.from > args.to) return errEnvelope(cmd, args, 'VALIDATION_ERROR', 'from must be <= to')
  if (args.status && !validateStatus(args.status)) return errEnvelope(cmd, args, 'VALIDATION_ERROR', `Invalid status: ${args.status}`)

  const { limit, offset } = paginate(args.limit, args.offset)
  const sortBy = args.sortBy || 'createdAt'
  const sortDir = args.sortDir || 'desc'
  if (!['createdAt', 'amount', 'customerName'].includes(sortBy)) return errEnvelope(cmd, args, 'VALIDATION_ERROR', 'sortBy must be createdAt, amount, or customerName')
  if (!['asc', 'desc'].includes(sortDir)) return errEnvelope(cmd, args, 'VALIDATION_ERROR', 'sortDir must be asc or desc')

  const sortColMap = { createdAt: 'o.created_date', amount: 'o.amount', customerName: 'c.name' }
  const sortCol = sortColMap[sortBy]

  const mode = args.match || 'contains'
  let namePattern = args.customerName
  if (mode === 'prefix') namePattern = `${args.customerName}%`
  else if (mode === 'contains') namePattern = `%${args.customerName}%`

  let where = 'WHERE c.name LIKE ?'
  const params = [namePattern]

  if (args.from && args.to) {
    where += ' AND o.created_date BETWEEN ? AND ?'
    params.push(`${args.from}T00:00:00.000Z`, `${args.to}T23:59:59.999Z`)
  }
  if (args.status) { where += ' AND o.status = ?'; params.push(args.status) }

  const total = db.prepare(`SELECT COUNT(*) as c FROM orders o JOIN customers c ON c.id = o.customer_id ${where}`).get(...params).c
  const rows = db.prepare(`
    SELECT o.*, c.name as customer_name FROM orders o
    JOIN customers c ON c.id = o.customer_id
    ${where} ORDER BY ${sortCol} ${sortDir} LIMIT ? OFFSET ?
  `).all(...params, limit, offset)

  return envelope(cmd, args, true, { orders: rows.map(formatOrder), count: rows.length }, null, {
    pagination: { limit, offset, returned: rows.length, total, hasMore: offset + rows.length < total },
  })
}

function orderConfirm(args) {
  const cmd = 'order-confirm'
  if (!args.customerId) return errEnvelope(cmd, args, 'VALIDATION_ERROR', 'customerId is required')
  const cid = cusId(args.customerId)
  if (!cid) return errEnvelope(cmd, args, 'VALIDATION_ERROR', 'Invalid customerId format')

  const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(cid)
  if (!customer) return errEnvelope(cmd, args, 'NOT_FOUND', 'Customer not found')

  if (args.amount !== undefined && args.amount !== null) {
    const amt = parseInt(args.amount)
    if (isNaN(amt) || amt <= 0) return errEnvelope(cmd, args, 'VALIDATION_ERROR', 'amount must be > 0')
  }

  const now = new Date().toISOString()
  const code = nextOrderCode()
  const amount = args.amount ? parseInt(args.amount) : 0

  const result = db.prepare(`
    INSERT INTO orders (code, customer_id, status, amount, note, source, created_date, updated_date, confirmed_at)
    VALUES (?, ?, 'confirmed', ?, ?, 'agent-cli', ?, ?, ?)
  `).run(code, cid, amount, args.note || null, now, now, now)

  const row = db.prepare('SELECT o.*, c.name as customer_name FROM orders o JOIN customers c ON c.id = o.customer_id WHERE o.id = ?').get(result.lastInsertRowid)

  // Update customer last_seen_at
  db.prepare('UPDATE customers SET last_seen_at = ? WHERE id = ?').run(now, cid)

  return envelope(cmd, args, true, { order: formatOrder(row) })
}

// ─── Command dispatcher ──────────────────────────────────────────────────────
const COMMANDS = {
  'customer-find': customerFind,
  'customer-orders': customerOrders,
  'orders-find': ordersFind,
  'orders-list': ordersList,
  'orders-summary': ordersSummary,
  'orders-search': ordersSearch,
  'order-confirm': orderConfirm,
}

export function executeCommand(command, args = {}) {
  const start = Date.now()
  const fn = COMMANDS[command]
  if (!fn) {
    return errEnvelope(command, args, 'VALIDATION_ERROR', `Unknown command: ${command}`)
  }
  const result = fn(args)
  result.meta.durationMs = Date.now() - start
  return result
}

export function listCommands() {
  return Object.keys(COMMANDS)
}