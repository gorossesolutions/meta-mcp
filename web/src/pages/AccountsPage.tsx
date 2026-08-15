import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { neon } from "../lib/neon";
import { AppShell } from "../components/layout/AppShell";
import { Breadcrumb } from "../components/layout/Breadcrumb";
import { EmptyState } from "../components/layout/EmptyState";
import { LoadingTable } from "../components/table/LoadingTable";
import type { AdAccount, Client } from "../types/db";

export function AccountsPage() {
  const { clientId, businessId } = useParams<{ clientId: string; businessId: string }>();
  const [client, setClient] = useState<Client | null>(null);
  const [accounts, setAccounts] = useState<AdAccount[] | null>(null);

  useEffect(() => {
    if (!clientId || !businessId) return;
    neon.from("clients").select("id,name,is_active").eq("id", clientId).single().then(({ data }) => {
      setClient((data as Client) ?? null);
    });
    let query = neon
      .from("ad_accounts")
      .select("id,client_id,meta_account_id,name,currency,timezone_name,business_id,business_name")
      .eq("client_id", clientId);
    query = businessId === "(sans portefeuille)" ? query.is("business_id", null) : query.eq("business_id", businessId);
    query.order("name").then(({ data }) => setAccounts((data ?? []) as AdAccount[]));
  }, [clientId, businessId]);

  const businessName = accounts?.[0]?.business_name ?? "Portefeuille";

  return (
    <AppShell clientId={clientId}>
      <Breadcrumb
        items={[
          { label: client?.name ?? "…", to: `/clients/${clientId}` },
          { label: businessName },
        ]}
      />
      <h1 className="mb-4 text-lg font-semibold text-slate-900 dark:text-slate-100">Comptes publicitaires</h1>

      {accounts === null && <LoadingTable columns={4} />}
      {accounts?.length === 0 && <EmptyState title="Aucun compte dans ce portefeuille" />}
      {accounts && accounts.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-800">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500 dark:bg-slate-900 dark:text-slate-400">
              <tr>
                <th className="px-3 py-2">Compte</th>
                <th className="px-3 py-2">ID Meta</th>
                <th className="px-3 py-2">Devise</th>
                <th className="px-3 py-2">Fuseau</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {accounts.map((a) => (
                <tr key={a.id} className="bg-white hover:bg-brand-blue-light/40 dark:bg-slate-950 dark:hover:bg-slate-900">
                  <td className="px-3 py-2">
                    <Link to={`/clients/${clientId}/accounts/${a.id}`} className="font-medium text-brand-blue hover:underline">
                      {a.name ?? a.meta_account_id}
                    </Link>
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-slate-500 dark:text-slate-400">{a.meta_account_id}</td>
                  <td className="px-3 py-2">{a.currency}</td>
                  <td className="px-3 py-2 text-slate-500 dark:text-slate-400">{a.timezone_name}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AppShell>
  );
}
