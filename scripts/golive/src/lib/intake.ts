/**
 * One real intake through the app's own API, as the /call page does it: start a request, upload the voice note
 * (multipart, no language hint: speech-to-text has to detect it), read the thread. The trace keeps timings, the
 * app's answer and a comparison with the scenario's expected extraction.
 */
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

export interface IntakeScenario {
  id: string;
  lang: string;
  audioPath: string;
  expectedStatus: string;
  expectedPayout?: string;
  expectedCategory?: string;
  expectedHousehold?: number;
}

export interface IntakeTrace {
  scenario: string;
  lang: string;
  audio: string;
  requestId?: string;
  ms: { start: number; audio: number; thread: number; total: number };
  result?: Record<string, unknown>;
  thread?: unknown;
  checks: Array<{ name: string; want: unknown; got: unknown; ok: boolean }>;
  ok: boolean;
  error?: string;
}

const pick = (o: unknown, ...paths: string[]): unknown => {
  for (const p of paths) {
    let cur: unknown = o;
    for (const k of p.split('.')) cur = cur && typeof cur === 'object' ? (cur as Record<string, unknown>)[k] : undefined;
    if (cur !== undefined) return cur;
  }
  return undefined;
};

export async function runIntake(f: typeof fetch, base: string, s: IntakeScenario): Promise<IntakeTrace> {
  const t0 = Date.now();
  const trace: IntakeTrace = { scenario: s.id, lang: s.lang, audio: basename(s.audioPath), ms: { start: 0, audio: 0, thread: 0, total: 0 }, checks: [], ok: false };
  try {
    const start = await f(`${base}/api/intake/start`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ groupSlug: 'eastside', channel: 'web_voice' }) });
    if (!start.ok) throw new Error(`POST /api/intake/start → ${start.status} ${(await start.text()).slice(0, 200)}`);
    const { requestId } = (await start.json()) as { requestId: string };
    trace.requestId = requestId;
    const cookie = (start.headers.getSetCookie?.() ?? [start.headers.get('set-cookie') ?? '']).map((c) => c.split(';')[0]).filter(Boolean).join('; ');
    trace.ms.start = Date.now() - t0;

    const bytes = readFileSync(s.audioPath);
    const form = new FormData();
    form.set('audio', new Blob([bytes], { type: 'audio/mpeg' }), basename(s.audioPath));
    const t1 = Date.now();
    const up = await f(`${base}/api/intake/${encodeURIComponent(requestId)}/audio`, { method: 'POST', headers: cookie ? { cookie } : {}, body: form });
    trace.ms.audio = Date.now() - t1;
    const text = await up.text();
    if (!up.ok) throw new Error(`POST /api/intake/${requestId}/audio → ${up.status} ${text.slice(0, 300)}`);
    trace.result = JSON.parse(text) as Record<string, unknown>;

    const t2 = Date.now();
    const th = await f(`${base}/api/intake/${encodeURIComponent(requestId)}/thread`, { headers: cookie ? { cookie } : {} });
    trace.ms.thread = Date.now() - t2;
    trace.thread = th.ok ? await th.json() : { status: th.status };

    const r = trace.result;
    const got = {
      status: pick(r, 'status', 'request.status'),
      lang: pick(r, 'transcript.lang', 'extraction.lang'),
      payout: pick(r, 'extraction.payout.value'),
      category: pick(r, 'extraction.category'),
      household: pick(r, 'extraction.householdSize'),
      simulated: pick(r, 'simulatedTranscript'),
    };
    const norm = (v: unknown) => (typeof v === 'string' ? v.replace(/^@/, '').toLowerCase() : v);
    trace.checks.push({ name: 'real speech-to-text (not a fixture)', want: false, got: got.simulated, ok: got.simulated === false });
    trace.checks.push({ name: 'status', want: s.expectedStatus, got: got.status, ok: got.status === s.expectedStatus });
    if (got.lang !== undefined) trace.checks.push({ name: 'language detected', want: s.lang, got: got.lang, ok: got.lang === s.lang });
    if (s.expectedPayout) trace.checks.push({ name: 'payout destination', want: s.expectedPayout, got: got.payout, ok: norm(got.payout) === norm(s.expectedPayout) });
    if (s.expectedCategory && got.category !== undefined) trace.checks.push({ name: 'category', want: s.expectedCategory, got: got.category, ok: got.category === s.expectedCategory });
    if (s.expectedHousehold !== undefined && got.household !== undefined) trace.checks.push({ name: 'household', want: s.expectedHousehold, got: got.household, ok: got.household === s.expectedHousehold });
    trace.ok = trace.checks.every((c) => c.ok);
  } catch (err) {
    trace.error = (err as Error).message;
  }
  trace.ms.total = Date.now() - t0;
  return trace;
}
