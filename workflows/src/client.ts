/**
 * Minimal signed HTTP client for the web app's internal endpoints.
 * One attempt per call: retries are Render Workflows' job (per-task `retry` options), so every
 * attempt is visible in the dashboard instead of being hidden inside a loop.
 */
import type { WorkflowConfig } from './config.js';
import { signedHeaders } from './signing.js';

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly path: string,
    readonly bodyPreview: string,
  ) {
    super(`${path} → HTTP ${status}${HttpError.isRetryable(status) ? ' (retryable)' : ' (permanent)'}: ${bodyPreview}`);
    this.name = 'HttpError';
  }
  static isRetryable(status: number): boolean {
    return status === 408 || status === 425 || status === 429 || status >= 500;
  }
}

export interface Caller {
  post<TReq, TRes>(path: string, body: TReq): Promise<TRes>;
  get<TRes>(path: string): Promise<TRes>;
}

export function createCaller(cfg: Pick<WorkflowConfig, 'baseUrl' | 'internalSecret' | 'requestTimeoutMs'>, fetchImpl: typeof fetch = fetch): Caller {
  async function send<TRes>(method: 'GET' | 'POST', path: string, rawBody: string): Promise<TRes> {
    const headers: Record<string, string> = {
      accept: 'application/json',
      'user-agent': 'neighborline-workflows/0.1',
      ...signedHeaders(cfg.internalSecret, method, path, rawBody),
    };
    if (method === 'POST') headers['content-type'] = 'application/json';
    const res = await fetchImpl(cfg.baseUrl + path, {
      method,
      headers,
      body: method === 'POST' ? rawBody : undefined,
      signal: AbortSignal.timeout(cfg.requestTimeoutMs),
      redirect: 'error',
    });
    const text = await res.text();
    if (!res.ok) throw new HttpError(res.status, path, text.slice(0, 300));
    try {
      return JSON.parse(text) as TRes;
    } catch {
      throw new HttpError(502, path, `non-JSON response: ${text.slice(0, 120)}`);
    }
  }
  return {
    post: <TReq, TRes>(path: string, body: TReq) => send<TRes>('POST', path, JSON.stringify(body)),
    get: <TRes>(path: string) => send<TRes>('GET', path, ''),
  };
}
