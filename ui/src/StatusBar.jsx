export default function StatusBar({ counts, connected }) {
  return (
    <div className="flex items-center gap-4 rounded-xl border border-slate-700 bg-slate-800/50 px-4 py-3">
      {/* Connection */}
      <div className="flex items-center gap-2">
        <div className={`h-2.5 w-2.5 rounded-full ${connected ? 'bg-green-500 shadow-[0_0_6px_#22c55e]' : 'bg-red-500'}`} />
        <span className="text-xs text-slate-400">{connected ? 'Đang kết nối' : 'Mất kết nối'}</span>
      </div>

      <div className="h-4 w-px bg-slate-700" />

      {/* Counts */}
      <div className="flex items-center gap-4 text-sm">
        <div className="flex items-center gap-1.5">
          <span className="text-amber-400">⏳</span>
          <span className="font-mono font-bold text-white">{counts.pending}</span>
          <span className="text-slate-500">chờ</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-green-400">✓</span>
          <span className="font-mono font-bold text-white">{counts.confirmed}</span>
          <span className="text-slate-500">xác nhận</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-slate-500">✕</span>
          <span className="font-mono font-bold text-white">{counts.skipped}</span>
          <span className="text-slate-500">bỏ</span>
        </div>
      </div>
    </div>
  )
}
