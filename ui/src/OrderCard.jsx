function timeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'vừa xong'
  if (mins < 60) return `${mins}p trước`
  return `${Math.floor(mins / 60)}h trước`
}

export default function OrderCard({ order }) {
  const avatarUrl = order.avatarUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(order.customerName)}&background=064e3b&color=6ee7b7&size=80`

  return (
    <div className="rounded-xl border border-green-800/40 bg-green-950/20 p-3 transition-all">
      <div className="flex items-center gap-3">
        <img
          src={avatarUrl}
          alt=""
          className="h-8 w-8 rounded-full object-cover ring-2 ring-green-700/50"
          onError={(e) => { e.target.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(order.customerName)}&background=064e3b&color=6ee7b7&size=80` }}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-medium text-green-300 truncate">{order.customerName}</span>
            <span className="ml-auto text-xs text-slate-500">{order.id}</span>
          </div>
          <p className="mt-0.5 text-xs text-slate-400 truncate">{order.commentText}</p>
        </div>
        <span className="text-green-500 text-lg">✓</span>
      </div>
    </div>
  )
}
