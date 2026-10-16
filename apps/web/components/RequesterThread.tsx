'use client';

import type { Lang } from '@neighborline/core';
import { Camera, Check, Play, Volume2 } from 'lucide-react';
import { useEffect, useRef } from 'react';
import type { ThreadMessage } from '@/lib/types';
import { dirOf, ui, speechTag } from '@/lib/i18n';
import { clockTime, cx, money, shortId, walletLabel } from '@/lib/format';

/** Deterministic waveform so the same voice note always looks the same. */
export function Waveform({ seed, bars = 30, playing = false, className }: { seed: string; bars?: number; playing?: boolean; className?: string }) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  const heights = Array.from({ length: bars }, (_, i) => {
    h = Math.imul(h ^ (i + 1), 2654435761);
    const v = ((h >>> 0) % 1000) / 1000;
    const env = Math.sin((Math.PI * (i + 1)) / (bars + 1));
    return 0.18 + 0.82 * v * (0.45 + 0.55 * env);
  });
  return (
    <span className={cx('flex h-7 items-center gap-[2px]', className)} aria-hidden>
      {heights.map((v, i) => (
        <span
          key={i}
          className="w-[3px] rounded-full bg-current"
          style={{
            height: `${Math.round(v * 100)}%`,
            animation: playing ? `nl-wave ${0.7 + (i % 5) * 0.12}s ease-in-out ${i * 0.03}s infinite` : undefined,
          }}
        />
      ))}
    </span>
  );
}

export function speak(text: string, lang: Lang) {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return false;
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = speechTag(lang);
  u.rate = 0.95;
  window.speechSynthesis.speak(u);
  return true;
}

export function RequesterThread({
  messages,
  lang,
  translated,
  awaitingConfirmation,
  onConfirm,
  onFix,
  busy,
  className,
  emptyHint,
}: {
  messages: ThreadMessage[];
  lang: Lang;
  translated: boolean;
  awaitingConfirmation: boolean;
  onConfirm?: () => void;
  onFix?: () => void;
  busy?: boolean;
  className?: string;
  emptyHint?: React.ReactNode;
}) {
  const t = ui(lang);
  const box = useRef<HTMLDivElement>(null);
  const first = useRef(true);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    // Scroll only this conversation, never the page around it.
    el.scrollTo({ top: el.scrollHeight, behavior: first.current ? 'auto' : 'smooth' });
    first.current = false;
  }, [messages.length, messages.at(-1)?.text, awaitingConfirmation, translated]);

  return (
    <div ref={box} className={cx('flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto px-3.5 pb-4 pt-2', className)} role="log" aria-live="polite" aria-label="Conversation" dir={dirOf(lang)}>
      {messages.length === 0 && emptyHint}
      {messages.map((m) => (
        <Bubble key={m.id} m={m} translated={translated} lang={lang} />
      ))}
      {awaitingConfirmation && (
        <div className="flex flex-wrap justify-end gap-2 pt-1 animate-rise" lang={lang}>
          <button
            type="button"
            onClick={onFix}
            disabled={!onFix || busy}
            className="min-h-11 rounded-full border border-frost-ink/40 bg-raised px-4 text-[0.92rem] font-medium text-frost-ink disabled:cursor-default"
          >
            {t.fix}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={!onConfirm || busy}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-frost-ink px-4 text-[0.92rem] font-semibold text-raised disabled:cursor-default"
          >
            <Check size={16} strokeWidth={2.6} aria-hidden />
            {t.yes}
          </button>
        </div>
      )}
    </div>
  );
}

function Bubble({ m, translated, lang }: { m: ThreadMessage; translated: boolean; lang: Lang }) {
  const mine = m.from === 'neighbor';
  const t = ui(lang);
  const en = translated && m.textEn && m.textEn !== m.text && m.lang !== 'en' ? m.textEn : null;
  const time = <span className={cx('mt-1 block text-end text-[0.68rem] tabular', mine ? 'text-frost-ink' : 'text-ink-3')}>{clockTime(m.at)}</span>;

  if (m.kind === 'paid') {
    return (
      <div className="max-w-[88%] self-start animate-rise">
        <div className="rounded-[20px] rounded-es-md border border-lamp bg-raised p-3.5 animate-glow">
          <p className="flex items-baseline gap-2">
            <span className="text-[1.9rem] font-semibold leading-none text-ink">{m.meta?.amountCents ? money(m.meta.amountCents) : ''}</span>
            <span className="text-[0.82rem] text-lamp-ink">
              {m.meta?.wallet ? walletLabel(m.meta.wallet) : ''} · {t.arrived}
            </span>
          </p>
          <p lang={m.lang} dir={dirOf(m.lang)} className="mt-2 text-[0.92rem] leading-snug text-ink">
            {m.text.replace(m.meta?.transactionId ?? '§', shortId(m.meta?.transactionId, 6, 4))}
          </p>
          {en && <Translation text={en.replace(m.meta?.transactionId ?? '§', shortId(m.meta?.transactionId, 6, 4))} />}
          {time}
        </div>
      </div>
    );
  }

  return (
    <div className={cx('max-w-[86%] animate-rise', mine ? 'self-end' : 'self-start')}>
      <div
        className={cx(
          'rounded-[20px] px-3.5 py-2.5',
          mine ? 'rounded-ee-md bg-frost text-frost-ink' : 'rounded-es-md border border-rule bg-raised text-ink',
          m.kind === 'claim_help' && 'border-ink/40',
          m.kind === 'blocked' && 'border-signal/40',
        )}
      >
        {m.kind === 'voice' ? (
          <>
            <div className="flex items-center gap-2.5">
              <span className="grid size-8 shrink-0 place-items-center rounded-full bg-frost-ink text-frost" aria-hidden>
                <Play size={14} fill="currentColor" />
              </span>
              <Waveform seed={m.id} className="flex-1 text-frost-ink/80" />
              <span className="text-[0.75rem] tabular">0:{String(m.meta?.audioSeconds ?? 0).padStart(2, '0')}</span>
            </div>
            <span className="sr-only">{t.voiceNote}</span>
            {m.text ? (
              <p lang={m.lang} dir={dirOf(m.lang)} className="mt-2 border-t border-frost-ink/15 pt-2 text-[0.88rem] leading-snug">
                {m.text}
              </p>
            ) : (
              <p className="mt-2 border-t border-frost-ink/15 pt-2 text-[0.82rem] italic animate-breathe" lang={lang}>
                {t.transcribing}
              </p>
            )}
          </>
        ) : m.kind === 'photo' ? (
          <p className="flex items-center gap-2 text-[0.88rem]">
            <Camera size={16} aria-hidden /> {m.text}
          </p>
        ) : (
          <p lang={m.lang} dir={dirOf(m.lang)} className="whitespace-pre-line text-[0.92rem] leading-snug">
            {m.text}
          </p>
        )}
        {m.kind === 'readback' && (
          <button
            type="button"
            onClick={() => speak(m.text, m.lang)}
            className="mt-2 inline-flex min-h-8 items-center gap-1.5 rounded-full bg-sunk px-3 text-[0.8rem] font-medium text-ink-2"
            lang={m.lang}
          >
            <Volume2 size={14} aria-hidden /> {t.listen}
          </button>
        )}
        {en && <Translation text={en} onDark={mine} />}
        {time}
      </div>
    </div>
  );
}

function Translation({ text, onDark = false }: { text: string; onDark?: boolean }) {
  return (
    <p lang="en" dir="ltr" className={cx('mt-2 border-t pt-2 text-[0.8rem] leading-snug', onDark ? 'border-frost-ink/15 text-frost-ink/85' : 'border-rule text-ink-3')}>
      <span className="me-1 rounded bg-sunk px-1 text-[0.68rem] font-semibold text-ink-2">EN</span>
      {text}
    </p>
  );
}
