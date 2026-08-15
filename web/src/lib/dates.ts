// Postgres `date` columns come back through the Data API/postgres driver as
// values that get parsed into JS Date objects, which serialize/print in
// UTC — but insights_daily.date is a calendar date in the AD ACCOUNT's own
// timezone, not a UTC instant (see db/README.md "Conventions"). Applying
// any timezone conversion to it re-derives the wrong calendar day. Every
// helper below treats dates as plain "YYYY-MM-DD" strings, never through
// `new Date(...).toISOString()` or similar.

/** Coerces whatever the Data API handed back (string or Date-like) into a plain YYYY-MM-DD string, with zero timezone math. */
export function toDateOnlyString(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  if (typeof value === "string") return value.slice(0, 10);
  // A real Date object: read its UTC calendar fields directly. This is
  // safe ONLY because Postgres `date` values have no time-of-day to lose —
  // do not reuse this pattern for timestamptz columns.
  const y = value.getUTCFullYear();
  const m = String(value.getUTCMonth() + 1).padStart(2, "0");
  const d = String(value.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function formatDateOnly(value: string | Date | null | undefined): string {
  const s = toDateOnlyString(value);
  if (!s) return "—";
  const [y, m, d] = s.split("-");
  return `${d}/${m}/${y}`;
}

/** Formats a real instant (timestamptz column: meta_created_time, row_created_at, ...) in the browser's local time. */
export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" });
}

/** Days between a timestamptz value and now — for "days since launch". */
export function daysSince(value: string | Date | null | undefined): number | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const ms = Date.now() - date.getTime();
  return Math.max(0, Math.floor(ms / 86_400_000));
}

export function hoursSince(value: string | Date | null | undefined): number | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return (Date.now() - date.getTime()) / 3_600_000;
}

/** Today, and N days ago, as YYYY-MM-DD — for building an insights_daily date-range filter without any timezone conversion. */
export function dateRangeLastNDays(n: number): { since: string; until: string } {
  const until = new Date();
  const since = new Date(until);
  since.setUTCDate(since.getUTCDate() - (n - 1));
  return { since: toDateOnlyString(since)!, until: toDateOnlyString(until)! };
}
