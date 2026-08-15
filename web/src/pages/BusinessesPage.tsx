import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { neon } from "../lib/neon";
import { AppShell } from "../components/layout/AppShell";
import { Breadcrumb } from "../components/layout/Breadcrumb";
import { EmptyState } from "../components/layout/EmptyState";
import { FreshnessBadge } from "../components/layout/FreshnessBadge";
import { LoadingTable } from "../components/table/LoadingTable";
import type { AdAccount, Client } from "../types/db";

interface BusinessGroup {
  businessId: string;
  businessName: string;
  accounts: AdAccount[];
}

export function BusinessesPage() {
  const { clientId } = useParams<{ clientId: string }>();
  const [client, setClient] = useState<Client | null>(null);
  const [groups, setGroups] = useState<BusinessGroup[] | null>(null);

  useEffect(() => {
    if (!clientId) return;
    neon.from("clients").select("id,name,is_active").eq("id", clientId).single().then(({ data }) => {
      setClient((data as Client) ?? null);
    });
    neon
      .from("ad_accounts")
      .select("id,client_id,meta_account_id,name,currency,timezone_name,business_id,business_name")
      .eq("client_id", clientId)
      .order("business_name")
      .then(({ data }) => {
        const accounts = (data ?? []) as AdAccount[];
        const byBusiness = new Map<string, BusinessGroup>();
        for (const acc of accounts) {
          const key = acc.business_id ?? "(sans portefeuille)";
          const group = byBusiness.get(key) ?? {
            businessId: key,
            businessName: acc.business_name ?? "(sans portefeuille)",
            accounts: [],
          };
          group.accounts.push(acc);
          byBusiness.set(key, group);
        }
        setGroups([...byBusiness.values()]);
      });
  }, [clientId]);

  return (
    <AppShell clientId={clientId}>
      <Breadcrumb items={[{ label: client?.name ?? "…" }]} />
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Portefeuilles business</h1>
        <FreshnessBadge clientId={clientId} />
      </div>

      {groups === null && <LoadingTable columns={2} />}
      {groups?.length === 0 && (
        <EmptyState title="Aucun compte publicitaire" description="Ce client n'a pas encore de compte Meta synchronisé." />
      )}
      {groups && groups.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {groups.map((g) => (
            <Link
              key={g.businessId}
              to={`/clients/${clientId}/businesses/${g.businessId}`}
              className="rounded-lg border border-slate-200 bg-white p-4 transition-shadow hover:shadow-md dark:border-slate-800 dark:bg-slate-900"
            >
              <p className="font-medium text-slate-900 dark:text-slate-100">{g.businessName}</p>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                {g.accounts.length} compte{g.accounts.length > 1 ? "s" : ""} publicitaire{g.accounts.length > 1 ? "s" : ""}
              </p>
            </Link>
          ))}
        </div>
      )}
    </AppShell>
  );
}
