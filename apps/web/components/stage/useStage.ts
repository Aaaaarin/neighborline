'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError, openStream } from '@/lib/api';
import { approveAsVisitor } from '@/lib/passkey-client';
import type { Organizer, PlayMode, RequestView, ScenarioId, ScenarioRun, StreamMessage, ThreadView } from '@/lib/types';
import type { TimedEvent } from './stage-steps';

export type Conn = 'connecting' | 'open' | 'reconnecting';

export function useStage(organizers: Organizer[]) {
  const [run, setRun] = useState<ScenarioRun | null>(null);
  const [tick, setTick] = useState(0);
  const [view, setView] = useState<RequestView | null>(null);
  const [thread, setThread] = useState<ThreadView | null>(null);
  const [conn, setConn] = useState<Conn>('connecting');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [fallback, setFallback] = useState<{ organizerId: string; reason: string } | null>(null);
  const buffer = useRef<Extract<StreamMessage, { kind: 'stage' }>[]>([]);
  const skew = useRef(0);
  const runRef = useRef<ScenarioRun | null>(null);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** The demo database was reset under this run (nightly job): stop it and offer a replay, never hang. */
  const onDemoReset = useCallback(() => {
    if (!runRef.current) return;
    runRef.current = null;
    buffer.current = [];
    setRun(null);
    setView(null);
    setThread(null);
    setFallback(null);
    setError('The demo was reset, so this run stopped. Press Play to run it again.');
  }, []);

  const refresh = useCallback(() => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(async () => {
      const r = runRef.current;
      if (!r) return;
      try {
        const [v, t] = await Promise.all([api.request(r.requestId), api.thread(r.requestId)]);
        if (runRef.current?.requestId !== r.requestId) return;
        setView(v);
        setThread(t);
      } catch (e) {
        // 404 for our own run means the demo was reset (or the server restarted on a fresh database).
        if (e instanceof ApiError && e.status === 404 && runRef.current?.requestId === r.requestId) onDemoReset();
        /* otherwise transient; the next event retries */
      }
    }, 40);
  }, [onDemoReset]);

  // One stream per run, filtered server-side to this request and replaying its history first,
  // so nothing is lost between "Play" and the stream opening.
  const runId = run?.requestId;
  useEffect(() => {
    if (!runId) {
      setConn('open');
      return;
    }
    setConn('connecting');
    const seen = new Set<string>();
    const close = openStream(
      (m) => {
        if (m.kind === 'hello') {
          skew.current = Date.now() - Date.parse(m.serverTime);
          return;
        }
        if (m.kind === 'reset') {
          onDemoReset();
          return;
        }
        const key = `${m.event.type}|${m.event.at}|${JSON.stringify(m.event).length}`;
        if (seen.has(key)) return;
        seen.add(key);
        buffer.current.push(m);
        if (buffer.current.length > 800) buffer.current.splice(0, 200);
        if (m.requestIds.includes(runId)) {
          setTick((n) => n + 1);
          refresh();
        }
      },
      { requestId: runId, onStatus: setConn },
    );
    return close;
  }, [runId, refresh, onDemoReset]);

  // Fallback polling if the event stream drops (proxies, flaky wifi).
  useEffect(() => {
    if (!run || conn === 'open') return;
    const id = setInterval(refresh, 1500);
    return () => clearInterval(id);
  }, [run, conn, refresh]);

  const events: TimedEvent[] = useMemo(() => {
    void tick;
    if (!run) return [];
    return buffer.current
      .filter((m) => m.requestIds.includes(run.requestId))
      .map((m) => ({ event: m.event, at: Date.parse(m.event.at) }));
  }, [run, tick]);

  const play = useCallback(
    async (scenario: ScenarioId, mode: PlayMode, speed?: number) => {
      setError(null);
      setBusy('play');
      setView(null);
      setThread(null);
      setFallback(null);
      try {
        const r = await api.play(scenario, mode, speed);
        buffer.current = [];
        runRef.current = r;
        setRun(r);
        setTick((n) => n + 1);
        refresh();
      } catch (e) {
        setError(e instanceof ApiError ? e.message : 'Couldn’t start the scenario. Check that the server is running.');
      } finally {
        setBusy(null);
      }
    },
    [refresh],
  );

  const clear = useCallback(() => {
    runRef.current = null;
    setRun(null);
    setView(null);
    setThread(null);
    setError(null);
  }, []);

  /**
   * Dana (scripted) always signs with her labelled demo key. The visitor approving as Marcus signs
   * with a real passkey on their own device when it has one; otherwise we say why and offer the
   * demo key — the judge is never blocked, and the card says which one signed.
   */
  const approve = useCallback(
    async (organizerId: string, opts: { useDemoKey?: boolean } = {}) => {
      const r = runRef.current;
      const org = organizers.find((o) => o.id === organizerId);
      if (!r || !org) return;
      setBusy(organizerId);
      setError(null);
      try {
        const visitor = r.manualOrganizerId === organizerId && !opts.useDemoKey;
        if (visitor) {
          const out = await approveAsVisitor({ requestIds: [r.requestId], organizerId, name: org.name });
          if (out.signedWith === 'none') {
            setFallback({ organizerId, reason: out.reason });
            return;
          }
        } else {
          await api.approve({ requestIds: [r.requestId], organizerId, signer: { kind: 'demo_key' } });
        }
        setFallback(null);
        refresh();
      } catch (e) {
        setError(e instanceof ApiError ? e.message : 'Approval didn’t go through. Try again.');
      } finally {
        setBusy(null);
      }
    },
    [organizers, refresh],
  );

  return { run, events, view, thread, conn, error, busy, play, approve, clear, skew, fallback };
}
