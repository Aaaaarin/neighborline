/**
 * Thin HMAC-signed HTTP client to the approver process (apps/approver). The web app holds NO PayPal
 * Payouts credentials and constructs no Payouts client: it can only ask the approver to look at an
 * approval record, and the approver decides from the database (see apps/approver/src/approver.ts).
 *
 * Imports only `@neighborline/approver/protocol` (shapes + signing), enforced by
 * lib/server/least-privilege.test.ts.
 */
import {
  APPROVER_ROUTES,
  DEFAULT_APPROVER_PORT,
  signApproverRequest,
  type ApproverError,
  type ApproverHealth,
  type CancelUnclaimedResponse,
  type ExecuteRequest,
  type ExecuteResponse,
  type PollResponse,
  type VerifyWebhookResponse,
} from '@neighborline/approver/protocol';
import { HttpError } from './errors';

export type Env = Record<string, string | undefined>;

/** A refusal or failure reported by the approver (status + stable code + organizer-safe message). */
export class ApproverRefusal extends HttpError {
  constructor(
    status: number,
    readonly code: ApproverError['code'] | 'unreachable' | 'not_configured',
    message: string,
  ) {
    super(status, message);
  }
}

export class ApproverClient {
  readonly url: string;
  private readonly secret: string | undefined;

  constructor(env: Env) {
    this.url = (env.APPROVER_URL || `http://127.0.0.1:${env.APPROVER_PORT || DEFAULT_APPROVER_PORT}`).replace(/\/$/, '');
    this.secret = env.NEIGHBORLINE_APPROVER_SECRET || undefined;
  }

  private async post<T>(path: string, body: unknown, timeoutMs = 30_000): Promise<T> {
    if (!this.secret) {
      throw new ApproverRefusal(503, 'not_configured', 'The approval service is not configured (NEIGHBORLINE_APPROVER_SECRET). Nothing was sent.');
    }
    const raw = JSON.stringify(body);
    let res: Response;
    try {
      res = await fetch(this.url + path, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...signApproverRequest(this.secret, 'POST', path, raw) },
        body: raw,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw new ApproverRefusal(503, 'unreachable', 'The approval service is unreachable. Nothing was sent; try again in a moment.');
    }
    const json = (await res.json().catch(() => ({}))) as Partial<ApproverError> & T;
    if (res.ok) return json as T;
    const code = (json.code ?? 'internal') as ApproverError['code'];
    const msg = json.error ?? `approval service error ${res.status}`;
    // Our own signature was refused: a deployment problem, not something the organizer did.
    if (res.status === 401 || code === 'replayed') throw new ApproverRefusal(502, code, `The approval service rejected this server's signature (${msg}). Nothing was sent.`);
    if (res.status >= 500) throw new ApproverRefusal(502, code, msg);
    throw new ApproverRefusal(res.status === 404 ? 404 : res.status === 403 ? 403 : 409, code, msg);
  }

  execute(req: ExecuteRequest): Promise<ExecuteResponse> {
    return this.post(APPROVER_ROUTES.execute, req, 60_000);
  }

  poll(batchId: string): Promise<PollResponse> {
    return this.post(APPROVER_ROUTES.poll(batchId), {});
  }

  cancelUnclaimed(itemId: string, body: { organizerId?: string; batchId?: string }): Promise<CancelUnclaimedResponse> {
    return this.post(APPROVER_ROUTES.cancelUnclaimed(itemId), body);
  }

  async verifyPayoutsWebhook(input: { headers: Record<string, string>; rawBody: string }): Promise<boolean> {
    try {
      return (await this.post<VerifyWebhookResponse>(APPROVER_ROUTES.verifyWebhook, input, 15_000)).verified;
    } catch {
      return false;
    }
  }

  /** Unauthenticated health (no secrets in it); null when unreachable. */
  async health(timeoutMs = 1500): Promise<ApproverHealth | null> {
    try {
      const res = await fetch(this.url + APPROVER_ROUTES.health, { signal: AbortSignal.timeout(timeoutMs) });
      return res.ok ? ((await res.json()) as ApproverHealth) : null;
    } catch {
      return null;
    }
  }
}
