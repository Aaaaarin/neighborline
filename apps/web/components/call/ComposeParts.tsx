'use client';

import type { Lang } from '@neighborline/core';
import { LoaderCircle, Mic, Play } from 'lucide-react';
import { cx } from '@/lib/format';
import type { UiStrings } from '@/lib/i18n';
import type { SampleVoiceNote, ScenarioId } from '@/lib/types';
import type { RecState } from './useRecorder';

/** The big hold-to-talk button (press-and-hold, or tap to start and tap to stop; Space/Enter too). */
export function RecordButton({
  t,
  lang,
  rec,
  recording,
  disabled,
  onPointerDown,
  onPointerUp,
  onKeyDown,
}: {
  t: UiStrings;
  lang: Lang;
  rec: { state: RecState; seconds: number; level: number };
  recording: boolean;
  disabled: boolean;
  onPointerDown: (e: React.PointerEvent) => void;
  onPointerUp: () => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
}) {
  return (
          <div className="my-6 flex flex-col items-center">
            <button
              type="button"
              aria-pressed={recording}
              aria-label={recording ? `${t.recording}, ${rec.seconds} seconds. ${t.tapToStop}` : t.holdToTalk}
              onPointerDown={onPointerDown}
              onPointerUp={onPointerUp}
              onKeyDown={onKeyDown}
              onContextMenu={(e) => e.preventDefault()}
              disabled={disabled}
              className={cx(
                'relative grid size-[132px] touch-none select-none place-items-center rounded-full text-raised transition-transform active:scale-[0.97]',
                recording ? 'bg-frost-ink' : 'bg-ink',
              )}
              style={recording ? { boxShadow: `0 0 0 ${8 + rec.level * 22}px color-mix(in oklab, var(--frost-ink) 18%, transparent)` } : undefined}
            >
              {rec.state === 'starting' ? <LoaderCircle size={40} className="animate-spin" aria-hidden /> : <Mic size={44} strokeWidth={1.8} aria-hidden />}
            </button>
            <p className="mt-4 text-[1rem] font-semibold tabular text-ink" aria-live="polite" lang={lang}>
              {recording ? `${t.recording} · 0:${String(rec.seconds).padStart(2, '0')}` : t.holdToTalk}
            </p>
            {recording && <p className="text-[0.85rem] text-ink-3" lang={lang}>{t.tapToStop}</p>}
            {(rec.state === 'denied' || rec.state === 'unsupported') && (
              <p role="alert" className="mt-3 max-w-[30ch] text-center text-[0.88rem] text-signal">
                {rec.state === 'denied' ? 'The microphone is blocked.' : 'This browser can’t record audio.'} Use a sample voice note below, or type instead.
              </p>
            )}
          </div>
  );
}

/** No microphone: bundled sample voice notes, one per scenario language. */
export function SampleNotes({
  samples,
  label,
  lang,
  disabled,
  onPick,
}: {
  samples: SampleVoiceNote[];
  label: string;
  lang: Lang;
  disabled: boolean;
  onPick: (id: ScenarioId) => void;
}) {
  return (
          <details className="group mt-6 rounded-2xl border border-rule bg-raised">
            <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between px-4 text-[0.92rem] font-medium text-ink [&::-webkit-details-marker]:hidden" lang={lang}>
              {label}
              <span aria-hidden className="text-ink-3 transition-transform group-open:rotate-180">▾</span>
            </summary>
            <ul className="border-t border-rule">
              {samples.map((s) => (
                <li key={s.id} className="border-b border-rule last:border-0">
                  <button type="button" onClick={() => onPick(s.id)} disabled={disabled} className="flex w-full items-center gap-3 px-4 py-3 text-start hover:bg-sunk">
                    <span className="grid size-9 shrink-0 place-items-center rounded-full bg-frost text-frost-ink" aria-hidden>
                      <Play size={14} fill="currentColor" />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[0.95rem] font-medium text-ink">
                        <span lang={s.lang}>{s.languageName}</span> · {s.speaker} · 0:{String(s.seconds).padStart(2, '0')}
                      </span>
                      <span className="block truncate text-[0.82rem] text-ink-3">{s.gist}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </details>
  );
}
