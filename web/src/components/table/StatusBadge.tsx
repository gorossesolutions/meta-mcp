const STATUS_STYLES: Record<string, string> = {
  ACTIVE: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300",
  PAUSED: "bg-slate-100 text-slate-600 dark:bg-slate-700/50 dark:text-slate-300",
  DELETED: "bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300",
  ARCHIVED: "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400",
  CAMPAIGN_PAUSED: "bg-slate-100 text-slate-600 dark:bg-slate-700/50 dark:text-slate-300",
};

/** Renders a raw Meta status string (status_raw/effective_status_raw) — unconstrained by design (see db/README.md), so unknown values still render, just without a specific color. */
export function StatusBadge({ status }: { status: string | null | undefined }) {
  if (!status) return <span className="text-slate-400 dark:text-slate-500">—</span>;
  const className = STATUS_STYLES[status] ?? "bg-slate-100 text-slate-600 dark:bg-slate-700/50 dark:text-slate-300";
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${className}`}>
      {status}
    </span>
  );
}
