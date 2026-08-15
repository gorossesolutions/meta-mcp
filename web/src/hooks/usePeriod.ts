import { useMemo, useState } from "react";
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

/** Period selector state (7 days / 30 days / custom range), all dates as plain YYYY-MM-DD strings — see lib/dates.ts. */
export function usePeriod(defaultPreset: "7d" | "30d" = "7d"): UsePeriodResult {
  const [period, setPeriod] = useState<Period>(() => ({
    preset: defaultPreset,
    ...dateRangeLastNDays(defaultPreset === "7d" ? 7 : 30),
  }));

  return useMemo(
    () => ({
      period,
      setPreset: (preset) => setPeriod({ preset, ...dateRangeLastNDays(preset === "7d" ? 7 : 30) }),
      setCustomRange: (since, until) => setPeriod({ preset: "custom", since, until }),
    }),
    [period],
  );
}
