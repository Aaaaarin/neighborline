'use client';

import type { Lang } from '@neighborline/core';
import { Check, LoaderCircle, Mic, SendHorizontal, Square } from 'lucide-react';
import { useState } from 'react';
import { dirOf, type UiStrings } from '@/lib/i18n';
import { cx } from '@/lib/format';
import type { ThreadView } from '@/lib/types';
import type { RecState } from './useRecorder';

export const MAX_CHARS = 2000;

/**
 * The bottom of the neighbor's phone while the line is waiting for them: "Yes / Fix" after a read-back,
 * or the one clarifying question's answers (tap one, type, or say it). Always reachable, never scrolled away.
 */
export function ReplyDock({
  t,
  lang,
  thread,
  busy,
  error,
  rec,
  onConfirm,
  onFix,
  onReply,
  onRecord,
  onSampleAnswer,
}: {
  t: UiStrings;
  lang: Lang;
  thread: ThreadView;
  busy: boolean;
  error: string | null;
  rec: { state: RecState; seconds: number };
  onConfirm: () => void;
  onFix: () => void;
  onReply: (text: string) => Promise<boolean>;
  onRecord: () => void;
  /** No microphone here: let the offline demo stand in a sample answer (labelled in the thread). */
  onSampleAnswer: () => void;
}) {
  const [text, setText] = useState('');
  const q = thread.question ?? null;
  const confirm = thread.awaitingConfirmation;
  const recording = rec.state === 'recording';

  if (!q && !confirm) {
    return error ? (
      <p role="alert" lang={lang} dir={dirOf(lang)} className="mx-4 mb-3 text-[0.9rem] text-signal">
        {error}
      </p>
    ) : null;
  }

  const send = async (value: string) => {
    const v = value.trim();
    if (!v || busy) return;
    if (await onReply(v)) setText('');
  };
  const left = MAX_CHARS - text.length;

  return (
    <div className="shrink-0 border-t border-rule bg-screen px-3.5 pb-4 pt-3" lang={lang} dir={dirOf(lang)}>
      {confirm && (
        <div className="flex gap-2">
          <button type="button" onClick={onFix} disabled={busy} className="min-h-12 flex-1 rounded-full border border-frost-ink/40 bg-raised px-4 text-[0.95rem] font-medium text-frost-ink">
            {t.fix}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="inline-flex min-h-12 flex-[1.4] items-center justify-center gap-1.5 rounded-full bg-frost-ink px-4 text-[0.95rem] font-semibold text-raised disabled:opacity-70"
          >
            {busy ? <LoaderCircle size={17} className="animate-spin motion-reduce:animate-none" aria-hidden /> : <Check size={17} strokeWidth={2.6} aria-hidden />}
            {t.yes}
          </button>
        </div>
      )}
      {q && (
        <form
          className={cx(confirm && 'mt-3 border-t border-rule pt-3')}
          onSubmit={(e) => {
            e.preventDefault();
            void send(text);
          }}
        >
          {q.answers.length > 0 && (
            <div className="mb-2.5 flex flex-wrap gap-1.5" role="group" aria-label={q.text}>
              {q.answers.map((a) => (
                <button
                  key={a.send}
                  type="button"
                  disabled={busy}
                  onClick={() => void send(a.send)}
                  className={cx(
                    'min-h-11 rounded-full border border-rule-strong bg-raised px-3.5 text-[0.92rem] text-ink hover:bg-sunk disabled:opacity-60',
                    q.key === 'ask_household' && 'min-w-11 tabular',
                  )}
                >
                  {a.label}
                </button>
              ))}
            </div>
          )}
          {confirm && q.optional && <p className="mb-2 text-[0.8rem] leading-snug text-ink-3">{t.orJustYes}</p>}
          <label htmlFor="reply" className="sr-only">
            {q.text}
          </label>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onRecord}
              disabled={busy && !recording}
              aria-pressed={recording}
              aria-label={recording ? `${t.recording}, ${rec.seconds} s. ${t.tapToStop}` : t.answerByVoice}
              className={cx('grid size-12 shrink-0 place-items-center rounded-full text-raised', recording ? 'bg-frost-ink animate-breathe' : 'bg-ink')}
            >
              {rec.state === 'starting' ? <LoaderCircle size={20} className="animate-spin" aria-hidden /> : recording ? <Square size={16} fill="currentColor" aria-hidden /> : <Mic size={20} aria-hidden />}
            </button>
            <input
              id="reply"
              value={recording ? `${t.recording} · 0:${String(rec.seconds).padStart(2, '0')}` : text}
              readOnly={recording}
              onChange={(e) => setText(e.target.value)}
              maxLength={MAX_CHARS}
              enterKeyHint="send"
              autoComplete="off"
              dir="auto"
              placeholder={q.key === 'ask_payout' ? t.payoutHint : t.reply}
              aria-describedby={error ? 'reply-error' : undefined}
              className="h-12 min-w-0 flex-1 rounded-full border border-rule-strong bg-raised px-4 text-[1rem] text-ink placeholder:text-ink-3"
            />
            <button
              type="submit"
              disabled={!text.trim() || busy || recording}
              aria-label={t.send}
              className="grid size-12 shrink-0 place-items-center rounded-full bg-ink text-raised disabled:opacity-40"
            >
              {busy && !recording ? <LoaderCircle size={18} className="animate-spin motion-reduce:animate-none" aria-hidden /> : <SendHorizontal size={18} className="rtl:-scale-x-100" aria-hidden />}
            </button>
          </div>
          {left < 300 && (
            <p className={cx('mt-1.5 text-end text-[0.78rem] tabular', left <= 0 ? 'text-signal' : 'text-ink-3')} aria-live="polite">
              {t.charsLeft.replace('{n}', String(Math.max(0, left)))}
            </p>
          )}
          {(rec.state === 'denied' || rec.state === 'unsupported') && (
            <p className="mt-2 text-[0.82rem] leading-snug text-ink-2" lang={lang} dir={dirOf(lang)}>
              {rec.state === 'denied' ? t.micBlocked : t.micUnsupported} {t.micTypeAnswer}{' '}
              <button type="button" onClick={onSampleAnswer} className="font-semibold text-ink underline underline-offset-4">
                {t.sampleAnswer}
              </button>
            </p>
          )}
        </form>
      )}
      {error && (
        <p id="reply-error" role="alert" className="mt-2 text-[0.9rem] leading-snug text-signal">
          {error}
        </p>
      )}
    </div>
  );
}
