import { describe, expect, it } from 'vitest';
import {
  ITEM_TRANSITIONS,
  InvalidTransitionError,
  REQUEST_TRANSITIONS,
  TERMINAL_ITEM_STATUSES,
  applyItemEvent,
  canTransitionRequest,
  foldItemEvents,
  isItemTerminal,
  isRequestFinal,
  itemStatusForWebhookEvent,
  parsePayPalItemStatus,
  requestStatusForItem,
  transitionRequest,
} from './state.js';
import { PayoutItemStatus, RequestStatus } from './schemas.js';

const ITEM = PayoutItemStatus.options;
const REQ = RequestStatus.options;

describe('request state machine', () => {
  it('covers every status', () => {
    expect(Object.keys(REQUEST_TRANSITIONS).sort()).toEqual([...REQ].sort());
  });
  it('follows the happy path', () => {
    const path: RequestStatus[] = ['intake', 'awaiting_approval', 'approved', 'paying', 'paid'];
    path.slice(1).forEach((to, i) => expect(transitionRequest(path[i]!, to)).toBe(to));
  });
  it('supports the unclaimed → claim-help → paid beat', () => {
    expect(canTransitionRequest('paying', 'unclaimed')).toBe(true);
    expect(canTransitionRequest('unclaimed', 'paid')).toBe(true);
  });
  it('rejects skipping approval', () => {
    expect(canTransitionRequest('intake', 'paying')).toBe(false);
    expect(canTransitionRequest('awaiting_approval', 'paying')).toBe(false);
    expect(() => transitionRequest('intake', 'paid')).toThrow(InvalidTransitionError);
    expect(() => transitionRequest('intake', 'paid')).toThrow('intake → paid');
  });
  it('treats same-state as a no-op', () => {
    for (const s of REQ) expect(transitionRequest(s, s)).toBe(s);
  });
  it('cancelled is terminal; paid only moves to returned', () => {
    expect(REQUEST_TRANSITIONS.cancelled).toEqual([]);
    expect(REQUEST_TRANSITIONS.paid).toEqual(['returned']);
    expect(isRequestFinal('paid')).toBe(true);
    expect(isRequestFinal('awaiting_approval')).toBe(false);
  });
  it('only references known statuses', () => {
    for (const tos of Object.values(REQUEST_TRANSITIONS)) for (const t of tos) expect(REQ).toContain(t);
  });
});

describe('payout item state machine', () => {
  it('covers every status and terminal set', () => {
    expect(Object.keys(ITEM_TRANSITIONS).sort()).toEqual([...ITEM].sort());
    expect([...TERMINAL_ITEM_STATUSES].sort()).toEqual(['BLOCKED', 'CANCELED', 'FAILED', 'REFUNDED', 'RETURNED', 'REVERSED']);
    expect(isItemTerminal('SUCCESS')).toBe(false);
    expect(isItemTerminal('RETURNED')).toBe(true);
  });
  it('PENDING can move to anything else', () => {
    for (const s of ITEM.filter((x) => x !== 'PENDING')) expect(applyItemEvent('PENDING', s)).toEqual({ status: s, changed: true });
  });
  it('UNCLAIMED → SUCCESS | RETURNED | CANCELED only', () => {
    for (const s of ITEM) {
      const r = applyItemEvent('UNCLAIMED', s);
      expect(r.changed).toBe(['SUCCESS', 'RETURNED', 'CANCELED'].includes(s));
    }
  });
  it('is idempotent on duplicates', () => {
    for (const s of ITEM) expect(applyItemEvent(s, s)).toEqual({ status: s, changed: false, ignored: 'duplicate' });
  });
  it('never regresses a settled state on late webhooks', () => {
    expect(applyItemEvent('SUCCESS', 'PENDING')).toEqual({ status: 'SUCCESS', changed: false, ignored: 'stale' });
    expect(applyItemEvent('SUCCESS', 'UNCLAIMED')).toMatchObject({ status: 'SUCCESS', changed: false });
    expect(applyItemEvent('SUCCESS', 'ONHOLD')).toMatchObject({ status: 'SUCCESS', changed: false });
    for (const t of TERMINAL_ITEM_STATUSES) for (const s of ITEM) expect(applyItemEvent(t, s).status).toBe(t);
  });
  it('allows refunds/reversals after success', () => {
    expect(applyItemEvent('SUCCESS', 'REFUNDED')).toEqual({ status: 'REFUNDED', changed: true });
    expect(applyItemEvent('SUCCESS', 'REVERSED')).toEqual({ status: 'REVERSED', changed: true });
  });
  it('folds any permutation of a realistic sequence to the same final state', () => {
    const seq: PayoutItemStatus[] = ['PENDING', 'UNCLAIMED', 'SUCCESS', 'SUCCESS'];
    const perms = (xs: PayoutItemStatus[]): PayoutItemStatus[][] =>
      xs.length <= 1 ? [xs] : xs.flatMap((x, i) => perms([...xs.slice(0, i), ...xs.slice(i + 1)]).map((p) => [x, ...p]));
    for (const p of perms(seq)) expect(foldItemEvents(p)).toBe('SUCCESS');
    expect(foldItemEvents([])).toBe('PENDING');
    expect(foldItemEvents(['RETURNED', 'SUCCESS'], 'UNCLAIMED')).toBe('RETURNED');
  });
  it('maps item status to request status for every item status', () => {
    const expected: Record<PayoutItemStatus, RequestStatus> = {
      PENDING: 'paying', ONHOLD: 'paying', SUCCESS: 'paid', UNCLAIMED: 'unclaimed', RETURNED: 'returned',
      REFUNDED: 'returned', REVERSED: 'returned', BLOCKED: 'failed', FAILED: 'failed', CANCELED: 'cancelled',
    };
    for (const s of ITEM) expect(requestStatusForItem(s)).toBe(expected[s]);
  });
  it('mapped request statuses are reachable from paying (except cancel via unclaimed)', () => {
    for (const s of ITEM) {
      const r = requestStatusForItem(s);
      expect(r === 'paying' || canTransitionRequest('paying', r)).toBe(true);
    }
  });
});

describe('PayPal mapping', () => {
  it('maps webhook event types', () => {
    expect(itemStatusForWebhookEvent('PAYMENT.PAYOUTS-ITEM.SUCCEEDED')).toBe('SUCCESS');
    expect(itemStatusForWebhookEvent('PAYMENT.PAYOUTS-ITEM.UNCLAIMED')).toBe('UNCLAIMED');
    expect(itemStatusForWebhookEvent('PAYMENT.PAYOUTS-ITEM.DENIED')).toBe('FAILED');
    expect(itemStatusForWebhookEvent('PAYMENT.PAYOUTS-ITEM.HELD')).toBe('ONHOLD');
    expect(itemStatusForWebhookEvent('PAYMENT.PAYOUTSBATCH.SUCCESS')).toBeNull();
    expect(itemStatusForWebhookEvent('nonsense')).toBeNull();
  });
  it('parses transaction_status strings', () => {
    expect(parsePayPalItemStatus('success')).toBe('SUCCESS');
    expect(parsePayPalItemStatus(' UNCLAIMED ')).toBe('UNCLAIMED');
    expect(parsePayPalItemStatus('DENIED')).toBe('FAILED');
    expect(parsePayPalItemStatus('NEW')).toBe('PENDING');
    expect(parsePayPalItemStatus('WAT')).toBeNull();
  });
});
