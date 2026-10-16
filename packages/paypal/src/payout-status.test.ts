import { describe, expect, it } from 'vitest';
import { PayoutItemStatus } from '@neighborline/core';
import { applyItemStatus, canTransition, itemStatusFromEvent, mapBatchStatus, mapTransactionStatus, PAYOUT_ITEM_EVENT_TYPES, type PayoutItemStatus as Status } from './payout-status.js';

describe('status mapping', () => {
  it('maps every documented transaction_status to the core enum', () => {
    for (const s of ['SUCCESS', 'FAILED', 'PENDING', 'UNCLAIMED', 'RETURNED', 'ONHOLD', 'BLOCKED', 'REFUNDED', 'REVERSED']) {
      expect(PayoutItemStatus.parse(mapTransactionStatus(s))).toBe(s);
    }
  });
  it('treats unknown / missing statuses as PENDING (re-poll), never as final', () => {
    expect(mapTransactionStatus('NEW')).toBe('PENDING');
    expect(mapTransactionStatus(undefined)).toBe('PENDING');
  });
  it('maps item webhook events (CANCELED is ours, DENIED → FAILED, HELD → ONHOLD)', () => {
    expect(itemStatusFromEvent('PAYMENT.PAYOUTS-ITEM.SUCCEEDED')).toBe('SUCCESS');
    expect(itemStatusFromEvent('PAYMENT.PAYOUTS-ITEM.CANCELED')).toBe('CANCELED');
    expect(itemStatusFromEvent('PAYMENT.PAYOUTS-ITEM.DENIED')).toBe('FAILED');
    expect(itemStatusFromEvent('PAYMENT.PAYOUTS-ITEM.HELD')).toBe('ONHOLD');
    expect(itemStatusFromEvent('PAYMENT.PAYOUTSBATCH.SUCCESS')).toBeUndefined();
    for (const t of PAYOUT_ITEM_EVENT_TYPES) expect(() => PayoutItemStatus.parse(itemStatusFromEvent(t))).not.toThrow();
  });
  it('maps batch statuses', () => {
    expect(mapBatchStatus('PROCESSING')).toBe('PROCESSING');
    expect(mapBatchStatus('DENIED')).toBe('DENIED');
    expect(mapBatchStatus('weird')).toBe('PENDING');
  });
});

describe('applyItemStatus (out-of-order webhooks)', () => {
  const fold = (events: Status[], start: Status = 'PENDING') => events.reduce((s, e) => applyItemStatus(s, e).status, start);

  it('a late HELD after SUCCEEDED does not regress the item', () => {
    expect(fold(['SUCCESS', 'ONHOLD', 'PENDING'])).toBe('SUCCESS');
    expect(applyItemStatus('SUCCESS', 'ONHOLD')).toEqual({ status: 'SUCCESS', changed: false, reason: 'stale' });
  });
  it('UNCLAIMED → SUCCESS (recipient claimed) is a valid forward move', () => {
    expect(fold(['UNCLAIMED', 'SUCCESS'])).toBe('SUCCESS');
  });
  it('same final state regardless of arrival order for the claim story', () => {
    expect(fold(['ONHOLD', 'UNCLAIMED', 'SUCCESS'])).toBe('SUCCESS');
    expect(fold(['UNCLAIMED', 'ONHOLD', 'SUCCESS'])).toBe('SUCCESS');
    expect(fold(['SUCCESS', 'UNCLAIMED', 'ONHOLD'])).toBe('SUCCESS');
  });
  it('cancel arrives as CANCELED (event) and RETURNED (GET): equivalent, first one wins', () => {
    expect(applyItemStatus('CANCELED', 'RETURNED')).toEqual({ status: 'CANCELED', changed: false, reason: 'equivalent' });
    expect(fold(['UNCLAIMED', 'RETURNED', 'CANCELED'])).toBe('RETURNED');
  });
  it('terminal states stay terminal; SUCCESS can still be refunded/reversed', () => {
    for (const t of ['FAILED', 'RETURNED', 'CANCELED', 'REFUNDED', 'REVERSED'] as Status[]) expect(canTransition(t, 'SUCCESS')).toBe(false);
    expect(fold(['SUCCESS', 'REFUNDED'])).toBe('REFUNDED');
  });
});
