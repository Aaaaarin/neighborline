/** Typed errors. Every PayPal failure surfaces `debugId` — PayPal support asks for it first. */

export interface PayPalErrorDetail {
  field?: string;
  value?: string;
  location?: string;
  issue: string;
  description?: string;
  link?: PayPalLink[];
  links?: PayPalLink[];
}

export interface PayPalLink {
  href: string;
  rel: string;
  method?: string;
  encType?: string;
}

/** Base class so callers can `catch (e) { if (e instanceof PayPalError) … }`. */
export class PayPalError extends Error {
  override name = 'PayPalError';
}

/**
 * A non-2xx response from PayPal. `name` is PayPal's error name (e.g. `UNPROCESSABLE_ENTITY`,
 * `USER_BUSINESS_ERROR`, `INSTRUMENT_DECLINED` for OAuth-style errors it is the `error` field).
 */
export class PayPalApiError extends PayPalError {
  override readonly name: string;
  readonly status: number;
  readonly debugId: string | undefined;
  readonly details: PayPalErrorDetail[];
  readonly informationLink: string | undefined;
  readonly links: PayPalLink[];
  /** Raw parsed body (or text) for anything not modelled above. */
  readonly body: unknown;
  readonly method: string;
  readonly path: string;

  constructor(init: { status: number; body: unknown; method: string; path: string; headerDebugId?: string | null }) {
    const b = (init.body && typeof init.body === 'object' ? init.body : {}) as Record<string, unknown>;
    const name = str(b.name) ?? str(b.error) ?? `HTTP_${init.status}`;
    const message = str(b.message) ?? str(b.error_description) ?? (typeof init.body === 'string' ? init.body.slice(0, 200) : 'PayPal request failed');
    super(`${init.method} ${init.path} → ${init.status} ${name}: ${message}`);
    this.name = name;
    this.status = init.status;
    this.debugId = str(b.debug_id) ?? init.headerDebugId ?? undefined;
    this.details = Array.isArray(b.details) ? (b.details as PayPalErrorDetail[]) : [];
    this.informationLink = str(b.information_link);
    this.links = Array.isArray(b.links) ? (b.links as PayPalLink[]) : [];
    this.body = init.body;
    this.method = init.method;
    this.path = init.path;
  }

  /** First `details[].issue` — the most specific code PayPal gives (e.g. `ORDER_ALREADY_CAPTURED`). */
  get issue(): string | undefined {
    return this.details[0]?.issue;
  }

  /** True when `name` or any `details[].issue` equals `code`. */
  hasIssue(code: string): boolean {
    return this.name === code || this.details.some((d) => d.issue === code);
  }

  get retryable(): boolean {
    return this.status === 429 || this.status >= 500;
  }
}

/** OAuth token request failed (bad credentials, wrong environment, app disabled). */
export class PayPalAuthError extends PayPalApiError {}

export class PayPalTimeoutError extends PayPalError {
  override name = 'PayPalTimeoutError';
  constructor(
    readonly method: string,
    readonly path: string,
    readonly timeoutMs: number,
  ) {
    super(`${method} ${path} timed out after ${timeoutMs}ms`);
  }
}

export class PayPalNetworkError extends PayPalError {
  override name = 'PayPalNetworkError';
  constructor(
    readonly method: string,
    readonly path: string,
    override readonly cause: unknown,
  ) {
    super(`${method} ${path} failed: ${(cause as Error)?.message ?? String(cause)}`);
  }
}

/** Local validation failed before anything was sent to PayPal (e.g. Venmo item without a note). */
export class PayPalInputError extends PayPalError {
  override name = 'PayPalInputError';
  constructor(
    message: string,
    readonly field?: string,
  ) {
    super(message);
  }
}

/**
 * PayPal rejected a reused `sender_batch_id` (30-day window) and the error carried no link to the original
 * batch. Look up the batch id you stored when the first create succeeded. Nothing was paid twice.
 */
export class DuplicateBatchError extends PayPalError {
  override name = 'DuplicateBatchError';
  constructor(
    readonly senderBatchId: string,
    override readonly cause: PayPalApiError,
  ) {
    super(`sender_batch_id "${senderBatchId}" was already used (PayPal debug_id ${cause.debugId ?? 'n/a'}); no new payout was created`);
  }
}

/**
 * Did this failed write possibly land at PayPal? Timeouts, network errors and 5xx responses are
 * ambiguous: PayPal may have accepted the request before the connection broke. A duplicate
 * sender_batch_id without a link means it certainly landed. For any of these, do NOT record a
 * failure; resolve by replaying the same idempotency key (sender_batch_id / PayPal-Request-Id) or by
 * reading the resource. Only a definite 4xx rejection (or local validation) is a real failure.
 */
export function isAmbiguousPayPalError(err: unknown): boolean {
  if (err instanceof PayPalTimeoutError || err instanceof PayPalNetworkError || err instanceof DuplicateBatchError) return true;
  if (err instanceof PayPalApiError) return err.status >= 500 || err.status === 429 || err.status === 408;
  return !(err instanceof PayPalError); // an unexpected throw (bug, aborted fetch): we cannot know either way
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v ? v : undefined;
}
