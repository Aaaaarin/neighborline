// Regenerates apps/web/screenshots/*.png against a running server (default http://localhost:3000).
// Usage: BASE_URL=http://localhost:3100 PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node scripts/screenshots.mjs [name-filter]
// Organizer passkey shots make single-use invite codes with scripts/organizer-invite.ts, so they need the
// server's DATABASE_URL (or DEV_DB_PORT for `pnpm dev`'s database); alert shots its
// NEIGHBORLINE_INTERNAL_SECRET; the payout-rail shots FAKE_PAYPAL_URL (the fake PayPal's control plane).
// Every /demo run is played at real pace (speed=1), so the stopwatch and its people/system split are
// what a judge would see. Passkey shots use Chromium's virtual WebAuthn authenticator (CDP).
import { execFileSync } from 'node:child_process';
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

/** A fresh single-use invite code from the operator CLI, in the server's database. */
function newInviteCode(organizerId) {
  return execFileSync('pnpm', ['-s', 'exec', 'tsx', 'scripts/organizer-invite.ts', organizerId, '--ttl', '1h'], {
    cwd: new URL('..', import.meta.url).pathname,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  }).trim();
}

/** Enroll a passkey for an organizer seat on /organizer. Real seats need an invite code, demo or not. */
async function enroll(p, name, organizerId) {
  await p.getByRole('button', { name: 'First time here? Set up a passkey' }).click();
  await p.getByRole('radio', { name: new RegExp(name) }).check();
  await p.getByLabel('Invite code').fill(newInviteCode(organizerId));
  await p.getByRole('button', { name: new RegExp(`Create passkey for ${name}`) }).click();
  await p.getByText('Signed in as').waitFor({ timeout: 15_000 });
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
      await enroll(p, 'Marcus', 'org_marcus');
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

/** POST to /api/internal/* signed with the server's NEIGHBORLINE_INTERNAL_SECRET (what Render Workflows sends). */
async function internalPost(secret, path, body) {
  const raw = JSON.stringify(body);
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = 'v1=' + createHmac('sha256', secret).update(`${ts}.POST.${path}.${raw}`).digest('hex');
  const res = await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-neighborline-timestamp': ts, 'x-neighborline-signature': sig }, body: raw });
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  return res.json();
}

const DAY = 86_400_000;
const usd = (cents) => `$${(cents / 100).toFixed(2)}`;
const LANG_NAME = { en: 'English', es: 'Spanish', vi: 'Vietnamese', ht: 'Haitian Creole', zh: 'Chinese', ar: 'Arabic', fr: 'French', tl: 'Tagalog', ko: 'Korean', ru: 'Russian' };
/**
 * Stand in for the scheduler, honestly: run the same unclaimed sweep the nightly job runs and raise the
 * day-25 alert only for items that really are unclaimed and 25+ days old, with the job's own wording
 * (workflows/src/policy.ts decideUnclaimed + tasks/unclaimed.ts escalationSummary). The seeded month has
 * exactly one such payout, so the alert, the ledger row and the Unclaimed total describe the same item.
 */
async function raiseAlerts() {
  const secret = process.env.NEIGHBORLINE_INTERNAL_SECRET;
  if (!secret) return false;
  const now = new Date();
  const { items } = await internalPost(secret, '/api/internal/unclaimed-sweep', { now: now.toISOString(), minAgeHours: 24 });
  for (const item of items) {
    const created = Date.parse(item.payoutCreatedAt);
    const deadline = new Date(created + 30 * DAY).toISOString();
    if (now.getTime() - created < 25 * DAY || now.toISOString() >= deadline || item.organizerAlertedAt) continue;
    const wallet = item.wallet === 'VENMO' ? 'Venmo' : 'PayPal';
    const day = new Date(deadline).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/Los_Angeles' });
    const nudges = item.nudgeCount === 1 ? '1 follow-up' : `${item.nudgeCount} follow-ups`;
    await internalPost(secret, '/api/internal/organizer-alert', {
      kind: 'unclaimed_day25',
      idempotencyKey: `unclaimed_day25:${item.itemId}`,
      itemIds: [item.itemId],
      deadline,
      summary:
        `${usd(item.amountCents)} ${wallet} payout is still unclaimed after 25 days ` +
        `(${nudges} sent in ${LANG_NAME[item.lang] ?? item.lang}). PayPal returns it on ${day}. ` +
        `Reach the neighbor directly, or cancel it and re-send to a destination they can use.`,
    });
  }
  return true;
}

/**
 * The rules edit works from whatever policy is active (no reset between flows): it toggles the utility
 * cap between $150 and $120 and adds the baby-supplies line once.
 */
const RULES_EDIT = (t) => {
  const next = /up to \$120 per request, at most \$300/.test(t) ? '$150' : '$120';
  let out = t.replace(/up to \$\d+ per request, at most \$300/, `up to ${next} per request, at most $300`);
  if (!/Baby supplies/.test(out)) out = out.replace('- Anything else:', '- Baby supplies (diapers, formula, wipes): up to $80 per request, $160 per household in 30 days.\n- Anything else:');
  return out;
};

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
    await p.getByRole('heading', { name: /Review draft v\d+/ }).waitFor({ timeout: 20_000 });
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
    await p.getByText(/Policy v\d+ is now active/).waitFor({ timeout: 20_000 });
    await p.evaluate(() => window.scrollTo(0, 0));
    await shot(`rules-${tag}-activated`, false);
  } catch (err) {
    console.error('FAILED', `rules-${tag}`, err instanceof Error ? err.message.split('\n')[0] : err);
    process.exitCode = 1;
  } finally {
    await ctx.close();
  }
}

/**
 * The payout-rail fallback on /organizer at 390 px: Marcus signs in with a passkey, turns on manual
 * recording, the fake PayPal refuses the next batch the way a restricted sponsor account does
 * (SENDER_RESTRICTED, via /__fake/faults), the alert appears, and he records a cash hand-over.
 * Needs FAKE_PAYPAL_URL (the fake's control plane). Changes shared state (Minh's request), so serial.
 */
async function railFlow() {
  const fakeUrl = process.env.FAKE_PAYPAL_URL;
  if (!fakeUrl) return console.log('skipped organizer-390-rail (set FAKE_PAYPAL_URL to the fake PayPal)');
  const ctx = await browser.newContext({ viewport: PHONE, deviceScaleFactor: 2 });
  const p = await ctx.newPage();
  try {
    await withPasskeyDevice(p);
    await p.goto(`${base}/organizer`, { waitUntil: 'load' });
    await p.evaluate(() => document.fonts.ready);
    await enroll(p, 'Marcus', 'org_marcus');
    await p.getByText('If PayPal is unavailable', { exact: true }).click();
    // The switch is controlled: it flips once the server saved the setting (it may already be on).
    if (!(await p.getByRole('switch', { name: /switch to manual recording/ }).isChecked())) {
      await p.getByText('If PayPal is unavailable or the account is restricted, switch to manual recording').click();
    }
    await p.getByRole('switch', { name: /switch to manual recording/, checked: true }).waitFor({ state: 'attached', timeout: 10_000 });
    await fetch(`${fakeUrl}/__fake/faults`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pathPrefix: '/v1/payments/payouts', status: 422, count: 1, name: 'SENDER_RESTRICTED' }) });
    await p.getByRole('article', { name: /^Minh/ }).getByRole('button', { name: /^Approve \$/ }).click();
    const alert = p.getByText('PayPal refused a payout');
    await alert.waitFor({ timeout: 20_000 });
    await alert.evaluate((el) => el.closest('section')?.scrollIntoView({ block: 'start' }));
    await p.waitForTimeout(600);
    await p.screenshot({ path: `${out}organizer-390-rail-refused.png` });
    console.log('saved', 'organizer-390-rail-refused');
    await p.getByText('Cash', { exact: true }).click();
    await p.getByLabel('Receipt note').fill('$80 cash to Minh at the Montavilla warming center, 4:10 pm. Dana witnessed.');
    await p.getByRole('button', { name: 'Record manual payment' }).click();
    await p.getByText(/Resolved: recorded by hand/).waitFor({ timeout: 15_000 });
    await p.getByText(/Resolved: recorded by hand/).evaluate((el) => el.closest('section')?.scrollIntoView({ block: 'start' }));
    await p.waitForTimeout(600);
    await p.screenshot({ path: `${out}organizer-390-rail-recorded.png` });
    console.log('saved', 'organizer-390-rail-recorded');
  } catch (err) {
    console.error('FAILED', 'organizer-390-rail', err instanceof Error ? err.message.split('\n')[0] : err);
    process.exitCode = 1;
  } finally {
    await ctx.close();
  }
}

const serial = [
  { name: 'rules-1920', run: () => rulesFlow('1920', DESKTOP) },
  { name: 'rules-390', run: () => rulesFlow('390', PHONE) },
  { name: 'organizer-390-rail', run: railFlow },
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
          await enroll(p, 'Dana', 'org_dana');
          await p.getByText('Devices that can sign').click();
          await p.getByRole('button', { name: 'Revoke', exact: true }).first().click();
          await p.getByRole('button', { name: /^Revoke Dana/ }).scrollIntoViewIfNeeded();
        },
      }),
  },
].filter((s) => !only || only.test(s.name));
// No demo reset (it is not public): every shot above runs in a fresh browser context, i.e. a new
// visitor with its own runs. The serial flows change shared state (the active policy, alerts), so they
// run last; for pristine rules shots, run them against a freshly started server.
for (const s of serial) await s.run();
await browser.close();
