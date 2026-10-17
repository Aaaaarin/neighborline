/**
 * Browser side of the human check (lib/server/security/human-check.ts). `ensureHuman()` asks the
 * server what to do and does it, once at a time:
 *
 *   none / passed  nothing
 *   pow            solve the proof of work in the background (lib/pow.ts, ~200 ms, yields to the page)
 *   turnstile      Cloudflare Turnstile, managed mode: invisible unless Cloudflare wants an interaction,
 *                  then shown in a small labelled panel (accessible checkbox, no picture puzzle)
 *
 * and the server sets an HttpOnly pass cookie. lib/api.ts calls it when an API call answers 403
 * `human_check_required` and retries once; pages that will need it (/call) start it on load.
 */
import { TURNSTILE_SCRIPT } from './human-check-mode';
import { solvePow } from './pow';

type Challenge =
  | { kind: 'none' }
  | { kind: 'passed'; expiresAt: string }
  | { kind: 'pow'; challenge: string; bits: number; count: number; expiresAt: string }
  | { kind: 'turnstile'; siteKey: string; action: string; cData: string };

export class HumanCheckError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function postJson(path: string, json: unknown): Promise<unknown> {
  const res = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(json), cache: 'no-store' });
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new HumanCheckError(res.status, data.error ?? `Request failed (${res.status})`);
  return data;
}

interface TurnstileApi {
  render(el: HTMLElement, opts: Record<string, unknown>): string;
  remove(id: string): void;
}

let script: Promise<TurnstileApi> | null = null;
function loadTurnstile(): Promise<TurnstileApi> {
  const w = window as unknown as { turnstile?: TurnstileApi };
  if (w.turnstile) return Promise.resolve(w.turnstile);
  script ??= new Promise<TurnstileApi>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = TURNSTILE_SCRIPT;
    s.async = true;
    s.onload = () => (w.turnstile ? resolve(w.turnstile) : reject(new Error('Turnstile did not load')));
    s.onerror = () => {
      script = null;
      reject(new Error('Turnstile did not load'));
    };
    document.head.appendChild(s);
  });
  return script;
}

async function turnstileToken(ch: Extract<Challenge, { kind: 'turnstile' }>): Promise<string> {
  const ts = await loadTurnstile();
  const panel = document.createElement('div');
  panel.setAttribute('role', 'region');
  panel.setAttribute('aria-label', 'Quick check that you are a person');
  Object.assign(panel.style, { position: 'fixed', left: '50%', bottom: '16px', transform: 'translateX(-50%)', zIndex: '50', maxWidth: 'calc(100vw - 32px)' });
  document.body.appendChild(panel);
  let id = '';
  try {
    return await new Promise<string>((resolve, reject) => {
      id = ts.render(panel, {
        sitekey: ch.siteKey,
        action: ch.action,
        cData: ch.cData,
        appearance: 'interaction-only',
        language: document.documentElement.lang || 'auto',
        callback: (token: string) => resolve(token),
        'error-callback': () => reject(new Error('The browser check failed')),
        'expired-callback': () => reject(new Error('The browser check expired')),
      });
    });
  } finally {
    if (id) ts.remove(id);
    panel.remove();
  }
}

async function runCheck(): Promise<void> {
  const ch = (await postJson('/api/human/challenge', {})) as Challenge;
  if (ch.kind === 'none' || ch.kind === 'passed') return;
  if (ch.kind === 'pow') {
    const solution = await solvePow(ch);
    await postJson('/api/human/verify', { kind: 'pow', challenge: ch.challenge, solution });
    return;
  }
  const token = await turnstileToken(ch);
  await postJson('/api/human/verify', { kind: 'turnstile', token });
}

let inflight: Promise<void> | null = null;

/** Make sure this browser holds a human pass (no-op when the server needs none). Concurrent calls share one run. */
export function ensureHuman(): Promise<void> {
  inflight ??= runCheck().finally(() => {
    inflight = null;
  });
  return inflight;
}
