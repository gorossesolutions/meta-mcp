import { useEffect, useState } from "react";
import { neon } from "../lib/neon";
import type { SyncRun } from "../types/db";

export type FreshnessLevel = "fresh" | "stale" | "failed" | "unknown";

export interface Freshness {
  level: FreshnessLevel;
  lastRun: SyncRun | null;
  lastSuccessfulRun: SyncRun | null;
}

const STALE_AFTER_HOURS = 48;

/** Reads sync_runs for a client and derives a freshness signal — see web/README.md "Indicateur de fraîcheur". */
export function useFreshness(clientId: string | undefined): { freshness: Freshness; loading: boolean } {
  const [freshness, setFreshness] = useState<Freshness>({ level: "unknown", lastRun: null, lastSuccessfulRun: null });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!clientId) return;
    let cancelled = false;
    setLoading(true);

    neon
      .from("sync_runs")
      .select("*")
      .eq("client_id", clientId)
      .order("started_at", { ascending: false })
      .limit(20)
      .then(({ data }) => {
        if (cancelled) return;
        const runs = (data ?? []) as SyncRun[];
        const lastRun = runs[0] ?? null;
        const lastSuccessfulRun = runs.find((r) => r.status === "success" || r.status === "partial") ?? null;

        let level: FreshnessLevel = "unknown";
        if (!lastRun) {
          level = "unknown";
        } else if (lastRun.status === "failed") {
          level = "failed";
        } else if (lastSuccessfulRun?.finished_at) {
          const ageHours = (Date.now() - new Date(lastSuccessfulRun.finished_at).getTime()) / 3_600_000;
          level = ageHours > STALE_AFTER_HOURS ? "stale" : "fresh";
        } else if (lastRun.status === "running") {
          level = "unknown";
        }

        setFreshness({ level, lastRun, lastSuccessfulRun });
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [clientId]);

  return { freshness, loading };
}
