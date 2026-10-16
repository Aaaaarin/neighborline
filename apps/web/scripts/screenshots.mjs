// Regenerates apps/web/screenshots/*.png against a running server (default http://localhost:3000).
// Usage: BASE_URL=http://localhost:3100 PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node scripts/screenshots.mjs [name-filter]
// Every /demo run is played at real pace (speed=1), so the stopwatch and its people/system split are
// what a judge would see. Passkey shots use Chromium's virtual WebAuthn authenticator (CDP).
import { mkdirSync } from 'node:fs';
import { chromium } from '@playwright/test';

const base = process.env.BASE_URL ?? 'http://localhost:3000';
const out = process.env.SHOTS_DIR ? process.env.SHOTS_DIR.replace(/\/?$/, '/') : new URL('../screenshots/', import.meta.url).pathname;
const only = process.argv[2] ? new RegExp(process.argv[2]) : null;
const CONCURRENCY = Number(process.env.SHOTS_CONCURRENCY ?? 4);
mkdirSync(out, { recursive: true });

const DESKTOP = { width: 1920, height: 1080 };
const PHONE = { width: 390, height: 844 };

/** Wait until the stage stopwatch stops (paid or blocked), up to `ms`. */
const untilStopped = (ms) => async (page) => {
  await page.waitForFunction(() => /Stopped/.test(document.body.innerText), null, { timeout: ms });
  await page.waitForTimeout(1200);
};

/** A device with a platform passkey (virtual authenticator, user verification on). */
async function withPasskeyDevice(page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
  });
}

const PAID = { lan: 60_000, rosa: 90_000, jean: 60_000, walter: 60_000, blocked: 20_000 };
const scenarioShots = Object.keys(PAID).flatMap((sc) => [
  { name: `demo-1920-${sc}-done`, path: `/demo?scenario=${sc}&speed=1&autoplay=1`, vp: DESKTOP, run: untilStopped(PAID[sc]) },
  { name: `demo-390-${sc}-done`, path: `/demo?scenario=${sc}&speed=1&autoplay=1`, vp: PHONE, run: untilStopped(PAID[sc]) },
]);

const shots = [
  // /demo — the stage
  { name: 'demo-1920-idle', path: '/demo', vp: DESKTOP },
  { name: 'demo-1920-lan-readback', path: '/demo?scenario=lan&speed=1&autoplay=1', vp: DESKTOP, wait: 6500 },
  { name: 'demo-1920-lan-your-turn', path: '/demo?scenario=lan&mode=manual&speed=1&autoplay=1', vp: DESKTOP, run: (p) => p.getByText('Your turn').waitFor({ timeout: 40_000 }).then(() => p.waitForTimeout(800)) },
  {
    name: 'demo-1920-lan-visitor-passkey',
    path: '/demo?scenario=lan&mode=manual&speed=1&autoplay=1',
    vp: DESKTOP,
    before: withPasskeyDevice,
    run: async (p) => {
      await p.getByText('Your turn').waitFor({ timeout: 40_000 });
      await p.locator('#panel-organizers').getByRole('button', { name: /^Approve \$/ }).last().click();
      await untilStopped(40_000)(p);
    },
  },
  { name: 'demo-1920-lan-done-dark', path: '/demo?scenario=lan&speed=1&autoplay=1', vp: DESKTOP, dark: true, run: untilStopped(60_000) },
  { name: 'demo-1280-lan-done', path: '/demo?scenario=lan&speed=1&autoplay=1', vp: { width: 1280, height: 800 }, full: true, run: untilStopped(60_000) },
  ...scenarioShots,
  // other pages
  ...['', 'call', 'organizer', 'donate', 'report', 'trust', 'ledger'].flatMap((p) => [
    { name: `${p || 'home'}-1920`, path: `/${p}`, vp: DESKTOP, full: true },
    { name: `${p || 'home'}-390`, path: `/${p}`, vp: PHONE, full: p !== 'call' },
  ]),
  { name: 'call-390-readback', path: '/call', vp: PHONE, click: ['No microphone? Use a sample', 'Español · Rosa'], wait: 1500 },
  {
    name: 'call-390-arabic-rtl',
    path: '/call',
    vp: PHONE,
    run: async (p) => {
      await p.locator('select').first().selectOption('ar');
      await p.getByRole('button', { name: 'أفضّل الكتابة' }).click();
      await p.locator('textarea').fill('انقطعت الكهرباء منذ يومين وأحتاج إلى مدفأة. نحن أربعة في البيت. حسابي في فينمو @samira-haddad');
      await p.getByRole('button', { name: 'أرسل' }).click();
      await p.waitForTimeout(2500);
    },
  },
  { name: 'organizer-390-setup', path: '/organizer', vp: PHONE, full: true, click: ['First time here? Set up a passkey'] },
  {
    name: 'organizer-390-passkey-approved',
    path: '/organizer',
    vp: PHONE,
    full: true,
    before: withPasskeyDevice,
    run: async (p) => {
      await p.getByRole('button', { name: 'First time here? Set up a passkey' }).click();
      await p.getByRole('radio', { name: /Marcus/ }).check();
      await p.getByRole('button', { name: /Create passkey for Marcus/ }).click();
      await p.getByText('Signed in as').waitFor({ timeout: 15_000 });
      await p.getByRole('article').filter({ hasText: 'Ana' }).getByRole('button', { name: /^Approve \$/ }).click();
      await p.getByText(/Signed with passkey/).first().waitFor({ timeout: 20_000 });
      await p.waitForTimeout(1500);
    },
  },
  { name: 'home-1920-dark', path: '/', vp: DESKTOP, dark: true },
].filter((s) => !only || only.test(s.name));

const browser = await chromium.launch();
async function take(s) {
  const ctx = await browser.newContext({ viewport: s.vp, colorScheme: s.dark ? 'dark' : 'light', deviceScaleFactor: s.vp.width < 500 ? 2 : 1 });
  const page = await ctx.newPage();
  try {
    if (s.before) await s.before(page);
    await page.goto(base + s.path, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(700);
    for (const t of s.click ?? []) {
      await page.locator(':visible', { hasText: t }).last().click();
      await page.waitForTimeout(300);
    }
    if (s.run) await s.run(page);
    if (s.wait) await page.waitForTimeout(s.wait);
    await page.screenshot({ path: `${out}${s.name}.png`, fullPage: !!s.full });
    console.log('saved', s.name);
  } catch (err) {
    console.error('FAILED', s.name, err instanceof Error ? err.message.split('\n')[0] : err);
    process.exitCode = 1;
  } finally {
    await ctx.close();
  }
}
const queue = [...shots];
await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
  for (let s = queue.shift(); s; s = queue.shift()) await take(s);
}));
await browser.close();
