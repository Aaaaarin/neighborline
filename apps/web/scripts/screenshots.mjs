// Regenerates apps/web/screenshots/*.png against a running server (default http://localhost:3000).
// Usage: BASE_URL=http://localhost:3100 PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node scripts/screenshots.mjs
import { mkdirSync } from 'node:fs';
import { chromium } from '@playwright/test';

const base = process.env.BASE_URL ?? 'http://localhost:3000';
const out = new URL('../screenshots/', import.meta.url).pathname;
mkdirSync(out, { recursive: true });

const DESKTOP = { width: 1920, height: 1080 };
const PHONE = { width: 390, height: 844 };

const shots = [
  // /demo — the stage
  { name: 'demo-1920-idle', path: '/demo', vp: DESKTOP },
  { name: 'demo-1920-lan-readback', path: '/demo?scenario=lan&speed=1&autoplay=1', vp: DESKTOP, wait: 6500 },
  { name: 'demo-1920-lan-your-turn', path: '/demo?scenario=lan&mode=manual&speed=2&autoplay=1', vp: DESKTOP, wait: 10_000 },
  { name: 'demo-1920-lan-paid', path: '/demo?scenario=lan&speed=3&autoplay=1', vp: DESKTOP, wait: 12_500 },
  { name: 'demo-1920-rosa-rescued', path: '/demo?scenario=rosa&speed=3&autoplay=1', vp: DESKTOP, wait: 17_000 },
  { name: 'demo-1920-blocked', path: '/demo?scenario=blocked&speed=1&autoplay=1', vp: DESKTOP, wait: 5_000 },
  { name: 'demo-1920-lan-paid-dark', path: '/demo?scenario=lan&speed=3&autoplay=1', vp: DESKTOP, wait: 12_500, dark: true },
  { name: 'demo-1280-lan-paid', path: '/demo?scenario=lan&speed=3&autoplay=1', vp: { width: 1280, height: 800 }, wait: 12_500, full: true },
  { name: 'demo-390-lan-paid', path: '/demo?scenario=lan&speed=3&autoplay=1', vp: PHONE, wait: 12_500 },
  // other pages
  ...['', 'call', 'organizer', 'donate', 'report', 'trust', 'ledger'].flatMap((p) => [
    { name: `${p || 'home'}-1920`, path: `/${p}`, vp: DESKTOP, full: true },
    { name: `${p || 'home'}-390`, path: `/${p}`, vp: PHONE, full: p !== 'call' },
  ]),
  { name: 'call-390-readback', path: '/call', vp: PHONE, click: ['No microphone? Use a sample', 'Español · Rosa'], wait: 1500 },
  { name: 'home-1920-dark', path: '/', vp: DESKTOP, dark: true },
];

const browser = await chromium.launch();
await Promise.all(
  shots.map(async (s) => {
    const ctx = await browser.newContext({ viewport: s.vp, colorScheme: s.dark ? 'dark' : 'light', deviceScaleFactor: s.vp.width < 500 ? 2 : 1 });
    const page = await ctx.newPage();
    await page.goto(base + s.path, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(700);
    for (const t of s.click ?? []) {
      await page.locator(':visible', { hasText: t }).last().click();
      await page.waitForTimeout(300);
    }
    if (s.wait) await page.waitForTimeout(s.wait);
    await page.screenshot({ path: `${out}${s.name}.png`, fullPage: !!s.full });
    await ctx.close();
    console.log('saved', s.name);
  }),
);
await browser.close();
