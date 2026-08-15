/** A table skeleton that visibly shows loading, not a blank flash — see web/README.md "Direction visuelle". */
export function LoadingTable({ columns = 6, rows = 5 }: { columns?: number; rows?: number }) {
  return (
    <div className="animate-pulse overflow-hidden rounded-lg border border-slate-200 dark:border-slate-800">
      <div className="grid gap-px bg-slate-100 dark:bg-slate-800" style={{ gridTemplateColumns: `repeat(${columns}, 1fr)` }}>
        {Array.from({ length: columns }).map((_, i) => (
          <div key={`h-${i}`} className="h-9 bg-slate-50 dark:bg-slate-900" />
        ))}
        {Array.from({ length: rows * columns }).map((_, i) => (
          <div key={i} className="h-10 bg-white dark:bg-slate-950">
            <div className="m-3 h-3 rounded bg-slate-200 dark:bg-slate-700" style={{ width: `${50 + ((i * 13) % 40)}%` }} />
          </div>
        ))}
      </div>
    </div>
  );
}
