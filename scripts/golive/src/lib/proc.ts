/**
 * Child processes. Every child runs in its own process group, and only those groups are ever signalled (no pkill),
 * so golive can share a machine with other agents' servers. Long-running services are listed in golive-out/pids.
 */
import { spawn } from 'node:child_process';
import { appendFileSync, createWriteStream, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export interface RunOptions {
  cwd?: string;
  env?: Record<string, string | undefined>;
  timeoutMs?: number;
  /** Tee stdout+stderr here. */
  logFile?: string;
  /** Write this to stdin and close it. */
  input?: string;
}

export interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  ms: number;
}

export type Runner = (cmd: string, args: string[], opts?: RunOptions) => Promise<RunResult>;

const cleanEnv = (env: Record<string, string | undefined>) => Object.fromEntries(Object.entries(env).filter(([, v]) => v !== undefined)) as Record<string, string>;

export const spawnRunner: Runner = (cmd, args, opts = {}) =>
  new Promise((resolve) => {
    const started = Date.now();
    if (opts.logFile) mkdirSync(dirname(opts.logFile), { recursive: true });
    const log = opts.logFile ? createWriteStream(opts.logFile) : null;
    const p = spawn(cmd, args, { cwd: opts.cwd, env: cleanEnv(opts.env ?? process.env), stdio: ['pipe', 'pipe', 'pipe'], detached: true });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    p.stdout.on('data', (d: Buffer) => {
      stdout += d.toString();
      log?.write(d);
    });
    p.stderr.on('data', (d: Buffer) => {
      stderr += d.toString();
      log?.write(d);
    });
    if (opts.input !== undefined) p.stdin.end(opts.input);
    else p.stdin.end();
    const timer = opts.timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          killGroup(p.pid);
        }, opts.timeoutMs)
      : null;
    const finish = (code: number | null) => {
      if (timer) clearTimeout(timer);
      log?.end();
      resolve({ code, stdout, stderr, timedOut, ms: Date.now() - started });
    };
    p.on('error', (err) => {
      stderr += String(err);
      finish(127);
    });
    p.on('close', (code) => finish(code));
  });

export function killGroup(pid: number | undefined, signal: NodeJS.Signals = 'SIGTERM'): void {
  if (!pid) return;
  try {
    process.kill(-pid, signal);
  } catch {
    /* already gone */
  }
}

export interface Service {
  name: string;
  pid: number;
  stop(): void;
}

/** Start a long-running service in its own process group, logging to `logFile`; PIDs are appended to `pidFile`. */
export function startService(name: string, cmd: string, args: string[], opts: { cwd: string; env: Record<string, string | undefined>; logFile: string; pidFile: string }): Service {
  mkdirSync(dirname(opts.logFile), { recursive: true });
  const out = createWriteStream(opts.logFile);
  const p = spawn(cmd, args, { cwd: opts.cwd, env: cleanEnv(opts.env), stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  p.stdout.pipe(out);
  p.stderr.pipe(out);
  appendFileSync(opts.pidFile, `${p.pid} ${name}\n`);
  return { name, pid: p.pid!, stop: () => killGroup(p.pid) };
}

export async function waitForUrl(url: string, opts: { timeoutMs: number; fetch?: typeof fetch; okStatuses?: number[] }): Promise<boolean> {
  const f = opts.fetch ?? fetch;
  const until = Date.now() + opts.timeoutMs;
  while (Date.now() < until) {
    try {
      const res = await f(url, { signal: AbortSignal.timeout(2_000) });
      if (res.ok || opts.okStatuses?.includes(res.status)) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

export function pidFileFor(out: string): string {
  const f = join(out, 'pids');
  mkdirSync(out, { recursive: true });
  writeFileSync(f, '', { flag: 'a' });
  return f;
}
