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

// --- Proactive rate-limit tracking ------------------------------------
//
// The retry/backoff above is reactive: it only kicks in once Meta has
// already rejected a call. For volume usage (the sync job pulling many
// accounts/entities), we also read the X-Business-Use-Case-Usage response
// header proactively and slow down BEFORE hitting the limit, not after.
// This is opt-in in effect: it only ever engages once a response has
// actually carried the header, so it's a no-op for callers/accounts that
// never see it.

export interface RateLimitUsage {
  /** Highest of call_count/total_cputime/total_time across all business use cases in the header, 0-100. */
  percent: number;
  raw: unknown;
  observedAt: Date;
}

let lastUsage: RateLimitUsage | undefined;

/** The most recent X-Business-Use-Case-Usage reading seen by this process, if any. */
export function getLastRateLimitUsage(): RateLimitUsage | undefined {
  return lastUsage;
}

/** Exposed for tests/long-running processes that want a clean slate between runs. */
export function resetRateLimitUsage(): void {
  lastUsage = undefined;
}

const THROTTLE_THRESHOLD_PERCENT = Number(process.env.META_RATE_LIMIT_THROTTLE_THRESHOLD_PERCENT ?? "80");
const THROTTLE_DELAY_MS = Number(process.env.META_RATE_LIMIT_THROTTLE_DELAY_MS ?? "3000");

function parseBusinessUseCaseUsage(headerValue: string | null): RateLimitUsage | undefined {
  if (!headerValue) return undefined;
  try {
    const parsed = JSON.parse(headerValue) as Record<
      string,
      Array<{ call_count?: number; total_cputime?: number; total_time?: number }>
    >;
    let maxPercent = 0;
    for (const entries of Object.values(parsed)) {
      for (const entry of entries) {
        maxPercent = Math.max(maxPercent, entry.call_count ?? 0, entry.total_cputime ?? 0, entry.total_time ?? 0);
      }
    }
    return { percent: maxPercent, raw: parsed, observedAt: new Date() };
  } catch {
    return undefined;
  }
}

export class MetaApiError extends Error {
  readonly code?: number;
  readonly subcode?: number;
  readonly type?: string;
  readonly fbtraceId?: string;
  readonly httpStatus: number;

  constructor(payload: MetaApiErrorPayload, httpStatus: number) {
    const detail = payload.error_user_msg ?? payload.message;
    super(`Meta API error${payload.code !== undefined ? ` (code ${payload.code})` : ""}: ${detail}`);
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
    if (lastUsage && lastUsage.percent >= THROTTLE_THRESHOLD_PERCENT) {
      await sleep(THROTTLE_DELAY_MS);
    }

    const response = await fetch(url, init);

    const usage = parseBusinessUseCaseUsage(response.headers.get("x-business-use-case-usage"));
    if (usage) lastUsage = usage;

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
