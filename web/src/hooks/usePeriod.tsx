import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { dateRangeLastNDays } from "../lib/dates";

export type PeriodPreset = "7d" | "30d" | "custom";

export interface Period {
  preset: PeriodPreset;
  since: string;
  until: string;
}

export interface UsePeriodResult {
  period: Period;
  setPreset: (preset: "7d" | "30d") => void;
  setCustomRange: (since: string, until: string) => void;
}

const PeriodContext = createContext<UsePeriodResult | null>(null);

/**
 * Holds the period selector state above the router so it survives
 * navigation between levels (campaign → ad set → ad) — previously each
 * page called useState locally, which reset to "7 jours" on every
 * navigation because the old page unmounts. Only setPreset/setCustomRange
 * change it now; navigating never does.
 */
export function PeriodProvider({ children }: { children: ReactNode }) {
  const [period, setPeriod] = useState<Period>(() => ({ preset: "7d", ...dateRangeLastNDays(7) }));

  const value = useMemo(
    () => ({
      period,
      setPreset: (preset: "7d" | "30d") => setPeriod({ preset, ...dateRangeLastNDays(preset === "7d" ? 7 : 30) }),
      setCustomRange: (since: string, until: string) => setPeriod({ preset: "custom", since, until }),
    }),
    [period],
  );

  return <PeriodContext.Provider value={value}>{children}</PeriodContext.Provider>;
}

/** Period selector state (7 days / 30 days / custom range), all dates as plain YYYY-MM-DD strings — see lib/dates.ts. */
export function usePeriod(): UsePeriodResult {
  const context = useContext(PeriodContext);
  if (!context) throw new Error("usePeriod must be used within <PeriodProvider>");
  return context;
}
