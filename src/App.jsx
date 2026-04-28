import React, { useEffect, useRef, useState } from 'react'

const API = '/api'

async function confirmComment(id) {
  const r = await fetch(`${API}/comments/${id}/confirm`, { method: 'POST' })
  if (!r.ok) throw new Error(`${r.status}`)
  const data = await r.json()
  return data
}

function fmtTime(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function relTime(iso) {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 5) return 'vừa'
  if (s < 60) return `${s}g`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}p`
  return `${Math.floor(m / 60)}h`
}

function Card({ item, isLatest, isFlash, done, spinning, onConfirm, onAvatarTap }) {
  const initials = (item.customerName || '?')[0].toUpperCase()
  const isBlacklisted = item.blacklisted
  return (
    <div className={`card${isLatest ? ' card--latest' : ''}${isFlash ? ' card--flash' : ''}${done ? ' card--done' : ''}${isBlacklisted ? ' card--blacklisted' : ''} fade-in`}>
      {isBlacklisted && <div className="card__warning">⚠️ BOM HÀNG</div>}
      {item.avatarUrl ? (
        <>
          <img className="card__avatar card__avatar--tap" src={item.avatarUrl} alt="" onClick={onAvatarTap} onError={(e) => { e.target.style.display='none'; if(e.target.nextSibling) e.target.nextSibling.style.display='flex' }} />
          <div className="card__avatar card__avatar--placeholder card__avatar--tap" style={{display:'none'}} onClick={onAvatarTap}>{initials}</div>
        </>
      ) : (
        <div className="card__avatar card__avatar--placeholder card__avatar--tap" onClick={onAvatarTap}>{initials}</div>
      )}
      <div className="card__body">
        <div className="card__meta">
          <span className={`card__name${isBlacklisted ? ' card__name--warn' : ''}`}>{item.customerName}</span>
          <span className="card__sep">|</span>
          <span className="card__time">{fmtTime(item.createdAt)} ({relTime(item.createdAt)})</span>
        </div>
        <div className="card__text">{item.commentText}</div>
        {(item.missingPhone || item.missingAddress || item.isNewCustomer) && item.status !== 'confirmed' && (
          <div className="card__missing">
            {item.isNewCustomer && <span className="badge badge--new">🆕 Khách mới</span>}
            {item.missingPhone && <span className="badge badge--phone">📱 Thiếu SĐT</span>}
            {item.missingAddress && <span className="badge badge--addr">🏠 Thiếu địa chỉ</span>}
          </div>
        )}
      </div>
      <button
        className={`btn-order${done ? ' btn-order--done' : ''}${spinning ? ' btn-order--spin' : ''}`}
        onClick={onConfirm}
        disabled={spinning || done}
      >
        {spinning ? '' : done ? <i className="fa-solid fa-check" /> : <i className="fa-solid fa-print" />}
      </button>
    </div>
  )
}

// Popup menu khi tap avatar
function CustomerPopup({ item, position, onBlacklist, onClose }) {
  if (!item) return null
  return (
    <>
      <div className="popup-overlay" onClick={onClose} />
      <div className="popup" style={{ top: position.y, left: position.x }}>
        <div className="popup__name">{item.customerName}</div>
        {item.blacklisted ? (
          <button className="popup__btn popup__btn--unban" onClick={() => onBlacklist(item, false)}>
            ✅ Gỡ bom hàng
          </button>
        ) : (
          <button className="popup__btn popup__btn--ban" onClick={() => onBlacklist(item, true)}>
            🚫 Đánh dấu bom hàng
          </button>
        )}
      </div>
    </>
  )
}

// Print error alert - giữa màn hình
function PrintAlert({ message, onClose }) {
  if (!message) return null
  return (
    <>
      <div className="print-alert-overlay" onClick={onClose} />
      <div className="print-alert">
        <div className="print-alert__icon">🚨</div>
        <div className="print-alert__title">LỖI MÁY IN</div>
        <div className="print-alert__msg">{message}</div>
        <button className="print-alert__btn" onClick={onClose}>Đã hiểu</button>
      </div>
    </>
  )
}

export default function App() {
  const [items, setItems] = useState([])        // Stable ordered list
  const [doneIds, setDoneIds] = useState(new Set())
  const [counts, setCounts] = useState({ p: 0, c: 0 })
  const [loading, setLoading] = useState(true)
  const [spinning, setSpinning] = useState({})
  const [autoScroll, setAutoScroll] = useState(true)
  const [latestId, setLatestId] = useState(null)
  const [popup, setPopup] = useState(null) // { item, position: {x, y} }
  const [flashIds, setFlashIds] = useState(new Set())
  const [printError, setPrintError] = useState(null)

  const latestRef = useRef(null)
  const lastSeenRef = useRef(null)
  const feedRef = useRef(null)

  // ── SSE connection ─────────────────────────────────────────────────────────
  useEffect(() => {
    const es = new EventSource(`${API}/stream`)

    // Initial state
    es.addEventListener('init', (e) => {
      const data = JSON.parse(e.data)
      const pending = data.pendingComments || []
      const confirmed = data.confirmedOrders || []

      // Sort all by createdAt descending (newest on top)
      const all = [...pending, ...confirmed].sort(
        (a, b) => new Date(b.createdAt) - new Date(a.createdAt)
      )

      const done = new Set(confirmed.map(c => c.id))

      setItems(all)
      setDoneIds(done)
      setCounts({ p: data.counts?.pending || 0, c: data.counts?.confirmed || 0 })
      setLoading(false)

      // Latest pending
      const lastPending = pending.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0]
      if (lastPending) setLatestId(lastPending.id)

      // Scroll to bottom after render
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (feedRef.current) feedRef.current.scrollTop = 0
        })
      })
    })

    // New comment — insert in correct time order
    es.addEventListener('new-comment', (e) => {
      const item = JSON.parse(e.data)
      setItems(prev => {
        const next = [item, ...prev]
        next.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        return next
      })
      setLatestId(item.id)
      setFlashIds(prev => new Set([...prev, item.id]))
      setTimeout(() => setFlashIds(prev => { const n = new Set(prev); n.delete(item.id); return n }), 3000)
      setCounts(prev => ({ ...prev, p: prev.p + 1 }))
    })

    // Comment confirmed (by this or another operator)
    es.addEventListener('confirmed', (e) => {
      const { id } = JSON.parse(e.data)
      setDoneIds(prev => new Set([...prev, id]))
      setCounts(prev => ({ p: Math.max(0, prev.p - 1), c: prev.c + 1 }))
    })

    // Comment updated (phone/address added)
    es.addEventListener('updated', (e) => {
      const updatedItem = JSON.parse(e.data)
      setItems(prev => prev.map(item => item.id === updatedItem.id ? updatedItem : item))
    })

    // Reset
    es.addEventListener('reset', () => {
      setItems([])
      setDoneIds(new Set())
      setCounts({ p: 0, c: 0 })
      setLatestId(null)
    })

    es.onerror = () => {
      console.warn('[sse] Connection lost, reconnecting...')
    }

    return () => es.close()
  }, [])

  // ── Auto-scroll when new item arrives ──────────────────────────────────────
  useEffect(() => {
    if (!autoScroll || !latestRef.current || !latestId) return
    const behavior = lastSeenRef.current && lastSeenRef.current !== latestId ? 'smooth' : 'auto'
    latestRef.current.scrollIntoView({ behavior, block: 'start' })
    lastSeenRef.current = latestId
  }, [autoScroll, latestId, items.length])

  // ── Scroll detection: auto off when 300px+ from bottom, auto on at bottom ──
  function handleScroll(e) {
    const el = e.target
    const distFromTop = el.scrollTop
    if (distFromTop < 60 && !autoScroll) setAutoScroll(true)
    if (distFromTop > 300 && autoScroll) setAutoScroll(false)
  }

  // ── Confirm ────────────────────────────────────────────────────────────────
  function doConfirm(id) {
    if (spinning[id] || doneIds.has(id)) return
    setSpinning(p => ({ ...p, [id]: true }))
    confirmComment(id)
      .then((data) => {
        if (data.ok) {
          setDoneIds(prev => new Set([...prev, id]))
        }
        if (data.printError) {
          setPrintError(data.printError)
        }
      })
      .catch(err => alert(err.message))
      .finally(() => setSpinning(p => ({ ...p, [id]: false })))
  }

  // ── Avatar tap → popup ────────────────────────────────────────────────────
  function handleAvatarTap(e, item) {
    const rect = e.currentTarget.getBoundingClientRect()
    // Nếu gần bottom → hiện popup phía trên avatar
    const spaceBelow = window.innerHeight - rect.bottom
    const y = spaceBelow < 120 ? rect.top - 80 : rect.bottom + 4
    setPopup({
      item,
      position: { x: Math.min(rect.left, window.innerWidth - 200), y }
    })
  }

  // ── Blacklist toggle ───────────────────────────────────────────────────
  async function handleBlacklist(item, ban) {
    const endpoint = ban
      ? `${API}/customers/${item.customerId}/blacklist`
      : `${API}/customers/${item.customerId}/unblacklist`
    try {
      const r = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'Bom hàng' }),
      })
      if (!r.ok) throw new Error(`${r.status}`)
      // Update blacklisted flag on all items with same customerId
      setItems(prev => prev.map(c =>
        c.customerId === item.customerId ? { ...c, blacklisted: ban } : c
      ))
    } catch (err) {
      alert('Lỗi: ' + err.message)
    }
    setPopup(null)
  }

  const txt = loading ? '...' : `${counts.p} chờ · ${counts.c} đã`

  return (
    <div className="app">
      <header className="hdr">
        <span className="hdr__txt">{txt}</span>
        <label className="hdr__auto">
          <input type="checkbox" checked={autoScroll} onChange={e => setAutoScroll(e.target.checked)} />
          <span>Auto</span>
        </label>
      </header>
      <div className="feed" ref={feedRef} onScroll={handleScroll}>
        {loading ? <div className="empty">Đang tải...</div>
          : items.length === 0 ? <div className="empty">Chưa có comment</div>
          : items.map(c => (
            <div key={c.id} ref={c.id === latestId ? latestRef : null}>
              <Card
                item={c}
                isLatest={c.id === latestId}
                isFlash={flashIds.has(c.id)}
                done={doneIds.has(c.id)}
                spinning={!!spinning[c.id]}
                onConfirm={() => doConfirm(c.id)}
                onAvatarTap={(e) => handleAvatarTap(e, c)}
              />
            </div>
          ))
        }
      </div>
      <CustomerPopup
        item={popup?.item}
        position={popup?.position || { x: 0, y: 0 }}
        onBlacklist={handleBlacklist}
        onClose={() => setPopup(null)}
      />
      <PrintAlert message={printError} onClose={() => setPrintError(null)} />
    </div>
  )
}