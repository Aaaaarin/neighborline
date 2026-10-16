import { expect, test } from '@playwright/test';

test('a neighbor without a microphone can send a sample voice note and confirm it', async ({ page }) => {
  await page.goto('/call');
  await page.getByText('No microphone? Use a sample voice note').click();
  await page.getByRole('button', { name: /Tiếng Việt · Mrs\. Lan/ }).click();
  await expect(page.getByText(/Cô Lan ơi, Neighborline đọc lại/)).toBeVisible();
  await page.getByRole('button', { name: 'Đúng rồi' }).click();
  await expect(page.getByText(/Hai người trong nhóm đang xem yêu cầu/)).toBeVisible();
  const width = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(width).toBeLessThanOrEqual(0);
});
