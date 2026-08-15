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
import type { AdAccount, AdLatest, AdsetLatest, Creative } from "../types/db";

export function AdsPage() {
  const { clientId, accountId, campaignId, adsetId } = useParams<{
    clientId: string;
    accountId: string;
    campaignId: string;
    adsetId: string;
  }>();
  const [account, setAccount] = useState<AdAccount | null>(null);
  const [adset, setAdset] = useState<AdsetLatest | null>(null);
  const [ads, setAds] = useState<AdLatest[] | null>(null);
  const [creativesById, setCreativesById] = useState<Map<string, Creative>>(new Map());
  const periodState = usePeriod();

  useEffect(() => {
    if (!accountId || !campaignId || !adsetId) return;
    neon
      .from("ad_accounts")
      .select("id,client_id,meta_account_id,name,currency,timezone_name,business_id,business_name")
      .eq("id", accountId)
      .single()
      .then(({ data }) => setAccount((data as AdAccount) ?? null));
    neon
      .from("adsets_latest")
      .select("*")
      .eq("ad_account_id", accountId)
      .eq("meta_adset_id", adsetId)
      .single()
      .then(({ data }) => setAdset((data as AdsetLatest) ?? null));
    neon
      .from("ads_latest")
      .select("*")
      .eq("ad_account_id", accountId)
      .eq("meta_adset_id", adsetId)
      .order("name")
      .then(({ data }) => setAds((data ?? []) as AdLatest[]));
    neon
      .from("creatives")
      .select("id,client_id,ad_account_id,meta_creative_id,meta_ad_id,name,thumbnail_url,title,body,call_to_action_type,image_url,video_id,object_type")
      .eq("ad_account_id", accountId)
      .then(({ data }) => {
        const map = new Map<string, Creative>();
        for (const c of (data ?? []) as Creative[]) map.set(c.meta_creative_id, c);
        setCreativesById(map);
      });
  }, [accountId, campaignId, adsetId]);

  const adIds = useMemo(() => (ads ?? []).map((a) => a.meta_ad_id), [ads]);
  const { metricsByEntityId, loading: metricsLoading } = useEntityMetrics(accountId, "ad", adIds, periodState.period);

  return (
    <AppShell clientId={clientId}>
      <Breadcrumb
        items={[
          { label: account?.business_name ?? "…", to: `/clients/${clientId}/businesses/${account?.business_id}` },
          { label: account?.name ?? "…", to: `/clients/${clientId}/accounts/${accountId}` },
          { label: "Campagne", to: `/clients/${clientId}/accounts/${accountId}/campaigns/${campaignId}` },
          { label: adset?.name ?? "…" },
        ]}
      />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Annonces</h1>
        <div className="flex items-center gap-3">
          <FreshnessBadge clientId={clientId} />
          <PeriodSelector {...periodState} />
        </div>
      </div>

      {ads === null && <LoadingTable columns={11} />}
      {ads?.length === 0 && <EmptyState title="Aucune annonce" description="Cet ad set n'a pas encore d'annonce synchronisée." />}
      {ads && ads.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
          <table className="w-full min-w-[1200px] text-sm">
            <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500 dark:bg-slate-900 dark:text-slate-400">
              <tr>
                <th className="px-3 py-2">Annonce</th>
                <th className="px-3 py-2">Statut</th>
                <MetricsHeaderCells />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {ads.map((ad) => {
                const creative = ad.meta_creative_id ? creativesById.get(ad.meta_creative_id) : undefined;
                return (
                  <tr key={ad.meta_ad_id} className="bg-white hover:bg-brand-blue-light/40 dark:bg-slate-950 dark:hover:bg-slate-900">
                    <td className="px-3 py-2">
                      <Link
                        to={`/clients/${clientId}/accounts/${accountId}/campaigns/${campaignId}/adsets/${adsetId}/ads/${ad.meta_ad_id}`}
                        className="flex items-center gap-2"
                      >
                        {creative?.thumbnail_url ? (
                          <img src={creative.thumbnail_url} alt="" className="h-8 w-8 flex-none rounded object-cover" />
                        ) : (
                          <span className="h-8 w-8 flex-none rounded bg-slate-100 dark:bg-slate-800" />
                        )}
                        <span className="font-medium text-brand-blue hover:underline">{ad.name ?? ad.meta_ad_id}</span>
                      </Link>
                    </td>
                    <td className="px-3 py-2">
                      <StatusBadge status={ad.status_raw} />
                    </td>
                    <MetricsCells metrics={metricsByEntityId.get(ad.meta_ad_id)} />
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
