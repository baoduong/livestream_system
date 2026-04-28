import { useState, useEffect, useRef, useCallback } from 'react'
import { connectSSE, fetchState } from './api'

export function useSSE() {
  const [comments, setComments] = useState([])
  const [orders, setOrders] = useState([])
  const [counts, setCounts] = useState({ pending: 0, confirmed: 0, skipped: 0 })
  const [connected, setConnected] = useState(false)
  const esRef = useRef(null)

  const updateComment = useCallback((updated) => {
    setComments(prev => prev.map(c => c.id === updated.id ? { ...c, ...updated } : c))
    setOrders(prev => prev.map(c => c.id === updated.id ? { ...c, ...updated } : c))
  }, [])

  useEffect(() => {
    const es = connectSSE({
      onInit(data) {
        setComments(data.pendingComments || [])
        setOrders(data.confirmedOrders || [])
        setCounts(data.counts || { pending: 0, confirmed: 0, skipped: 0 })
        setConnected(true)
      },
      onNewComment(comment) {
        setComments(prev => [...prev, comment])
        setCounts(prev => ({ ...prev, pending: prev.pending + 1 }))
      },
      onConfirmed(data) {
        setComments(prev => prev.filter(c => c.id !== data.id))
        setOrders(prev => [data.item, ...prev])
        setCounts(prev => ({ ...prev, pending: Math.max(0, prev.pending - 1), confirmed: prev.confirmed + 1 }))
      },
      onSkipped(data) {
        setComments(prev => prev.filter(c => c.id !== data.id))
        setCounts(prev => ({ ...prev, pending: Math.max(0, prev.pending - 1), skipped: prev.skipped + 1 }))
      },
      onUpdated(item) {
        updateComment(item)
      },
      onReset() {
        setComments([])
        setOrders([])
        setCounts({ pending: 0, confirmed: 0, skipped: 0 })
      },
      onError() {
        setConnected(false)
      },
    })
    esRef.current = es

    return () => es.close()
  }, [updateComment])

  return { comments, orders, counts, connected, updateComment, setComments }
}
