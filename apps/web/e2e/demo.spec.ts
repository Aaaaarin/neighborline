import { expect, test } from '@playwright/test';

// speed=6 compresses the ~30 s scripted pacing; the code path is identical.
test.describe('/demo stage (mock mode)', () => {
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
    await expect(page.getByText('Stopped when PayPal reported SUCCESS · Venmo')).toBeVisible();

    // The stopwatch froze: same value a second later.
    const timer = page.getByRole('timer').last();
    const first = await timer.textContent();
    await page.waitForTimeout(1000);
    await expect(timer).toHaveText(first!);
    expect(first).toMatch(/^0:\d{2}\.\d$/);
  });

  test('a visitor can play the second organizer', async ({ page }) => {
    await page.goto('/demo?scenario=lan&mode=manual&speed=6');
    await page.getByRole('button', { name: 'Play scenario' }).click();

    await expect(page.getByText('Your turn')).toBeVisible();
    const marcus = page.getByRole('region', { name: 'Marcus’s phone, organizer' });
    await marcus.getByRole('button', { name: 'Approve $150' }).click();

    await expect(page.getByRole('list', { name: 'PayPal rail events' }).getByText('Item SUCCESS · money landed')).toBeVisible();
    await expect(marcus.getByText('$150 landed')).toBeVisible();
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
  const again = await (await request.post('/api/approvals', { data: { requestIds: [run.requestId], organizerId: 'org_dana', deviceLabel: 'test' } })).json();
  expect(again).toMatchObject({ count: 1, executed: false });
  const second = await (await request.post('/api/approvals', { data: { requestIds: [run.requestId], organizerId: 'org_marcus', deviceLabel: 'test' } })).json();
  expect(second).toMatchObject({ count: 2, executed: true });
  expect(second.senderBatchId).toMatch(/^nl_[0-9a-f]{24}$/);
  const third = await (await request.post('/api/approvals', { data: { requestIds: [run.requestId], organizerId: 'org_marcus', deviceLabel: 'test' } })).json();
  expect(third.batchId).toBe(second.batchId);
});
