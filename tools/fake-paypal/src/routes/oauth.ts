/** POST /v1/oauth2/token (client credentials) and bearer-token checking for every API route. */
import { HttpError, type Ctx, type Reply, type Router } from '../http.js';
import type { FakeContext } from '../context.js';

export function registerOAuthRoutes(router: Router, ctx: FakeContext): void {
  router.add('POST', '/v1/oauth2/token', (c) => token(ctx, c), { auth: false });
}

const invalidClient = () => new HttpError(401, { error: 'invalid_client', error_description: 'Client Authentication failed' });

function token(ctx: FakeContext, c: Ctx): Reply {
  const auth = c.header('authorization') ?? '';
  if (!auth.startsWith('Basic ')) throw invalidClient();
  const decoded = Buffer.from(auth.slice(6), 'base64').toString('utf8');
  const idx = decoded.indexOf(':');
  const id = idx > 0 ? decoded.slice(0, idx) : '';
  const secret = idx > 0 ? decoded.slice(idx + 1) : '';
  if (!id || !secret) throw invalidClient();
  if (ctx.config.clientId && (id !== ctx.config.clientId || secret !== ctx.config.clientSecret)) throw invalidClient();
  const form = new URLSearchParams(c.rawBody);
  if (form.get('grant_type') !== 'client_credentials') {
    throw new HttpError(400, { error: 'unsupported_grant_type', error_description: 'Grant Type is NULL or unsupported' });
  }
  const accessToken = ctx.ids.accessToken();
  ctx.state.tokens.set(accessToken, ctx.now() + ctx.config.tokenTtlSec * 1000);
  ctx.state.tokenClients.set(accessToken, id);
  return {
    status: 200,
    body: {
      scope: 'https://uri.paypal.com/services/payments/payment https://uri.paypal.com/payments/payouts https://uri.paypal.com/services/reporting/search/read https://uri.paypal.com/services/subscriptions https://uri.paypal.com/services/applications/webhooks',
      access_token: accessToken,
      token_type: 'Bearer',
      app_id: 'APP-80W284485P519543T',
      expires_in: ctx.config.tokenTtlSec,
      nonce: `${ctx.iso()}${ctx.ids.debugId()}`,
    },
  };
}

/** Throws 401 unless the request carries a live bearer token. Two shapes, like real PayPal. */
export function requireBearer(ctx: FakeContext, c: Ctx): void {
  const auth = c.header('authorization');
  if (!auth?.startsWith('Bearer ')) {
    throw new HttpError(401, {
      name: 'AUTHENTICATION_FAILURE',
      message: 'Authentication failed due to invalid authentication credentials or a missing Authorization header.',
      links: [{ href: 'https://developer.paypal.com/docs/api/overview/#error', rel: 'information_link' }],
    });
  }
  const exp = ctx.state.tokens.get(auth.slice(7));
  if (exp === undefined || exp <= ctx.now()) {
    throw new HttpError(401, { error: 'invalid_token', error_description: 'Token signature verification failed' });
  }
}

/** client_id behind the request's bearer token ('unknown' if none). */
export function callerClientId(ctx: FakeContext, c: Ctx): string {
  const auth = c.header('authorization');
  return (auth?.startsWith('Bearer ') ? ctx.state.tokenClients.get(auth.slice(7)) : undefined) ?? 'unknown';
}
