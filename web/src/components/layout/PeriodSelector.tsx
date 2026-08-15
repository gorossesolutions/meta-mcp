import type { UsePeriodResult } from "../../hooks/usePeriod";

export function PeriodSelector({ period, setPreset, setCustomRange }: UsePeriodResult) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <button
        onClick={() => setPreset("7d")}
        className={`rounded-md px-2.5 py-1 font-medium transition-colors ${
          period.preset === "7d"
            ? "bg-brand-blue text-white"
            : "bg-white text-slate-600 hover:bg-slate-100 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
        }`}
      >
        7 jours
      </button>
      <button
        onClick={() => setPreset("30d")}
        className={`rounded-md px-2.5 py-1 font-medium transition-colors ${
          period.preset === "30d"
            ? "bg-brand-blue text-white"
            : "bg-white text-slate-600 hover:bg-slate-100 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
        }`}
      >
        30 jours
      </button>
      <input
        type="date"
        value={period.since}
        onChange={(e) => setCustomRange(e.target.value, period.until)}
        className="rounded-md border border-slate-200 bg-white px-2 py-1 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
      />
      <span className="text-slate-400">→</span>
      <input
        type="date"
        value={period.until}
        onChange={(e) => setCustomRange(period.since, e.target.value)}
        className="rounded-md border border-slate-200 bg-white px-2 py-1 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
      />
    </div>
  );
}
