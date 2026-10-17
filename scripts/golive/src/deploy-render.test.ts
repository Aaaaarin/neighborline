/**
 * deploy-render against a mock Render API and a mock hosted app (health, demo play + SSE, the routes
 * scripts/verify-deploy.sh checks, HMAC on the internal route), with tools/fake-paypal for the webhook registration.
 * verify-deploy.sh itself really runs (bash + curl).
 */
import { createHmac } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createFakePayPal, type FakePayPal } from '@neighborline/fake-paypal';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { REPO } from './lib/context.js';
import { runGolive } from './lib/orchestrate.js';
import { spawnRunner } from './lib/proc.js';
import { deployRender, desiredWebEnv, envDiff } from './steps/deploy-render.js';
import { fakePaypalEnv, tmp } from './test-helpers.js';

const SECRET = 'internal-secret-0123456789-0123456789-abcd';

async function listen(handler: (req: IncomingMessage, res: ServerResponse, body: string) => void): Promise<{ url: string; server: Server }> {
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    handler(req, res, Buffer.concat(chunks).toString('utf8'));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, server };
}

const json = (res: ServerResponse, status: number, body?: unknown, headers: Record<string, string> = {}) => {
  res.writeHead(status, { 'content-type': 'application/json', ...headers });
  res.end(body === undefined ? '' : JSON.stringify(body));
};

/** The hosted app: what verify-deploy.sh and the hosted e2e touch. */
function appHandler(req: IncomingMessage, res: ServerResponse, body: string) {
  const url = new URL(req.url ?? '/', 'http://x');
  const p = url.pathname;
  if (p === '/api/health') return json(res, 200, { ok: true, paypalMode: 'sandbox', aiMode: 'live', approver: 'up' });
  if (req.method === 'GET' && ['/', '/demo', '/report'].includes(p)) return res.writeHead(200, { 'content-type': 'text/html' }).end('<html></html>');
  if (p === '/api/webhooks/paypal') return json(res, 400, { verified: false });
  if (p === '/api/internal/report-refresh') {
    const ts = String(req.headers['x-neighborline-timestamp'] ?? '');
    const want = `v1=${createHmac('sha256', SECRET).update(`${ts}.POST.${p}.${body}`).digest('hex')}`;
    return req.headers['x-neighborline-signature'] === want ? json(res, 200, { regenerated: false, skippedReason: 'not_due' }) : json(res, 401, { error: 'bad signature' });
  }
  if (p === '/api/demo/play' && req.method === 'POST') return json(res, 200, { requestId: 'req_demo_v1_1', scenario: JSON.parse(body).scenario }, { 'set-cookie': 'nl_visitor=v1; Path=/; HttpOnly' });
  if (p === '/api/stream') {
    if (!String(req.headers.cookie ?? '').includes('nl_visitor=v1')) return json(res, 404, { error: 'No such request' });
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const at = new Date().toISOString();
    const send = (event: object) => res.write(`event: stage\ndata: ${JSON.stringify({ kind: 'stage', event, requestIds: ['req_demo_v1_1'] })}\n\n`);
    res.write(`event: hello\ndata: ${JSON.stringify({ kind: 'hello', serverTime: at })}\n\n`);
    send({ type: 'request.created', at, requestId: 'req_demo_v1_1' });
    send({ type: 'payout.batch_created', at, batchId: 'b1', senderBatchId: 'nl_x', paypalBatchId: 'SANDBOXBATCH1', itemCount: 1, totalCents: 15000 });
    setTimeout(() => {
      send({ type: 'payout.item_updated', at, itemId: 'i1', requestId: 'req_demo_v1_1', status: 'SUCCESS' });
      send({ type: 'webhook.verified', at, eventType: 'PAYMENT.PAYOUTS-ITEM.SUCCEEDED', eventId: 'WH-REAL-1' });
    }, 50);
    return;
  }
  json(res, 404, { error: 'nope' });
}

interface MockRender {
  url: string;
  services: Array<{ id: string; name: string; type: string; serviceDetails?: { url: string }; dashboardUrl?: string }>;
  env: Record<string, Record<string, string>>;
  deploys: Record<string, Array<{ id: string; status: string; polls: number }>>;
  calls: string[];
}

function renderHandler(m: MockRender) {
  return (req: IncomingMessage, res: ServerResponse, body: string) => {
    const url = new URL(req.url ?? '/', 'http://x');
    const p = url.pathname.replace(/^\/v1/, '');
    m.calls.push(`${req.method} ${p}`);
    if (req.headers.authorization !== 'Bearer rnd_testkey0123456789abcdef') return json(res, 401, { message: 'unauthorized' });
    let mm: RegExpExecArray | null;
    if (p === '/owners') return json(res, 200, [{ cursor: 'c1', owner: { id: 'tea-1', name: 'Neighborline', type: 'team' } }]);
    if (p === '/blueprints/validate') return json(res, 200, { valid: body.includes('neighborline-db'), plan: {} });
    if (p === '/blueprints') return json(res, 200, []);
    if (p === '/services') return json(res, 200, m.services.filter((s) => s.name === url.searchParams.get('name')).map((service) => ({ cursor: service.id, service })));
    if ((mm = /^\/services\/([^/]+)\/env-vars$/.exec(p))) return json(res, 200, Object.entries(m.env[mm[1]!] ?? {}).map(([key, value]) => ({ cursor: key, envVar: { key, value } })));
    if ((mm = /^\/services\/([^/]+)\/env-vars\/([^/]+)$/.exec(p))) {
      const e = (m.env[mm[1]!] ??= {});
      if (req.method === 'PUT') return (e[decodeURIComponent(mm[2]!)] = JSON.parse(body).value), json(res, 200, { key: mm[2], value: JSON.parse(body).value });
      if (req.method === 'DELETE') return delete e[decodeURIComponent(mm[2]!)], json(res, 204);
    }
    if ((mm = /^\/services\/([^/]+)\/deploys$/.exec(p))) {
      const list = (m.deploys[mm[1]!] ??= []);
      if (req.method === 'POST') {
        const d = { id: `dep-${list.length + 1}`, status: 'created', polls: 0 };
        list.unshift(d);
        return json(res, 201, { id: d.id, status: d.status });
      }
      return json(res, 200, list.slice(0, Number(url.searchParams.get('limit') ?? 20)).map((d) => ({ cursor: d.id, deploy: { id: d.id, status: d.status } })));
    }
    if ((mm = /^\/services\/([^/]+)\/deploys\/([^/]+)$/.exec(p))) {
      const d = (m.deploys[mm[1]!] ?? []).find((x) => x.id === mm![2]);
      if (!d) return json(res, 404, { message: 'no deploy' });
      d.polls++;
      d.status = d.polls === 1 ? 'build_in_progress' : d.polls === 2 ? 'update_in_progress' : 'live';
      return json(res, 200, { id: d.id, status: d.status });
    }
    if (p === '/env-groups') return json(res, 200, url.searchParams.get('name') === 'neighborline-internal' ? [{ cursor: 'g', envGroup: { id: 'evg-1', name: 'neighborline-internal' } }] : []);
    if (p === '/env-groups/evg-1') return json(res, 200, { id: 'evg-1', name: 'neighborline-internal', envVars: [{ key: 'NEIGHBORLINE_INTERNAL_SECRET', value: SECRET }] });
    json(res, 404, { message: `mock has no ${req.method} ${p}` });
  };
}

let fake: FakePayPal;
let app: { url: string; server: Server };
let render: { url: string; server: Server };
const m: MockRender = { url: '', services: [], env: {}, deploys: {}, calls: [] };

beforeAll(async () => {
  fake = await createFakePayPal({ processingDelayMs: 20 });
  app = await listen(appHandler);
  render = await listen(renderHandler(m));
  m.url = render.url;
});
afterAll(async () => {
  await fake.close();
  app.server.close();
  render.server.close();
});

describe('desiredWebEnv / envDiff', () => {
  it('sandbox mode with keys; fake mode removes the browser client id', () => {
    const env: Record<string, string> = { ...fakePaypalEnv('https://api-m.sandbox.paypal.com'), OPENAI_API_KEY: `sk-${'a'.repeat(30)}`, PAYPAL_WEBHOOK_ID: 'W1' };
    const d = desiredWebEnv(env, 'https://nl.onrender.com');
    expect(d).toMatchObject({ PAYPAL_MODE: 'sandbox', AI_MODE: 'live', LLM_PROVIDER: 'openai', APP_BASE_URL: 'https://nl.onrender.com', PAYPAL_WEBHOOK_ID: 'W1' });
    expect(d.NEXT_PUBLIC_PAYPAL_CLIENT_ID).toBe(env.PAYPAL_CLIENT_ID);
    const f = desiredWebEnv({ ...env, GOLIVE_HOSTED_PAYPAL_MODE: 'fake' }, 'https://nl.onrender.com');
    expect(f.PAYPAL_MODE).toBe('fake');
    expect(f.NEXT_PUBLIC_PAYPAL_CLIENT_ID).toBeNull();
    expect(envDiff({ NEXT_PUBLIC_PAYPAL_CLIENT_ID: 'x', APP_BASE_URL: 'https://nl.onrender.com' }, f).map((x) => `${x.action}:${x.key}`)).toContain('remove:NEXT_PUBLIC_PAYPAL_CLIENT_ID');
    expect(desiredWebEnv({}, 'u')).toMatchObject({ PAYPAL_MODE: 'fake', AI_MODE: 'fixture' });
  });
});

describe('deploy-render against mocks', () => {
  it('pending with clicks before the Blueprint exists; then env, deploy, verify, hosted e2e; then idempotent', async () => {
    const out = tmp();
    const env: Record<string, string> = { ...fakePaypalEnv(fake.url), RENDER_API_KEY: 'rnd_testkey0123456789abcdef', RENDER_API_URL: `${render.url}/v1`, OPENAI_API_KEY: `sk-${'b'.repeat(30)}`, GOLIVE_DEPLOY_POLL_MS: '5', PATH: process.env.PATH ?? '' };
    const opts = { repo: REPO, out, steps: [deployRender], processEnv: env, run: spawnRunner, quiet: true, sleep: async () => {} };

    const first = await runGolive(opts);
    const r1 = first.results.find((r) => r.step === 'deploy-render')!.result;
    expect(r1.status).toBe('pending');
    expect(r1.next).toContain('render.com/deploy?repo=');

    m.services.push(
      { id: 'srv-web', name: 'neighborline', type: 'web_service', serviceDetails: { url: app.url }, dashboardUrl: 'https://dashboard.render.com/web/srv-web' },
      { id: 'crn-sched', name: 'neighborline-scheduler', type: 'cron_job' },
    );
    m.env['srv-web'] = { NODE_VERSION: '22', PAYPAL_MODE: 'sandbox', DATABASE_URL: 'postgres://render' };
    const second = await runGolive(opts);
    const r2 = second.results.find((r) => r.step === 'deploy-render')!.result;
    expect(r2, JSON.stringify(r2)).toMatchObject({ status: 'ok' });
    const web = m.env['srv-web']!;
    expect(web).toMatchObject({ APP_BASE_URL: app.url, PAYPAL_MODE: 'sandbox', AI_MODE: 'live', LLM_PROVIDER: 'openai', OPENAI_API_KEY: env.OPENAI_API_KEY, PAYPAL_PAYOUTS_CLIENT_SECRET: env.PAYPAL_PAYOUTS_CLIENT_SECRET, DATABASE_URL: 'postgres://render' });
    expect(web.PAYPAL_WEBHOOK_ID).toMatch(/^[A-Z0-9]{17}$/);
    expect(web.PAYPAL_PAYOUTS_WEBHOOK_ID).toMatch(/^[A-Z0-9]{17}$/);
    expect(web.NEXT_PUBLIC_PAYPAL_CLIENT_ID).toBe(env.PAYPAL_CLIENT_ID);
    expect(m.env['crn-sched']!.RENDER_API_KEY).toBe(env.RENDER_API_KEY);
    expect(m.deploys['srv-web']![0]!.status).toBe('live');
    expect([...fake.state.registeredWebhooks.values()].map((w) => w.url)).toContain(`${app.url}/api/webhooks/paypal`);
    const gen = readFileSync(join(out, 'golive.env'), 'utf8');
    expect(gen).toContain(`HOSTED_URL=${new URL(app.url).host}`);
    const hosted = JSON.parse(readFileSync(join(out, 'deploy/hosted-e2e.json'), 'utf8'));
    expect(hosted).toMatchObject({ paypalMode: 'sandbox', paypalBatchId: 'SANDBOXBATCH1', itemStatus: 'SUCCESS', webhookVerified: { eventId: 'WH-REAL-1' } });
    const verifyLog = readFileSync(join(out, 'deploy/verify-deploy.log'), 'utf8');
    expect(verifyLog).toContain('internal API accepts signed no-op call');
    expect(verifyLog).not.toContain('✗');
    // Logs never carry a secret.
    expect(readFileSync(join(out, 'golive.log'), 'utf8')).not.toContain(env.PAYPAL_PAYOUTS_CLIENT_SECRET);

    // Third run: nothing changed → no PUT, no new deploy.
    const putsBefore = m.calls.filter((c) => c.startsWith('PUT')).length;
    const deploysBefore = m.deploys['srv-web']!.length;
    const third = await runGolive(opts);
    expect(third.results.find((r) => r.step === 'deploy-render')!.result.status).toBe('ok');
    expect(m.calls.filter((c) => c.startsWith('PUT')).length).toBe(putsBefore);
    expect(m.deploys['srv-web']!.length).toBe(deploysBefore);
  }, 60_000);

  it('a failed build stops with where to look', async () => {
    const env: Record<string, string> = { ...fakePaypalEnv(fake.url), RENDER_API_KEY: 'rnd_testkey0123456789abcdef', RENDER_API_URL: `${render.url}/v1`, GOLIVE_DEPLOY_POLL_MS: '5', GOLIVE_HOSTED_PAYPAL_MODE: 'fake' };
    // The env change (fake mode) triggers a deploy; the mock's deploy GET is answered with build_failed.
    const failingFetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const u = String(input);
      if (/\/deploys\/dep-\d+$/.test(u)) return new Response(JSON.stringify({ id: u.split('/').pop(), status: 'build_failed' }), { status: 200, headers: { 'content-type': 'application/json' } });
      return fetch(input, init);
    }) as typeof fetch;
    const report = await runGolive({ repo: REPO, out: tmp(), steps: [deployRender], processEnv: env, run: spawnRunner, quiet: true, sleep: async () => {}, fetch: failingFetch });
    expect(report.stoppedAt).toBe('deploy-render');
    expect(report.results[0]!.result.next).toMatch(/dashboard\.render\.com\/web\/srv-web.*logs/);
  }, 30_000);
});
