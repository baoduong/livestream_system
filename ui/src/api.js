const API = ''

export async function fetchState() {
  const res = await fetch(`${API}/api/state`)
  return res.json()
}

export async function confirmComment(id) {
  const res = await fetch(`${API}/api/comments/${id}/confirm`, { method: 'POST' })
  return res.json()
}

export async function skipComment(id) {
  const res = await fetch(`${API}/api/comments/${id}/skip`, { method: 'POST' })
  return res.json()
}

export async function updateComment(id, data) {
  const res = await fetch(`${API}/api/comments/${id}/update`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  return res.json()
}

export async function getActiveSession() {
  const res = await fetch(`${API}/api/live-session/active`)
  return res.json()
}

export async function getFbStatus() {
  const res = await fetch(`${API}/api/fb/status`)
  return res.json()
}

export async function getPrinterStatus() {
  const res = await fetch(`${API}/api/printer/status`)
  return res.json()
}

export async function resetDemo() {
  const res = await fetch(`${API}/api/reset-demo`, { method: 'POST' })
  return res.json()
}

export async function addDemo() {
  const res = await fetch(`${API}/api/comments/add-demo`, { method: 'POST' })
  return res.json()
}

export async function blacklistCustomer(id, reason) {
  const res = await fetch(`${API}/api/customers/${id}/blacklist`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason }),
  })
  return res.json()
}

export async function unblacklistCustomer(id) {
  const res = await fetch(`${API}/api/customers/${id}/unblacklist`, { method: 'POST' })
  return res.json()
}

export function connectSSE(handlers) {
  const es = new EventSource(`${API}/api/stream`)
  
  es.addEventListener('init', (e) => {
    handlers.onInit?.(JSON.parse(e.data))
  })
  
  es.addEventListener('new-comment', (e) => {
    handlers.onNewComment?.(JSON.parse(e.data))
  })
  
  es.addEventListener('confirmed', (e) => {
    handlers.onConfirmed?.(JSON.parse(e.data))
  })
  
  es.addEventListener('skipped', (e) => {
    handlers.onSkipped?.(JSON.parse(e.data))
  })
  
  es.addEventListener('updated', (e) => {
    handlers.onUpdated?.(JSON.parse(e.data))
  })
  
  es.addEventListener('reset', () => {
    handlers.onReset?.()
  })
  
  es.onerror = () => {
    handlers.onError?.()
  }
  
  return es
}
