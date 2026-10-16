/**
 * The demo's transcript: a list of typed events, printed to the terminal as they happen (with optional typewriter
 * pacing for screen recording) and optionally saved as JSON for `scripts/record-video.mjs`.
 */
import { writeFileSync } from 'node:fs';

export type TranscriptEvent =
  | { kind: 'banner'; text: string; detail?: string }
  | { kind: 'step'; n: number; title: string }
  | { kind: 'user'; text: string }
  | { kind: 'agent'; text: string }
  | { kind: 'call'; tool: string; summary: string; args: unknown }
  | { kind: 'result'; tool: string; ok: boolean; summary: string; text: string }
  | { kind: 'human'; who: string; text: string }
  | { kind: 'token'; token: string; summary: string }
  | { kind: 'done'; text: string };

export interface PrinterOptions {
  /** Characters per second for typewriter output; 0 prints instantly. */
  cps: number;
  /** Pause after each event, ms (screen-recording breathing room). */
  pauseMs: number;
  color: boolean;
  /** Print raw tool arguments and full results under each call. */
  verbose: boolean;
  write: (s: string) => void;
}

const ESC = '\u001b[';
const paint = (on: boolean, code: string, s: string) => (on ? `${ESC}${code}m${s}${ESC}0m` : s);

/** Shortens a token for display: nlap1.eyJ2Ijox…Q3ZhXw (the full token is never needed on screen). */
export const shortToken = (t: string) => (t.length > 34 ? `${t.slice(0, 18)}…${t.slice(-8)}` : t);

export function formatEvent(e: TranscriptEvent, color: boolean, verbose = false): string[] {
  const dim = (s: string) => paint(color, '2', s);
  const bold = (s: string) => paint(color, '1', s);
  const green = (s: string) => paint(color, '32', s);
  const red = (s: string) => paint(color, '31', s);
  const amber = (s: string) => paint(color, '33', s);
  const blue = (s: string) => paint(color, '36', s);
  switch (e.kind) {
    case 'banner':
      return [bold(e.text), ...(e.detail ? [dim(e.detail)] : [])];
    case 'step':
      return ['', amber(`── ${e.n}. ${e.title} `.padEnd(72, '─'))];
    case 'user':
      return [`${dim('user  ')} ${e.text}`];
    case 'agent':
      return [`${blue('agent ')} ${e.text}`];
    case 'call': {
      const lines = [`${blue('agent ')} ${bold('→ ' + e.tool)} ${e.summary}`];
      if (verbose) lines.push(...JSON.stringify(e.args, null, 2).split('\n').map((l) => dim(`         ${l}`)));
      return lines;
    }
    case 'result': {
      const mark = e.ok ? green('✓') : red('✗');
      const lines = [`${dim('mcp   ')} ${mark} ${e.ok ? e.summary : red(e.summary)}`];
      if (verbose) lines.push(...e.text.split('\n').map((l) => dim(`         ${l}`)));
      return lines;
    }
    case 'human':
      return [`${amber('human ')} ${bold(e.who)} ${e.text}`];
    case 'token':
      return [`${amber('token ')} ${e.summary}`, dim(`         ${shortToken(e.token)}`)];
    case 'done':
      return ['', green(bold(e.text)), ''];
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class Transcript {
  readonly events: Array<TranscriptEvent & { t: number }> = [];
  private readonly started = Date.now();
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly opts: PrinterOptions) {}

  /** Records the event and prints it (awaiting typewriter pacing, so the run reads at a human pace). */
  emit(e: TranscriptEvent): Promise<void> {
    this.events.push({ ...e, t: Date.now() - this.started });
    const lines = formatEvent(e, this.opts.color, this.opts.verbose);
    this.queue = this.queue.then(async () => {
      for (const line of lines) {
        if (this.opts.cps > 0 && line.trim()) {
          // Type the visible text; ANSI sequences go out whole so colors never break mid-escape.
          for (const chunk of line.split(/(\u001b\[[0-9;]*m)/)) {
            if (chunk.startsWith('\u001b[')) this.opts.write(chunk);
            else
              for (const ch of chunk) {
                this.opts.write(ch);
                await sleep(1000 / this.opts.cps);
              }
          }
          this.opts.write('\n');
        } else this.opts.write(`${line}\n`);
      }
      if (this.opts.pauseMs) await sleep(this.opts.pauseMs);
    });
    return this.queue;
  }

  save(path: string, meta: Record<string, unknown> = {}): void {
    writeFileSync(path, JSON.stringify({ ...meta, events: this.events }, null, 2));
  }
}
