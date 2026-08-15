import { useEffect, useState } from "react";
import { neon } from "../lib/neon";
import type { Client } from "../types/db";

export interface UseAccessibleClientsResult {
  clients: Client[];
  loading: boolean;
  error: string | null;
}

/**
 * Lists clients visible to the signed-in user. RLS (app.has_client_access,
 * via user_clients) does the actual filtering — an empty result here means
 * "no user_clients row for this user", not a bug, see
 * db/README.md "Modèle de sécurité" and web/README.md "Test RLS".
 */
export function useAccessibleClients(): UseAccessibleClientsResult {
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    neon
      .from("clients")
      .select("id,name,is_active")
      .eq("is_active", true)
      .order("name")
      .then(({ data, error: queryError }) => {
        if (cancelled) return;
        if (queryError) setError(queryError.message);
        setClients((data ?? []) as Client[]);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { clients, loading, error };
}
