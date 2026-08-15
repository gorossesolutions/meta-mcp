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
import { LearningPhaseBadge } from "../components/table/LearningPhaseBadge";
import { MetricsCells, MetricsHeaderCells } from "../components/table/MetricsCells";
import { usePeriod } from "../hooks/usePeriod";
import { useEntityMetrics } from "../hooks/useEntityMetrics";
import { formatMoney } from "../lib/money";
import { daysSince, formatDateTime } from "../lib/dates";
import type { AdAccount, AdsetLatest, CampaignLatest, Client } from "../types/db";

export function AdsetsPage() {
  const { clientId, accountId, campaignId } = useParams<{ clientId: string; accountId: string; campaignId: string }>();
  const [client, setClient] = useState<Client | null>(null);
  const [account, setAccount] = useState<AdAccount | null>(null);
  const [campaign, setCampaign] = useState<CampaignLatest | null>(null);
  const [adsets, setAdsets] = useState<AdsetLatest[] | null>(null);
  const periodState = usePeriod();

  useEffect(() => {
    if (!clientId || !accountId || !campaignId) return;
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
      .eq("meta_campaign_id", campaignId)
      .single()
      .then(({ data }) => setCampaign((data as CampaignLatest) ?? null));
    neon
      .from("adsets_latest")
      .select("*")
      .eq("ad_account_id", accountId)
      .eq("meta_campaign_id", campaignId)
      .order("name")
      .then(({ data }) => setAdsets((data ?? []) as AdsetLatest[]));
  }, [clientId, accountId, campaignId]);

  const adsetIds = useMemo(() => (adsets ?? []).map((a) => a.meta_adset_id), [adsets]);
  const { metricsByEntityId, loading: metricsLoading } = useEntityMetrics(accountId, "adset", adsetIds, periodState.period);

  return (
    <AppShell clientId={clientId}>
      <Breadcrumb
        items={[
          { label: client?.name ?? "…", to: `/clients/${clientId}` },
          { label: account?.business_name ?? "…", to: `/clients/${clientId}/businesses/${account?.business_id}` },
          { label: account?.name ?? "…", to: `/clients/${clientId}/accounts/${accountId}` },
          { label: campaign?.name ?? "…" },
        ]}
      />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Ad sets</h1>
        <div className="flex items-center gap-3">
          <FreshnessBadge clientId={clientId} />
          <PeriodSelector {...periodState} />
        </div>
      </div>

      {adsets === null && <LoadingTable columns={13} />}
      {adsets?.length === 0 && <EmptyState title="Aucun ad set" description="Cette campagne n'a pas encore d'ad set synchronisé." />}
      {adsets && adsets.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
          <table className="w-full min-w-[1400px] text-sm">
            <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500 dark:bg-slate-900 dark:text-slate-400">
              <tr>
                <th className="px-3 py-2">Nom</th>
                <th className="px-3 py-2">Statut</th>
                <th className="px-3 py-2 bg-brand-blue-light/60 dark:bg-slate-800">Phase d'apprentissage</th>
                <th className="px-3 py-2 text-right bg-brand-blue-light/60 dark:bg-slate-800">Jours depuis lancement</th>
                <th className="px-3 py-2 bg-brand-blue-light/60 dark:bg-slate-800">Dernière modification</th>
                <th className="px-3 py-2 text-right">Budget quotidien</th>
                <MetricsHeaderCells />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {adsets.map((a) => {
                const days = daysSince(a.meta_created_time);
                return (
                  <tr key={a.meta_adset_id} className="bg-white hover:bg-brand-blue-light/40 dark:bg-slate-950 dark:hover:bg-slate-900">
                    <td className="px-3 py-2">
                      <Link
                        to={`/clients/${clientId}/accounts/${accountId}/campaigns/${campaignId}/adsets/${a.meta_adset_id}`}
                        className="font-medium text-brand-blue hover:underline"
                      >
                        {a.name ?? a.meta_adset_id}
                      </Link>
                    </td>
                    <td className="px-3 py-2">
                      <StatusBadge status={a.status_raw} />
                    </td>
                    <td className="px-3 py-2">
                      <LearningPhaseBadge normalized={a.learning_status_normalized} raw={a.learning_status_raw} />
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{days !== null ? days : "—"}</td>
                    <td className="px-3 py-2 text-xs text-slate-500 dark:text-slate-400">
                      {formatDateTime(a.learning_last_significant_edit ?? a.meta_updated_time)}
                      {a.learning_last_significant_edit && (
                        <span className="ml-1 text-slate-400" title="Dernière modification significative (apprentissage)">
                          *
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatMoney(a.daily_budget_minor, a.currency)}</td>
                    <MetricsCells metrics={metricsByEntityId.get(a.meta_adset_id)} />
                  </tr>
                );
              })}
            </tbody>
          </table>
          {metricsLoading && <p className="border-t border-slate-100 px-3 py-2 text-xs text-slate-400 dark:border-slate-800">Mise à jour des métriques…</p>}
        </div>
      )}
    </AppShell>
  );
}
