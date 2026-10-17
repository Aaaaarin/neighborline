'use client';

import type { Lang } from '@neighborline/core';
import { Camera, Keyboard, LoaderCircle, Mic, RotateCcw, SendHorizontal, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError, openStream } from '@/lib/api';
import { dirOf, fill, ui } from '@/lib/i18n';
import { LANGUAGE_NAMES, cx } from '@/lib/format';
import type { SampleVoiceNote, ScenarioId, ThreadView } from '@/lib/types';
import { RequesterThread } from '../RequesterThread';
import { LineAvatar } from '../stage/RequesterPhone';
import { errorText, saved } from './call-session';
import { MAX_CHARS, ReplyDock } from './ReplyDock';
import { RecordButton, SampleNotes } from './ComposeParts';
import { StatusSteps } from './StatusSteps';
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
  const replyRecording = useRef(false);

  const lang: Lang = thread?.lang ?? (picked === 'auto' ? 'en' : picked);
  const t = ui(picked === 'auto' && !thread ? 'en' : lang);

  const refresh = useCallback(async (id: string) => {
    try {
      const next = await api.thread(id);
      setThread(next);
      return next;
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) {
        // The demo was reset or the request is gone: start fresh instead of showing an empty phone.
        saved.set(null);
        setRequestId(null);
        setThread(null);
        setMode('compose');
      }
      return null;
    }
  }, []);

  // Survive a refresh mid-conversation: the thread comes back from the server.
  useEffect(() => {
    const id = saved.get();
    if (!id) return;
    setRequestId(id);
    void refresh(id).then((th) => {
      if (th && th.messages.length) setMode('thread');
    });
  }, [refresh]);

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
    saved.set(id);
    return id;
  };

  /** Runs one step; on failure shows a translated error and returns to `back` (nothing typed is lost). */
  const run = async (fn: () => Promise<void>, back?: Mode): Promise<boolean> => {
    setError(null);
    setBusy(true);
    try {
      await fn();
      return true;
    } catch (e) {
      setError(errorText(e, t, lang));
      if (back) setMode(back);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const sendAudio = (input: { audio?: Blob; sampleId?: ScenarioId; durationSeconds?: number }) =>
    run(async () => {
      setMode('sending');
      const id = await ensureRequest('web_voice');
      const res = await api.submitAudio(id, { ...input, lang: picked === 'auto' ? undefined : picked, photo: photo ?? undefined });
      setSimulated(res.simulatedTranscript);
      setTranslated(res.transcript.lang !== 'en');
      setPhoto(null);
      await refresh(id);
      setMode('thread');
    }, 'compose');

  const sendText = () => {
    const body = text.trim();
    if (!body) return;
    if (body.length > MAX_CHARS) {
      setError(t.tooLong);
      return;
    }
    return run(async () => {
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
      await refresh(id);
      setMode('thread');
    }, 'typing');
  };

  /** An answer to the line's question (or to a decline), typed or tapped. */
  const reply = (body: string) =>
    run(async () => {
      if (!requestId) return;
      if (body.length > MAX_CHARS) throw new ApiError(400, 'too long');
      await api.submitText(requestId, { text: body });
      await refresh(requestId);
    });

  const replyAudio = (input: { audio?: Blob; sampleId?: ScenarioId; durationSeconds?: number }) =>
    run(async () => {
      if (!requestId) return;
      const res = await api.submitAudio(requestId, input);
      setSimulated(res.simulatedTranscript);
      await refresh(requestId);
    });

  const toggleReplyRecording = async () => {
    if (rec.state === 'recording') {
      replyRecording.current = false;
      const durationSeconds = Math.min(120, rec.seconds);
      const blob = await rec.stop();
      if (blob && blob.size > 0) await replyAudio({ audio: blob, durationSeconds });
      return;
    }
    replyRecording.current = true;
    await rec.start();
  };

  const confirm = () =>
    run(async () => {
      if (!requestId) return;
      const r = await api.confirm(requestId, { confirmed: true });
      setThread(r.thread);
    });

  const startOver = () => {
    saved.set(null);
    setRequestId(null);
    setThread(null);
    setText('');
    setFixing(false);
    setSimulated(false);
    setError(null);
    setMode('compose');
  };

  const finishRecording = async () => {
    if (replyRecording.current) return toggleReplyRecording();
    // The server refuses recordings over 2:00, so the recorder stops there (see the effect below).
    const durationSeconds = Math.min(120, rec.seconds);
    const blob = await rec.stop();
    if (blob && blob.size > 0) await sendAudio({ audio: blob, durationSeconds });
  };

  useEffect(() => {
    if (rec.state === 'recording' && rec.seconds >= 120) void finishRecording();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rec.seconds, rec.state]);

  const onPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    if (rec.state === 'recording') return void finishRecording();
    pressAt.current = performance.now();
    replyRecording.current = false;
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
    else {
      replyRecording.current = false;
      void rec.start();
    }
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
                <option value="auto">{t.auto.replace(/\s*[(（].*$/, '')}</option>
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

      {mode === 'thread' && thread ? (
        <>
          <RequesterThread messages={thread.messages} lang={lang} translated={translated} awaitingConfirmation={false} busy={busy} />
          {simulated && (
            <p lang="en" dir="ltr" className="mx-4 mb-2 rounded-xl border border-dashed border-rule-strong px-3 py-2 text-[0.78rem] leading-snug text-ink-2">
              Offline demo: no live speech-to-text is configured, so a sample transcript stands in for your recording.
            </p>
          )}
          {status === 'awaiting_approval' && (
            <p className="mx-4 mb-4 text-center text-[0.8rem] text-ink-3" lang="en" dir="ltr">
              Trying the demo on your own? <a className="font-semibold text-ink underline underline-offset-4" href="/organizer" target="_blank" rel="noreferrer">Open the organizer queue</a> and approve it as Marcus. Dana’s scripted demo key signs second, as on the live demo.
            </p>
          )}
          <ReplyDock
            t={t}
            lang={lang}
            thread={thread}
            busy={busy}
            error={error}
            rec={{ state: replyRecording.current || rec.state === 'denied' || rec.state === 'unsupported' ? rec.state : 'idle', seconds: rec.seconds }}
            onConfirm={() => void confirm()}
            onFix={() => {
              setFixing(true);
              setError(null);
              setMode('typing');
            }}
            onReply={reply}
            onRecord={() => void toggleReplyRecording()}
            onSampleAnswer={() => void replyAudio({ sampleId: 'lan' })}
          />
          {!thread.question && !thread.awaitingConfirmation && (status === 'paid' || status === 'declined' || status === 'cancelled') && (
            <div className="shrink-0 px-4 pb-4">
              <button type="button" onClick={startOver} className="flex min-h-11 w-full items-center justify-center gap-2 rounded-full border border-rule-strong text-[0.92rem] text-ink" lang={lang}>
                <RotateCcw size={16} aria-hidden /> {t.startOver}
              </button>
            </div>
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
            dir="auto"
            maxLength={MAX_CHARS}
            aria-describedby="say-count"
            placeholder={fixing ? t.fixPlaceholder : t.askPlaceholder}
            className="min-h-40 w-full flex-1 resize-none rounded-2xl border border-rule-strong bg-raised p-4 text-[1.05rem] leading-relaxed text-ink placeholder:text-ink-3"
          />
          <p id="say-count" className={cx('-mt-1 text-end text-[0.8rem] tabular', MAX_CHARS - text.length <= 0 ? 'text-signal' : 'text-ink-3', MAX_CHARS - text.length >= 300 && 'sr-only')} lang={lang} aria-live="polite">
            {fill(t.charsLeft, { n: Math.max(0, MAX_CHARS - text.length) })}
          </p>
          {error && (
            <p role="alert" className="text-[0.9rem] leading-snug text-signal" lang={lang}>
              {error}
            </p>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                setError(null);
                setFixing(false);
                setMode(thread?.messages.length ? 'thread' : 'compose');
              }}
              className="h-12 rounded-full border border-rule-strong px-5 text-ink"
            >
              <Mic size={18} aria-hidden className="inline" /> <span className="sr-only">{t.backToVoice}</span>
            </button>
            <button type="submit" disabled={!text.trim() || busy} className="flex h-12 flex-1 items-center justify-center gap-2 rounded-full bg-ink font-semibold text-raised disabled:opacity-50">
              {busy ? <LoaderCircle size={18} className="animate-spin motion-reduce:animate-none" aria-hidden /> : <SendHorizontal size={18} className="rtl:-scale-x-100" aria-hidden />}
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

          <RecordButton t={t} lang={lang} rec={rec} recording={recording} disabled={busy} onPointerDown={onPointerDown} onPointerUp={onPointerUp} onKeyDown={onKey} />

          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => { setError(null); setMode('typing'); }} className="flex min-h-12 items-center justify-center gap-2 rounded-2xl border border-rule-strong bg-raised text-[0.95rem] text-ink" lang={lang}>
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

          <SampleNotes samples={samples} label={t.noMic} lang={lang} disabled={busy} onPick={(id) => void sendAudio({ sampleId: id })} />
          {error && (
            <p role="alert" className="mt-4 text-[0.9rem] text-signal" lang={lang}>
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
