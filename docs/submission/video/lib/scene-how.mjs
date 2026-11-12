// "How it works" (Draft 7): five steps left to right, each appearing on its beat with the narration (E2), and the one
// line about what the AI never does. Same dark, cold style as the other drawn scenes (lib/scene.mjs renders it).
const STEPS = [
  ['Neighbor', 'Voice note', 'any language'],
  ['AI', 'Transcribes, translates, reads it back', 'she confirms in her own language'],
  ['Code', 'The group’s rules set the amount', 'written policy, not a model'],
  ['People', 'Two organizers approve', 'signed with passkeys'],
  ['PayPal', 'PayPal Payouts', '→ PayPal or Venmo'],
];

export const HOW_CSS = `
body{background:#090E17;color:#E6ECF2}
.bg{position:absolute;inset:0;background:radial-gradient(ellipse 70% 55% at 50% 52%,#152136 0%,transparent 72%),#090E17}
.kicker{position:absolute;left:150px;top:150px;font-family:'Atkinson Hyperlegible Mono Variable',monospace;font-size:23px;letter-spacing:.16em;text-transform:uppercase;color:#93A7C0}
h1{position:absolute;left:150px;top:190px;font-family:'Literata Variable',serif;font-weight:520;font-size:68px;letter-spacing:-0.015em;line-height:1.1;color:#E9EEF4}
.step{position:absolute;top:372px;width:300px;height:330px;box-sizing:border-box;padding:28px 26px;background:#101826;border:1.5px solid #22314A;border-radius:16px;box-shadow:0 30px 70px rgba(0,0,0,.45)}
.step .n{font-family:'Atkinson Hyperlegible Mono Variable',monospace;font-size:66px;font-weight:500;line-height:1;color:#EEF2F6}
.step .who{position:absolute;right:24px;top:34px;font-family:'Atkinson Hyperlegible Mono Variable',monospace;font-size:17px;letter-spacing:.12em;text-transform:uppercase;color:#93A7C0;border:1px solid #33455F;border-radius:999px;padding:5px 12px}
.step .t{margin-top:30px;font-size:29px;font-weight:600;line-height:1.22;color:#EEF2F6}
.step .s{position:absolute;left:26px;right:26px;bottom:26px;font-size:21px;line-height:1.3;color:#A9B9CC}
.arrow{position:absolute;top:522px;width:30px;height:30px}
.foot{position:absolute;left:150px;right:150px;top:790px;font-family:'Literata Variable',serif;font-weight:520;font-size:46px;letter-spacing:-0.01em;color:#E9EEF4}
.foot i{display:block;width:72px;height:3px;background:#5B6F8C;margin-bottom:26px;font-style:normal}`;

export function howBody() {
  const x = (i) => 150 + i * 330;
  return `<div class="bg"></div><div class="kicker" id="k">Neighborline</div><h1 id="h">How it works</h1>
${STEPS.map(([who, t, s], i) => `<div class="step" id="s${i + 1}" style="left:${x(i)}px;opacity:0"><div class="n">${i + 1}</div><div class="who">${who}</div><div class="t">${t}</div><div class="s">${s}</div></div>`).join('\n')}
${STEPS.slice(1).map((_, i) => `<svg class="arrow" id="a${i + 2}" style="left:${x(i) + 300}px;opacity:0" viewBox="0 0 30 30"><path d="M6 15h17M17 9l6 6-6 6" fill="none" stroke="#8FA3BD" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`).join('')}
<div class="foot" id="foot" style="opacity:0"><i></i>AI never decides who gets help, and never touches the money.</div>
<script>
const B = __BEATS__, DUR = __DUR__;
const ease = (x) => x <= 0 ? 0 : x >= 1 ? 1 : 1 - Math.pow(1 - x, 3);
const $ = (id) => document.getElementById(id);
const AT = [B.s1, B.s2, B.s3, B.s4, B.s5];
window.setT = (t) => {
  const f = ease(t / 0.6);
  $('k').style.opacity = f.toFixed(3); $('h').style.opacity = f.toFixed(3);
  AT.forEach((at, i) => {
    const e = ease((t - at) / 0.7);
    const el = $('s' + (i + 1));
    // The step being spoken is the bright one; earlier steps settle back a little.
    const next = i < 4 ? AT[i + 1] : B.foot;
    const settle = ease((t - next) / 0.8);
    el.style.opacity = (e * (1 - 0.18 * settle)).toFixed(3);
    el.style.transform = 'translateY(' + ((1 - e) * 16).toFixed(1) + 'px)';
    el.style.borderColor = e > 0 && settle < 0.5 ? '#6B7F9B' : '#22314A';
    if (i > 0) $('a' + (i + 1)).style.opacity = (0.9 * ease((t - at + 0.25) / 0.5)).toFixed(3);
  });
  const ft = ease((t - B.foot) / 0.9);
  $('foot').style.opacity = ft.toFixed(3);
  $('foot').style.transform = 'translateY(' + ((1 - ft) * 12).toFixed(1) + 'px)';
};
</script>`;
}
