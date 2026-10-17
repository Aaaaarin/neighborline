import { expect, test } from '@playwright/test';

/**
 * QA-2 P2-3: PayPal refuses the batch at the account level (a restricted sponsor account, injected on
 * the fake with /__fake/faults). The /demo stage must stop the clock and say so, not "send" forever.
 * Runs in its own Playwright project after every other test: the fault fails the next payouts call.
 */
const FAKE = process.env.E2E_FAKE_PAYPAL_URL;

test.describe('/demo when PayPal refuses the payout (FAILED_RAIL)', () => {
  test.skip(!FAKE, 'needs the fake PayPal control plane (not available against BASE_URL)');

  test('the clock stops, the rail and both phones say no money moved, Lan is told in Vietnamese', async ({ page }) => {
    await page.goto('/demo?scenario=lan&speed=6');
    await page.getByRole('button', { name: 'Play scenario' }).click();
    // The run's only payouts call is the batch after the second approval (several seconds away).
    const res = await fetch(`${FAKE}/__fake/faults`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pathPrefix: '/v1/payments/payouts', status: 422, count: 1, name: 'SENDER_RESTRICTED' }),
    });
    expect(res.ok).toBe(true);

    const rail = page.getByRole('list', { name: 'PayPal rail events' });
    await expect(rail.getByText('Approval 2 of 2 · Marcus')).toBeVisible();
    await expect(rail.getByText('PayPal refused this payout')).toBeVisible();
    await expect(rail.getByText('The sponsor’s account needs attention (SENDER_RESTRICTED). No money moved.')).toBeVisible();
    await expect(rail.getByText('Organizers alerted')).toBeVisible();
    await expect(rail.getByText(/told in Vietnamese$/)).toBeVisible();
    await expect(rail.getByText('Item SUCCESS', { exact: false })).toHaveCount(0);
    await expect(rail.locator('[data-state="active"]')).toHaveCount(0);

    await expect(page.getByText('Stopped · PayPal refused the payout')).toBeVisible();
    await expect(page.getByTestId('rail-refused')).toHaveText(
      'PayPal refused this payout: the sponsor’s account needs attention. No money moved. Organizers were alerted; they can record a hand-over instead.',
    );

    // The neighbor gets a neutral note in her language; nobody tells her money is on the way.
    const lan = page.getByRole('region', { name: 'Mrs. Lan’s phone' });
    await expect(lan.getByText(/hiện giờ PayPal chưa gửi được tiền/)).toBeVisible();
    await expect(lan.getByText(/đã gửi \$150/i)).toHaveCount(0);

    // Both organizer phones show the refusal instead of "Sending … through PayPal".
    for (const name of ['Dana’s phone, organizer', 'Marcus’s phone, organizer']) {
      const phone = page.getByRole('region', { name });
      await expect(phone.getByText('PayPal refused this payout:')).toBeVisible();
      await expect(phone.getByText(/Sending \$150 through PayPal/)).toHaveCount(0);
    }

    // The stopwatch is stopped in the refused state: same value a second later.
    const timer = page.getByRole('timer').last();
    await expect(timer).toHaveAttribute('data-clock', 'refused');
    const first = await timer.textContent();
    await page.waitForTimeout(1000);
    await expect(timer).toHaveText(first!);
  });
});
