// Regenerates apps/web/screenshots/*.png against a running server (default http://localhost:3000).
// Usage: BASE_URL=http://localhost:3100 PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node scripts/screenshots.mjs [name-filter]
// Every /demo run is played at real pace (speed=1), so the stopwatch and its people/system split are
// what a judge would see. Passkey shots use Chromium's virtual WebAuthn authenticator (CDP).
import { createHmac } from 'node:crypto';
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
  await page.waitForFunction(() => /Stopped/.test(document.body.textContent ?? ''), null, { timeout: ms });
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

/** A Spanish request this visitor filed and an organizer declined; /call opens on that thread. */
async function declinedRequest(page) {
  const api = page.request;
  const { requestId } = await (await api.post(`${base}/api/intake/start`, { data: { groupSlug: 'eastside', channel: 'web_text', lang: 'es' } })).json();
  await api.post(`${base}/api/intake/${requestId}/text`, { data: { text: 'Se fue la luz por la tormenta y necesito un calentador. Somos 3. Mi Venmo es @lucia-ramos4', lang: 'es' } });
  await api.post(`${base}/api/intake/${requestId}/confirm`, { data: { confirmed: true } });
  await api.post(`${base}/api/requests/${requestId}/decline`, { data: { organizerId: 'org_dana', reasonCode: 'outside_area' } });
  await page.addInitScript((id) => sessionStorage.setItem('neighborline.call.v1', JSON.stringify({ requestId: id })), requestId);
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
  {
    name: 'call-390-question',
    path: '/call',
    vp: PHONE,
    run: async (p) => {
      await p.getByRole('button', { name: 'Type instead' }).click();
      await p.locator('textarea').fill('我家停电两天了，需要买一个取暖器。我们家有三口人。');
      await p.getByRole('button', { name: 'Send' }).click();
      await p.getByRole('log').getByText(/钱应该汇到哪里/).waitFor({ timeout: 15_000 });
      await p.waitForTimeout(800);
    },
  },
  {
    name: 'call-390-household',
    path: '/call',
    vp: PHONE,
    run: async (p) => {
      await p.locator('select').first().selectOption('es');
      await p.getByRole('button', { name: 'Escribir' }).click();
      await p.locator('textarea').fill('Se fue la luz por la tormenta y necesito un calentador. Mi Venmo es @ana-flores9');
      await p.getByRole('button', { name: 'Enviar' }).click();
      await p.getByRole('button', { name: 'Sí, correcto' }).waitFor({ timeout: 15_000 });
      await p.waitForTimeout(800);
    },
  },
  { name: 'call-390-appeal', path: '/call', vp: PHONE, before: declinedRequest, run: (p) => p.getByRole('button', { name: 'REVISAR' }).waitFor({ timeout: 15_000 }).then(() => p.waitForTimeout(600)) },
  {
    name: 'organizer-390-appeal',
    path: '/call',
    vp: PHONE,
    before: declinedRequest,
    run: async (p) => {
      await p.getByRole('button', { name: 'REVISAR' }).click();
      await p.getByText(/Otra persona del grupo revisará su solicitud/).waitFor({ timeout: 15_000 });
      await p.goto(base + '/organizer');
      await p.getByText(/asked for another look/).first().evaluate((el) => el.closest('article')?.scrollIntoView({ block: 'start' }));
      await p.waitForTimeout(800);
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
      await p.getByRole('article', { name: /^Ana/ }).getByRole('button', { name: /^Approve \$/ }).click();
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

/* ---------- serial: flows that change server state (rules editor, alerts), each on a fresh demo ---------- */

const resetDemo = () => fetch(`${base}/api/demo/reset`, { method: 'POST' });

/** Raise the two organizer alerts the scheduled jobs raise (needs NEIGHBORLINE_INTERNAL_SECRET of the server). */
async function raiseAlerts() {
  const secret = process.env.NEIGHBORLINE_INTERNAL_SECRET;
  if (!secret) return false;
  const ledger = await (await fetch(`${base}/api/ledger`)).json();
  const unclaimed = ledger.rows.find((r) => r.status === 'UNCLAIMED') ?? ledger.rows[0];
  const other = ledger.rows.find((r) => r.status === 'SUCCESS' && r.itemId !== unclaimed.itemId);
  const post = async (path, body) => {
    const raw = JSON.stringify(body);
    const ts = String(Math.floor(Date.now() / 1000));
    const sig = 'v1=' + createHmac('sha256', secret).update(`${ts}.POST.${path}.${raw}`).digest('hex');
    await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-neighborline-timestamp': ts, 'x-neighborline-signature': sig }, body: raw });
  };
  await post('/api/internal/organizer-alert', {
    kind: 'unclaimed_day25', idempotencyKey: `day25:${unclaimed.itemId}`, itemIds: [unclaimed.itemId],
    summary: `A ${unclaimed.categoryLabel.toLowerCase()} payout of $${(unclaimed.amountCents / 100).toFixed(0)} to ${unclaimed.receiverMasked} has not been claimed for 25 days.`,
    deadline: new Date(Date.now() + 5 * 86_400_000).toISOString(),
  });
  await post('/api/internal/organizer-alert', {
    kind: 'reconcile_mismatch', idempotencyKey: `mismatch:${other.itemId}`, itemIds: [other.itemId],
    summary: `Transaction Search shows a different amount for one payout of $${(other.amountCents / 100).toFixed(0)} (${other.requestRef}).`,
  });
  return true;
}

const RULES_EDIT = (t) =>
  t.replace('up to $150 per request, at most $300', 'up to $120 per request, at most $300')
    .replace('- Anything else:', '- Baby supplies (diapers, formula, wipes): up to $80 per request, $160 per household in 30 days.\n- Anything else:');

/** /organizer/rules: draft → one signature → second signature (activated), at one viewport. */
async function rulesFlow(tag, vp) {
  const ctx = await browser.newContext({ viewport: vp, deviceScaleFactor: vp.width < 500 ? 2 : 1 });
  const p = await ctx.newPage();
  const shot = async (name, full = true) => {
    await p.waitForTimeout(500);
    await p.screenshot({ path: `${out}${name}.png`, fullPage: full });
    console.log('saved', name);
  };
  try {
    await p.goto(`${base}/organizer/rules`, { waitUntil: 'load' });
    await p.evaluate(() => document.fonts.ready);
    await shot(`rules-${tag}`, false);
    const box = p.locator('#rules-text');
    await box.fill(RULES_EDIT(await box.inputValue()));
    await p.getByRole('button', { name: /Draft policy|Draft again/ }).click();
    await p.getByRole('heading', { name: /Review draft v2/ }).waitFor({ timeout: 20_000 });
    await p.getByRole('button', { name: 'Show line 7 of the rules' }).first().hover();
    await shot(`rules-${tag}-draft`);
    const pick = async (name) => {
      await p.getByRole('combobox').selectOption({ label: `${name}’s demo key` });
      await p.getByRole('button', { name: `Sign as ${name}` }).click();
    };
    await pick('Dana');
    await p.getByText('Dana signed').waitFor({ timeout: 15_000 });
    await p.getByText('Dana signed').scrollIntoViewIfNeeded();
    await shot(`rules-${tag}-one-signature`, false);
    await pick('Marcus');
    await p.getByText(/Policy v2 is now active/).waitFor({ timeout: 20_000 });
    await p.evaluate(() => window.scrollTo(0, 0));
    await shot(`rules-${tag}-activated`, false);
  } catch (err) {
    console.error('FAILED', `rules-${tag}`, err instanceof Error ? err.message.split('\n')[0] : err);
    process.exitCode = 1;
  } finally {
    await ctx.close();
  }
}

const serial = [
  { name: 'rules-1920', run: () => rulesFlow('1920', DESKTOP) },
  { name: 'rules-390', run: () => rulesFlow('390', PHONE) },
  {
    name: 'alerts',
    run: async () => {
      if (!(await raiseAlerts())) return console.log('skipped alerts (set NEIGHBORLINE_INTERNAL_SECRET to the server’s)');
      for (const s of [
        { name: 'organizer-1920-alerts', path: '/organizer', vp: DESKTOP, full: true },
        { name: 'organizer-390-alerts', path: '/organizer', vp: PHONE },
        { name: 'ledger-1920-alerts', path: '/ledger', vp: DESKTOP },
        { name: 'ledger-390-alerts', path: '/ledger', vp: PHONE },
      ]) await take(s);
    },
  },
  {
    name: 'organizer-390-devices',
    run: () =>
      take({
        name: 'organizer-390-devices',
        path: '/organizer',
        vp: PHONE,
        before: withPasskeyDevice,
        run: async (p) => {
          await p.getByRole('button', { name: 'First time here? Set up a passkey' }).click();
          await p.getByRole('radio', { name: /Dana/ }).check();
          await p.getByRole('button', { name: /Create passkey for Dana/ }).click();
          await p.getByText('Signed in as').waitFor({ timeout: 15_000 });
          await p.getByText('Devices that can sign').click();
          await p.getByRole('button', { name: 'Revoke', exact: true }).first().click();
          await p.getByRole('button', { name: /^Revoke Dana/ }).scrollIntoViewIfNeeded();
        },
      }),
  },
].filter((s) => !only || only.test(s.name));
for (const s of serial) {
  await resetDemo();
  await s.run();
}
if (serial.length) await resetDemo();
await browser.close();
