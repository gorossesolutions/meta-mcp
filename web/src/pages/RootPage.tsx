import { Navigate, Link } from "react-router";
import { AppShell } from "../components/layout/AppShell";
import { EmptyState } from "../components/layout/EmptyState";
import { LoadingTable } from "../components/table/LoadingTable";
import { useAccessibleClients } from "../hooks/useAccessibleClients";
import { neon } from "../lib/neon";

/**
 * Landing page after sign-in. Zero clients here means one of two things:
 * either this user genuinely has no user_clients row (expected, correct —
 * shows the empty state), or RLS isn't actually filtering (would show
 * OTHER people's clients instead of zero) — see the mandatory security
 * test in web/README.md. If you ever see unexpected client names here
 * before you've created your own user_clients row, STOP and report it,
 * don't work around it.
 */
export function RootPage() {
  const { clients, loading } = useAccessibleClients();
  const { data } = neon.auth.useSession();

  if (loading) {
    return (
      <AppShell>
        <LoadingTable columns={2} rows={2} />
      </AppShell>
    );
  }

  if (clients.length === 1) {
    return <Navigate to={`/clients/${clients[0].id}`} replace />;
  }

  if (clients.length === 0) {
    return (
      <AppShell>
        <EmptyState
          title="Aucun client ne vous est attribué"
          description={`Le compte ${data?.user?.email ?? ""} n'a accès à aucun client pour l'instant. Contacte l'administrateur pour qu'il t'ajoute via user_clients.`}
        />
      </AppShell>
    );
  }

  return (
    <AppShell>
      <h1 className="mb-4 text-lg font-semibold text-slate-900 dark:text-slate-100">Clients</h1>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {clients.map((c) => (
          <Link
            key={c.id}
            to={`/clients/${c.id}`}
            className="rounded-lg border border-slate-200 bg-white p-4 transition-shadow hover:shadow-md dark:border-slate-800 dark:bg-slate-900"
          >
            <p className="font-medium text-slate-900 dark:text-slate-100">{c.name}</p>
          </Link>
        ))}
      </div>
    </AppShell>
  );
}
