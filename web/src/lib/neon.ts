// Neon Data API + Neon Auth client. See web/README.md "Piège de l'URL
// Data API" — the URL shown in the Neon console is NOT what this SDK
// wants; VITE_NEON_DATA_API_URL and VITE_NEON_AUTH_URL below must already
// be in the short form before they land in .env.

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
  },
});
