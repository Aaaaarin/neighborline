// Usage: node scripts/shot.mjs <path> <w>x<h> <out.png> [--play] [--wait=ms] [--full] [--dark] [--click=text]
import { chromium } from '@playwright/test';

const [path, size, out, ...flags] = process.argv.slice(2);
const [w, h] = size.split('x').map(Number);
const opt = Object.fromEntries(flags.map((f) => f.replace(/^--/, '').split('=')).map(([k, v]) => [k, v ?? true]));
const base = process.env.BASE_URL ?? 'http://localhost:3000';
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: Number(opt.dpr ?? 1), colorScheme: opt.dark ? 'dark' : 'light' });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.error('pageerror', e.message));
page.on('console', (m) => m.type() === 'error' && console.error('console', m.text()));
await page.goto(base + path, { waitUntil: 'load' });
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(Number(opt.settle ?? 700));
if (opt.play) await page.getByRole('button', { name: /play scenario|play again/i }).click();
if (opt.click) for (const t of String(opt.click).split('|')) { await page.locator(':visible', { hasText: t }).last().click(); await page.waitForTimeout(300); }
if (opt.wait) await page.waitForTimeout(Number(opt.wait));
await page.screenshot({ path: out, fullPage: !!opt.full });
await browser.close();
console.log('saved', out);
