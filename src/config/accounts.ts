// Loads the multi-tenant client -> ad account / token mapping.
// See accounts.config.json.example for the expected file shape.
//
// TODO (Etape 1 - Authentification Meta): implement loadAccountsConfig(),
// resolve each client's token from its access_token_env_var, and validate
// the config against AccountsConfig on startup.

import type { AccountsConfig } from "../types/index.js";

export function loadAccountsConfig(_path: string): AccountsConfig {
  throw new Error("Not implemented yet — see Etape 1");
}
