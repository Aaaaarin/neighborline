import { expect, test, type Page } from '@playwright/test';

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
    await marcus.getByRole('button', { name: 'Approve $150' }).click();
    await marcus.getByRole('button', { name: 'Approve with Marcus’s demo key' }).click();

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
});

test('approvals are idempotent and need two different organizers', async ({ request }) => {
  const run = await (await request.post('/api/demo/play', { data: { scenario: 'jean', mode: 'manual', speed: 20 } })).json();
  // wait for the neighbor's confirmation and Dana's scripted approval
  await expect
    .poll(async () => (await (await request.get(`/api/requests/${run.requestId}`)).json()).approvals.length, { timeout: 15_000 })
    .toBe(1);
  const again = await (await request.post('/api/approvals', { data: { requestIds: [run.requestId], organizerId: 'org_dana', signer: { kind: 'demo_key' } } })).json();
  expect(again).toMatchObject({ count: 1, executed: false });
  const second = await (await request.post('/api/approvals', { data: { requestIds: [run.requestId], organizerId: 'org_marcus', signer: { kind: 'demo_key' } } })).json();
  expect(second).toMatchObject({ count: 2, executed: true });
  expect(second.senderBatchId).toMatch(/^nl_[0-9a-f]{24}$/);
  const third = await (await request.post('/api/approvals', { data: { requestIds: [run.requestId], organizerId: 'org_marcus', signer: { kind: 'demo_key' } } })).json();
  expect(third.batchId).toBe(second.batchId);
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
  await page.getByRole('button', { name: /Create passkey for Marcus/ }).click();
  await expect(page.getByText('Signed in as')).toBeVisible();
  // Ana has no approvals yet, so her card stays in the queue with Marcus's signature on it.
  const ana = page.getByRole('article', { name: /^Ana/ });
  await ana.getByRole('button', { name: /^Approve \$/ }).click();
  await expect(ana.getByText(/Signed with passkey · Marcus’s/)).toBeVisible();
  await expect(ana.getByText('You approved. Waiting for one more organizer.')).toBeVisible();
});
