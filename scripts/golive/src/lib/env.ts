/**
 * Environment for the go-live run: which keys exist, whether they look right, and masking for logs.
 *
 * Precedence: process env > root .env > golive-out/golive.env (values this run generated: webhook ids, plan ids,
 * the hosted URL). A generated value never overrides one the human set; a conflict is reported instead.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export type Env = Record<string, string | undefined>;

/** The same parser as scripts/dev.mjs: KEY=value, inline `# comments`, optional quotes, empty = unset. */
export function parseDotenv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m) continue;
    let v = m[2]!;
    if (/^(['"]).*\1$/.test(v)) v = v.slice(1, -1);
    else v = v.replace(/(^|\s+)#.*$/, '');
    if (v !== '') out[m[1]!] = v;
  }
  return out;
}

export const readDotenv = (file: string): Record<string, string> => (existsSync(file) ? parseDotenv(readFileSync(file, 'utf8')) : {});

export interface LoadedEnv {
  env: Env;
  /** Where each key came from. */
  source: Record<string, 'process' | '.env' | 'golive.env'>;
  /** Keys whose generated value differs from the one the human set (the human's wins). */
  conflicts: Array<{ key: string; generated: string; used: string }>;
}

export function loadEnv(repo: string, outDir: string, processEnv: Env = process.env): LoadedEnv {
  const generated = readDotenv(join(outDir, 'golive.env'));
  const dot = readDotenv(join(repo, '.env'));
  const env: Env = {};
  const source: LoadedEnv['source'] = {};
  for (const [k, v] of Object.entries(generated)) (env[k] = v), (source[k] = 'golive.env');
  for (const [k, v] of Object.entries(dot)) (env[k] = v), (source[k] = '.env');
  for (const [k, v] of Object.entries(processEnv)) if (v !== undefined && v !== '') (env[k] = v), (source[k] = 'process');
  const conflicts = Object.entries(generated)
    .filter(([k, v]) => env[k] !== undefined && env[k] !== v)
    .map(([key, g]) => ({ key, generated: g, used: env[key]! }));
  return { env, source, conflicts };
}

/** `abcd…yz (40 chars)`; never prints a secret whole. */
export function mask(value: string | undefined): string {
  if (!value) return '(unset)';
  if (value.length <= 8) return `${'*'.repeat(value.length)} (${value.length} chars)`;
  return `${value.slice(0, 4)}…${value.slice(-2)} (${value.length} chars)`;
}

/** Replace every known secret value in a text (logs, error messages) with its mask. */
export function redactSecrets(text: string, env: Env): string {
  let out = text;
  for (const spec of KEY_SPECS) {
    if (!spec.secret) continue;
    const v = env[spec.key];
    if (v && v.length >= 8) out = out.split(v).join(mask(v));
  }
  return out;
}

export interface KeySpec {
  key: string;
  secret: boolean;
  /** What it is and where to get it (shown when missing). */
  hint: string;
  /** Returns an error string when the value is malformed. */
  check?: (v: string) => string | null;
  /** Format problems that do not block (e.g. an email that is not a sandbox account). */
  warn?: (v: string) => string | null;
}

const re = (rx: RegExp, msg: string) => (v: string) => (rx.test(v) ? null : msg);
const paypalId = re(/^[A-Za-z0-9_-]{40,128}$/, 'expected 40-128 characters of letters, digits, - and _ (developer.paypal.com → Apps & Credentials → Sandbox)');
const email = re(/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'expected an email address');
const sandboxEmail = (v: string) => (/@(personal|business)\.example\.com$/i.test(v) ? null : 'sandbox test accounts usually end in @personal.example.com; check it is a SANDBOX account, never a real one');

export const KEY_SPECS: KeySpec[] = [
  { key: 'PAYPAL_CLIENT_ID', secret: false, hint: 'main sandbox REST app (Orders, Subscriptions, webhooks, Transaction Search): developer.paypal.com → Apps & Credentials → Sandbox', check: paypalId },
  { key: 'PAYPAL_CLIENT_SECRET', secret: true, hint: 'the main app\'s secret', check: paypalId },
  { key: 'PAYPAL_PAYOUTS_CLIENT_ID', secret: false, hint: 'second sandbox REST app with ONLY Payouts enabled (the approver\'s keys)', check: paypalId },
  { key: 'PAYPAL_PAYOUTS_CLIENT_SECRET', secret: true, hint: 'the Payouts app\'s secret', check: paypalId },
  {
    key: 'PAYPAL_BASE_URL',
    secret: false,
    hint: 'defaults to https://api-m.sandbox.paypal.com',
    check: (v) => (/^https:\/\/api-m\.paypal\.com/i.test(v) || /^https:\/\/api\.paypal\.com/i.test(v) ? 'this is LIVE PayPal: golive only ever runs against the sandbox (or the local fake)' : /^https?:\/\//.test(v) ? null : 'expected a URL'),
  },
  { key: 'SANDBOX_PERSONAL_EMAIL', secret: false, hint: 'a sandbox PERSONAL test account email (developer.paypal.com → Testing tools → Sandbox accounts); receives the PayPal-wallet test payout', check: email, warn: sandboxEmail },
  { key: 'SANDBOX_DEMO_RECEIVER_EMAIL', secret: false, hint: 'optional: the sandbox Personal account the hosted /demo pays instead of Lan\'s and Jean\'s Venmo and Walter\'s email (default: SANDBOX_PERSONAL_EMAIL)', check: email, warn: sandboxEmail },
  { key: 'SANDBOX_VENMO_HANDLE', secret: false, hint: 'optional: a Venmo username for the Venmo test payout (default: neighborline-sandbox-test)', check: re(/^@?[A-Za-z0-9_-]{2,30}$/, 'expected a Venmo username like @lan-nguyen54') },
  { key: 'SANDBOX_BUYER_EMAIL', secret: false, hint: 'optional: sandbox PERSONAL account that approves the Orders test checkout (Playwright logs in as it)', check: email, warn: sandboxEmail },
  { key: 'SANDBOX_BUYER_PASSWORD', secret: true, hint: 'that sandbox account\'s password (sandbox only, never a real one)' },
  { key: 'OPENAI_API_KEY', secret: true, hint: 'platform.openai.com → API keys (live STT/TTS/LLM, eval, voiceover)', check: re(/^sk-[A-Za-z0-9_-]{20,}$/, 'expected sk-…') },
  { key: 'ANTHROPIC_API_KEY', secret: true, hint: 'optional: console.anthropic.com → API keys (adds a Claude eval column)', check: re(/^sk-ant-[A-Za-z0-9_-]{20,}$/, 'expected sk-ant-…') },
  { key: 'RENDER_API_KEY', secret: true, hint: 'dashboard.render.com → Account settings → API keys → Create API key', check: re(/^rnd_[A-Za-z0-9]{16,}$/, 'expected rnd_…') },
  { key: 'HOSTED_URL', secret: false, hint: 'set by deploy-render; or the Render host, e.g. neighborline.onrender.com', check: re(/^(https:\/\/)?[a-z0-9.-]+\.[a-z]{2,}\/?$/i, 'expected a host like neighborline.onrender.com') },
  { key: 'VIDEO_ID', secret: false, hint: 'the YouTube id after the upload (11 characters)', check: re(/^[A-Za-z0-9_-]{11}$/, 'expected an 11-character YouTube id') },
  { key: 'JUDGE_SANDBOX_BUYER_EMAIL', secret: false, hint: 'optional: the sandbox buyer judges may use on /donate (published in DEVPOST)', check: email, warn: sandboxEmail },
  { key: 'JUDGE_SANDBOX_BUYER_PASSWORD', secret: false, hint: 'its password (published in DEVPOST: sandbox only, dedicated to judges)' },
  { key: 'GOLIVE_WEBHOOK_CAPTURE_URL', secret: false, hint: 'optional: public https URL that tunnels to GOLIVE_WEBHOOK_CAPTURE_PORT (default 4345), so the spike can verify a real delivery before deploy', check: re(/^https?:\/\//, 'expected a URL') },
];

export const SPEC_BY_KEY = new Map(KEY_SPECS.map((s) => [s.key, s]));

export interface KeyReport {
  key: string;
  present: boolean;
  shown: string;
  error: string | null;
  warning: string | null;
}

export function checkKeys(env: Env): KeyReport[] {
  return KEY_SPECS.map((s) => {
    const v = env[s.key];
    return {
      key: s.key,
      present: Boolean(v),
      shown: s.secret ? mask(v) : (v ?? '(unset)'),
      error: v && s.check ? s.check(v) : null,
      warning: v && s.warn ? s.warn(v) : null,
    };
  });
}

export const has = (env: Env, ...keys: string[]): boolean => keys.every((k) => Boolean(env[k]) && !(SPEC_BY_KEY.get(k)?.check?.(env[k]!) ?? null));

export const SANDBOX_URL = 'https://api-m.sandbox.paypal.com';
export const paypalBase = (env: Env): string => (env.PAYPAL_BASE_URL || SANDBOX_URL).replace(/\/+$/, '');

/** 'sandbox' for PayPal's sandbox, 'fake' for anything else (tools/fake-paypal, a test server). Never 'live'. */
export function paypalTarget(env: Env): 'sandbox' | 'fake' {
  const host = new URL(paypalBase(env)).host;
  if (/(^|\.)paypal\.com$/i.test(host) && !/sandbox/i.test(host)) throw new Error(`PAYPAL_BASE_URL ${host} is live PayPal; golive refuses to run against it`);
  return /sandbox\.paypal\.com$/i.test(host) ? 'sandbox' : 'fake';
}

/** `neighborline.onrender.com` and `https://neighborline.onrender.com` for any HOSTED_URL spelling. */
export function hostedParts(value: string | undefined): { host: string; origin: string } | null {
  if (!value) return null;
  const v = value.trim().replace(/\/+$/, '');
  const withScheme = /^https?:\/\//i.test(v) ? v : `https://${v}`;
  try {
    const u = new URL(withScheme);
    return { host: u.host, origin: u.origin };
  } catch {
    return null;
  }
}
