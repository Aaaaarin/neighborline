// The sound bed (Draft 6), synthesised with ffmpeg: no downloads, no samples.
//   wind  band-passed brown/pink noise with slow gusts and a faint whistle, over a low A drone: under Act 1 only,
//         cut at the one-line beat so her voice note starts in near-silence;
//   pads  a slow-attack A-major add9 sine chord, low-passed: from the SUCCESS event (the only sound in the
//         tap-and-money silence) and again, longer, from the lamp in the close.
// Levels come from timeline.json → sound (`belowVo`, dB under the measured loudness of the narration), and the bed is
// also ducked under the VO with a sidechain compressor. The final mix is set to −14 LUFS with a static gain and a
// limiter (≤ −1 dBTP), not with single-pass loudnorm, which would pump the bed up in every pause.
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { DIRS, ffmpeg, log } from './common.mjs';
import { voChains } from './vo.mjs';

/** Integrated loudness (LUFS) and true peak (dBTP) of an audio file or of the audio in a video. */
export function loudness(file) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-map', '0:a', '-af', 'ebur128=peak=true', '-f', 'null', '-'], { encoding: 'utf8', maxBuffer: 1 << 28 });
  const tail = r.stderr.slice(r.stderr.lastIndexOf('Summary:'));
  const I = Number(/I:\s+(-?[\d.]+) LUFS/.exec(tail)?.[1]);
  const TP = Number(/Peak:\s+(-?[\d.]+) dBFS/.exec(tail)?.[1]);
  const LRA = Number(/LRA:\s+(-?[\d.]+) LU/.exec(tail)?.[1]);
  if (!Number.isFinite(I)) throw new Error(`could not measure loudness of ${file}`);
  return { I, TP, LRA };
}

const stereo = (l, r, out) => `[${l}][${r}]join=inputs=2:channel_layout=stereo[${out}]`;

/** Wind + drone, `dur` seconds, stereo (each channel has its own noise seed, so it is wide but mono-safe). */
function renderWind(dur, { fadeIn, fadeOut }, file) {
  const f = [];
  // Gusts: products of slow sines with unrelated periods, so the swell never visibly loops in 26 s.
  const gust = (a, b, c, p) => `volume='${a}+${b}*pow(0.5+0.5*sin(2*PI*${c}*t+${p}),2)*(0.6+0.4*sin(2*PI*${(c * 0.37).toFixed(4)}*t+${p}*2))':eval=frame`;
  ['L', 'R'].forEach((ch, i) => {
    f.push(`anoisesrc=c=brown:r=48000:d=${dur}:s=${11 + i}:a=0.9,highpass=f=70,lowpass=f=380,${gust(0.5, 0.5, 0.083, 1.1 + i)}[lo${ch}]`);
    f.push(`anoisesrc=c=pink:r=48000:d=${dur}:s=${21 + i}:a=0.8,bandpass=f=560:width_type=o:w=1.6,${gust(0.12, 0.88, 0.117, 0.3 + i * 0.7)},volume=0.55[mid${ch}]`);
    // The whistle: a narrow band whose pitch drifts (vibrato is a modulated delay), heard only on the gusts.
    f.push(`anoisesrc=c=white:r=48000:d=${dur}:s=${31 + i}:a=0.8,bandpass=f=${1180 + i * 90}:width_type=q:w=14,vibrato=f=0.13:d=0.5,${gust(0.0, 1.0, 0.061, 2.2 + i * 1.3)},volume=0.5[hi${ch}]`);
    f.push(`[lo${ch}][mid${ch}][hi${ch}]amix=inputs=3:normalize=0[w${ch}]`);
  });
  f.push(stereo('wL', 'wR', 'wind'));
  f.push(`aevalsrc='0.5*sin(2*PI*55*t)+0.3*sin(2*PI*82.41*t)+0.12*sin(2*PI*110.3*t)|0.5*sin(2*PI*55.2*t)+0.3*sin(2*PI*82.2*t)+0.12*sin(2*PI*109.8*t)':s=48000:d=${dur},tremolo=f=0.11:d=0.35,volume=0.16[drone]`);
  f.push(`[wind][drone]amix=inputs=2:normalize=0,afade=t=in:st=0:d=${fadeIn}:curve=qsin,afade=t=out:st=${(dur - fadeOut).toFixed(3)}:d=${fadeOut}[a]`);
  ffmpeg(['-filter_complex', f.join(';'), '-map', '[a]', '-t', String(dur), '-c:a', 'pcm_s16le', file]);
}

/** A-major add9 (A2 A3 C#4 E4 B4), two slightly detuned sines per note across the channels, low-passed. */
function renderPad(dur, { attack, release }, file) {
  const notes = [[110, 0.5], [220, 0.7], [277.18, 0.5], [329.63, 0.55], [493.88, 0.22]];
  const side = (d) => notes.map(([hz, a]) => `${a}*sin(2*PI*${(hz + d * (hz / 440) * 0.9).toFixed(3)}*t)`).join('+');
  const f = `aevalsrc='${side(-1)}|${side(1)}':s=48000:d=${dur},lowpass=f=1100,volume=0.2,afade=t=in:st=0:d=${attack}:curve=qsin,afade=t=out:st=${(dur - release).toFixed(3)}:d=${release}:curve=qsin,aecho=0.8:0.5:110|190:0.22|0.12[a]`;
  ffmpeg(['-filter_complex', f, '-map', '[a]', '-t', String(dur), '-c:a', 'pcm_s16le', file]);
}

/**
 * Mixes VO + bed onto the captioned video. `sound` is the resolved timeline sound block
 * ({ wind: { start, end, … }, pads: [{ id, start, end, … }] }, seconds). Returns the measured loudness.
 */
export function mixWithBed(videoIn, voFiles, sound, out) {
  const tmp = (n) => join(DIRS.cache, `sound-${n}.wav`);
  // 1. The narration alone: its loudness is the reference for the bed.
  const { args, chains, label } = voChains(voFiles, 0);
  ffmpeg([...args, '-filter_complex', [...chains, `[${label}]anull[a]`].join(';'), '-map', '[a]', '-c:a', 'pcm_s16le', tmp('vo')]);
  const narr = voFiles.filter((f) => f.id !== 'lan_voice');
  const one = voChains(narr, 0);
  ffmpeg([...one.args, '-filter_complex', [...one.chains, `[${one.label}]anull[a]`].join(';'), '-map', '[a]', '-c:a', 'pcm_s16le', tmp('narr')]);
  const voI = loudness(tmp('narr')).I;

  // 2. The bed elements, each gained to `belowVo` under the narration.
  const parts = [];
  if (sound.wind) {
    const w = sound.wind;
    renderWind(+(w.end - w.start).toFixed(3), w, tmp('wind'));
    parts.push({ file: tmp('wind'), start: w.start, gain: voI - w.belowVo - loudness(tmp('wind')).I, id: 'wind' });
  }
  for (const p of sound.pads ?? []) {
    renderPad(+(p.end - p.start).toFixed(3), p, tmp(`pad-${p.id}`));
    parts.push({ file: tmp(`pad-${p.id}`), start: p.start, gain: voI - p.belowVo - loudness(tmp(`pad-${p.id}`)).I, id: `pad ${p.id}` });
  }
  for (const p of parts) log(`sound: ${p.id} at ${p.start.toFixed(2)} s, ${p.gain.toFixed(1)} dB (narration ${voI.toFixed(1)} LUFS)`);

  // 3. Pre-mix: bed ducked under the VO.
  const inp = ['-i', tmp('vo')];
  const f = ['[0:a]asplit=2[vo][key]'];
  parts.forEach((p, i) => {
    inp.push('-i', p.file);
    const ms = Math.round(p.start * 1000);
    f.push(`[${i + 1}:a]volume=${p.gain.toFixed(2)}dB,adelay=${ms}|${ms}[b${i}]`);
  });
  f.push(`${parts.map((_, i) => `[b${i}]`).join('')}amix=inputs=${parts.length}:normalize=0,apad[bed]`);
  f.push(`[bed][key]sidechaincompress=threshold=0.05:ratio=2:attack=40:release=700:makeup=1[duck]`);
  f.push(`[vo][duck]amix=inputs=2:normalize=0:duration=first[a]`);
  ffmpeg([...inp, '-filter_complex', f.join(';'), '-map', '[a]', '-c:a', 'pcm_s16le', tmp('premix')]);

  // 4. −14 LUFS with a static gain, peaks caught by a limiter; one correction pass for what the limiter took.
  const pre = loudness(tmp('premix'));
  let gain = -14 - pre.I;
  const master = (g, to, codec) => ffmpeg(['-i', videoIn, '-i', tmp('premix'), '-filter_complex', `[1:a]volume=${g.toFixed(2)}dB,alimiter=limit=0.79:attack=5:release=60:level=false,apad[a]`, '-map', '0:v', '-map', '[a]', '-shortest', '-c:v', 'copy', ...codec, '-movflags', '+faststart', to]);
  const aac = ['-c:a', 'aac', '-b:a', '192k', '-ar', '48000'];
  master(gain, out, aac);
  let got = loudness(out);
  if (Math.abs(got.I + 14) > 0.3) {
    gain += -14 - got.I;
    master(gain, out, aac);
    got = loudness(out);
  }
  log(`sound: mix ${got.I.toFixed(1)} LUFS, true peak ${got.TP.toFixed(1)} dBTP, LRA ${got.LRA.toFixed(1)} LU (gain ${gain.toFixed(1)} dB)`);
  if (got.TP > -1) log(`WARNING true peak ${got.TP} dBTP is above −1`);
  return { ...got, narration: voI, parts: parts.map((p) => ({ id: p.id, start: +p.start.toFixed(2), gainDb: +p.gain.toFixed(1) })) };
}
