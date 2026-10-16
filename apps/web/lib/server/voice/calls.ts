/**
 * In-process call state: one job per Twilio recording (download → engine intake → delete) and a clock
 * per call (max call length, max recordings). Like the rate limiter and the message thread, this lives
 * in the one web process; if it restarts mid-call the caller hears "please call again" (docs/PHONE.md).
 * The durable state (the request, its transcript, the audit log) is in the database.
 */
import type { PhoneTurn } from './bridge';

export type JobState =
  | { state: 'running'; promise: Promise<void> }
  | { state: 'done'; turn: PhoneTurn }
  | { state: 'failed'; reason: 'not_heard' | 'busy' | 'error' }
  | { state: 'cancelled' };

interface JobEntry {
  at: number;
  job: JobState;
}

export class JobStore {
  private jobs = new Map<string, JobEntry>();
  constructor(private readonly now: () => number = Date.now) {}

  get(recordingSid: string): JobState | null {
    return this.jobs.get(recordingSid)?.job ?? null;
  }

  /** Start `fn` once per recording; later calls (status callback + action + poll) return the same job. */
  ensure(recordingSid: string, fn: () => Promise<PhoneTurn>, classify: (err: unknown) => 'not_heard' | 'busy' | 'error'): JobState {
    const existing = this.jobs.get(recordingSid);
    if (existing) return existing.job;
    this.prune();
    const entry: JobEntry = { at: this.now(), job: { state: 'running', promise: Promise.resolve() } };
    const promise = (async () => {
      try {
        const turn = await fn();
        if (entry.job.state === 'running') entry.job = { state: 'done', turn };
      } catch (err) {
        if (entry.job.state === 'running') entry.job = { state: 'failed', reason: classify(err) };
      }
    })();
    entry.job = { state: 'running', promise };
    this.jobs.set(recordingSid, entry);
    return entry.job;
  }

  /** The caller hung up or the recording was empty: never transcribe it (the delete still happens). */
  cancel(recordingSid: string): void {
    const e = this.jobs.get(recordingSid);
    if (e) e.job = { state: 'cancelled' };
    else this.jobs.set(recordingSid, { at: this.now(), job: { state: 'cancelled' } });
  }

  private prune(maxAgeMs = 3_600_000) {
    const t = this.now();
    for (const [k, e] of this.jobs) if (t - e.at > maxAgeMs && e.job.state !== 'running') this.jobs.delete(k);
  }
}

export class CallClock {
  private calls = new Map<string, { startedAt: number; recordings: number }>();
  constructor(private readonly now: () => number = Date.now) {}

  start(callSid: string): void {
    this.prune();
    if (!this.calls.has(callSid)) this.calls.set(callSid, { startedAt: this.now(), recordings: 0 });
  }

  /** Seconds since the call reached us (a call we don't know, e.g. after a restart, starts now). */
  elapsed(callSid: string): number {
    if (!this.calls.has(callSid)) this.start(callSid);
    return (this.now() - this.calls.get(callSid)!.startedAt) / 1000;
  }

  /** Count one more <Record>; false when the call already used its allowance. */
  takeRecording(callSid: string, max: number): boolean {
    if (!this.calls.has(callSid)) this.start(callSid);
    const c = this.calls.get(callSid)!;
    if (c.recordings >= max) return false;
    c.recordings++;
    return true;
  }

  private prune(maxAgeMs = 6 * 3_600_000) {
    const t = this.now();
    for (const [k, c] of this.calls) if (t - c.startedAt > maxAgeMs) this.calls.delete(k);
  }
}

declare global {
  // eslint-disable-next-line no-var
  var __neighborlineVoice: { jobs: JobStore; calls: CallClock } | undefined;
}

export const voiceState = () => (globalThis.__neighborlineVoice ??= { jobs: new JobStore(), calls: new CallClock() });
