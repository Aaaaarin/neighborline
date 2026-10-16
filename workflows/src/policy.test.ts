import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { UnclaimedItem } from './contract.js';
import { decideUnclaimed, dedupeMismatches, dueJobs, planLagRecheck, reconcileWindows } from './policy.js';

const H = 3_600_000;
const D = 24 * H;

test('reconcileWindows: 72 h in 24 h slices, hour-aligned, contiguous', () => {
  const w = reconcileWindows(new Date('2026-11-20T10:07:33Z'), 72, 24);
  assert.equal(w.length, 3);
  assert.equal(w[0]!.startDate, '2026-11-17T10:00:00.000Z');
  assert.equal(w[2]!.endDate, '2026-11-20T10:00:00.000Z');
  assert.equal(w[0]!.endDate, w[1]!.startDate);
  assert.match(w[1]!.idempotencyKey, /^reconcile:2026-11-18T10:00:00.000Z\/2026-11-19T10:00:00.000Z$/);
});

test('reconcileWindows rejects slices longer than Transaction Search allows', () => {
  assert.throws(() => reconcileWindows(new Date(), 24 * 40, 24 * 32));
});

test('planLagRecheck waits until the newest pending item is past the 3 h lag + margin', () => {
  const now = new Date('2026-11-20T10:00:00Z');
  const plan = planLagRecheck(
    [{ paidAt: '2026-11-20T09:00:00Z' }, { paidAt: '2026-11-20T08:00:00Z' }],
    3,
    now,
  );
  assert.ok(plan);
  assert.equal(plan.waitMs, 2 * H + 10 * 60_000);
  assert.equal(plan.startDate, '2026-11-20T07:55:00.000Z');
  assert.equal(planLagRecheck([], 3, now), null);
  assert.equal(planLagRecheck([{ paidAt: '2026-11-19T00:00:00Z' }], 3, now)!.waitMs, 0);
});

test('dedupeMismatches keeps one entry per item+kind', () => {
  const m = dedupeMismatches(
    [{ itemId: 'a', kind: 'status_mismatch' }],
    [{ itemId: 'a', kind: 'status_mismatch' }, { itemId: 'a', kind: 'amount_mismatch' }],
  );
  assert.equal(m.length, 2);
});

function item(over: Partial<UnclaimedItem>, now: Date, unclaimedAgoH: number): UnclaimedItem {
  return {
    itemId: 'it_1',
    requestId: 'req_1',
    lang: 'es',
    wallet: 'VENMO',
    amountCents: 15000,
    payoutCreatedAt: new Date(now.getTime() - unclaimedAgoH * H - 60_000).toISOString(),
    unclaimedSince: new Date(now.getTime() - unclaimedAgoH * H).toISOString(),
    nudgeCount: 0,
    lastNudgeAt: null,
    organizerAlertedAt: null,
    ...over,
  };
}

test('decideUnclaimed: nothing before 24 h', () => {
  const now = new Date('2026-11-20T10:00:00Z');
  assert.deepEqual(decideUnclaimed(item({}, now, 23), now), []);
});

test('decideUnclaimed: first nudge at 24 h, keyed per nudge number', () => {
  const now = new Date('2026-11-20T10:00:00Z');
  const a = decideUnclaimed(item({}, now, 25), now);
  assert.deepEqual(a, [{ action: 'renotify', itemId: 'it_1', nudgeNumber: 1, idempotencyKey: 'renotify:it_1:1' }]);
});

test('decideUnclaimed: respects schedule and the minimum gap between nudges', () => {
  const now = new Date('2026-11-20T10:00:00Z');
  // 2 days in, already nudged once → next nudge is at 72 h
  assert.deepEqual(decideUnclaimed(item({ nudgeCount: 1, lastNudgeAt: new Date(now.getTime() - 24 * H).toISOString() }, now, 48), now), []);
  // 4 days in, 1 nudge so far, last one 2 h ago → gap blocks it
  assert.deepEqual(decideUnclaimed(item({ nudgeCount: 1, lastNudgeAt: new Date(now.getTime() - 2 * H).toISOString() }, now, 96), now), []);
  // 4 days in, last nudge a day ago → nudge #2
  const a = decideUnclaimed(item({ nudgeCount: 1, lastNudgeAt: new Date(now.getTime() - 24 * H).toISOString() }, now, 96), now);
  assert.equal(a[0]?.action, 'renotify');
  assert.equal(a[0]?.action === 'renotify' && a[0].nudgeNumber, 2);
});

test('decideUnclaimed: day 25 escalates once with the 30-day deadline', () => {
  const now = new Date('2026-11-20T10:00:00Z');
  const it = item({ nudgeCount: 5, lastNudgeAt: new Date(now.getTime() - 4 * D).toISOString() }, now, 25 * 24 + 1);
  const a = decideUnclaimed(it, now);
  assert.equal(a.length, 1);
  assert.equal(a[0]!.action, 'escalate');
  const first = a[0]!;
  assert.equal(first.action === 'escalate' && first.deadline, new Date(Date.parse(it.payoutCreatedAt) + 30 * D).toISOString());
  assert.deepEqual(decideUnclaimed({ ...it, organizerAlertedAt: now.toISOString() }, now), []);
});

test('decideUnclaimed: nothing after PayPal auto-return', () => {
  const now = new Date('2026-11-20T10:00:00Z');
  assert.deepEqual(decideUnclaimed(item({}, now, 31 * 24), now), []);
});

test('dueJobs: reconcile only in the configured UTC hour; keys are per hour/day', () => {
  const at10 = dueJobs(new Date('2026-11-20T10:14:00Z'), { reconcileHourUtc: 10, reportEveryNPayouts: 5 });
  assert.deepEqual(at10.map((j) => j.task), ['nightlyReconcile', 'unclaimedSweep', 'refreshReport']);
  assert.equal(at10[0]!.idempotencyKey, 'reconcile:2026-11-20');
  assert.equal(at10[1]!.idempotencyKey, 'unclaimed:2026-11-20T10');
  const at11 = dueJobs(new Date('2026-11-20T11:44:00Z'), { reconcileHourUtc: 10, reportEveryNPayouts: 5 });
  assert.deepEqual(at11.map((j) => j.task), ['unclaimedSweep', 'refreshReport']);
  assert.deepEqual(at11[1]!.input, [{ minNewPayouts: 5, force: false, reason: 'schedule' }]);
});
