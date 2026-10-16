import { expect, test } from '@playwright/test';

/**
 * Rules editor happy path: an organizer edits the plain-English rules, the (fixture) compiler drafts
 * them, Dana signs with a passkey on her device, Marcus signs with his demo key in another browser,
 * and Policy v2 is active. Runs after every other spec (project "rules" depends on them), because
 * activating a new policy re-prices the shared queue.
 */
test('plain English → draft → two organizers sign → Policy v2 is active', async ({ page, browser, baseURL }) => {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
  });

  // Dana sets up a passkey on her device.
  await page.goto('/organizer');
  await page.getByRole('button', { name: 'First time here? Set up a passkey' }).click();
  await page.getByRole('radio', { name: /Dana/ }).check();
  await page.getByRole('button', { name: /Create passkey for Dana/ }).click();
  await expect(page.getByText('Signed in as')).toBeVisible();

  // She adds a rule in plain English and drafts it.
  await page.goto('/organizer/rules');
  await expect(page.getByText(/Policy v1/).first()).toBeVisible();
  const box = page.locator('#rules-text');
  const text = await box.inputValue();
  await box.fill(text.replace('- Anything else:', '- Baby supplies (diapers, formula, wipes): up to $80 per request, $160 per household in 30 days.\n- Anything else:'));
  await page.getByRole('button', { name: 'Draft policy' }).click();
  await expect(page.getByRole('heading', { name: 'Review draft v2' })).toBeVisible();
  await expect(page.getByText('Added Baby supplies: up to $80 per request, $160 per household in 30 days')).toBeVisible();
  await expect(page.getByText('Baby supplies (diapers, formula, wipes): up to $80 per request, $160 per household in 30 days.', { exact: true }).last()).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Requests waiting now' })).toBeVisible();

  // Dana signs with her passkey: one signature is not enough.
  await page.getByRole('button', { name: 'Sign Policy v2 as Dana' }).click();
  await expect(page.getByText('Dana signed')).toBeVisible();
  await expect(page.getByText('Passkey on', { exact: false })).toBeVisible();
  expect((await (await page.request.get('/api/group')).json()).policy.version).toBe(1);

  // Marcus, on another device, signs with his demo key: the draft becomes Policy v2.
  const other = await browser.newContext({ baseURL });
  const marcus = await other.newPage();
  await marcus.goto('/organizer/rules');
  await expect(marcus.getByText('Dana signed')).toBeVisible();
  await marcus.getByRole('combobox').selectOption({ label: 'Marcus’s demo key' });
  await marcus.getByRole('button', { name: 'Sign as Marcus' }).click();
  await expect(marcus.getByText('Policy v2 is now active.')).toBeVisible();
  await other.close();

  expect((await (await page.request.get('/api/group')).json()).policy.version).toBe(2);
  await page.goto('/organizer');
  await expect(page.getByText(/Amounts come from Policy v2/)).toBeVisible();
});
