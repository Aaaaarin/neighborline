'use client';

import type { Lang } from '@neighborline/core';
import { Camera, Check, Keyboard, LoaderCircle, Mic, Play, SendHorizontal, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError, openStream } from '@/lib/api';
import { dirOf, ui } from '@/lib/i18n';
import { LANGUAGE_NAMES, cx } from '@/lib/format';
import type { SampleVoiceNote, ScenarioId, ThreadView } from '@/lib/types';
import { RequesterThread } from '../RequesterThread';
import { LineAvatar } from '../stage/RequesterPhone';
import { useRecorder } from './useRecorder';

type Mode = 'compose' | 'typing' | 'sending' | 'thread';
const PICKABLE: Lang[] = ['vi', 'es', 'ht', 'en', 'zh', 'ar', 'fr', 'tl', 'ko', 'ru'];

export function CallApp({ samples }: { samples: SampleVoiceNote[] }) {
  const [picked, setPicked] = useState<Lang | 'auto'>('auto');
  const [mode, setMode] = useState<Mode>('compose');
  const [requestId, setRequestId] = useState<string | null>(null);
  const [thread, setThread] = useState<ThreadView | null>(null);
  const [text, setText] = useState('');
  const [fixing, setFixing] = useState(false);
  const [photo, setPhoto] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [simulated, setSimulated] = useState(false);
  const [busy, setBusy] = useState(false);
  const [translated, setTranslated] = useState(false);
  const rec = useRecorder();
  const pressAt = useRef(0);
  const photoUrl = useRef<string | null>(null);

  const lang: Lang = thread?.lang ?? (picked === 'auto' ? 'en' : picked);
  const t = ui(picked === 'auto' && !thread ? 'en' : lang);

  const refresh = useCallback(async (id: string) => {
    try {
      setThread(await api.thread(id));
    } catch {
      /* retry on next event */
    }
  }, []);

  useEffect(() => {
    if (!requestId) return;
    return openStream(() => void refresh(requestId), { requestId });
  }, [requestId, refresh]);

  useEffect(() => {
    if (photo) photoUrl.current = URL.createObjectURL(photo);
    return () => {
      if (photoUrl.current) URL.revokeObjectURL(photoUrl.current);
      photoUrl.current = null;
    };
  }, [photo]);

  const ensureRequest = async (channel: 'web_voice' | 'web_text') => {
    if (requestId) return requestId;
    const { requestId: id } = await api.startIntake({ groupSlug: 'eastside', channel, lang: picked === 'auto' ? undefined : picked });
    setRequestId(id);
    return id;
  };

  const run = async (fn: () => Promise<void>) => {
    setError(null);
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'We couldn’t reach Neighborline. Check your connection and try again.');
      setMode((m) => (m === 'sending' ? 'compose' : m));
    } finally {
      setBusy(false);
    }
  };

  const sendAudio = (input: { audio?: Blob; sampleId?: ScenarioId }) =>
    run(async () => {
      setMode('sending');
      const id = await ensureRequest('web_voice');
      const res = await api.submitAudio(id, { ...input, lang: picked === 'auto' ? undefined : picked, photo: photo ?? undefined });
      setSimulated(res.simulatedTranscript);
      setTranslated(res.transcript.lang !== 'en');
      setPhoto(null);
      await refresh(id);
      setMode('thread');
    });

  const sendText = () =>
    run(async () => {
      const body = text.trim();
      if (!body) return;
      if (fixing && requestId) {
        await api.confirm(requestId, { confirmed: false, corrections: body });
        setFixing(false);
        setText('');
        await refresh(requestId);
        setMode('thread');
        return;
      }
      setMode('sending');
      const id = await ensureRequest('web_text');
      await api.submitText(id, { text: body, lang: picked === 'auto' ? undefined : picked });
      setText('');
      setSimulated(true);
      await refresh(id);
      setMode('thread');
    });

  const confirm = () =>
    run(async () => {
      if (!requestId) return;
      const r = await api.confirm(requestId, { confirmed: true });
      setThread(r.thread);
    });

  const finishRecording = async () => {
    const blob = await rec.stop();
    if (blob && blob.size > 0) await sendAudio({ audio: blob });
  };

  useEffect(() => {
    if (rec.state === 'recording' && rec.seconds >= 120) void finishRecording();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rec.seconds, rec.state]);

  const onPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    if (rec.state === 'recording') return void finishRecording();
    pressAt.current = performance.now();
    void rec.start();
  };
  const onPointerUp = () => {
    // Held longer than a tap: release sends. A quick tap leaves it recording until the next tap.
    if (rec.state === 'recording' && performance.now() - pressAt.current > 450) void finishRecording();
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    if (rec.state === 'recording') void finishRecording();
    else void rec.start();
  };

  const recording = rec.state === 'recording';
  const status = thread?.status;
  const item = thread?.itemStatus;

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col" dir={dirOf(picked === 'auto' && !thread ? 'en' : lang)}>
      {/* app bar */}
      <div className="flex shrink-0 items-center gap-2.5 border-b border-rule px-4 pb-3 pt-2">
        <LineAvatar />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[1rem] font-semibold leading-tight text-ink">Neighborline</p>
          <p className="truncate text-[0.78rem] text-ink-3" lang={lang}>
            {t.lineSub}
          </p>
        </div>
        {thread && thread.lang !== 'en' ? (
          <button
            type="button"
            role="switch"
            aria-checked={translated}
            onClick={() => setTranslated((v) => !v)}
            className={cx('h-9 rounded-full border px-3 text-[0.8rem] font-semibold', translated ? 'border-ink bg-ink text-raised' : 'border-rule-strong text-ink-2')}
          >
            EN<span className="sr-only"> translation</span>
          </button>
        ) : (
          !thread && (
            <label className="relative">
              <span className="sr-only">{t.language}</span>
              <select
                value={picked}
                onChange={(e) => setPicked(e.target.value as Lang | 'auto')}
                className="h-10 max-w-[9.5rem] appearance-none rounded-full border border-rule-strong bg-raised ps-3.5 pe-8 text-[0.85rem] text-ink"
              >
                <option value="auto">Any language</option>
                {PICKABLE.map((l) => (
                  <option key={l} value={l} lang={l}>
                    {LANGUAGE_NAMES[l].native}
                  </option>
                ))}
              </select>
              <span aria-hidden className="pointer-events-none absolute end-3 top-1/2 -translate-y-1/2 text-[0.7rem] text-ink-3">
                ▼
              </span>
            </label>
          )
        )}
      </div>

      {thread && (
        <StatusSteps t={t} status={status} itemStatus={item ?? null} approvals={thread.approvalsCount} required={thread.approvalsRequired} lang={lang} />
      )}

      {mode === 'thread' || (thread && mode !== 'typing') ? (
        <>
          <RequesterThread
            messages={thread?.messages ?? []}
            lang={lang}
            translated={translated}
            awaitingConfirmation={!!thread?.awaitingConfirmation}
            onConfirm={confirm}
            onFix={() => {
              setFixing(true);
              setMode('typing');
            }}
            busy={busy}
          />
          {simulated && (
            <p className="mx-4 mb-2 rounded-xl border border-dashed border-rule-strong px-3 py-2 text-[0.78rem] leading-snug text-ink-2">
              Offline demo: no live speech-to-text is configured, so a sample transcript stands in for your recording.
            </p>
          )}
          {status === 'awaiting_approval' && (
            <p className="mx-4 mb-4 text-center text-[0.8rem] text-ink-3">
              Trying the demo on your own? <a className="font-semibold text-ink underline underline-offset-4" href="/organizer" target="_blank" rel="noreferrer">Open the organizer queue</a> and approve it as two organizers.
            </p>
          )}
        </>
      ) : mode === 'sending' ? (
        <div className="grid flex-1 place-items-center px-8 text-center" role="status">
          <div>
            <LoaderCircle size={34} className="mx-auto animate-spin text-ink-3 motion-reduce:animate-none" aria-hidden />
            <p className="mt-4 font-display text-[1.25rem] text-ink" lang={lang}>
              {t.transcribing}
            </p>
          </div>
        </div>
      ) : mode === 'typing' ? (
        <form
          className="flex flex-1 flex-col gap-3 p-4"
          onSubmit={(e) => {
            e.preventDefault();
            void sendText();
          }}
        >
          <label htmlFor="say" className="font-display text-[1.3rem] text-ink" lang={lang}>
            {fixing ? `${t.fix}:` : t.askTitle}
          </label>
          <textarea
            id="say"
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={6}
            autoFocus
            lang={lang}
            placeholder={fixing ? 'What should we change?' : 'Power is out since the storm. I need a heater. My Venmo is @…'}
            className="min-h-40 w-full flex-1 resize-none rounded-2xl border border-rule-strong bg-raised p-4 text-[1.05rem] leading-relaxed text-ink placeholder:text-ink-3"
          />
          <div className="flex gap-2">
            <button type="button" onClick={() => setMode(thread ? 'thread' : 'compose')} className="h-12 rounded-full border border-rule-strong px-5 text-ink">
              <Mic size={18} aria-hidden className="inline" /> <span className="sr-only">Back to voice</span>
            </button>
            <button type="submit" disabled={!text.trim() || busy} className="flex h-12 flex-1 items-center justify-center gap-2 rounded-full bg-ink font-semibold text-raised disabled:opacity-50">
              <SendHorizontal size={18} aria-hidden />
              <span lang={lang}>{t.send}</span>
            </button>
          </div>
        </form>
      ) : (
        <div className="flex flex-1 flex-col overflow-y-auto px-5 pb-6 pt-6">
          <h1 className="text-[2rem] leading-tight text-ink" lang={picked === 'auto' ? 'en' : lang}>
            {t.askTitle}
          </h1>
          <p className="mt-2 text-[1rem] leading-relaxed text-ink-2" lang={picked === 'auto' ? 'en' : lang}>
            {t.askSub}
          </p>

          <div className="my-6 flex flex-col items-center">
            <button
              type="button"
              aria-pressed={recording}
              aria-label={recording ? `${t.recording}, ${rec.seconds} seconds. ${t.tapToStop}` : t.holdToTalk}
              onPointerDown={onPointerDown}
              onPointerUp={onPointerUp}
              onKeyDown={onKey}
              onContextMenu={(e) => e.preventDefault()}
              disabled={busy}
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

          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => setMode('typing')} className="flex min-h-12 items-center justify-center gap-2 rounded-2xl border border-rule-strong bg-raised text-[0.95rem] text-ink" lang={lang}>
              <Keyboard size={18} aria-hidden /> {t.typeInstead}
            </button>
            <label className="flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-2xl border border-rule-strong bg-raised text-[0.95rem] text-ink has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-ink" lang={lang}>
              <Camera size={18} aria-hidden /> {t.addPhoto}
              <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} />
            </label>
          </div>
          {photo && (
            <p className="mt-2 flex items-center justify-between rounded-xl bg-sunk px-3 py-2 text-[0.85rem] text-ink-2">
              <span className="truncate">Photo attached: {photo.name}</span>
              <button type="button" onClick={() => setPhoto(null)} aria-label="Remove photo" className="grid size-8 place-items-center rounded-full">
                <X size={16} aria-hidden />
              </button>
            </p>
          )}

          <details className="group mt-6 rounded-2xl border border-rule bg-raised">
            <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between px-4 text-[0.92rem] font-medium text-ink [&::-webkit-details-marker]:hidden" lang={lang}>
              {t.noMic}
              <span aria-hidden className="text-ink-3 transition-transform group-open:rotate-180">▾</span>
            </summary>
            <ul className="border-t border-rule">
              {samples.map((s) => (
                <li key={s.id} className="border-b border-rule last:border-0">
                  <button type="button" onClick={() => void sendAudio({ sampleId: s.id })} disabled={busy} className="flex w-full items-center gap-3 px-4 py-3 text-start hover:bg-sunk">
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
          {error && (
            <p role="alert" className="mt-4 text-[0.9rem] text-signal">
              {error}
            </p>
          )}
        </div>
      )}
      {error && mode !== 'compose' && (
        <p role="alert" className="mx-4 mb-3 text-[0.9rem] text-signal">
          {error}
        </p>
      )}
    </div>
  );
}

function StatusSteps({
  t,
  status,
  itemStatus,
  approvals,
  required,
  lang,
}: {
  t: ReturnType<typeof ui>;
  status: ThreadView['status'] | undefined;
  itemStatus: ThreadView['itemStatus'];
  approvals: number;
  required: number;
  lang: Lang;
}) {
  if (!status || status === 'intake' || status === 'needs_clarification') return null;
  const declined = status === 'declined';
  const third = declined ? t.declined : itemStatus === 'UNCLAIMED' ? t.claim : t.arrived;
  const stage = declined ? 2 : status === 'awaiting_approval' ? 0 : status === 'paying' || status === 'approved' ? 1 : 2;
  const steps = [`${t.waiting} · ${approvals}/${required}`, t.sending, third];
  const warm = status === 'paid';
  return (
    <ol className="grid shrink-0 grid-cols-3 gap-1.5 px-4 py-3" aria-label="Status" lang={lang}>
      {steps.map((s, i) => {
        const done = i < stage || (i === stage && i === 2);
        const current = i === stage;
        return (
          <li key={i} aria-current={current ? 'step' : undefined}>
            <span
              className={cx(
                'block h-1.5 rounded-full',
                done && i === 2 && warm ? 'bg-lamp' : done || current ? 'bg-ink' : 'bg-rule',
                current && i !== 2 && 'animate-breathe',
              )}
            />
            <span className={cx('mt-1.5 flex items-start gap-1 text-[0.72rem] leading-tight', current ? 'font-semibold text-ink' : 'text-ink-3')}>
              {done && <Check size={12} className="mt-px shrink-0" aria-hidden />}
              {s}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
