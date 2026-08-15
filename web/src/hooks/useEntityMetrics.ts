import { useEffect, useState } from "react";
import { neon } from "../lib/neon";
import { aggregateInsights, type AggregatedMetrics } from "../lib/metrics";
import type { InsightsDailyRow } from "../types/db";
import type { Period } from "./usePeriod";

type EntityType = "account" | "campaign" | "adset" | "ad";

export interface UseEntityMetricsResult {
  metricsByEntityId: Map<string, AggregatedMetrics>;
  loading: boolean;
  error: string | null;
}

/**
 * Fetches unbroken-down insights_daily rows (all breakdown_* = '', see
 * db/README.md) for a set of entities over a period, and aggregates them
 * per entity. Client-side aggregation — fine at current volume, see
 * lib/metrics.ts scale note.
 */
export function useEntityMetrics(
  adAccountId: string | undefined,
  entityType: EntityType,
  metaEntityIds: string[],
  period: Period,
): UseEntityMetricsResult {
  const [metricsByEntityId, setMetricsByEntityId] = useState<Map<string, AggregatedMetrics>>(new Map());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const idsKey = metaEntityIds.join(",");

  useEffect(() => {
    if (!adAccountId || metaEntityIds.length === 0) {
      setMetricsByEntityId(new Map());
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    neon
      .from("insights_daily")
      .select(
        "meta_entity_id,date,impressions,reach,frequency,clicks,inline_link_clicks,ctr,cpc_minor,cpm_minor,spend_minor,currency,actions,action_values,cost_per_action_type,purchase_roas,quality_ranking,engagement_rate_ranking,conversion_rate_ranking",
      )
      .eq("ad_account_id", adAccountId)
      .eq("entity_type", entityType)
      .in("meta_entity_id", metaEntityIds)
      .eq("breakdown_age", "")
      .eq("breakdown_gender", "")
      .eq("breakdown_publisher_platform", "")
      .eq("breakdown_platform_position", "")
      .eq("breakdown_impression_device", "")
      .eq("breakdown_device_platform", "")
      .eq("breakdown_region", "")
      .eq("breakdown_country", "")
      .gte("date", period.since)
      .lte("date", period.until)
      .then(({ data, error: queryError }) => {
        if (cancelled) return;
        if (queryError) {
          setError(queryError.message);
          setLoading(false);
          return;
        }
        const rows = (data ?? []) as InsightsDailyRow[];
        const grouped = new Map<string, InsightsDailyRow[]>();
        for (const row of rows) {
          const bucket = grouped.get(row.meta_entity_id) ?? [];
          bucket.push(row);
          grouped.set(row.meta_entity_id, bucket);
        }
        const aggregated = new Map<string, ReturnType<typeof aggregateInsights>>();
        for (const [id, entityRows] of grouped) {
          aggregated.set(id, aggregateInsights(entityRows));
        }
        setMetricsByEntityId(aggregated);
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adAccountId, entityType, idsKey, period.since, period.until]);

  return { metricsByEntityId, loading, error };
}
