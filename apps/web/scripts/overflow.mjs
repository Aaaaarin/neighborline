import { chromium } from '@playwright/test';
const [path, w = '390', h = '844'] = process.argv.slice(2);
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: +w, height: +h } });
await p.goto((process.env.BASE_URL ?? 'http://localhost:3000') + path, { waitUntil: 'load' });
await p.waitForTimeout(800);
const r = await p.evaluate(() => {
  const vw = document.documentElement.clientWidth;
  const out = [];
  for (const el of document.querySelectorAll('body *')) {
    const rc = el.getBoundingClientRect();
    if (rc.right > vw + 0.5 && rc.width > 0) out.push(`${el.tagName}.${String(el.className).slice(0, 80)} right=${Math.round(rc.right)}`);
  }
  return { vw, sw: document.documentElement.scrollWidth, out: out.slice(0, 8) };
});
console.log(JSON.stringify(r, null, 1));
await b.close();
