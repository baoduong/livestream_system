import { useRef, useEffect } from 'react'
import CommentCard from './CommentCard'
import OrderCard from './OrderCard'
import StatusBar from './StatusBar'
import { useSSE } from './useSSE'

export default function App() {
  const { comments, orders, counts, connected } = useSSE()
  const pendingEndRef = useRef(null)

  // Auto-scroll pending list
  useEffect(() => {
    pendingEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [comments.length])

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      {/* Header */}
      <header className="flex items-center justify-between border-b border-slate-700 bg-slate-900 px-6 py-3">
        <div className="flex items-center gap-3">
          <span className="text-2xl">🔴</span>
          <h1 className="text-lg font-bold text-white">Livestream Manager</h1>
        </div>
        <StatusBar counts={counts} connected={connected} />
      </header>

      {/* Main content - 2 columns */}
      <div className="flex flex-1 overflow-hidden">
        {/* Pending comments */}
        <div className="flex w-1/2 flex-col border-r border-slate-700">
          <div className="flex items-center justify-between border-b border-slate-700/50 px-4 py-2">
            <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider">
              Comment chờ xử lý
              {counts.pending > 0 && (
                <span className="ml-2 inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-amber-500/20 px-1.5 text-xs font-bold text-amber-400">
                  {counts.pending}
                </span>
              )}
            </h2>
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {comments.length === 0 ? (
              <div className="flex h-full items-center justify-center">
                <p className="text-slate-500 text-sm">Chưa có comment nào</p>
              </div>
            ) : (
              comments.map((c) => (
                <CommentCard key={c.id} comment={c} />
              ))
            )}
            <div ref={pendingEndRef} />
          </div>
        </div>

        {/* Confirmed orders */}
        <div className="flex w-1/2 flex-col">
          <div className="flex items-center justify-between border-b border-slate-700/50 px-4 py-2">
            <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider">
              Đã xác nhận
              {counts.confirmed > 0 && (
                <span className="ml-2 inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-green-500/20 px-1.5 text-xs font-bold text-green-400">
                  {counts.confirmed}
                </span>
              )}
            </h2>
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-2">
            {orders.length === 0 ? (
              <div className="flex h-full items-center justify-center">
                <p className="text-slate-500 text-sm">Chưa có đơn nào</p>
              </div>
            ) : (
              orders.map((o) => (
                <OrderCard key={o.id} order={o} />
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
