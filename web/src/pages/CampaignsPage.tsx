import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import { neon } from "../lib/neon";
import { AppShell } from "../components/layout/AppShell";
import { Breadcrumb } from "../components/layout/Breadcrumb";
import { EmptyState } from "../components/layout/EmptyState";
import { FreshnessBadge } from "../components/layout/FreshnessBadge";
import { PeriodSelector } from "../components/layout/PeriodSelector";
import { LoadingTable } from "../components/table/LoadingTable";
import { StatusBadge } from "../components/table/StatusBadge";
import { MetricsCells, MetricsHeaderCells } from "../components/table/MetricsCells";
import { usePeriod } from "../hooks/usePeriod";
import { useEntityMetrics } from "../hooks/useEntityMetrics";
import { formatMoney } from "../lib/money";
import type { AdAccount, CampaignLatest, Client } from "../types/db";

type StatusFilter = "all" | "ACTIVE" | "PAUSED" | "ARCHIVED";

export function CampaignsPage() {
  const { clientId, accountId } = useParams<{ clientId: string; accountId: string }>();
  const [client, setClient] = useState<Client | null>(null);
  const [account, setAccount] = useState<AdAccount | null>(null);
  const [campaigns, setCampaigns] = useState<CampaignLatest[] | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const periodState = usePeriod();

  useEffect(() => {
    if (!clientId || !accountId) return;
    neon.from("clients").select("id,name,is_active").eq("id", clientId).single().then(({ data }) => setClient((data as Client) ?? null));
    neon
      .from("ad_accounts")
      .select("id,client_id,meta_account_id,name,currency,timezone_name,business_id,business_name")
      .eq("id", accountId)
      .single()
      .then(({ data }) => setAccount((data as AdAccount) ?? null));
    neon
      .from("campaigns_latest")
      .select("*")
      .eq("ad_account_id", accountId)
      .order("name")
      .then(({ data }) => setCampaigns((data ?? []) as CampaignLatest[]));
  }, [clientId, accountId]);

  const campaignIds = useMemo(() => (campaigns ?? []).map((c) => c.meta_campaign_id), [campaigns]);
  const { metricsByEntityId, loading: metricsLoading } = useEntityMetrics(accountId, "campaign", campaignIds, periodState.period);

  const visibleCampaigns = (campaigns ?? []).filter(
    (c) => statusFilter === "all" || c.status_raw === statusFilter,
  );

  return (
    <AppShell clientId={clientId}>
      <Breadcrumb
        items={[
          { label: client?.name ?? "…", to: `/clients/${clientId}` },
          { label: account?.business_name ?? "…", to: `/clients/${clientId}/businesses/${account?.business_id}` },
          { label: account?.name ?? account?.meta_account_id ?? "…" },
        ]}
      />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Campagnes</h1>
        <div className="flex items-center gap-3">
          <FreshnessBadge clientId={clientId} />
          <PeriodSelector {...periodState} />
        </div>
      </div>

      <div className="mb-3 flex gap-1.5 text-xs">
        {(["all", "ACTIVE", "PAUSED", "ARCHIVED"] as StatusFilter[]).map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`rounded-md px-2 py-1 font-medium ${
              statusFilter === s
                ? "bg-brand-navy text-white dark:bg-slate-700"
                : "bg-white text-slate-500 hover:bg-slate-100 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700"
            }`}
          >
            {s === "all" ? "Toutes" : s}
          </button>
        ))}
      </div>

      {campaigns === null && <LoadingTable columns={12} />}
      {campaigns?.length === 0 && <EmptyState title="Aucune campagne" description="Ce compte n'a pas encore de campagne synchronisée." />}
      {campaigns && campaigns.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
          <table className="w-full min-w-[1100px] text-sm">
            <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500 dark:bg-slate-900 dark:text-slate-400">
              <tr>
                <th className="px-3 py-2">Nom</th>
                <th className="px-3 py-2">Statut</th>
                <th className="px-3 py-2">Objectif</th>
                <th className="px-3 py-2 text-right">Budget quotidien</th>
                <MetricsHeaderCells />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {visibleCampaigns.map((c) => (
                <tr key={c.meta_campaign_id} className="bg-white hover:bg-brand-blue-light/40 dark:bg-slate-950 dark:hover:bg-slate-900">
                  <td className="px-3 py-2">
                    <Link
                      to={`/clients/${clientId}/accounts/${accountId}/campaigns/${c.meta_campaign_id}`}
                      className="font-medium text-brand-blue hover:underline"
                    >
                      {c.name ?? c.meta_campaign_id}
                    </Link>
                  </td>
                  <td className="px-3 py-2">
                    <StatusBadge status={c.status_raw} />
                  </td>
                  <td className="px-3 py-2 text-slate-500 dark:text-slate-400">{c.objective_raw ?? "—"}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatMoney(c.daily_budget_minor, c.currency)}</td>
                  <MetricsCells metrics={metricsByEntityId.get(c.meta_campaign_id)} />
                </tr>
              ))}
            </tbody>
          </table>
          {metricsLoading && <p className="border-t border-slate-100 px-3 py-2 text-xs text-slate-400 dark:border-slate-800">Mise à jour des métriques…</p>}
        </div>
      )}
    </AppShell>
  );
}
