// Neon Data API + Neon Auth client. See web/README.md "Piège de l'URL
// Data API" — VITE_NEON_DATA_API_URL and VITE_NEON_AUTH_URL are two
// DIFFERENT URLs from two different Neon console tabs, both used exactly
// as the console shows them (no stripping — confirmed via curl).

import { createClient } from "@neondatabase/neon-js";
import { BetterAuthReactAdapter } from "@neondatabase/neon-js/auth/react/adapters";

const dataApiUrl = import.meta.env.VITE_NEON_DATA_API_URL as string | undefined;
const authUrl = import.meta.env.VITE_NEON_AUTH_URL as string | undefined;

if (!dataApiUrl || !authUrl) {
  throw new Error(
    "VITE_NEON_DATA_API_URL and VITE_NEON_AUTH_URL must be set (see web/.env.example and web/README.md).",
  );
}

export const neon = createClient({
  auth: {
    url: authUrl,
    adapter: BetterAuthReactAdapter(),
  },
  dataApi: {
    url: dataApiUrl,
    // Neon project exposes multiple schemas (app, auth, neon_auth, public —
    // app.current_user_id()/app.has_client_access() live in `app`, but every
    // actual table lives in `public`). Without this, the client defaulted to
    // the FIRST exposed schema ("app") and every query 404'd with "Could not
    // find the table 'app.<name>' in the schema cache" — confirmed the hard
    // way in this session. Explicit > relying on exposed-schema list order.
    options: { db: { schema: "public" } },
  },
});
