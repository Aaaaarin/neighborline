// Burn-in captions as ASS (libass) with per-composition placement, from the same cues as the YouTube SRT.
import { LAYOUT } from './segments.mjs';
import { compOf } from './timeline.mjs';

// ASS colours are &HAABBGGRR.
const INK = '&H002E2018';
const BOX = '&H14F8FAF9'; // --paper-raised, ~92 % opaque
const FROST_INK = '&H005E4427';
const FROST_BOX = '&H10EAE2D6';

const style = (name, { font = 'Be Vietnam Pro SemiBold', size = 38, colour = INK, box = BOX, align = 2, l = 80, r = 80, v = 40 } = {}) =>
  `Style: ${name},${font},${size},${colour},${colour},${box},${box},0,0,0,0,100,100,0,0,3,11,0,${align},${l},${r},${v},1`;

const styleFor = (comp) => {
  const c = LAYOUT[comp]?.caption ?? { style: 'C' };
  return c.style === 'R' ? `R${c.marginL}` : 'C';
};

const assTime = (s) => {
  const cs = Math.round(s * 100);
  return `${Math.floor(cs / 360000)}:${String(Math.floor(cs / 6000) % 60).padStart(2, '0')}:${String(Math.floor(cs / 100) % 60).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`;
};

export function toAss(T, cues) {
  const rMargins = [...new Set(Object.values(LAYOUT).map((L) => L.caption).filter((c) => c?.style === 'R').map((c) => c.marginL))];
  const styles = [
    style('C', { align: 2, v: 34 }),
    ...rMargins.map((m) => style(`R${m}`, { align: 1, l: m + 11, r: 90, v: 52 })),
    ...rMargins.map((m) => style(`Q${m}`, { font: 'Be Vietnam Pro', colour: FROST_INK, box: FROST_BOX, align: 1, l: m + 11, r: 90, v: 52 })),
    style('QC', { font: 'Be Vietnam Pro', colour: FROST_INK, box: FROST_BOX, align: 2, v: 34 }),
  ];
  const events = [];
  for (const c of cues) {
    if (c.burn === false) continue; // already drawn by the shot itself (the cold open's words); SRT only
    // Split a cue where it crosses a cut into a composition with a different caption position.
    const cuts = T.shots.filter((s) => s.start > c.start && s.start < c.end).map((s) => s.start);
    const bounds = [c.start, ...cuts, c.end];
    for (let i = 0; i < bounds.length - 1; i++) {
      const comp = compOf(T.shotAt(bounds[i] + 0.001));
      let st = styleFor(comp);
      if (c.kind === 'quote') st = st === 'C' ? 'QC' : `Q${st.slice(1)}`;
      const text = (c.kind === 'quote' ? [`{\\fs24}${c.who}{\\fs38}`, ...c.lines] : c.lines).join('\\N');
      events.push(`Dialogue: 0,${assTime(bounds[i])},${assTime(bounds[i + 1])},${st},,0,0,0,,${text}`);
    }
  }
  return `[Script Info]
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080
WrapStyle: 2
ScaledBorderAndShadow: yes
YCbCr Matrix: TV.709

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
${styles.join('\n')}

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${events.join('\n')}
`;
}
