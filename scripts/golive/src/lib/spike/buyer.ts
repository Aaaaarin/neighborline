/**
 * Approve a sandbox checkout as the developer's own sandbox buyer test account (SANDBOX_BUYER_EMAIL/PASSWORD), with
 * Playwright from apps/web. Optional: without it the spike records the approve link instead. Screenshots of each stage
 * go to golive-out/spike/ so a changed PayPal page is easy to diagnose. Never used against live PayPal (the step
 * refuses a non-sandbox approve URL).
 */
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { RETURN_URL, type Approver } from './orders.js';

type PwPage = {
  goto(url: string, o?: object): Promise<unknown>;
  locator(sel: string): { first(): PwLoc };
  getByRole(role: string, o: { name: RegExp }): { first(): PwLoc };
  waitForURL(fn: (u: URL) => boolean, o?: object): Promise<void>;
  url(): string;
  screenshot(o: { path: string; fullPage?: boolean }): Promise<unknown>;
};
type PwLoc = { isVisible(o?: object): Promise<boolean>; fill(v: string): Promise<void>; click(o?: object): Promise<void>; waitFor(o?: object): Promise<void> };

export function playwrightAvailable(repo: string): string | null {
  const req = createRequire(join(repo, 'apps/web/package.json'));
  for (const name of ['playwright', '@playwright/test']) {
    try {
      return req.resolve(name);
    } catch {
      /* try the next */
    }
  }
  return null;
}

async function firstVisible(page: PwPage, selectors: string[], timeoutMs: number): Promise<PwLoc | null> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    for (const s of selectors) {
      const loc = page.locator(s).first();
      if (await loc.isVisible().catch(() => false)) return loc;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return null;
}

export function playwrightApprover(opts: { repo: string; email: string; password: string; shotsDir: string; headless?: boolean; timeoutMs?: number }): Approver {
  return async (approveUrl) => {
    if (!/sandbox\.paypal\.com/i.test(new URL(approveUrl).host)) return { ok: false, note: `refusing to log in on ${new URL(approveUrl).host} (not the PayPal sandbox)` };
    const mod = playwrightAvailable(opts.repo);
    if (!mod) return { ok: false, note: 'playwright is not installed in apps/web' };
    const pw = (await import(mod)) as { chromium: { launch(o: object): Promise<{ newPage(): Promise<PwPage>; close(): Promise<void> }> } };
    process.env.PLAYWRIGHT_BROWSERS_PATH ??= '/opt/pw-browsers';
    const browser = await pw.chromium.launch({ headless: opts.headless ?? true });
    const shot = async (page: PwPage, name: string) => page.screenshot({ path: join(opts.shotsDir, `buyer-${name}.png`), fullPage: true }).catch(() => undefined);
    const timeout = opts.timeoutMs ?? 90_000;
    try {
      const page = await browser.newPage();
      await page.goto(approveUrl, { waitUntil: 'domcontentloaded', timeout });
      // Some sandbox flows show a guest-checkout page first: go to "Log in".
      const login = await firstVisible(page, ['a:has-text("Log In")', 'button:has-text("Log In")', '#loginSection a', '#email'], 30_000);
      if (login && !(await page.locator('#email').first().isVisible().catch(() => false))) await login.click();
      const email = await firstVisible(page, ['#email', 'input[name="login_email"]'], 30_000);
      if (!email) return await shot(page, '1-no-email').then(() => ({ ok: false, note: `no email field on ${page.url()}` }));
      await email.fill(opts.email);
      const next = await firstVisible(page, ['#btnNext', 'button:has-text("Next")'], 3_000);
      if (next) await next.click();
      const pwd = await firstVisible(page, ['#password', 'input[name="login_password"]'], 30_000);
      if (!pwd) return await shot(page, '2-no-password').then(() => ({ ok: false, note: `no password field on ${page.url()}` }));
      await pwd.fill(opts.password);
      const loginBtn = await firstVisible(page, ['#btnLogin', 'button:has-text("Log In")'], 10_000);
      if (!loginBtn) return await shot(page, '3-no-login').then(() => ({ ok: false, note: 'no Log In button' }));
      await loginBtn.click();
      await shot(page, '4-after-login');
      const pay = await firstVisible(page, ['#payment-submit-btn', 'button[data-testid="submit-button-initial"]', 'button:has-text("Complete Purchase")', 'button:has-text("Pay Now")', 'button:has-text("Continue to Review Order")', 'button:has-text("Continue")', 'button:has-text("Agree")'], 60_000);
      if (!pay) return await shot(page, '5-no-pay-button').then(() => ({ ok: false, note: `no pay/continue button on ${page.url()}` }));
      await pay.click();
      await page.waitForURL((u) => u.href.startsWith(RETURN_URL), { timeout });
      await shot(page, '6-returned');
      return { ok: true, note: 'approved by the sandbox buyer on PayPal\'s sandbox checkout' };
    } catch (err) {
      return { ok: false, note: `playwright: ${(err as Error).message.split('\n')[0]}` };
    } finally {
      await browser.close().catch(() => undefined);
    }
  };
}
