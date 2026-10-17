import { expect, test, type Page } from '@playwright/test';
import { inviteCode } from './helpers';

/** Give the browser a platform passkey (Chromium virtual authenticator with user verification). */
async function passkeyDevice(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
  });
}

// speed=6 compresses the scripted human beats (listening, reading the card); everything else is real latency.
test.describe('/demo stage (real engine, fake PayPal)', () => {
  test('Lan’s Vietnamese voice note reaches PayPal SUCCESS and the clock stops', async ({ page }) => {
    await page.goto('/demo?scenario=lan&speed=6');
    await page.getByRole('button', { name: 'Play scenario' }).click();

    const lan = page.getByRole('region', { name: 'Mrs. Lan’s phone' });
    await expect(lan.getByText('Đúng rồi').first()).toBeVisible();

    const rail = page.getByRole('list', { name: 'PayPal rail events' });
    await expect(rail.getByText('Approval 2 of 2 · Marcus')).toBeVisible();
    await expect(rail.getByText('PayPal Payouts batch created')).toBeVisible();
    await expect(rail.getByText(/^nl_[0-9a-f]{7}…/).first()).toBeVisible();
    await expect(rail.getByText('Item SUCCESS · money landed')).toBeVisible();

    await expect(lan.getByText(/Đã gửi \$150 vào Venmo của bạn/)).toBeVisible();
    await expect(page.getByText('Stopped at the verified SUCCESS webhook · Venmo')).toBeVisible();
    // Honest speed: people's decision time and system time, shown separately.
    await expect(page.getByText('Neighbors deciding')).toBeVisible();
    await expect(page.getByText('System', { exact: true })).toBeVisible();
    // Scripted organizers sign with labelled demo keys.
    await expect(rail.getByText(/Signed with Dana’s demo key/)).toBeVisible();

    // The stopwatch froze: same value a second later.
    const timer = page.getByRole('timer').last();
    const first = await timer.textContent();
    await page.waitForTimeout(1000);
    await expect(timer).toHaveText(first!);
    expect(first).toMatch(/^0:\d{2}\.\d$/);
  });

  test('a visitor approves as Marcus with a real passkey on their own device', async ({ page }) => {
    await passkeyDevice(page);
    await page.goto('/demo?scenario=lan&mode=manual&speed=6');
    await page.getByRole('button', { name: 'Play scenario' }).click();

    await expect(page.getByText('Your turn')).toBeVisible();
    const marcus = page.getByRole('region', { name: 'Marcus’s phone, organizer' });
    await marcus.getByRole('button', { name: 'Approve $150' }).click();

    await expect(page.getByRole('list', { name: 'PayPal rail events' }).getByText('Item SUCCESS · money landed')).toBeVisible();
    await expect(marcus.getByText('$150 landed')).toBeVisible();
    await expect(marcus.getByText(/Signed with passkey · Visitor’s .* \(as Marcus\)/)).toBeVisible();
    await expect(marcus.getByText('Dana: signed with demo key')).toBeVisible();
  });

  test('without a passkey the visitor is offered the labelled demo key, never blocked', async ({ page }) => {
    await page.goto('/demo?scenario=lan&mode=manual&speed=6');
    await page.getByRole('button', { name: 'Play scenario' }).click();

    await expect(page.getByText('Your turn')).toBeVisible();
    const marcus = page.getByRole('region', { name: 'Marcus’s phone, organizer' });
    // Keyboard users: "Your turn" puts focus on Approve; after it, focus lands on the fallback, never <body>.
    await expect(marcus.getByRole('button', { name: 'Approve $150' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(marcus.getByRole('button', { name: 'Approve with Marcus’s demo key' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(marcus.getByText(/You approved|landed/).first()).toBeVisible();

    await expect(page.getByRole('list', { name: 'PayPal rail events' }).getByText('Item SUCCESS · money landed')).toBeVisible();
    await expect(marcus.getByText('Marcus: signed with demo key')).toBeVisible();
  });

  test('a lookalike handle is blocked before any money moves', async ({ page }) => {
    await page.goto('/demo?scenario=blocked&speed=4');
    await page.getByRole('button', { name: 'Play scenario' }).click();

    await expect(page.getByRole('list', { name: 'PayPal rail events' }).getByText('Lookalike handle blocked')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Approve disabled' })).toHaveCount(2);
    await expect(page.getByText('Stopped · blocked before any money moved')).toBeVisible();
    await expect(page.getByText('PayPal Payouts batch created')).toHaveCount(0);
  });

  test('autoplay runs once: a reload mid-run does not start a second run', async ({ page }) => {
    const plays: string[] = [];
    page.on('request', (r) => {
      if (r.method() === 'POST' && new URL(r.url()).pathname === '/api/demo/play') plays.push(r.url());
    });
    await page.goto('/demo?scenario=jean&speed=4&autoplay=1');
    await expect(page.getByRole('button', { name: 'Play again' })).toBeVisible();
    await expect(page).not.toHaveURL(/autoplay=1/);
    expect(new URL(page.url()).searchParams.get('scenario')).toBe('jean');
    await page.reload();
    await expect(page.getByRole('button', { name: 'Play scenario' })).toBeVisible();
    await page.waitForTimeout(1500);
    expect(plays).toHaveLength(1);
  });
});

test('approvals are idempotent, need two different organizers, and a visitor only ever plays Marcus', async ({ request }) => {
  const run = await (await request.post('/api/demo/play', { data: { scenario: 'jean', mode: 'manual', speed: 20 } })).json();
  expect(run.requestId).toMatch(/^req_demo_[0-9a-f]{12}_[0-9a-f]+$/);
  // wait for the neighbor's confirmation and Dana's scripted approval
  await expect
    .poll(async () => (await (await request.get(`/api/requests/${run.requestId}`)).json()).approvals.length, { timeout: 15_000 })
    .toBe(1);
  // A browser can't use Dana's demo key: Dana is the script, the visitor is Marcus.
  const asDana = await request.post('/api/approvals', { data: { requestIds: [run.requestId], organizerId: 'org_dana', signer: { kind: 'demo_key' } } });
  expect(asDana.status()).toBe(403);
  // Concurrent taps all succeed with one batch.
  const taps = await Promise.all([1, 2, 3, 4, 5].map(() => request.post('/api/approvals', { data: { requestIds: [run.requestId], organizerId: 'org_marcus', signer: { kind: 'demo_key' } } })));
  expect(taps.map((t) => t.status())).toEqual([200, 200, 200, 200, 200]);
  const bodies = await Promise.all(taps.map((t) => t.json()));
  expect(new Set(bodies.map((b) => b.batchId)).size).toBe(1);
  expect(bodies[0]).toMatchObject({ count: 2, executed: true });
  expect(bodies[0].senderBatchId).toMatch(/^nl_[0-9a-f]{24}$/);
});

test('a request a visitor sends from /call is paid once they approve it as Marcus (Dana’s scripted key signs second)', async ({ request }) => {
  const { requestId } = await (await request.post('/api/intake/start', { data: { groupSlug: 'eastside', channel: 'web_text' } })).json();
  await request.post(`/api/intake/${requestId}/text`, { data: { text: 'Power is out since the storm, I need a space heater. We are 2 people. My Venmo is @e2e-second2' } });
  expect((await request.post(`/api/intake/${requestId}/confirm`, { data: { confirmed: true } })).status()).toBe(200);
  const tap = await request.post('/api/approvals', { data: { requestIds: [requestId], organizerId: 'org_marcus', signer: { kind: 'demo_key' } } });
  expect(await tap.json()).toMatchObject({ count: 1, executed: false });
  await expect
    .poll(async () => (await (await request.get(`/api/requests/${requestId}`)).json()).payout?.item?.status, { timeout: 30_000 })
    .toBe('SUCCESS');
  const view = await (await request.get(`/api/requests/${requestId}`)).json();
  expect(view.approvals.map((a: { organizerId: string }) => a.organizerId).sort()).toEqual(['org_dana', 'org_marcus']);
});

test('judges are isolated: another visitor cannot see, approve or reset my run', async ({ request, playwright, baseURL }) => {
  const run = await (await request.post('/api/demo/play', { data: { scenario: 'walter', mode: 'manual', speed: 20 } })).json();
  const other = await playwright.request.newContext({ baseURL });
  try {
    expect((await other.get(`/api/requests/${run.requestId}`)).status()).toBe(404);
    expect((await other.get(`/api/intake/${run.requestId}/thread`)).status()).toBe(404);
    const list = await (await other.get('/api/requests')).json();
    expect(list.some((v: { request: { id: string } }) => v.request.id === run.requestId)).toBe(false);
    const steal = await other.post('/api/approvals', { data: { requestIds: [run.requestId], organizerId: 'org_marcus', signer: { kind: 'demo_key' } } });
    expect(steal.status()).toBe(403);
    // the seeded queue is visible to anyone, but redacted
    const ana = await (await other.get('/api/requests/req_seed_q_ana')).json();
    expect(ana).toMatchObject({ redacted: true, request: { originalText: '', englishText: '' } });
    expect(ana.request.payoutDestination.value).toContain('•');
    // nobody resets the shared demo from the internet
    expect((await other.post('/api/demo/reset', { data: {} })).status()).toBe(401);
  } finally {
    await other.dispose();
  }
  expect((await request.get(`/api/requests/${run.requestId}`)).status()).toBe(200);
});

test('state-changing routes refuse cross-site and non-JSON requests', async ({ request }) => {
  const crossSite = await request.post('/api/demo/play', { data: { scenario: 'lan' }, headers: { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' } });
  expect(crossSite.status()).toBe(403);
  const plain = await request.post('/api/intake/start', { data: '{"groupSlug":"eastside","channel":"web_text"}', headers: { 'content-type': 'text/plain' } });
  expect(plain.status()).toBe(415);
  const page = await request.get('/');
  const h = page.headers();
  expect(h['content-security-policy']).toContain("frame-ancestors 'none'");
  expect(h['x-content-type-options']).toBe('nosniff');
  expect(h['referrer-policy']).toBe('strict-origin-when-cross-origin');
  expect(h['permissions-policy']).toContain('microphone=(self)');
});

test('pages run under the nonce CSP: no violations, and /donate still offers a PayPal button path', async ({ page }) => {
  const violations: string[] = [];
  page.on('console', (m) => {
    if (/Content Security Policy|Refused to (load|execute|apply|connect|frame)/i.test(m.text())) violations.push(m.text());
  });
  await page.goto('/donate');
  // fake mode, no client id: the labelled simulated button walks the same server path (Orders v2 create + capture)
  await expect(page.getByText('Sandbox not configured — simulated')).toBeVisible();
  await page.getByRole('button', { name: /^Give .*\(simulated\)$/ }).click();
  await expect(page.getByText(/thank/i).first()).toBeVisible();
  await page.goto('/demo?scenario=lan&speed=6');
  await expect(page.getByRole('button', { name: 'Play scenario' })).toBeEnabled();
  await page.goto('/organizer');
  await page.goto('/trust');
  await expect(page.getByText('This is everything the demo relaxes')).toBeVisible();
  expect(violations).toEqual([]);
});

test('an approval without a signature is refused', async ({ request }) => {
  const res = await request.post('/api/approvals', { data: { requestIds: ['req_seed_q_ana'], organizerId: 'org_dana', deviceLabel: 'no signature' } });
  expect(res.status()).toBe(400);
});

test('an organizer enrolls a passkey on /organizer and signs an approval with it', async ({ page }) => {
  await passkeyDevice(page);
  await page.goto('/organizer');
  await page.getByRole('button', { name: 'First time here? Set up a passkey' }).click();
  await page.getByRole('radio', { name: /Marcus/ }).check();
  // A real organizer seat needs an invite code, demo or not.
  await page.getByLabel('Invite code').fill(inviteCode('org_marcus'));
  await page.getByRole('button', { name: /Create passkey for Marcus/ }).click();
  await expect(page.getByText('Signed in as')).toBeVisible();
  // Ana has no approvals yet, so her card stays in the queue with Marcus's signature on it.
  const ana = page.getByRole('article', { name: /^Ana/ });
  await ana.getByRole('button', { name: /^Approve \$/ }).click();
  await expect(ana.getByText(/Signed with passkey · Marcus’s/)).toBeVisible();
  await expect(ana.getByText('You approved. Waiting for one more organizer.')).toBeVisible();
});
