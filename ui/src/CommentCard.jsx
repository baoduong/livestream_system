import { useState } from 'react'
import { confirmComment, skipComment } from './api'

function timeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'vừa xong'
  if (mins < 60) return `${mins}p trước`
  return `${Math.floor(mins / 60)}h trước`
}

export default function CommentCard({ comment, onConfirmed, onSkipped }) {
  const [loading, setLoading] = useState(null) // 'confirm' | 'skip'

  const handleConfirm = async () => {
    setLoading('confirm')
    try {
      const res = await confirmComment(comment.id)
      if (res.ok) onConfirmed?.(comment.id)
    } catch (e) { console.error(e) }
    setLoading(null)
  }

  const handleSkip = async () => {
    setLoading('skip')
    try {
      const res = await skipComment(comment.id)
      if (res.ok) onSkipped?.(comment.id)
    } catch (e) { console.error(e) }
    setLoading(null)
  }

  const avatarUrl = comment.avatarUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(comment.customerName)}&background=1e293b&color=94a3b8&size=80`

  return (
    <div className={`animate-slide-in rounded-xl border p-4 transition-all hover:border-slate-500 ${
      comment.blacklisted ? 'border-red-500/50 bg-red-950/20' :
      comment.isNewCustomer ? 'border-green-500/50 bg-green-950/10 animate-pulse-border' :
      'border-slate-700 bg-slate-800/50'
    }`}>
      <div className="flex items-start gap-3">
        {/* Avatar */}
        <img
          src={avatarUrl}
          alt=""
          className="h-10 w-10 rounded-full object-cover ring-2 ring-slate-600"
          onError={(e) => { e.target.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(comment.customerName)}&background=1e293b&color=94a3b8&size=80` }}
        />

        {/* Content */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-white truncate">{comment.customerName}</span>
            {comment.isNewCustomer && (
              <span className="rounded-full bg-green-500/20 px-2 py-0.5 text-xs text-green-400">Mới</span>
            )}
            {comment.blacklisted && (
              <span className="rounded-full bg-red-500/20 px-2 py-0.5 text-xs text-red-400">⛔ Blacklist</span>
            )}
            <span className="ml-auto text-xs text-slate-500">{comment.id}</span>
          </div>

          <p className="mt-1 text-sm text-slate-300 break-words">{comment.commentText}</p>

          {/* Missing info badges */}
          <div className="mt-2 flex flex-wrap gap-1.5">
            {comment.missingPhone && (
              <span className="rounded bg-amber-500/15 px-2 py-0.5 text-xs text-amber-400">📱 Thiếu SĐT</span>
            )}
            {comment.missingAddress && (
              <span className="rounded bg-amber-500/15 px-2 py-0.5 text-xs text-amber-400">📍 Thiếu địa chỉ</span>
            )}
          </div>

          {/* Time */}
          <div className="mt-1 text-xs text-slate-500">
            {timeAgo(comment.createdAt)}
            {comment.platform && comment.platform !== 'live' && (
              <span className="ml-2">via {comment.platform}</span>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex flex-col gap-2">
          <button
            onClick={handleConfirm}
            disabled={!!loading}
            className="rounded-lg bg-green-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-green-500 disabled:opacity-50"
          >
            {loading === 'confirm' ? '...' : '✓'}
          </button>
          <button
            onClick={handleSkip}
            disabled={!!loading}
            className="rounded-lg bg-slate-600 px-3 py-1.5 text-sm font-medium text-slate-300 transition hover:bg-slate-500 disabled:opacity-50"
          >
            {loading === 'skip' ? '...' : '✕'}
          </button>
        </div>
      </div>
    </div>
  )
}
