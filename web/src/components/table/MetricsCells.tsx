import { formatMoneyByCurrency } from "../../lib/money";
import type { AggregatedMetrics } from "../../lib/metrics";

/** The metrics column headers shared by campaigns/adsets/ads tables — keep in sync with MetricsCells below. */
export function MetricsHeaderCells() {
  return (
    <>
      <th className="px-3 py-2 text-right">Dépense</th>
      <th className="px-3 py-2 text-right">Impressions</th>
      <th className="px-3 py-2 text-right">Clics</th>
      <th className="px-3 py-2 text-right">Clics lien</th>
      <th className="px-3 py-2 text-right">CTR</th>
      <th className="px-3 py-2 text-right">CPC</th>
      <th className="px-3 py-2 text-right">CPM</th>
      <th className="px-3 py-2 text-right">Conversions</th>
      <th className="px-3 py-2 text-right">ROAS</th>
    </>
  );
}

export function MetricsCells({ metrics }: { metrics: AggregatedMetrics | undefined }) {
  if (!metrics) {
    return (
      <>
        {Array.from({ length: 9 }).map((_, i) => (
          <td key={i} className="px-3 py-2 text-right text-slate-300 dark:text-slate-600">
            —
          </td>
        ))}
      </>
    );
  }
  return (
    <>
      <td className="px-3 py-2 text-right tabular-nums">{formatMoneyByCurrency(metrics.spendByCurrency)}</td>
      <td className="px-3 py-2 text-right tabular-nums">{metrics.impressions.toLocaleString("fr-FR")}</td>
      <td className="px-3 py-2 text-right tabular-nums">{metrics.clicks.toLocaleString("fr-FR")}</td>
      <td className="px-3 py-2 text-right tabular-nums">{metrics.inlineLinkClicks.toLocaleString("fr-FR")}</td>
      <td className="px-3 py-2 text-right tabular-nums">
        {metrics.ctrPercent !== null ? `${metrics.ctrPercent.toFixed(2)} %` : "—"}
      </td>
      <td className="px-3 py-2 text-right tabular-nums">{formatMoneyByCurrency(metrics.cpcByCurrency)}</td>
      <td className="px-3 py-2 text-right tabular-nums">{formatMoneyByCurrency(metrics.cpmByCurrency)}</td>
      <td className="px-3 py-2 text-right tabular-nums">{metrics.conversions > 0 ? metrics.conversions.toLocaleString("fr-FR") : "—"}</td>
      <td className="px-3 py-2 text-right tabular-nums">{metrics.roas !== null ? `${metrics.roas.toFixed(2)}×` : "—"}</td>
    </>
  );
}
