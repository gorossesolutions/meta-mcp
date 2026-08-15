import { useEffect, useState } from "react";
import { useParams } from "react-router";
import { neon } from "../lib/neon";
import { AppShell } from "../components/layout/AppShell";
import { Breadcrumb } from "../components/layout/Breadcrumb";
import { PeriodSelector } from "../components/layout/PeriodSelector";
import { AngleForm } from "../components/angles/AngleForm";
import { usePeriod } from "../hooks/usePeriod";
import { aggregateInsights } from "../lib/metrics";
import { formatMoneyByCurrency } from "../lib/money";
import { formatDateTime } from "../lib/dates";
import type { AdLatest, Creative, CreativeAngle, InsightsDailyRow } from "../types/db";

const RANKING_LABEL: Record<string, string> = {
  ABOVE_AVERAGE: "Au-dessus de la moyenne",
  AVERAGE: "Dans la moyenne",
  BELOW_AVERAGE: "En dessous de la moyenne",
  BELOW_AVERAGE_10: "En dessous (bottom 35%)",
  BELOW_AVERAGE_20: "En dessous (bottom 20%)",
  BELOW_AVERAGE_35: "En dessous (bottom 10%)",
  UNKNOWN: "Non disponible",
};

function RankingCell({ value }: { value: string | null | undefined }) {
  if (!value || value === "UNKNOWN") {
    return <span className="text-slate-400 dark:text-slate-500">— (volume insuffisant)</span>;
  }
  return <span>{RANKING_LABEL[value] ?? value}</span>;
}

export function AdDetailPage() {
  const { clientId, accountId, campaignId, adsetId, adId } = useParams<{
    clientId: string;
    accountId: string;
    campaignId: string;
    adsetId: string;
    adId: string;
  }>();
  const [ad, setAd] = useState<AdLatest | null>(null);
  const [creative, setCreative] = useState<Creative | null>(null);
  const [angle, setAngle] = useState<CreativeAngle | null>(null);
  const [insightsRows, setInsightsRows] = useState<InsightsDailyRow[]>([]);
  const periodState = usePeriod();

  useEffect(() => {
    if (!accountId || !adId) return;
    neon.from("ads_latest").select("*").eq("ad_account_id", accountId).eq("meta_ad_id", adId).single().then(({ data }) => {
      const adRow = (data as AdLatest) ?? null;
      setAd(adRow);
      if (adRow?.meta_creative_id) {
        neon
          .from("creatives")
          .select("*")
          .eq("ad_account_id", accountId)
          .eq("meta_creative_id", adRow.meta_creative_id)
          .single()
          .then(({ data: c }) => setCreative((c as Creative) ?? null));
      }
    });
    neon
      .from("creative_angles")
      .select("*")
      .eq("meta_entity_type", "ad")
      .eq("meta_entity_id", adId)
      .maybeSingle()
      .then(({ data }) => setAngle((data as CreativeAngle) ?? null));
  }, [accountId, adId]);

  useEffect(() => {
    if (!accountId || !adId) return;
    neon
      .from("insights_daily")
      .select(
        "meta_entity_id,date,impressions,clicks,inline_link_clicks,spend_minor,currency,actions,purchase_roas,quality_ranking,engagement_rate_ranking,conversion_rate_ranking",
      )
      .eq("ad_account_id", accountId)
      .eq("entity_type", "ad")
      .eq("meta_entity_id", adId)
      .eq("breakdown_age", "")
      .eq("breakdown_gender", "")
      .eq("breakdown_publisher_platform", "")
      .eq("breakdown_platform_position", "")
      .eq("breakdown_impression_device", "")
      .eq("breakdown_device_platform", "")
      .eq("breakdown_region", "")
      .eq("breakdown_country", "")
      .gte("date", periodState.period.since)
      .lte("date", periodState.period.until)
      .order("date", { ascending: false })
      .then(({ data }) => setInsightsRows((data ?? []) as InsightsDailyRow[]));
  }, [accountId, adId, periodState.period.since, periodState.period.until]);

  const metrics = aggregateInsights(insightsRows);
  const latestRanking = insightsRows[0]; // most recent day with data — rankings are a point-in-time classification, not summable

  return (
    <AppShell clientId={clientId}>
      <Breadcrumb
        items={[
          { label: "Compte", to: `/clients/${clientId}/accounts/${accountId}` },
          { label: "Campagne", to: `/clients/${clientId}/accounts/${accountId}/campaigns/${campaignId}` },
          { label: "Ad set", to: `/clients/${clientId}/accounts/${accountId}/campaigns/${campaignId}/adsets/${adsetId}` },
          { label: ad?.name ?? "…" },
        ]}
      />

      <div className="grid gap-6 lg:grid-cols-[380px_1fr]">
        <div className="space-y-4">
          <div className="overflow-hidden rounded-lg border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
            {creative?.thumbnail_url ? (
              <img src={creative.thumbnail_url} alt={creative.title ?? ""} className="aspect-square w-full object-cover" />
            ) : (
              <div className="flex aspect-square w-full items-center justify-center bg-slate-100 text-sm text-slate-400 dark:bg-slate-800">
                {creative?.video_id ? "Vidéo (pas de vignette)" : "Aucun visuel"}
              </div>
            )}
            <div className="space-y-2 p-4">
              {creative?.title && <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{creative.title}</p>}
              {creative?.body && <p className="whitespace-pre-wrap text-sm text-slate-600 dark:text-slate-400">{creative.body}</p>}
              {creative?.call_to_action_type && (
                <span className="inline-block rounded bg-brand-blue-light px-2 py-0.5 text-xs font-medium text-brand-blue dark:bg-brand-blue/20 dark:text-brand-blue">
                  {creative.call_to_action_type}
                </span>
              )}
              {!creative && <p className="text-sm text-slate-400">Aucun créatif associé synchronisé.</p>}
            </div>
          </div>

          <AngleForm
            clientId={clientId!}
            metaEntityId={adId!}
            adCreatedTime={ad?.meta_created_time ?? null}
            existing={angle}
            onSaved={setAngle}
          />
        </div>

        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">{ad?.name ?? "…"}</h1>
            <PeriodSelector {...periodState} />
          </div>

          <div className="grid grid-cols-3 gap-3 sm:grid-cols-5">
            {[
              ["Dépense", formatMoneyByCurrency(metrics.spendByCurrency)],
              ["Impressions", metrics.impressions.toLocaleString("fr-FR")],
              ["Clics", metrics.clicks.toLocaleString("fr-FR")],
              ["CTR", metrics.ctrPercent !== null ? `${metrics.ctrPercent.toFixed(2)} %` : "—"],
              ["Conversions*", metrics.conversions > 0 ? metrics.conversions.toLocaleString("fr-FR") : "—"],
            ].map(([label, value]) => (
              <div key={label} className="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
                <p className="text-xs text-slate-500 dark:text-slate-400">{label}</p>
                <p className="mt-1 text-base font-semibold tabular-nums text-slate-900 dark:text-slate-100">{value}</p>
              </div>
            ))}
          </div>
          <p className="text-xs text-slate-400">* Conversions = approximation (somme d'un ensemble d'action_types courants), Meta n'expose pas un champ unique canonique — voir web/README.md.</p>

          <div className="rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <h2 className="mb-3 text-sm font-semibold text-slate-900 dark:text-slate-100">
              Classements de qualité {latestRanking && <span className="font-normal text-slate-400">({latestRanking.date})</span>}
            </h2>
            <dl className="grid grid-cols-3 gap-4 text-sm">
              <div>
                <dt className="text-xs text-slate-500 dark:text-slate-400">Qualité</dt>
                <dd className="mt-0.5">
                  <RankingCell value={latestRanking?.quality_ranking} />
                </dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500 dark:text-slate-400">Taux d'engagement</dt>
                <dd className="mt-0.5">
                  <RankingCell value={latestRanking?.engagement_rate_ranking} />
                </dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500 dark:text-slate-400">Taux de conversion</dt>
                <dd className="mt-0.5">
                  <RankingCell value={latestRanking?.conversion_rate_ranking} />
                </dd>
              </div>
            </dl>
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-4 text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
            <p>Créé le : {formatDateTime(ad?.meta_created_time)}</p>
            <p>Dernière mise à jour Meta : {formatDateTime(ad?.meta_updated_time)}</p>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
