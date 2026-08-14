// Thin wrapper around the Meta Marketing API (Graph API) using native fetch.
// No dependency on the official Meta Node SDK, so we can track new Graph API
// versions without waiting on upstream.

import type { MetaApiErrorPayload } from "../types/index.js";

export const GRAPH_API_BASE_URL = "https://graph.facebook.com";
export const DEFAULT_API_VERSION = "v26.0";

/** Meta error codes that indicate a transient rate limit and are safe to retry. */
const RATE_LIMIT_ERROR_CODES = new Set([4, 17, 32, 613]);

const MAX_RETRIES = 5;
const BASE_BACKOFF_MS = 1000;

export class MetaApiError extends Error {
  readonly code?: number;
  readonly subcode?: number;
  readonly type?: string;
  readonly fbtraceId?: string;
  readonly httpStatus: number;

  constructor(payload: MetaApiErrorPayload, httpStatus: number) {
    super(`Meta API error${payload.code !== undefined ? ` (code ${payload.code})` : ""}: ${payload.message}`);
    this.name = "MetaApiError";
    this.code = payload.code;
    this.subcode = payload.error_subcode;
    this.type = payload.type;
    this.fbtraceId = payload.fbtrace_id;
    this.httpStatus = httpStatus;
  }

  get isRateLimit(): boolean {
    return this.httpStatus === 429 || (this.code !== undefined && RATE_LIMIT_ERROR_CODES.has(this.code));
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function apiVersion(): string {
  return process.env.META_API_VERSION ?? DEFAULT_API_VERSION;
}

function buildUrl(path: string, params: Record<string, string | number | boolean | undefined>): URL {
  const cleanPath = path.startsWith("/") ? path.slice(1) : path;
  const url = new URL(`${GRAPH_API_BASE_URL}/${apiVersion()}/${cleanPath}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }
  return url;
}

async function parseErrorPayload(response: Response): Promise<MetaApiErrorPayload> {
  try {
    const body = (await response.json()) as { error?: MetaApiErrorPayload };
    if (body.error) return body.error;
  } catch {
    // fall through to generic message below
  }
  return { message: response.statusText || "Unknown Meta API error" };
}

async function requestWithRetry(url: URL, init: RequestInit): Promise<unknown> {
  let attempt = 0;
  for (;;) {
    const response = await fetch(url, init);

    if (response.ok) {
      return response.json();
    }

    const errorPayload = await parseErrorPayload(response);
    const error = new MetaApiError(errorPayload, response.status);

    if (error.isRateLimit && attempt < MAX_RETRIES) {
      const backoffMs = BASE_BACKOFF_MS * 2 ** attempt;
      await sleep(backoffMs);
      attempt += 1;
      continue;
    }

    throw error;
  }
}

/** GET a Graph API path (e.g. "act_123/campaigns") with query params. */
export async function graphGet<T>(
  path: string,
  params: Record<string, string | number | boolean | undefined>,
  accessToken: string,
): Promise<T> {
  const url = buildUrl(path, { ...params, access_token: accessToken });
  return (await requestWithRetry(url, { method: "GET" })) as T;
}

/** POST to a Graph API path with a form-encoded body. */
export async function graphPost<T>(
  path: string,
  body: Record<string, string | number | boolean | undefined>,
  accessToken: string,
): Promise<T> {
  const url = buildUrl(path, {});
  const form = new URLSearchParams();
  form.set("access_token", accessToken);
  for (const [key, value] of Object.entries(body)) {
    if (value !== undefined) form.set(key, String(value));
  }
  return (await requestWithRetry(url, {
    method: "POST",
    body: form,
  })) as T;
}
