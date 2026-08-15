import { useFreshness } from "../../hooks/useFreshness";
import { formatDateTime } from "../../lib/dates";

const LEVEL_STYLES: Record<string, string> = {
  fresh: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300",
  stale: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
  failed: "bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300",
  unknown: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
};

const LEVEL_LABEL: Record<string, string> = {
  fresh: "Données à jour",
  stale: "Données périmées (> 48h)",
  failed: "Dernier sync en échec",
  unknown: "Aucun sync connu",
};

/** Always-visible freshness signal — see web/README.md "Indicateur de fraîcheur". Never let stale data look current. */
export function FreshnessBadge({ clientId }: { clientId: string | undefined }) {
  const { freshness } = useFreshness(clientId);
  const style = LEVEL_STYLES[freshness.level];
  const label = LEVEL_LABEL[freshness.level];
  const lastSuccess = freshness.lastSuccessfulRun?.finished_at;

  return (
    <div
      title={lastSuccess ? `Dernier sync réussi : ${formatDateTime(lastSuccess)}` : "Aucun sync réussi enregistré"}
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${style}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />
      {label}
      {lastSuccess && <span className="font-normal opacity-75">· {formatDateTime(lastSuccess)}</span>}
    </div>
  );
}
