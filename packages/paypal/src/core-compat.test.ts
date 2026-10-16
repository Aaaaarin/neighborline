/**
 * The published package mirrors a few types from the private @neighborline/core contract. These checks fail
 * (typecheck + runtime) the moment the two drift apart.
 */
import * as core from '@neighborline/core';
import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  applyItemStatus,
  BATCH_STATUSES,
  ITEM_TRANSITIONS,
  itemStatusFromEvent,
  PAYOUT_ITEM_EVENT_TYPES,
  PAYOUT_ITEM_STATUSES,
  type BatchStatus,
  type PayoutItemStatus,
} from './payout-status.js';
import type { LocalPayoutItem } from './reconcile.js';
import type { PayoutRecipientType, PayoutWallet } from './payouts.js';

describe('@neighborline/core compatibility', () => {
  it('status enums are identical', () => {
    expect([...PAYOUT_ITEM_STATUSES].sort()).toEqual([...core.PayoutItemStatus.options].sort());
    expect([...BATCH_STATUSES].sort()).toEqual([...core.PayoutBatch.shape.status.options].sort());
    expectTypeOf<PayoutItemStatus>().toEqualTypeOf<core.PayoutItemStatus>();
    expectTypeOf<BatchStatus>().toEqualTypeOf<core.PayoutBatch['status']>();
  });
  it('the payout item state machine and webhook mapping match core exactly (one source of truth)', () => {
    for (const s of PAYOUT_ITEM_STATUSES) expect([...ITEM_TRANSITIONS[s]].sort()).toEqual([...core.ITEM_TRANSITIONS[s]].sort());
    for (const t of PAYOUT_ITEM_EVENT_TYPES) expect(itemStatusFromEvent(t)).toBe(core.itemStatusForWebhookEvent(t));
    for (const a of PAYOUT_ITEM_STATUSES) for (const b of PAYOUT_ITEM_STATUSES) expect(applyItemStatus(a, b).status).toBe(core.applyItemEvent(a, b).status);
  });
  it('core payout items and destinations plug straight into this package', () => {
    expectTypeOf<core.PayoutItem>().toMatchTypeOf<LocalPayoutItem>();
    expectTypeOf<core.Wallet>().toEqualTypeOf<PayoutWallet>();
    expectTypeOf<core.RecipientType>().toMatchTypeOf<PayoutRecipientType>();
  });
});
