// Aggregates raw insights_daily rows (fetched client-side for the
// selected period) into the table columns the brief asks for. Ratios
// (CTR/CPC/CPM) are recomputed from summed totals, never averaged
// row-by-row — averaging daily CTRs would silently misweight low-volume
// days the same as high-volume ones.
//
// SCALE NOTE: this aggregates in the browser over whatever rows were
// fetched. Fine at current volume (a handful of entities, short windows).
// With hundreds of ads or long windows, this should move to a SQL
// aggregate (a view or a Data API RPC) instead of shipping every daily row
// to the client — flagged in web/README.md "Limites connues".

import type { InsightsDailyRow } from "../types/db";
import { sumByCurrency, type MoneyByCurrency } from "./money";

export interface AggregatedMetrics {
  impressions: number;
  clicks: number;
  inlineLinkClicks: number;
  spendByCurrency: MoneyByCurrency[];
  ctrPercent: number | null;
  cpcByCurrency: MoneyByCurrency[];
  cpmByCurrency: MoneyByCurrency[];
  /** Approximate: sum of a curated set of bottom-funnel action_types. Meta has no single canonical "conversions" field — see web/README.md. */
  conversions: number;
  /** Spend-weighted average of purchase_roas.value, only when at least one row reported it. Null (shown as "—") is the normal case for lead-gen accounts. */
  roas: number | null;
}

const CONVERSION_ACTION_TYPES = new Set([
  "lead",
  "onsite_conversion.lead_grouped",
  "onsite_web_lead",
  "purchase",
  "offsite_conversion.fb_pixel_purchase",
  "complete_registration",
  "submit_application",
]);

export function aggregateInsights(rows: InsightsDailyRow[]): AggregatedMetrics {
  let impressions = 0;
  let clicks = 0;
  let inlineLinkClicks = 0;
  let conversions = 0;
  const spendByCurrencyRaw: MoneyByCurrency[] = [];
  const clicksByCurrency = new Map<string, number>();
  const impressionsByCurrency = new Map<string, number>();
  let roasWeightedSum = 0;
  let roasWeightTotal = 0;
  let hasRoas = false;

  for (const row of rows) {
    const rowImpressions = Number(row.impressions ?? 0);
    const rowClicks = Number(row.clicks ?? 0);
    const rowSpend = Number(row.spend_minor ?? 0);

    impressions += rowImpressions;
    clicks += rowClicks;
    inlineLinkClicks += Number(row.inline_link_clicks ?? 0);
    spendByCurrencyRaw.push({ currency: row.currency, minorUnits: rowSpend });
    clicksByCurrency.set(row.currency, (clicksByCurrency.get(row.currency) ?? 0) + rowClicks);
    impressionsByCurrency.set(row.currency, (impressionsByCurrency.get(row.currency) ?? 0) + rowImpressions);

    for (const action of row.actions ?? []) {
      if (CONVERSION_ACTION_TYPES.has(action.action_type)) conversions += Number(action.value ?? 0);
    }
    for (const r of row.purchase_roas ?? []) {
      hasRoas = true;
      roasWeightedSum += Number(r.value ?? 0) * rowSpend;
      roasWeightTotal += rowSpend;
    }
  }

  const spendByCurrency = sumByCurrency(spendByCurrencyRaw);
  const spendMap = new Map(spendByCurrency.map((s) => [s.currency, s.minorUnits]));

  const cpcByCurrency: MoneyByCurrency[] = [...clicksByCurrency.entries()]
    .filter(([, c]) => c > 0)
    .map(([currency, c]) => ({ currency, minorUnits: Math.round((spendMap.get(currency) ?? 0) / c) }));

  const cpmByCurrency: MoneyByCurrency[] = [...impressionsByCurrency.entries()]
    .filter(([, i]) => i > 0)
    .map(([currency, i]) => ({ currency, minorUnits: Math.round(((spendMap.get(currency) ?? 0) / i) * 1000) }));

  return {
    impressions,
    clicks,
    inlineLinkClicks,
    spendByCurrency,
    ctrPercent: impressions > 0 ? (clicks / impressions) * 100 : null,
    cpcByCurrency,
    cpmByCurrency,
    conversions,
    roas: hasRoas && roasWeightTotal > 0 ? roasWeightedSum / roasWeightTotal : null,
  };
}
