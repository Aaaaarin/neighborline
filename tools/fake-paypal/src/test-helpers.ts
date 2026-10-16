/** Helpers shared by fake-paypal tests (and handy for other packages' tests). */
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface ReceivedWebhook {
  headers: Record<string, string>;
  rawBody: string;
  event: { id: string; event_type: string; resource: Record<string, unknown> };
}

/** A local HTTP endpoint that records webhook deliveries. */
export async function startWebhookReceiver(status = 200): Promise<{ url: string; received: ReceivedWebhook[]; close(): Promise<void> }> {
  const received: ReceivedWebhook[] = [];
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const ch of req) chunks.push(ch as Buffer);
    const rawBody = Buffer.concat(chunks).toString('utf8');
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers[k] = v;
    received.push({ headers, rawBody, event: JSON.parse(rawBody) });
    res.writeHead(status).end();
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/webhooks/paypal`,
    received,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

export async function getToken(baseUrl: string, id = 'test-client', secret = 'test-secret'): Promise<string> {
  const res = await fetch(`${baseUrl}/v1/oauth2/token`, {
    method: 'POST',
    headers: { authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`, 'content-type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  });
  const body = (await res.json()) as { access_token: string };
  return body.access_token;
}
