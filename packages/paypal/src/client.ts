/**
 * PayPalClient: OAuth2 client-credentials with cached + early-refreshed tokens (single-flight), JSON requests with
 * typed errors, per-attempt timeouts, `PayPal-Request-Id` idempotency, optional `PayPal-Mock-Response`, and
 * jittered retries on 429/5xx. Writes get an auto-generated PayPal-Request-Id so retries are always replay-safe.
 */
import { randomUUID } from 'node:crypto';
import { PayPalApiError, PayPalAuthError, PayPalNetworkError, PayPalTimeoutError } from './errors.js';
import { backoffDelayMs, DEFAULT_RETRY, isRetryableStatus, isSafeToReplay, retryAfterMs, type RetryPolicy } from './retry.js';

export const PAYPAL_SANDBOX_URL = 'https://api-m.sandbox.paypal.com';
export const PAYPAL_LIVE_URL = 'https://api-m.paypal.com';

export interface PayPalClientOptions {
  clientId: string;
  clientSecret: string;
  /** API base, e.g. PAYPAL_SANDBOX_URL or the fake's URL. */
  baseUrl: string;
  fetch?: typeof fetch;
  /** Per-attempt timeout. Default 30s. */
  timeoutMs?: number;
  retry?: Partial<RetryPolicy>;
  /** Refresh the token this long before it expires (capped at half its lifetime). Default 5 min. */
  tokenRefreshSkewMs?: number;
  /** Clock + randomness + sleep injection for tests. */
  now?: () => number;
  random?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** Called for every attempt (status or error). Do not log bodies — they contain PII. */
  onRequest?: (info: RequestLog) => void;
}

export interface RequestLog {
  method: string;
  path: string;
  attempt: number;
  status?: number;
  debugId?: string;
  error?: string;
  ms: number;
}

export type MockResponse = string | { mock_application_codes: string };

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  path: string;
  query?: Record<string, string | number | boolean | undefined>;
  /** JSON-serialized for you. */
  body?: unknown;
  /** Pre-serialized JSON body, sent byte-for-byte (used for webhook verification). */
  rawBody?: string;
  /** Idempotency key. Writes without one get a random key that is reused across this call's retries. */
  requestId?: string;
  /** Sandbox negative testing: `PayPal-Mock-Response`. */
  mockResponse?: MockResponse;
  prefer?: 'return=minimal' | 'return=representation';
  headers?: Record<string, string>;
  /** Override retry policy for this call (`false` disables). */
  retry?: Partial<RetryPolicy> | false;
}

export interface PayPalResponse<T> {
  status: number;
  data: T;
  headers: Headers;
  requestId: string | undefined;
}

interface CachedToken {
  value: string;
  expiresAt: number;
  refreshAt: number;
}

export class PayPalClient {
  readonly baseUrl: string;
  private readonly opts: Required<Pick<PayPalClientOptions, 'timeoutMs' | 'tokenRefreshSkewMs'>> & PayPalClientOptions;
  private readonly retry: RetryPolicy;
  private readonly fetchImpl: typeof fetch;
  private token: CachedToken | undefined;
  private inflightToken: Promise<string> | undefined;

  constructor(options: PayPalClientOptions) {
    if (!options.clientId || !options.clientSecret) throw new Error('PayPalClient: clientId and clientSecret are required');
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.opts = { timeoutMs: 30_000, tokenRefreshSkewMs: 5 * 60_000, ...options };
    this.retry = { ...DEFAULT_RETRY, ...options.retry };
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
  }

  private now(): number {
    return this.opts.now?.() ?? Date.now();
  }

  private sleep(ms: number): Promise<void> {
    return this.opts.sleep ? this.opts.sleep(ms) : new Promise((r) => setTimeout(r, ms));
  }

  /** Cached access token; refreshed early, and only one refresh in flight at a time. */
  async getAccessToken(forceRefresh = false): Promise<string> {
    if (!forceRefresh && this.token && this.now() < this.token.refreshAt) return this.token.value;
    this.inflightToken ??= this.fetchToken().finally(() => {
      this.inflightToken = undefined;
    });
    return this.inflightToken;
  }

  /** Drop the cached token (e.g. after a 401). */
  invalidateToken(): void {
    this.token = undefined;
  }

  private async fetchToken(): Promise<string> {
    const path = '/v1/oauth2/token';
    const basic = Buffer.from(`${this.opts.clientId}:${this.opts.clientSecret}`).toString('base64');
    const res = await this.send('POST', path, {
      headers: { authorization: `Basic ${basic}`, 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: 'grant_type=client_credentials',
    }, 0);
    const body = await parseBody(res);
    if (!res.ok) throw new PayPalAuthError({ status: res.status, body, method: 'POST', path, headerDebugId: res.headers.get('paypal-debug-id') });
    const { access_token, expires_in } = body as { access_token?: string; expires_in?: number };
    if (!access_token) throw new PayPalAuthError({ status: res.status, body, method: 'POST', path });
    const lifetimeMs = Math.max(1, Number(expires_in ?? 0)) * 1000;
    const skew = Math.min(this.opts.tokenRefreshSkewMs, lifetimeMs / 2);
    const issued = this.now();
    this.token = { value: access_token, expiresAt: issued + lifetimeMs, refreshAt: issued + lifetimeMs - skew };
    return access_token;
  }

  /** Low-level fetch with timeout → typed timeout/network errors. */
  private async send(method: string, path: string, init: { headers: Record<string, string>; body?: string | undefined }, attempt: number): Promise<Response> {
    const started = this.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.opts.timeoutMs);
    try {
      const res = await this.fetchImpl(`${this.baseUrl}${path}`, { method, headers: init.headers, body: init.body ?? null, signal: controller.signal });
      const debugId = res.headers.get('paypal-debug-id') ?? undefined;
      this.opts.onRequest?.({ method, path: stripQuery(path), attempt, status: res.status, ...(debugId ? { debugId } : {}), ms: this.now() - started });
      return res;
    } catch (err) {
      this.opts.onRequest?.({ method, path: stripQuery(path), attempt, error: (err as Error).name, ms: this.now() - started });
      if (controller.signal.aborted) throw new PayPalTimeoutError(method, stripQuery(path), this.opts.timeoutMs);
      throw new PayPalNetworkError(method, stripQuery(path), err);
    } finally {
      clearTimeout(timer);
    }
  }

  /** Authenticated JSON request with retries. Throws PayPalApiError for non-2xx. */
  async request<T = unknown>(options: RequestOptions): Promise<PayPalResponse<T>> {
    const method = options.method ?? 'GET';
    const path = withQuery(options.path, options.query);
    const requestId = options.requestId ?? (method === 'GET' ? undefined : randomUUID());
    const policy = options.retry === false ? { ...this.retry, maxRetries: 0 } : { ...this.retry, ...options.retry };
    const body = options.rawBody ?? (options.body === undefined ? undefined : JSON.stringify(options.body));
    let refreshedAfter401 = false;

    for (let attempt = 0; ; attempt++) {
      const token = await this.getAccessToken();
      const headers: Record<string, string> = { authorization: `Bearer ${token}`, accept: 'application/json', ...options.headers };
      if (body !== undefined) headers['content-type'] = 'application/json';
      if (requestId) headers['paypal-request-id'] = requestId;
      if (options.prefer) headers.prefer = options.prefer;
      if (options.mockResponse) headers['paypal-mock-response'] = typeof options.mockResponse === 'string' ? options.mockResponse : JSON.stringify(options.mockResponse);

      let res: Response;
      try {
        res = await this.send(method, path, { headers, body }, attempt);
      } catch (err) {
        const canRetry = attempt < policy.maxRetries && isSafeToReplay(method, Boolean(requestId));
        if (!canRetry) throw err;
        await this.sleep(backoffDelayMs(attempt, policy, this.opts.random));
        continue;
      }

      if (res.status === 401 && !refreshedAfter401) {
        // Token revoked/expired early: refresh once, not counted as a retry.
        await res.arrayBuffer().catch(() => undefined);
        refreshedAfter401 = true;
        this.invalidateToken();
        attempt--;
        continue;
      }
      const data = await parseBody(res);
      if (res.ok) return { status: res.status, data: data as T, headers: res.headers, requestId };
      if (isRetryableStatus(res.status) && attempt < policy.maxRetries) {
        const wait = retryAfterMs(res.headers.get('retry-after'), this.now()) ?? backoffDelayMs(attempt, policy, this.opts.random);
        await this.sleep(wait);
        continue;
      }
      throw new PayPalApiError({ status: res.status, body: data, method, path: stripQuery(path), headerDebugId: res.headers.get('paypal-debug-id') });
    }
  }
}

async function parseBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function withQuery(path: string, query?: RequestOptions['query']): string {
  if (!query) return path;
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v !== undefined) qs.set(k, String(v));
  const s = qs.toString();
  return s ? `${path}${path.includes('?') ? '&' : '?'}${s}` : path;
}

function stripQuery(path: string): string {
  const i = path.indexOf('?');
  return i === -1 ? path : path.slice(0, i);
}

/** Encode a path segment (ids come from webhooks / users — never interpolate raw). */
export function seg(id: string): string {
  if (!id) throw new Error('empty id');
  return encodeURIComponent(id);
}
