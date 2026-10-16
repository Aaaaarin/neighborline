import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test('a neighbor without a microphone can send a sample voice note and confirm it', async ({ page }) => {
  await page.goto('/call');
  await page.getByText('No microphone? Use a sample voice note').click();
  await page.getByRole('button', { name: /Tiếng Việt · Mrs\. Lan/ }).click();
  await expect(page.getByText(/Đây là những gì chúng tôi hiểu/)).toBeVisible();
  await page.getByRole('button', { name: 'Đúng rồi' }).click();
  await expect(page.getByText(/Hai tình nguyện viên đang xem yêu cầu/)).toBeVisible();
  const width = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(width).toBeLessThanOrEqual(0);
});

test('a typed request in Chinese gets one question in Chinese, the neighbor answers, and it is filed — even after a refresh', async ({ page }) => {
  await page.goto('/call');
  await page.getByRole('button', { name: 'Type instead' }).click();
  await page.locator('#say').fill('我家停电两天了，需要买一个取暖器。我们家有三口人。');
  await page.getByRole('button', { name: 'Send' }).click();

  const question = page.getByRole('log').getByText(/钱应该汇到哪里？/);
  await expect(question).toBeVisible();
  await expect(page.getByText(/sample transcript stands in/)).toHaveCount(0);

  await page.reload();
  await expect(question).toBeVisible();

  await page.getByRole('textbox', { name: /钱应该汇到哪里/ }).fill('Venmo @wang-li88');
  await page.getByRole('button', { name: '发送' }).click();
  await expect(page.getByText(/钱将汇到您的 Venmo：@wang-li88/)).toBeVisible();
  await page.getByRole('button', { name: '对，没错' }).click();
  await expect(page.getByText(/两位志愿者正在查看您的申请/)).toBeVisible();
  await expect(page.getByRole('list', { name: 'Status' })).toBeVisible();
});

test('category quick answers let a neighbor finish without knowing the categories', async ({ page }) => {
  await page.goto('/call');
  await page.getByRole('combobox').selectOption('ar');
  await page.getByRole('button', { name: 'أفضّل الكتابة' }).click();
  await page.locator('#say').fill('أحتاج إلى مساعدة من فضلك. حسابي في Venmo هو @samira-h7');
  await page.getByRole('button', { name: 'أرسل' }).click();
  await page.getByRole('button', { name: 'مواد غذائية' }).click();
  await expect(page.getByRole('button', { name: 'نعم، هذا صحيح' })).toBeVisible();
  await page.getByRole('button', { name: 'نعم، هذا صحيح' }).click();
  await expect(page.getByRole('list', { name: 'Status' })).toBeVisible();
});

test('more than 2,000 characters: a translated error, nothing lost, and the neighbor can recover', async ({ page }) => {
  await page.goto('/call');
  await page.getByRole('combobox').selectOption('es');
  await page.getByRole('button', { name: 'Escribir' }).click();
  const box = page.locator('#say');
  await expect(box).toHaveAttribute('maxlength', '2000');
  // A paste in a browser that ignores maxlength.
  await box.evaluate((el) => el.removeAttribute('maxlength'));
  await box.fill('a'.repeat(2100));
  await page.getByRole('button', { name: 'Enviar' }).click();
  await expect(page.getByText(/Son más de 2.000 caracteres/)).toBeVisible();
  await expect(box).toHaveValue('a'.repeat(2100));
  await box.fill('Se fue la luz por la tormenta y necesito un calentador. Somos 3. Mi Venmo es @ana-recover1');
  await page.getByRole('button', { name: 'Enviar' }).click();
  await expect(page.getByRole('button', { name: 'Sí, correcto' })).toBeVisible();
});

test('decline is idempotent, and REVIEW sends it back to a different organizer with the first reason', async ({ page }) => {
  // File a request as this visitor, then decline it twice (a double tap and a second organizer).
  const { requestId } = await (await page.request.post('/api/intake/start', { data: { groupSlug: 'eastside', channel: 'web_text' } })).json();
  await page.request.post(`/api/intake/${requestId}/text`, { data: { text: 'Power is out since the storm, I need a heater. We are 2 people. My Venmo is @appeal-e2e1' } });
  await page.request.post(`/api/intake/${requestId}/confirm`, { data: { confirmed: true } });
  const decline = (organizerId: string, reasonCode: string) => page.request.post(`/api/requests/${requestId}/decline`, { data: { organizerId, reasonCode } });
  const [a, b] = await Promise.all([decline('org_dana', 'other'), decline('org_dana', 'other')]);
  expect(a.status()).toBe(200);
  expect(b.status()).toBe(200);
  const first = await a.json();
  expect(first.message.textEn).not.toMatch(/note/i);

  await page.addInitScript((id) => sessionStorage.setItem('neighborline.call.v1', JSON.stringify({ requestId: id })), requestId);
  await page.goto('/call');
  await expect(page.getByText(/We can’t send money this time/)).toHaveCount(1);
  await page.getByRole('button', { name: 'REVIEW' }).click();
  await expect(page.getByText(/A different organizer will look at your request again/)).toBeVisible();

  const view = await (await page.request.get(`/api/requests/${requestId}`)).json();
  expect(view.request.status).toBe('awaiting_approval');
  expect(view.appeal.firstDecline).toMatchObject({ organizerId: 'org_dana', reasonCode: 'other' });
  expect((await decline('org_dana', 'other')).status()).toBe(409);
  expect((await decline('org_marcus', 'not_covered')).status()).toBe(200);
  await expect(page.getByText(/A second organizer looked at your request again/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'REVIEW' })).toHaveCount(0);
});

for (const path of ['/report', '/ledger', '/call', '/demo']) {
  test(`no serious accessibility violations on ${path} at phone width`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(path);
    await page.waitForTimeout(500);
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    const serious = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    expect(serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 3).join(' | ')}`)).toEqual([]);
  });
}
