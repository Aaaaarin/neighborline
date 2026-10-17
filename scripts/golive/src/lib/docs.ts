/**
 * Pure document edits for finalize-docs. Every edit is idempotent (running it twice changes nothing the second
 * time) and reports whether it applied, so a moved sentence shows up as "not found" instead of silently passing.
 */
import type { HostedEvidence } from './evidence.js';

export interface Edit {
  file: string;
  rule: string;
  applied: boolean;
  count?: number;
}

/**
 * Replace `{TOKEN}` with `value`, except where the docs talk about the token itself: exactly `` `{TOKEN}` `` in
 * backticks (the fill-in tables, the checklist) and grep command lines.
 */
export function replaceToken(text: string, token: string, value: string): { text: string; count: number } {
  let count = 0;
  const re = new RegExp(`(\`?)\\{${token}\\}(\`?)`, 'g');
  const out = text
    .split('\n')
    .map((line) => {
      if (/grep -rn/.test(line)) return line;
      return line.replace(re, (m, a: string, b: string) => {
        if (a && b) return m;
        count++;
        return `${a}${value}${b}`;
      });
    })
    .join('\n');
  return { text: out, count };
}

/** Regex for a phrase that may be re-wrapped across lines in the Markdown source. */
export const phrase = (words: string) => new RegExp(words.trim().split(/\s+/).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+'));

/** Replace the whole Markdown table row whose first cell is `firstCell`. */
export function replaceRow(text: string, firstCell: string, row: string): { text: string; applied: boolean } {
  const lines = text.split('\n');
  const i = lines.findIndex((l) => l.startsWith(`| ${firstCell} |`));
  if (i === -1) return { text, applied: false };
  if (lines[i] === row) return { text, applied: true };
  lines[i] = row;
  return { text: lines.join('\n'), applied: true };
}

export interface Facts {
  host?: string;
  videoId?: string;
  judgeBuyer?: { email: string; password: string };
  sandbox?: {
    date: string;
    batchId?: string;
    paypalSuccess: boolean;
    venmoStatuses: string[];
    unclaimed: boolean;
    verifiedEventId?: string;
    duplicateOk: boolean | null;
    captureId?: string;
    reconciled: number;
  };
  hosted?: HostedEvidence;
  liveAi?: { date: string; intakesOk: number; intakes: number; evalProviders: string[] };
}

/** First cell of the README "Sandbox reality" row about the /demo sandbox stand-ins (apps/web .../sandbox-standin.ts). */
export const STAND_IN_ROW = 'Scripted `/demo` payouts in sandbox';

export function readmeEdits(text: string, f: Facts): { text: string; edits: Array<{ rule: string; applied: boolean }> } {
  const edits: Array<{ rule: string; applied: boolean }> = [];
  let t = text;
  if (f.host) {
    const hostedRe = /\*\*Hosted:\*\* not deployed yet[\s\S]*?locally with no credentials:/;
    t = t.replace(hostedRe, `**Hosted:** <https://${f.host}/demo> (no login; ${f.hosted?.paypalMode === 'sandbox' ? 'PayPal sandbox' : 'PayPal stand-in, labelled'}). Or run it locally with no credentials:`);
    edits.push({ rule: 'README "Hosted:" line', applied: t.includes(`**Hosted:** <https://${f.host}/demo>`) });
    const r = replaceRow(t, 'Hosting', `| Hosting | Deployed on Render from [\`render.yaml\`](render.yaml): <https://${f.host}> (web + approver, Postgres, Workflows, cron; [docs/DEPLOY.md](docs/DEPLOY.md)) |`);
    t = r.text;
    edits.push({ rule: 'README Sandbox reality: Hosting row', applied: r.applied });
  }
  if (f.sandbox) {
    const s = f.sandbox;
    const parts = [
      s.batchId ? `batch \`${s.batchId}\`` : null,
      s.paypalSuccess ? 'PayPal-wallet item SUCCESS' : null,
      s.venmoStatuses.length ? `Venmo items ${s.venmoStatuses.join('/')}` : null,
      s.unclaimed ? 'an unregistered email UNCLAIMED, then cancelled back' : null,
      s.duplicateOk ? 'a reused `sender_batch_id` resolved to the original batch' : null,
      s.verifiedEventId ? `webhook \`${s.verifiedEventId}\` verified by PayPal's postback API` : null,
      s.captureId ? `a donation captured (\`${s.captureId}\`)` : null,
      s.reconciled ? `${s.reconciled} items matched in Transaction Search` : null,
    ].filter(Boolean);
    const r1 = replaceRow(t, 'Real PayPal sandbox', `| Real PayPal sandbox | **Run on ${s.date}** with \`PAYPAL_MODE=sandbox\` credentials: ${parts.join('; ')}. Ids, timestamps and statuses: [docs/SANDBOX_EVIDENCE.md](docs/SANDBOX_EVIDENCE.md) |`);
    t = r1.text;
    edits.push({ rule: 'README Sandbox reality: Real PayPal sandbox row', applied: r1.applied });
    const venmo = s.venmoStatuses.length ? `Observed on ${s.date}: ${s.venmoStatuses.join(' / ')} ([evidence](docs/SANDBOX_EVIDENCE.md))` : 'Not observed in the sandbox run';
    const r2 = replaceRow(t, 'Venmo payouts in sandbox', `| Venmo payouts in sandbox | ${venmo}. Sandbox also rejects \`recipient_type: PHONE\` |`);
    t = r2.text;
    edits.push({ rule: 'README Sandbox reality: Venmo row', applied: r2.applied });
  }
  const h = f.hosted;
  if (f.sandbox && h?.paypalMode === 'sandbox' && h.standIn && h.paypalBatchId) {
    const r = replaceRow(
      t,
      STAND_IN_ROW,
      `| ${STAND_IN_ROW} | **Run on the hosted app** (${f.sandbox.date}): ${h.scenario === 'lan' ? 'Mrs. Lan' : h.scenario}'s payout, batch \`${h.paypalBatchId}\`, reached **${h.itemStatus ?? '?'}** in a PayPal sandbox account standing in for her Venmo (\`${h.standIn}\`)${h.webhookVerified ? `, settled by webhook \`${h.webhookVerified.eventId}\`` : ''}. Rail checks run on the scripted handle first and every screen of the run says so; Rosa's goes to a fresh unregistered address and really stays \`UNCLAIMED\` until an organizer cancels it ([evidence](docs/SANDBOX_EVIDENCE.md)) |`,
    );
    t = r.text;
    edits.push({ rule: 'README Sandbox reality: Scripted /demo payouts row', applied: r.applied });
  }
  if (f.liveAi && f.liveAi.intakes) {
    const r = replaceRow(t, 'Speech, translation, read-back', `| Speech, translation, read-back | Fixture mode replays prepared transcripts. \`AI_MODE=live\` ran on ${f.liveAi.date}: ${f.liveAi.intakesOk}/${f.liveAi.intakes} voice notes (vi, es, ht) through real speech-to-text and the live model matched the expected extraction; live eval columns in [docs/EVAL.md](docs/EVAL.md) |`);
    t = r.text;
    edits.push({ rule: 'README Sandbox reality: Speech row', applied: r.applied });
  }
  return { text: t, edits };
}

/** DEVPOST.md / DEVPOST_FIELDS.md "(sandbox)" sentences, with the wording DEVPOST_FIELDS.md prescribes. */
export function devpostSandboxEdits(file: 'DEVPOST.md' | 'DEVPOST_FIELDS.md', text: string, s: NonNullable<Facts['sandbox']>, hosted?: HostedEvidence): { text: string; applied: boolean } {
  const standIn = hosted?.paypalMode === 'sandbox' && hosted.standIn && hosted.paypalBatchId;
  const rosa = standIn
    ? ` On the hosted /demo, Mrs. Lan's payout (batch \`${hosted.paypalBatchId}\`) settles in a PayPal sandbox account standing in for her Venmo, and Rosa's goes to a fresh unregistered address and really stays unclaimed until an organizer cancels it; the screens say so.`
    : " Rosa's claim is still simulated, because nobody can claim a sandbox payout for her.";
  const verified = `Verified against PayPal's sandbox on ${s.date}: batch \`${s.batchId ?? '?'}\`${s.verifiedEventId ? `, webhook \`${s.verifiedEventId}\` verified by PayPal's postback API` : ''}.${rosa}`;
  if (file === 'DEVPOST_FIELDS.md') {
    const re = phrase("(sandbox) Every call is exercised end to end against tools/fake-paypal, our look-alike of PayPal's documented shapes; the run against PayPal's real sandbox is waiting on sandbox credentials, and the demo labels simulated PayPal ids \"Sandbox: simulated\".");
    if (text.includes(verified)) return { text, applied: true };
    if (!re.test(text)) return { text, applied: false };
    return { text: text.replace(re, `Every call is exercised end to end against tools/fake-paypal, our look-alike of PayPal's documented shapes. ${verified}`), applied: true };
  }
  const re = phrase("the run against PayPal's real sandbox is waiting on sandbox credentials *(sandbox)*.");
  const repl = `the run against PayPal's real sandbox on ${s.date} is recorded in [SANDBOX_EVIDENCE.md](../SANDBOX_EVIDENCE.md) (batch \`${s.batchId ?? '?'}\`${s.verifiedEventId ? `, webhook \`${s.verifiedEventId}\` verified` : ''}).`;
  if (text.includes(repl)) return { text, applied: true };
  if (!re.test(text)) return { text, applied: false };
  return { text: text.replace(re, repl), applied: true };
}

const PAYPAL_MARK = '<!-- golive:answered -->';

/** docs/PAYPAL.md: point the "To verify in the real sandbox" list at the evidence. */
export function paypalDocEdit(text: string, date: string): { text: string; applied: boolean } {
  const line = `${PAYPAL_MARK}\n**Answered by the sandbox run of ${date}:** see [SANDBOX_EVIDENCE.md](SANDBOX_EVIDENCE.md) (generated by \`pnpm golive\`).\n`;
  if (text.includes(PAYPAL_MARK)) return { text: text.replace(new RegExp(`${PAYPAL_MARK}\\n[^\\n]*\\n`), line), applied: true };
  const at = text.indexOf('## To verify in the real sandbox');
  if (at === -1) return { text, applied: false };
  const eol = text.indexOf('\n', at);
  return { text: `${text.slice(0, eol + 1)}\n${line}${text.slice(eol + 1)}`, applied: true };
}
