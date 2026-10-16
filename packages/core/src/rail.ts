/**
 * Rail protection (SPEC §2.4): protect the payment rail, never score the person.
 * Every flag here is about *where money goes* or *text trying to steer the system*.
 */
import type { HistoryEntry, PayoutDestination, Policy, RailFlag } from './schemas.js';
import { damerauLevenshtein, handleVariants, isPhoneLike, lookalikeThreshold, normalizeHandle } from './handles.js';
import { COUNTED_STATUSES, DAY_MS, destinationKey, normalizePhone, toDate } from './identity.js';
import { detectPromptInjection, type InjectionSignal } from './injection.js';


export interface CheckRailInput {
  destination: PayoutDestination | null;
  /** The group's official PayPal email / Venmo handle(s). */
  groupHandles: readonly string[];
  /** Organizers' own handles (emails, Venmo handles, phones). */
  organizerHandles: readonly string[];
  history: readonly HistoryEntry[];
  policy: Policy;
  /** Original + English request text; checked for prompt injection. */
  text?: string | readonly string[];
  now?: string | Date;
  /** Exclude this request from its own history (recompute). */
  requestId?: string;
}

/** Lookalike / self-payment checks against official handles. */
export function checkHandles(
  destination: Pick<PayoutDestination, 'type' | 'value'>,
  groupHandles: readonly string[],
  organizerHandles: readonly string[],
): RailFlag[] {
  const official = [
    ...groupHandles.map((h) => ({ h, who: 'the group' })),
    ...organizerHandles.map((h) => ({ h, who: 'an organizer' })),
  ].filter((o) => o.h.trim() !== '');
  const value = destination.value;

  if (destination.type === 'PHONE' || isPhoneLike(value)) {
    const mine = normalizePhone(value);
    const hit = official.find((o) => isPhoneLike(o.h) && normalizePhone(o.h) === mine);
    return hit ? [selfPay(value, hit.who)] : [];
  }

  const norm = normalizeHandle(value);
  const exact = official.find((o) => !isPhoneLike(o.h) && normalizeHandle(o.h) === norm);
  if (exact) return [selfPay(value, exact.who)];

  const mine = handleVariants(value, { includeLocalPart: true });
  for (const o of official) {
    if (isPhoneLike(o.h)) continue;
    for (const theirs of handleVariants(o.h, { includeLocalPart: false })) {
      if (theirs.length < 5) continue;
      for (const v of mine) {
        const limit = lookalikeThreshold(Math.min(v.length, theirs.length));
        const close = damerauLevenshtein(v, theirs, limit) <= limit;
        const contains = theirs.length >= 8 && v !== theirs && v.includes(theirs);
        if (close || contains) {
          return [{
            code: 'LOOKALIKE_HANDLE',
            severity: 'block',
            detail: `Payout destination "${value}" looks like ${o.who}'s official handle "${o.h}". Possible impersonation — confirm the destination with the requester directly.`,
          }];
        }
      }
    }
  }
  return [];
}

function selfPay(value: string, who: string): RailFlag {
  return {
    code: 'DEST_IS_GROUP_HANDLE',
    severity: 'block',
    detail: `Payout destination "${value}" belongs to ${who}. Aid must go to the neighbor's own account.`,
  };
}

const normName = (n: string): string[] =>
  n.normalize('NFKD').replace(/\p{M}/gu, '').replace(/đ/gi, 'd').toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean);

/**
 * Names "match" if one token set contains the other: "Lan" ≈ "Nguyễn Thị Lan" ≈ "Lan Nguyen Thi".
 * We are deliberately generous so name order, accents and nicknames-as-subsets never flag a person.
 */
export function namesCompatible(a: string, b: string): boolean {
  const ta = new Set(normName(a));
  const tb = new Set(normName(b));
  if (ta.size === 0 || tb.size === 0) return true;
  const [small, big] = ta.size <= tb.size ? [ta, tb] : [tb, ta];
  return [...small].every((t) => big.has(t));
}

function checkHistory(
  destination: PayoutDestination,
  history: readonly HistoryEntry[],
  policy: Policy,
  now: Date,
  requestId: string | undefined,
): RailFlag[] {
  const flags: RailFlag[] = [];
  const key = destinationKey(destination);
  const same = history.filter((h) => h.requestId !== requestId && destinationKey(h.destination) === key);

  const myName = destination.nameOnFile?.trim();
  if (myName) {
    const other = same.find((h) => h.destination.nameOnFile && !namesCompatible(myName, h.destination.nameOnFile));
    if (other) {
      flags.push({
        code: 'DUP_DESTINATION_DIFF_NAME',
        severity: 'review',
        detail: `This payout account was used before under a different name ("${other.destination.nameOnFile}"). Often a shared family account — check with the requester.`,
      });
    }
  }

  const since = now.getTime() - 30 * DAY_MS;
  const recent = same.filter((h) => {
    const t = new Date(h.createdAt).getTime();
    return COUNTED_STATUSES.has(h.status) && t > since && t <= now.getTime();
  });
  if (recent.length >= policy.maxRequestsPerDestinationPer30d) {
    flags.push({
      code: 'VELOCITY',
      severity: 'review',
      detail: `This payout account already has ${recent.length} request(s) in the last 30 days (policy allows ${policy.maxRequestsPerDestinationPer30d}).`,
    });
  }
  return flags;
}

const SIGNAL_LABEL: Record<InjectionSignal['id'], string> = {
  ignore_instructions: 'asks to ignore rules/instructions',
  system_marker: 'contains system-prompt markers',
  role_override: 'tries to change the assistant’s role',
  approval_coercion: 'tries to force or skip approval',
  structured_payload: 'contains tool/JSON payloads',
  encoded_blob: 'contains an encoded blob',
  hidden_characters: 'contains hidden control characters',
  large_amount_directive: 'demands an amount far above any cap',
};

export function checkInjection(text: string | readonly string[] | undefined, policy: Policy): RailFlag[] {
  const parts = typeof text === 'string' ? [text] : [...(text ?? [])];
  const seen = new Map<InjectionSignal['id'], InjectionSignal>();
  for (const t of parts) {
    for (const s of detectPromptInjection(t, { largeAmountCents: policy.householdCapPer30dCents * 10 })) {
      if (!seen.has(s.id)) seen.set(s.id, s);
    }
  }
  if (seen.size === 0) return [];
  const why = [...seen.values()].map((s) => `${SIGNAL_LABEL[s.id]} ("${s.excerpt}")`).join('; ');
  return [{
    code: 'PROMPT_INJECTION',
    severity: 'review',
    detail: `Request text ${why}. The assistant did not act on it; amounts always come from policy.`,
  }];
}

/** All rail checks. Order: block flags first, then review flags. */
export function checkRail(input: CheckRailInput): RailFlag[] {
  const now = toDate(input.now);
  const flags: RailFlag[] = [];
  if (input.destination) {
    flags.push(...checkHandles(input.destination, input.groupHandles, input.organizerHandles));
    flags.push(...checkHistory(input.destination, input.history, input.policy, now, input.requestId));
  }
  flags.push(...checkInjection(input.text, input.policy));
  return flags.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'block' ? -1 : 1));
}

export const hasBlockingFlag = (flags: readonly RailFlag[]): boolean => flags.some((f) => f.severity === 'block');
