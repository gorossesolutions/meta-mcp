import type { ReactNode } from "react";
import { Navigate } from "react-router";
import { neon } from "../../lib/neon";

export function RequireAuth({ children }: { children: ReactNode }) {
  const { data, isPending } = neon.auth.useSession();

  if (isPending) {
    return <div className="flex h-screen items-center justify-center text-sm text-slate-400">Chargement…</div>;
  }
  if (!data?.user) {
    return <Navigate to="/auth/sign-in" replace />;
  }
  return <>{children}</>;
}
