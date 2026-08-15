import { useEffect, useState } from "react";
import { useParams } from "react-router";
import { neon } from "../lib/neon";
import { AppShell } from "../components/layout/AppShell";
import { Breadcrumb } from "../components/layout/Breadcrumb";
import { EmptyState } from "../components/layout/EmptyState";
import { LoadingTable } from "../components/table/LoadingTable";
import { formatDateOnly } from "../lib/dates";
import type { Client, CreativeAngle } from "../types/db";

interface AngleGroup {
  label: string;
  category: string | null;
  adCount: number;
  firstSeenDate: string | null;
  manualCount: number;
  parsedCount: number;
}

export function AnglesPage() {
  const { clientId } = useParams<{ clientId: string }>();
  const [client, setClient] = useState<Client | null>(null);
  const [groups, setGroups] = useState<AngleGroup[] | null>(null);

  useEffect(() => {
    if (!clientId) return;
    neon.from("clients").select("id,name,is_active").eq("id", clientId).single().then(({ data }) => setClient((data as Client) ?? null));
    neon
      .from("creative_angles")
      .select("*")
      .eq("client_id", clientId)
      .then(({ data }) => {
        const rows = (data ?? []) as CreativeAngle[];
        const byLabel = new Map<string, AngleGroup>();
        for (const row of rows) {
          const g = byLabel.get(row.angle_label) ?? {
            label: row.angle_label,
            category: row.angle_category,
            adCount: 0,
            firstSeenDate: null,
            manualCount: 0,
            parsedCount: 0,
          };
          g.adCount += 1;
          if (row.source === "manual") g.manualCount += 1;
          else g.parsedCount += 1;
          if (!g.firstSeenDate || (row.first_seen_date && row.first_seen_date < g.firstSeenDate)) {
            g.firstSeenDate = row.first_seen_date;
          }
          byLabel.set(row.angle_label, g);
        }
        setGroups([...byLabel.values()].sort((a, b) => (a.firstSeenDate ?? "").localeCompare(b.firstSeenDate ?? "")));
      });
  }, [clientId]);

  return (
    <AppShell clientId={clientId}>
      <Breadcrumb items={[{ label: client?.name ?? "…", to: `/clients/${clientId}` }, { label: "Angles créatifs" }]} />
      <h1 className="mb-1 text-lg font-semibold text-slate-900 dark:text-slate-100">Angles créatifs</h1>
      <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">
        Vue transversale : combien d'annonces utilisent chaque angle, et depuis quand il existe sur le compte — c'est ici qu'un essoufflement au niveau du concept, pas juste d'une annonce, devient visible.
      </p>

      {groups === null && <LoadingTable columns={4} />}
      {groups?.length === 0 && (
        <EmptyState
          title="Aucun angle taggé pour l'instant"
          description="Ajoute un premier angle depuis la fiche d'une annonce."
        />
      )}
      {groups && groups.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-800">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500 dark:bg-slate-900 dark:text-slate-400">
              <tr>
                <th className="px-3 py-2">Angle</th>
                <th className="px-3 py-2">Catégorie</th>
                <th className="px-3 py-2 text-right">Annonces</th>
                <th className="px-3 py-2 text-right">Première apparition</th>
                <th className="px-3 py-2">Origine</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {groups.map((g) => (
                <tr key={g.label} className="bg-white dark:bg-slate-950">
                  <td className="px-3 py-2 font-medium text-slate-900 dark:text-slate-100">{g.label}</td>
                  <td className="px-3 py-2 text-slate-500 dark:text-slate-400">{g.category ?? "—"}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{g.adCount}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatDateOnly(g.firstSeenDate)}</td>
                  <td className="px-3 py-2 text-xs text-slate-500 dark:text-slate-400">
                    {g.manualCount > 0 && `${g.manualCount} manuel${g.manualCount > 1 ? "s" : ""}`}
                    {g.manualCount > 0 && g.parsedCount > 0 && " · "}
                    {g.parsedCount > 0 && `${g.parsedCount} auto`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AppShell>
  );
}
