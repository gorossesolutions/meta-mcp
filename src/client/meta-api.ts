// Thin wrapper around the Meta Marketing API (Graph API) using native fetch.
// No dependency on the official Meta Node SDK, so we can track new Graph API
// versions without waiting on upstream.
//
// TODO (Etape 1-3):
// - request(path, params, token): build the Graph API URL with the
//   configured META_API_VERSION and issue the fetch call
// - Exponential backoff retry on HTTP 429 and Meta rate-limit error codes
//   (17, 32, 613)
// - Normalize Meta error payloads into clear MCP-level error messages
//   instead of raw stack traces

export const GRAPH_API_BASE_URL = "https://graph.facebook.com";
export const DEFAULT_API_VERSION = "v26.0";
