// Meta OAuth 2.0 token handling.
//
// TODO (Etape 1 - Authentification Meta):
// - exchangeForLongLivedToken(shortLivedToken): exchange a short-lived user
//   token for a ~60 day long-lived token via /oauth/access_token
// - System User tokens (Business Manager) do not expire and should be
//   preferred for production/automated use — no refresh logic needed there
// - resolveTokenForClient(clientId): look up the right token for a given
//   client from the accounts config / env
export {};
