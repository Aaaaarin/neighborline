import { expect, test } from '@playwright/test';
import { solvePow } from '../lib/pow';

/**
 * The human check on live-AI intake, proof-of-work path (playwright.config sets HUMAN_CHECK=pow).
 * The neighbor never sees it: /call earns the pass in the background, and the scripted /demo never asks.
 */
test('a model-using intake call needs a human pass; a proof of work earns one, and it cannot be replayed', async ({ request }) => {
  const { requestId } = await (await request.post('/api/intake/start', { data: { groupSlug: 'eastside', channel: 'web_text' } })).json();
  const text = { data: { text: 'Power is out since the storm, I need a space heater. We are 2 people. My Venmo is @e2e-human1' } };

  const refused = await request.post(`/api/intake/${requestId}/text`, text);
  expect(refused.status()).toBe(403);
  expect(await refused.json()).toMatchObject({ code: 'human_check_required' });

  // A solution is bound to the visitor who asked and spent once.
  const ch = await (await request.post('/api/human/challenge', { data: {} })).json();
  expect(ch).toMatchObject({ kind: 'pow', count: 32 });
  const solution = await solvePow(ch, { yieldFn: async () => {} });
  expect((await request.post('/api/human/verify', { data: { kind: 'pow', challenge: ch.challenge, solution: solution.map((n) => n + 1) } })).status()).toBe(400);
  expect((await request.post('/api/human/verify', { data: { kind: 'pow', challenge: ch.challenge, solution } })).status()).toBe(200);
  expect((await request.post('/api/human/verify', { data: { kind: 'pow', challenge: ch.challenge, solution } })).status()).toBe(409);

  expect((await request.post(`/api/intake/${requestId}/text`, text)).status()).toBe(200);
  expect(await (await request.post('/api/human/challenge', { data: {} })).json()).toMatchObject({ kind: 'passed' });
});

test('another browser cannot use my solution or my pass', async ({ request, playwright, baseURL }) => {
  const ch = await (await request.post('/api/human/challenge', { data: {} })).json();
  const solution = await solvePow(ch, { yieldFn: async () => {} });
  const other = await playwright.request.newContext({ baseURL });
  await other.post('/api/human/challenge', { data: {} }); // its own visitor cookie
  expect((await other.post('/api/human/verify', { data: { kind: 'pow', challenge: ch.challenge, solution } })).status()).toBe(400);
  await other.dispose();
  expect((await request.post('/api/human/verify', { data: { kind: 'pow', challenge: ch.challenge, solution } })).status()).toBe(200);

  // My pass cookie, copied into another browser, is bound to my visitor id: refused there.
  const pass = (await request.storageState()).cookies.find((c) => c.name === 'nl_human');
  expect(pass).toBeTruthy();
  const thief = await playwright.request.newContext({ baseURL, storageState: { cookies: [pass!], origins: [] } });
  const { requestId } = await (await thief.post('/api/intake/start', { data: { groupSlug: 'eastside', channel: 'web_text' } })).json();
  const res = await thief.post(`/api/intake/${requestId}/text`, { data: { text: 'I need groceries. My Venmo is @e2e-thief1' } });
  expect(res.status()).toBe(403);
  await thief.dispose();
});

test('on /call the browser solves the proof of work in the background and a typed request goes through', async ({ page }) => {
  const verified = page.waitForResponse((r) => r.url().endsWith('/api/human/verify') && r.status() === 200);
  await page.goto('/call');
  await verified;
  await page.getByRole('button', { name: /type instead/i }).click();
  await page.locator('#say').fill('Power is out since the storm, I need a space heater. We are 2 people. My Venmo is @e2e-human2');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByRole('button', { name: 'Yes, that’s right' })).toBeVisible();
});

test('the scripted /demo never asks for a human check', async ({ page }) => {
  const asked: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/api/human/')) asked.push(r.url());
  });
  await page.goto('/demo?scenario=rosa&speed=8');
  await page.getByRole('button', { name: 'Play scenario' }).click();
  await expect(page.getByText(/claimed it · SUCCESS/)).toBeVisible({ timeout: 30_000 });
  expect(asked).toEqual([]);
});
