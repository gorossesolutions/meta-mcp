// Every monetary value in the database is a bigint in minor units (cents)
// with a currency code alongside it — see db/README.md "Conventions".
// Never sum two amounts without checking their currency matches first.

const formatterCache = new Map<string, Intl.NumberFormat>();

function getFormatter(currency: string): Intl.NumberFormat {
  let f = formatterCache.get(currency);
  if (!f) {
    f = new Intl.NumberFormat("fr-FR", { style: "currency", currency });
    formatterCache.set(currency, f);
  }
  return f;
}

/** Formats a minor-unit bigint/number amount in its own currency, e.g. 173n + "EUR" -> "1,73 €". */
export function formatMoney(minorUnits: number | string | null | undefined, currency: string | null | undefined): string {
  if (minorUnits === null || minorUnits === undefined || !currency) return "—";
  const value = Number(minorUnits) / 100;
  if (!Number.isFinite(value)) return "—";
  try {
    return getFormatter(currency).format(value);
  } catch {
    // Unrecognized currency code — still show the amount rather than hiding it.
    return `${value.toFixed(2)} ${currency}`;
  }
}

export interface MoneyByCurrency {
  minorUnits: number;
  currency: string;
}

/**
 * Sums amounts that share a currency; keeps different currencies as
 * separate totals rather than producing a single, wrong number. Returns
 * one entry per currency present in the input, in first-seen order.
 */
export function sumByCurrency(amounts: MoneyByCurrency[]): MoneyByCurrency[] {
  const totals = new Map<string, number>();
  for (const { minorUnits, currency } of amounts) {
    totals.set(currency, (totals.get(currency) ?? 0) + minorUnits);
  }
  return [...totals.entries()].map(([currency, minorUnits]) => ({ currency, minorUnits }));
}

/** Renders a possibly-multi-currency total as a display string, e.g. "12,30 € + 5,00 $" — never a single misleading number. */
export function formatMoneyByCurrency(amounts: MoneyByCurrency[]): string {
  const totals = sumByCurrency(amounts);
  if (totals.length === 0) return "—";
  return totals.map((t) => formatMoney(t.minorUnits, t.currency)).join(" + ");
}
