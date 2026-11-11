// Act 1 and the close (Draft 6): drawn scenes, no footage. A night street after the ice storm (every window dark),
// what "help" looks like today (a six-page English form, a comment thread taking 300 requests), a one-line beat, and
// the same street again with one warm window. Everything is HTML/SVG/canvas drawn here from the app's fonts and
// DESIGN.md tokens: no third-party images. The palette is cold on purpose; --lamp appears only when money has arrived.
//
// Rendered frame by frame like the cold open (page.setT(t) → screenshot → ffmpeg), so it is deterministic.
//   node docs/submission/video/lib/scene.mjs street 9.5 /tmp/a.png     # one preview frame of a scene at t seconds
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { CHROME_ARGS, DIRS, HERE, log, playwright, readJson } from './common.mjs';
import { TOKENS, fontCss, wordmark } from './cards.mjs';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// ---------- the street (shared by `street` and `payoff`) ----------

const GROUND = 812;
// x, width, wall height, roof rise, roof style, windows [[x, y, w, h] relative to the wall's top-left], door x
const HOUSES = [
  { x: -40, w: 250, h: 150, r: 92, win: [[70, 46, 44, 58], [156, 46, 44, 58]], door: 20 },
  { x: 268, w: 214, h: 236, r: 84, win: [[34, 30, 40, 54], [136, 30, 40, 54], [34, 136, 40, 58]], door: 132, chimney: 150 },
  { x: 548, w: 292, h: 142, r: 104, win: [[44, 40, 50, 60], [196, 40, 50, 60]], door: 124, dormer: 146 },
  { x: 902, w: 226, h: 214, r: 96, win: [[36, 34, 42, 56], [146, 34, 42, 56], [146, 130, 42, 58]], door: 40, chimney: 44 },
  { x: 1196, w: 286, h: 156, r: 110, win: [[50, 50, 52, 64], [186, 50, 52, 64]], door: 124, chimney: 214, lan: true },
  { x: 1556, w: 240, h: 226, r: 88, win: [[40, 32, 40, 54], [158, 32, 40, 54], [40, 134, 40, 58]], door: 150 },
  { x: 1860, w: 220, h: 150, r: 90, win: [[40, 44, 44, 58]], door: 130 },
];
export const LAN = (() => {
  const h = HOUSES.find((x) => x.lan);
  const [wx, wy, ww, wh] = h.win[0];
  return { house: h, win: { x: h.x + wx, y: GROUND - h.h + wy, w: ww, h: wh }, apex: { x: h.x + h.w / 2, y: GROUND - h.h - h.r } };
})();

function houseSvg(h, i) {
  const top = GROUND - h.h;
  const wall = ['#0A0F19', '#0B111C', '#090E17'][i % 3];
  const eave = 16;
  const roof = `M${h.x - eave} ${top} L${h.x + h.w / 2} ${top - h.r} L${h.x + h.w + eave} ${top} Z`;
  const out = [];
  if (h.chimney) out.push(`<rect x="${h.x + h.chimney}" y="${top - h.r * 0.78}" width="26" height="${h.r * 0.7}" fill="${wall}"/><rect x="${h.x + h.chimney - 3}" y="${top - h.r * 0.78 - 5}" width="32" height="6" rx="2" fill="#3C4D69" opacity=".55"/>`);
  out.push(`<path d="${roof}" fill="#080C14"/>`);
  out.push(`<rect x="${h.x}" y="${top}" width="${h.w}" height="${h.h + 8}" fill="${wall}"/>`);
  // Snow lying on the roof: a soft cold edge along both slopes, thicker toward the eaves.
  out.push(`<path d="M${h.x - eave} ${top} L${h.x + h.w / 2} ${top - h.r} L${h.x + h.w + eave} ${top}" fill="none" stroke="#51647F" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" opacity=".5"/>`);
  out.push(`<path d="M${h.x - eave} ${top} L${h.x + h.w / 2} ${top - h.r} L${h.x + h.w + eave} ${top}" fill="none" stroke="#8FA3BD" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" opacity=".42" transform="translate(0 -2)"/>`);
  if (h.dormer) out.push(`<path d="M${h.x + h.dormer - 34} ${top - 14} l34 -40 l34 40 z" fill="#0A0F19" stroke="#51647F" stroke-opacity=".35" stroke-width="3"/><rect x="${h.x + h.dormer - 13}" y="${top - 40}" width="26" height="26" fill="#111A29"/>`);
  // Icicles under the eaves.
  let seed = (i + 3) * 7919;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff), seed / 0x7fffffff);
  for (let x = h.x - eave + 6; x < h.x + h.w + eave - 4; x += 7 + rnd() * 13) out.push(`<path d="M${x.toFixed(1)} ${top} l1.4 ${(5 + rnd() * 15).toFixed(1)} l1.4 -${(5 + rnd() * 3).toFixed(1)}" fill="#9DB1CB" opacity="${(0.16 + rnd() * 0.22).toFixed(2)}"/>`);
  h.win.forEach(([x, y, w, hh], k) => {
    const X = h.x + x;
    const Y = top + y;
    const lit = h.lan && k === 0;
    out.push(`<g${lit ? ' id="lanwin"' : ''}><rect x="${X - 3}" y="${Y - 3}" width="${w + 6}" height="${hh + 6}" fill="#070B12"/>
<rect class="glass" x="${X}" y="${Y}" width="${w}" height="${hh}" fill="url(#glass)"/>
${lit ? `<rect class="lamp" x="${X}" y="${Y}" width="${w}" height="${hh}" fill="url(#lampfill)" opacity="0"/>` : ''}
<path d="M${X + w / 2} ${Y}v${hh}M${X} ${Y + hh * 0.46}h${w}" stroke="#070B12" stroke-width="3"/>
<rect x="${X - 5}" y="${Y + hh + 2}" width="${w + 10}" height="4" rx="2" fill="#6B7F9B" opacity=".4"/></g>`);
  });
  out.push(`<rect x="${h.x + h.door}" y="${GROUND - 78}" width="38" height="80" fill="#06090F"/>`);
  return `<g>${out.join('')}</g>`;
}

function polesSvg() {
  const P = [150, 870, 1516, 2060];
  const top = 372;
  const out = [];
  let seed = 4242;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff), seed / 0x7fffffff);
  const wire = (x0, y0, x1, y1, sag, o = 0.5) => {
    const mx = (x0 + x1) / 2;
    const my = (y0 + y1) / 2 + sag;
    out.push(`<path d="M${x0} ${y0} Q${mx} ${my + sag} ${x1} ${y1}" fill="none" stroke="#7E93B0" stroke-width="1.5" opacity="${o}"/>`);
    // Ice on the line: short icicles along the curve.
    for (let u = 0.04; u < 0.97; u += 0.012 + rnd() * 0.02) {
      const x = (1 - u) * (1 - u) * x0 + 2 * (1 - u) * u * mx + u * u * x1;
      const y = (1 - u) * (1 - u) * y0 + 2 * (1 - u) * u * (my + sag) + u * u * y1;
      out.push(`<path d="M${x.toFixed(1)} ${y.toFixed(1)}v${(3 + rnd() * 11).toFixed(1)}" stroke="#A9BCD4" stroke-width="1" opacity="${(0.12 + rnd() * 0.3).toFixed(2)}"/>`);
    }
  };
  wire(-200, top + 10, P[0], top, 34);
  wire(P[0], top, P[1], top, 58);
  wire(P[0], top + 26, P[1], top + 26, 66, 0.36);
  // The span to the third pole is down: one end hangs from the crossarm, the other lies in the snow.
  out.push(`<path d="M${P[1]} ${top} C${P[1] + 60} ${top + 150} ${P[1] + 120} ${GROUND - 120} ${P[1] + 178} ${GROUND + 26}" fill="none" stroke="#7E93B0" stroke-width="1.5" opacity=".5"/>`);
  wire(P[1], top + 26, P[2], top + 26, 84, 0.36);
  wire(P[2], top, P[3], top, 60);
  wire(P[2], top + 26, P[3], top + 26, 70, 0.36);
  P.forEach((x, i) => {
    const lean = i === 1 ? 2.4 : i === 2 ? -1.2 : 0;
    out.push(`<g transform="rotate(${lean} ${x} ${GROUND + 30})"><rect x="${x - 5}" y="${top - 34}" width="10" height="${GROUND - top + 70}" fill="#05080D"/><rect x="${x - 46}" y="${top - 6}" width="92" height="7" fill="#05080D"/><rect x="${x - 34}" y="${top + 20}" width="68" height="6" fill="#05080D"/>
<rect x="${x - 46}" y="${top - 9}" width="92" height="3" rx="1.5" fill="#8FA3BD" opacity=".4"/><rect x="${x - 34}" y="${top + 17}" width="68" height="3" rx="1.5" fill="#8FA3BD" opacity=".3"/></g>`);
  });
  return out.join('');
}

function backSvg() {
  // A farther row: roofs and bare trees, lighter and hazier, so the street has depth.
  let seed = 99;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff), seed / 0x7fffffff);
  const out = [];
  for (let x = -60; x < 2000; ) {
    const w = 120 + rnd() * 110;
    const h = 60 + rnd() * 70;
    const r = 34 + rnd() * 30;
    const y = 772 - h;
    out.push(`<path d="M${x} 790 V${y} L${x + w / 2} ${y - r} L${x + w} ${y} V790 Z" fill="#131E30"/><path d="M${x - 6} ${y} L${x + w / 2} ${y - r} L${x + w + 6} ${y}" fill="none" stroke="#5B6F8C" stroke-width="3" opacity=".35"/>`);
    x += w + 20 + rnd() * 90;
  }
  const tree = (x, y, len, ang, depth) => {
    if (depth === 0 || len < 7) return '';
    const x2 = x + Math.sin(ang) * len;
    const y2 = y - Math.cos(ang) * len;
    return `<path d="M${x.toFixed(1)} ${y.toFixed(1)}L${x2.toFixed(1)} ${y2.toFixed(1)}" stroke="#111B2B" stroke-width="${(depth * 1.1).toFixed(1)}" stroke-linecap="round"/>` + tree(x2, y2, len * (0.66 + rnd() * 0.12), ang - 0.3 - rnd() * 0.35, depth - 1) + tree(x2, y2, len * (0.62 + rnd() * 0.14), ang + 0.28 + rnd() * 0.35, depth - 1);
  };
  for (const x of [205, 520, 868, 1168, 1508, 1830]) out.push(tree(x + rnd() * 30, 790, 78 + rnd() * 36, (rnd() - 0.5) * 0.2, 6));
  return out.join('');
}

const STREET_CSS = `
body{background:#070B12;color:#E6ECF2}
.stage{position:absolute;inset:0;overflow:hidden}
.layer{position:absolute;inset:0;will-change:transform}
svg.full{position:absolute;inset:0;width:1920px;height:1080px}
#sleet{position:absolute;inset:0}
.vig{position:absolute;inset:0;background:radial-gradient(ellipse 75% 70% at 55% 52%,transparent 45%,rgba(3,5,9,.62) 100%),linear-gradient(to bottom,rgba(4,7,12,.5),transparent 22%,transparent 78%,rgba(4,7,12,.7))}
.kicker{font-family:'Atkinson Hyperlegible Mono Variable',monospace;font-size:23px;letter-spacing:.16em;text-transform:uppercase;color:#93A7C0}
.type{position:absolute;left:150px;top:150px}
.type h1{font-family:'Literata Variable',serif;font-weight:520;font-size:68px;letter-spacing:-0.015em;line-height:1.1;margin-top:16px;color:#E9EEF4}
.tag{position:absolute;display:flex;align-items:center;gap:16px;white-space:nowrap}
.tag .who{font-size:27px;font-weight:500;color:#E9EEF4}
.tag .pct{font-family:'Atkinson Hyperlegible Mono Variable',monospace;font-size:25px;color:#C6D3E2}
.endcard{position:absolute;left:150px;top:176px;width:900px}
.endcard .lbl{color:#93A7C0;font-size:22px;display:block}
.endcard .mono{font-size:33px;color:#F2F5F8}
.endcard .ev{font-size:24px;color:#B4C2D3}
.shade{position:absolute;inset:0;background:linear-gradient(100deg,rgba(5,8,13,.9) 0%,rgba(5,8,13,.78) 38%,rgba(5,8,13,.15) 68%,transparent 85%)}`;

function streetBody({ payoff = false, endCard = null }) {
  const L = LAN;
  const cx = L.win.x + L.win.w / 2;
  const cy = L.win.y + L.win.h / 2;
  const darkMark = wordmark(true, 1.6).replace(/#18202E/g, '#E9EEF4');
  return `<div class="stage">
<div class="layer" id="Lsky"><svg class="full" viewBox="0 0 1920 1080"><defs>
 <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#070B13"/><stop offset=".5" stop-color="#0E1727"/><stop offset=".76" stop-color="#1B2A42"/><stop offset="1" stop-color="#1B2A42"/></linearGradient>
 <radialGradient id="haze" cx=".62" cy=".73" r=".6"><stop offset="0" stop-color="#3A506F" stop-opacity=".5"/><stop offset="1" stop-color="#3A506F" stop-opacity="0"/></radialGradient>
 <filter id="b6"><feGaussianBlur stdDeviation="60"/></filter></defs>
 <rect width="1920" height="1080" fill="url(#sky)"/><rect width="1920" height="1080" fill="url(#haze)"/>
 <g filter="url(#b6)" opacity=".55"><ellipse cx="420" cy="250" rx="520" ry="70" fill="#1C2B43"/><ellipse cx="1500" cy="150" rx="600" ry="80" fill="#18263C"/><ellipse cx="1050" cy="420" rx="700" ry="60" fill="#22344F"/></g></svg></div>
<div class="layer" id="Lback" style="filter:blur(1.6px)"><svg class="full" viewBox="0 0 1920 1080">${backSvg()}<rect x="-100" y="786" width="2200" height="300" fill="#152136"/></svg></div>
<div class="layer" id="Lmain"><svg class="full" viewBox="0 0 1920 1080" style="overflow:visible"><defs>
 <linearGradient id="glass" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1A2638"/><stop offset=".55" stop-color="#0F1826"/><stop offset="1" stop-color="#16212F"/></linearGradient>
 <linearGradient id="lampfill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFD98A"/><stop offset=".6" stop-color="#F4B33D"/><stop offset="1" stop-color="#E09A22"/></linearGradient>
 <linearGradient id="snow" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2A3B56"/><stop offset=".35" stop-color="#1A273B"/><stop offset="1" stop-color="#0B111C"/></linearGradient>
 <radialGradient id="glow"><stop offset="0" stop-color="#F4B33D" stop-opacity=".7"/><stop offset=".3" stop-color="#F4B33D" stop-opacity=".24"/><stop offset="1" stop-color="#F4B33D" stop-opacity="0"/></radialGradient>
 <radialGradient id="spill"><stop offset="0" stop-color="#F4B33D" stop-opacity=".42"/><stop offset=".5" stop-color="#E09A22" stop-opacity=".14"/><stop offset="1" stop-color="#E09A22" stop-opacity="0"/></radialGradient>
 <filter id="soft"><feGaussianBlur stdDeviation="5"/></filter></defs>
 ${HOUSES.map(houseSvg).join('')}
 <path d="M-100 ${GROUND - 4} C200 ${GROUND - 18} 420 ${GROUND + 6} 700 ${GROUND - 6} S1250 ${GROUND - 16} 1500 ${GROUND - 2} S1900 ${GROUND - 12} 2100 ${GROUND - 4} V1200 H-100 Z" fill="url(#snow)"/>
 <path d="M-100 ${GROUND - 4} C200 ${GROUND - 18} 420 ${GROUND + 6} 700 ${GROUND - 6} S1250 ${GROUND - 16} 1500 ${GROUND - 2} S1900 ${GROUND - 12} 2100 ${GROUND - 4}" fill="none" stroke="#7F95B3" stroke-width="2" opacity=".32"/>
 <path d="M-100 930 C300 900 700 948 1100 922 S1700 902 2100 934 V1200 H-100 Z" fill="#0A0F19" opacity=".55"/>
 <g id="warm" opacity="0"><ellipse cx="${cx}" cy="${cy}" rx="270" ry="240" fill="url(#glow)"/><ellipse cx="${cx - 6}" cy="${GROUND + 34}" rx="230" ry="44" fill="url(#spill)"/>
  <path d="M${L.house.x - 16} ${GROUND - L.house.h} L${L.apex.x} ${L.apex.y}" stroke="#F4B33D" stroke-width="2" opacity=".0"/></g>
 ${polesSvg()}
 <g id="hl" opacity="0"><path d="M${L.house.x - 16} ${GROUND - L.house.h} L${L.apex.x} ${L.apex.y} L${L.house.x + L.house.w + 16} ${GROUND - L.house.h}" fill="none" stroke="#D6E2EA" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" opacity=".85"/>
  <path d="M${L.apex.x} ${L.apex.y - 12} V${L.apex.y - 86}" stroke="#D6E2EA" stroke-width="1.5" opacity=".7"/><circle cx="${L.apex.x}" cy="${L.apex.y - 12}" r="4" fill="#D6E2EA"/></g>
 </svg>
 <div class="tag" id="tag" style="left:${L.apex.x - 78}px;top:${L.apex.y - 138}px;opacity:0">
  <span class="who">Mrs. Lan, 71</span><span id="bat" style="display:flex;align-items:center;gap:12px;opacity:0"><svg width="50" height="26" viewBox="0 0 50 26"><rect x="1.5" y="1.5" width="42" height="23" rx="5" fill="none" stroke="#C6D3E2" stroke-width="2"/><rect x="45.5" y="8" width="3.5" height="10" rx="1.5" fill="#C6D3E2"/><rect x="5" y="5" width="8.3" height="16" rx="2" fill="#D6E2EA"/></svg>
  <span class="pct">23%</span></span></div>
</div>
<canvas id="sleet" width="1920" height="1080"></canvas>
<div class="vig"></div>
${payoff ? `<div class="shade" id="shade" style="opacity:0"></div><div class="endcard" id="end" style="opacity:0">${darkMark.replace("font-weight:620", "font-weight:620;color:#F2F5F8")}
<div style="margin-top:54px;display:grid;gap:30px;line-height:1.35">
<p><span class="lbl">Try the hotline, no login</span>${endCard.live ? `<span class="mono">${esc(endCard.hostedUrl)}</span>` : `<span style="font-size:34px;font-weight:600">${esc(endCard.pendingDemo)}</span>`}</p>
<p><span class="lbl">Open source (MIT)</span><span class="mono">${esc(endCard.repo)}</span></p>
<p class="ev">${esc(endCard.event)}</p></div></div>` : `<div class="type"><div class="kicker" id="k1" style="opacity:0">Eastside · 5:10 AM</div><h1 id="k2" style="opacity:0">Day 2 without power</h1></div>`}
</div>
<script>
const B = __BEATS__, DUR = __DUR__, PAYOFF = ${payoff}, FOCUS = [${LAN.apex.x}, ${GROUND - 120}];
const ease = (x) => x <= 0 ? 0 : x >= 1 ? 1 : 1 - Math.pow(1 - x, 3);
const io = (x) => x <= 0 ? 0 : x >= 1 ? 1 : (1 - Math.cos(Math.PI * x)) / 2;
const $ = (id) => document.getElementById(id);
// Sleet: three depths of short diagonal streaks, positions a pure function of t (deterministic per frame).
const cv = $('sleet'), g = cv.getContext('2d');
let s = 1234567; const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const drops = Array.from({ length: 620 }, (_, i) => ({ x: rnd() * 2600 - 300, y: rnd() * 1300, z: i % 3, v: 0.75 + rnd() * 0.5, a: 0.5 + rnd() * 0.5, gust: rnd() * 6.28 }));
function sleet(t, density) {
  g.clearRect(0, 0, 1920, 1080);
  g.lineCap = 'round';
  const n = Math.round(drops.length * density);
  for (let i = 0; i < n; i++) {
    const d = drops[i];
    const speed = [520, 860, 1380][d.z] * d.v;
    const wind = 0.42 + 0.1 * Math.sin(t * 0.7 + d.gust * 0.2);
    const y = ((d.y + speed * t) % 1300) - 110;
    const x = ((d.x - speed * wind * t) % 2600 + 2600) % 2600 - 300;
    const len = [9, 16, 30][d.z] * d.v;
    g.strokeStyle = 'rgba(190,206,226,' + ([0.2, 0.3, 0.2][d.z] * d.a).toFixed(3) + ')';
    g.lineWidth = [1, 1.4, 2.4][d.z];
    g.beginPath(); g.moveTo(x, y); g.lineTo(x - len * wind, y + len); g.stroke();
  }
}
window.setT = (t) => {
  // A very slow push toward her house. The payoff holds the framing the first scene ended on.
  const p = PAYOFF ? 1 + 0.12 * io(t / DUR) : io(t / DUR);
  const tf = (k) => 'translate(' + ((960 - FOCUS[0]) * k * p * 0.5).toFixed(2) + 'px,' + ((540 - FOCUS[1]) * k * p * 0.5).toFixed(2) + 'px) scale(' + (1 + k * p).toFixed(5) + ')';
  for (const [id, k] of [['Lsky', 0.02], ['Lback', 0.045], ['Lmain', 0.075]]) { $(id).style.transformOrigin = FOCUS[0] + 'px ' + FOCUS[1] + 'px'; $(id).style.transform = tf(k); }
  sleet(t + (PAYOFF ? 40 : 0), PAYOFF ? 0.3 : 1);
  if (PAYOFF) {
    // The lamp comes on: a quick catch, a settle, then a slow breath.
    const on = ease((t - B.lamp) / 0.9) * (0.94 + 0.06 * Math.sin(t * 1.3));
    document.querySelector('#lanwin .lamp').setAttribute('opacity', on.toFixed(3));
    $('warm').setAttribute('opacity', on.toFixed(3));
    const e = ease((t - B.card) / 1.2);
    $('shade').style.opacity = e.toFixed(3);
    $('end').style.opacity = ease((t - B.card - 0.3) / 0.9).toFixed(3);
    $('end').style.transform = 'translateY(' + ((1 - ease((t - B.card - 0.3) / 0.9)) * 12).toFixed(1) + 'px)';
  } else {
    $('k1').style.opacity = ease((t - B.kicker) / 0.9).toFixed(3);
    $('k2').style.opacity = ease((t - B.title) / 1.1).toFixed(3);
    $('k2').style.transform = 'translateY(' + ((1 - ease((t - B.title) / 1.1)) * 10).toFixed(1) + 'px)';
    const h = ease((t - B.lan) / 0.8);
    $('hl').setAttribute('opacity', h.toFixed(3));
    $('tag').style.opacity = ease((t - B.lan - 0.35) / 0.7).toFixed(3);
    $('bat').style.opacity = ease((t - B.battery) / 0.5).toFixed(3);
  }
};
</script>`;
}

// ---------- what help looks like today ----------

const HELP_CSS = `
body{background:#090E17;color:#E6ECF2}
.bg{position:absolute;inset:0;background:radial-gradient(ellipse 60% 60% at 28% 45%,#152136 0%,transparent 70%),radial-gradient(ellipse 50% 60% at 78% 50%,#111C2E 0%,transparent 70%),#090E17}
.head{position:absolute;top:92px;font-family:'Atkinson Hyperlegible Mono Variable',monospace;font-size:21px;letter-spacing:.16em;text-transform:uppercase;color:#93A7C0}
.form{position:absolute;left:150px;top:140px;width:770px;height:716px;background:#D5DCE4;border-radius:10px;overflow:hidden;box-shadow:0 40px 90px rgba(0,0,0,.55);color:#1E2836;font-family:'Be Vietnam Pro',sans-serif}
.form .bar{height:74px;background:#3B4A5F;color:#EEF2F6;display:flex;align-items:center;justify-content:space-between;padding:0 30px;font-size:22px;font-weight:600}
.form .bar span{font-weight:400;font-size:17px;border:1px solid #7C8BA1;border-radius:4px;padding:5px 12px;color:#D5DCE4}
.form .in{padding:24px 30px 0}
.pg{display:flex;align-items:center;justify-content:space-between;font-size:18px;color:#4C5869}
.pg b{font-weight:600;color:#1E2836;padding:3px 10px;margin-left:-10px;border-radius:6px}
.steps{display:flex;gap:6px;margin-top:12px}.steps i{flex:1;height:6px;background:#B4BEC9;border-radius:3px}.steps i:first-child{background:#3B4A5F}
.f{margin-top:20px}.f label{display:block;font-size:17px;font-weight:600;color:#2C3848}.f label em{font-style:normal;color:#A3382F}
.f .hint{font-size:14px;color:#5C6879;margin-top:2px}
.f .box{height:46px;margin-top:7px;background:#EEF1F4;border:1.5px solid #9AA6B4;border-radius:4px}
.f .err{font-size:15px;color:#A3261E;font-weight:600;margin-top:5px;display:flex;align-items:center;gap:7px}
.btns{position:absolute;left:30px;right:30px;bottom:26px;display:flex;justify-content:space-between;align-items:center;font-size:16px;color:#5C6879}
.btns b{background:#3B4A5F;color:#EEF2F6;font-weight:600;padding:11px 22px;border-radius:4px;font-size:17px}
.thread{position:absolute;left:1000px;top:140px;width:770px;height:716px;background:#101826;border:1px solid #22314A;border-radius:14px;overflow:hidden;box-shadow:0 40px 90px rgba(0,0,0,.5)}
.thread .top{position:absolute;left:0;right:0;top:0;height:178px;padding:26px 34px;background:linear-gradient(#101826 78%,rgba(16,24,38,0));z-index:2}
.thread .top .l{font-size:19px;color:#93A7C0;letter-spacing:.02em}
.num{font-family:'Atkinson Hyperlegible Mono Variable',monospace;font-size:92px;font-weight:500;line-height:1.02;color:#EEF2F6;font-variant-numeric:tabular-nums;letter-spacing:-0.03em}
.num small{font-family:'Be Vietnam Pro',sans-serif;font-size:27px;font-weight:500;color:#B9C6D6;letter-spacing:0;margin-left:16px}
.rows{position:absolute;left:0;right:0;top:0;bottom:0}
.row{position:absolute;left:34px;right:34px;height:76px;display:flex;gap:16px;align-items:flex-start}
.row .av{width:44px;height:44px;border-radius:50%;flex:none}
.row .ln{height:11px;border-radius:6px;background:#2A3A54;margin-top:7px}
.row .ln.n{height:10px;background:#3C4F6E;margin-top:3px}
.thread .fade{position:absolute;left:0;right:0;bottom:0;height:90px;background:linear-gradient(rgba(16,24,38,0),#101826);z-index:2}
.src{position:absolute;left:1000px;top:874px;font-size:18px;color:#8296B0}
.ill{position:absolute;left:150px;top:874px;font-size:18px;color:#6F829B}
.dim{position:absolute;left:150px;top:140px;width:770px;height:716px;border-radius:10px;background:#090E17;pointer-events:none}`;

function helpBody(shot) {
  let seed = 31337;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff), seed / 0x7fffffff);
  const rows = Array.from({ length: 320 }, () => ({ a: ['#33455F', '#2B3B52', '#3D5270', '#263449', '#465B7A'][Math.floor(rnd() * 5)], n: 70 + Math.round(rnd() * 90), w1: 260 + Math.round(rnd() * 330), w2: rnd() < 0.72 ? 120 + Math.round(rnd() * 380) : 0 }));
  return `<div class="bg"></div>
<div class="head" style="left:150px" id="h1">The relief fund’s form</div><div class="head" style="left:1000px;opacity:0" id="h2">Where people actually ask · comments</div>
<div class="form" id="form">
 <div class="bar">Emergency Relief Application<span id="lang">English ▾</span></div>
 <div class="in">
  <div class="pg"><span><b id="pg">Page 1 of 6</b> · Applicant information</span><span>All fields marked * are required</span></div>
  <div class="steps"><i></i><i></i><i></i><i></i><i></i><i></i></div>
  <div class="f"><label>Legal name of head of household <em>*</em></label><div class="box" id="b1"></div><div class="err" id="e1" style="opacity:0"><svg width="16" height="16" viewBox="0 0 16 16"><circle cx="8" cy="8" r="7.2" fill="#A3261E"/><path d="M8 4v5M8 11.2v.6" stroke="#fff" stroke-width="1.8" stroke-linecap="round"/></svg>This field is required</div></div>
  <div class="f" style="margin-top:12px"><label>Service address as shown on your utility bill <em>*</em></label><div class="box"></div></div>
  <div class="f"><label>Utility account number <em>*</em></label><div class="hint">Found on page 2 of your most recent statement</div><div class="box"></div></div>
  <div class="f"><label>Proof of residency <em>*</em></label><div class="hint">Upload a PDF, 2 MB maximum</div><div class="box" style="border-style:dashed"></div></div>
 </div>
 <div class="btns"><span>Step 1 of 6</span><b>Save and continue</b></div>
</div>
<div class="dim" id="dim" style="opacity:0"></div>
<div class="ill">Illustration · a typical relief application</div>
<div class="thread" id="thread" style="opacity:0">
 <div class="rows" id="rows"></div>
 <div class="top"><div class="l">Comments</div><div class="num"><span id="num">0</span><small id="numl">requests overnight</small></div></div>
 <div class="fade"></div>
</div>
<div class="src" id="src" style="opacity:0">LA Public Press, Jan 2025 · Mutual Aid LA Network after the Eaton fire</div>
<script>
const B = __BEATS__, DUR = __DUR__, ROWS = ${JSON.stringify(rows)};
const ease = (x) => x <= 0 ? 0 : x >= 1 ? 1 : 1 - Math.pow(1 - x, 3);
const $ = (id) => document.getElementById(id);
const H = 84, rowsEl = $('rows');
window.setT = (t) => {
  const s = 1 + 0.018 * (t / DUR);
  document.body.style.transform = 'scale(' + s.toFixed(5) + ')';
  const fi = ease(t / 0.7);
  $('form').style.opacity = fi.toFixed(3); $('h1').style.opacity = fi.toFixed(3);
  const er = ease((t - B.error) / 0.3);
  $('e1').style.opacity = er.toFixed(3);
  $('b1').style.borderColor = er > 0 ? '#A3261E' : '#9AA6B4';
  $('b1').style.boxShadow = er > 0 ? '0 0 0 3px rgba(163,38,30,' + (0.18 * er).toFixed(3) + ')' : 'none';
  const six = ease((t - B.six) / 0.35) * (1 - ease((t - B.six - 2.4) / 0.6));
  $('pg').style.background = 'rgba(59,74,95,' + (0.2 * six).toFixed(3) + ')';
  $('pg').style.boxShadow = '0 0 0 ' + (2 * six).toFixed(2) + 'px rgba(59,74,95,' + (0.75 * six).toFixed(3) + ')';
  const en = ease((t - B.english) / 0.3) * (1 - ease((t - B.english - 1.6) / 0.6));
  $('lang').style.boxShadow = '0 0 0 ' + (3 * en).toFixed(2) + 'px rgba(214,226,234,' + (0.8 * en).toFixed(3) + ')';
  $('lang').style.color = en > 0.5 ? '#FFFFFF' : '#D5DCE4';
  // The thread: comments arrive slowly, then faster than anyone can read.
  const th = ease((t - B.thread) / 0.6);
  $('thread').style.opacity = th.toFixed(3); $('h2').style.opacity = th.toFixed(3); $('src').style.opacity = ease((t - B.thread - 0.8) / 0.6).toFixed(3);
  $('dim').style.opacity = (0.34 * th).toFixed(3);
  const u = Math.min(1, Math.max(0, (t - B.thread - 0.4) / (B.count - B.thread - 0.4)));
  const c = 300 * (u < 1 ? Math.pow(u, 2.2) * (1 - 0.0) : 1) ;
  const settle = u >= 1 ? 300 : c;
  $('num').textContent = String(Math.floor(settle));
  let html = '';
  const first = Math.max(0, Math.floor(settle) - 9);
  for (let i = first; i <= Math.min(ROWS.length - 1, Math.floor(settle)); i++) {
    const r = ROWS[i];
    const y = 716 - 100 - (settle - i) * H + H;
    const born = Math.min(1, (settle - i) * 3);
    html += '<div class="row" style="top:' + y.toFixed(1) + 'px;opacity:' + born.toFixed(2) + '"><div class="av" style="background:' + r.a + '"></div><div style="flex:1"><div class="ln n" style="width:' + r.n + 'px"></div><div class="ln" style="width:' + r.w1 + 'px"></div>' + (r.w2 ? '<div class="ln" style="width:' + r.w2 + 'px"></div>' : '') + '</div></div>';
  }
  rowsEl.innerHTML = html;
};
</script>`;
}

// ---------- the one-line beat ----------

const LINE_CSS = `body{background:#05070B;color:#E9EEF4}
.bg{position:absolute;inset:0;background:radial-gradient(ellipse 55% 45% at 50% 48%,#0E1624 0%,#05070B 75%)}
.line{position:absolute;left:0;right:0;top:446px;text-align:center;font-family:'Literata Variable',serif;font-weight:520;font-size:84px;letter-spacing:-0.015em}`;
const lineBody = (shot) => `<div class="bg"></div><div class="line" id="line">${esc(shot.line)}</div>
<script>const DUR = __DUR__, B = __BEATS__; const ease = (x) => x <= 0 ? 0 : x >= 1 ? 1 : 1 - Math.pow(1 - x, 3);
window.setT = (t) => { const e = ease((t - B.line) / 1.0) * (1 - ease((t - (DUR - 0.35)) / 0.3)); const l = document.getElementById('line'); l.style.opacity = e.toFixed(3); l.style.transform = 'scale(' + (1 + 0.02 * t / DUR).toFixed(5) + ')'; };</script>`;

const SCENES = {
  street: { css: STREET_CSS, body: () => streetBody({}), beats: { kicker: 0.8, title: 3.2, lan: 7.6, battery: 9.4 } },
  help: { css: HELP_CSS, body: helpBody, beats: { error: 3.2, six: 5.4, english: 6.5, thread: 7.4, count: 13.5 } },
  line: { css: LINE_CSS, body: lineBody, beats: { line: 0.35 } },
  payoff: { css: STREET_CSS, body: (shot, ctx) => streetBody({ payoff: true, endCard: ctx.endCard }), beats: { lamp: 0.5, card: 4.2 } },
};

function sceneHtml(shot, ctx) {
  const S = SCENES[shot.scene];
  if (!S) throw new Error(`unknown scene ${shot.scene}`);
  const beats = { ...S.beats, ...(shot.beats ?? {}) };
  const body = S.body(shot, ctx).replaceAll('__BEATS__', JSON.stringify(beats)).replaceAll('__DUR__', String(shot.dur));
  const html = join(DIRS.cards, `_${shot.id}.html`);
  writeFileSync(html, `<!doctype html><html><head><meta charset="utf-8">${fontCss}<style>${TOKENS}${S.css}</style></head><body>${body}</body></html>`);
  return html;
}

async function openScene(shot, ctx) {
  const html = sceneHtml(shot, ctx);
  const { chromium } = await playwright();
  const browser = await chromium.launch({ args: CHROME_ARGS });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  await page.goto(pathToFileURL(html).href, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  return { browser, page };
}

function sceneVf(shot) {
  const fades = [];
  if (shot.fadeIn) fades.push(`fade=t=in:st=0:d=${shot.fadeIn}`);
  if (shot.fadeOut) fades.push(`fade=t=out:st=${(shot.dur - shot.fadeOut).toFixed(3)}:d=${shot.fadeOut}`);
  return [...fades, 'noise=alls=3:allf=t', 'format=yuv420p'].join(',');
}
export const sceneKey = (shot, ctx) => createHash('sha256').update(readFileSync(sceneHtml(shot, ctx))).update(`${Math.round(shot.dur * 30)}|${sceneVf(shot)}`).digest('hex');

/**
 * Renders segs/<id>.mp4 for a `scene` shot: { scene: street|help|line|payoff, dur, beats?, line? }.
 * ctx.endCard = { live, hostedUrl, pendingDemo, repo, event } (the payoff's end card). A little animated grain is
 * added at the encode, so the dark gradients do not band and the drawing does not look vector-clean.
 */
export async function sceneSegment(shot, file, ctx = {}) {
  const n = Math.round(shot.dur * 30);
  const vf = sceneVf(shot);
  // A scene is ~0.3 s per frame to draw, so a finished segment is reused while its page and length are unchanged.
  const key = sceneKey(shot, ctx);
  const keyFile = `${file}.key`;
  if (existsSync(file) && existsSync(keyFile) && readFileSync(keyFile, 'utf8') === key) return log(`scene ${shot.scene}: unchanged, reused`);
  const { browser, page } = await openScene(shot, ctx);
  const ff = spawn('ffmpeg', ['-hide_banner', '-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', '30', '-c:v', 'mjpeg', '-i', '-', '-vf', vf, '-c:v', 'libx264', '-preset', 'medium', '-crf', '16', '-pix_fmt', 'yuv420p', '-r', '30', '-an', file], { stdio: ['pipe', 'inherit', 'inherit'] });
  const done = new Promise((res, rej) => ff.on('close', (c) => (c === 0 ? res() : rej(new Error(`scene encode failed (${c})`)))));
  for (let i = 0; i < n; i++) {
    await page.evaluate((t) => window.setT(t), i / 30);
    const jpg = await page.screenshot({ type: 'jpeg', quality: 96 });
    if (!ff.stdin.write(jpg)) await new Promise((r) => ff.stdin.once('drain', r));
  }
  ff.stdin.end();
  await done;
  await browser.close();
  writeFileSync(keyFile, key);
  log(`scene ${shot.scene}: ${n} frames`);
}

// Preview: node lib/scene.mjs <shot id | scene> <t> <out.png>
if (process.argv[1] === new URL(import.meta.url).pathname) {
  const [which, t, out] = process.argv.slice(2);
  const tl = readJson(join(HERE, 'timeline.json'));
  const s = tl.shots.find((x) => x.id === which || x.scene === which) ?? { id: `preview-${which}`, scene: which, start: '0:00', end: '0:12' };
  const secs = (v) => (typeof v === 'number' ? v : Number(v.split(':')[0]) * 60 + Number(v.split(':')[1]));
  const shot = { ...s, dur: +(secs(s.end) - secs(s.start)).toFixed(3) };
  const { browser, page } = await openScene(shot, { endCard: { live: true, hostedUrl: 'neighborline.onrender.com/demo', pendingDemo: tl.endCard.pendingDemo, repo: tl.endCard.repo, event: tl.endCard.event } });
  await page.evaluate((x) => window.setT(x), Number(t));
  await page.screenshot({ path: out });
  await browser.close();
}
