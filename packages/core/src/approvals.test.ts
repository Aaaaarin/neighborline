import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { sha256Hex, utf8Bytes } from './sha256.js';
import {
  addApprover,
  approvalHash,
  approvalPayload,
  canExecute,
  canonicalJson,
  createApproval,
  markExecuted,
  requiredApprovers,
  senderBatchIdFor,
  senderItemIdFor,
  voidApproval,
  type ApprovalContent,
} from './approvals.js';
import type { Approver } from './schemas.js';

describe('sha256 (pure JS)', () => {
  it.each([
    ['', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
    ['abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
    ['abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq', '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1'],
    ['The quick brown fox jumps over the lazy dog', 'd7a8fbb307d7809469ca9abcb0082e4f8d5651e46d3cdb762d02d0bf37c9e592'],
  ])('NIST/known vector %#', (input, hex) => {
    expect(sha256Hex(input)).toBe(hex);
  });
  it('one million "a"', () => {
    expect(sha256Hex('a'.repeat(1_000_000))).toBe('cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0');
  });
  it('matches node:crypto across block boundaries and unicode', () => {
    const samples = ['Đã gửi $150 vào Venmo của bạn', '已汇到您的 Venmo', 'تم إرسال', '😀🏠', 'x'];
    for (let len = 0; len <= 130; len++) samples.push('ab'.repeat(len).slice(0, len));
    for (const s of samples) expect(sha256Hex(s)).toBe(createHash('sha256').update(s, 'utf8').digest('hex'));
  });
  it('hashes raw bytes', () => {
    const bytes = Uint8Array.from([0, 1, 2, 255]);
    expect(sha256Hex(bytes)).toBe(createHash('sha256').update(bytes).digest('hex'));
  });
  it('utf8Bytes matches Buffer and replaces lone surrogates', () => {
    for (const s of ['héllo', '€', '𝄞', 'ab']) expect([...utf8Bytes(s)]).toEqual([...Buffer.from(s, 'utf8')]);
    expect([...utf8Bytes(String.fromCharCode(0xd800))]).toEqual([0xef, 0xbf, 0xbd]);
  });
});

describe('canonicalJson', () => {
  it('sorts keys recursively and is insensitive to insertion order', () => {
    expect(canonicalJson({ b: 1, a: { d: [3, { z: 1, y: 2 }], c: 'x' } })).toBe('{"a":{"c":"x","d":[3,{"y":2,"z":1}]},"b":1}');
    expect(canonicalJson({ x: 1, y: 2 })).toBe(canonicalJson({ y: 2, x: 1 }));
  });
  it('drops undefined members, nulls undefined array slots, normalizes -0', () => {
    expect(canonicalJson({ a: undefined, b: null })).toBe('{"b":null}');
    expect(canonicalJson([undefined, 1])).toBe('[null,1]');
    expect(canonicalJson(-0)).toBe('0');
    expect(canonicalJson(true)).toBe('true');
    expect(canonicalJson(false)).toBe('false');
    expect(canonicalJson('é"\n')).toBe('"é\\"\\n"');
    expect(canonicalJson(Object.create(null) as object)).toBe('{}');
  });
  it('rejects non-JSON values', () => {
    expect(() => canonicalJson(Number.NaN)).toThrow(TypeError);
    expect(() => canonicalJson(Number.POSITIVE_INFINITY)).toThrow(TypeError);
    expect(() => canonicalJson(new Date())).toThrow(/plain objects/);
    expect(() => canonicalJson(10n)).toThrow(/bigint/);
    expect(() => canonicalJson(() => 1)).toThrow(/function/);
    expect(() => canonicalJson(undefined)).toThrow(/undefined/);
  });
});

const content = (over: Partial<ApprovalContent> = {}): ApprovalContent => ({
  policyVersionId: 'pol_eastside_v1',
  items: [
    { requestId: 'req_lan', amountCents: 15000, destination: { wallet: 'VENMO', type: 'USER_HANDLE', value: '@lan-nguyen' } },
    { requestId: 'req_maria', amountCents: 10000, destination: { wallet: 'PAYPAL', type: 'EMAIL', value: 'maria@example.com' } },
  ],
  ...over,
});
const dana: Approver = { organizerId: 'org_dana', at: '2026-10-16T18:00:01Z', deviceLabel: 'Dana’s phone' };
const marcus: Approver = { organizerId: 'org_marcus', at: '2026-10-16T18:00:09Z', deviceLabel: 'Marcus’s phone' };

describe('approvalHash', () => {
  it('is stable regardless of item order', () => {
    const c = content();
    expect(approvalHash(c)).toBe(approvalHash({ ...c, items: [...c.items].reverse() }));
    expect(approvalHash(c)).toMatch(/^[0-9a-f]{64}$/);
  });
  it('ignores cosmetic destination differences (case, leading @)', () => {
    const c = content();
    const cosmetic = content({
      items: [
        { ...c.items[0]!, destination: { ...c.items[0]!.destination, value: 'LAN-NGUYEN' } },
        { ...c.items[1]!, destination: { ...c.items[1]!.destination, value: ' Maria@Example.com' } },
      ],
    });
    expect(approvalHash(cosmetic)).toBe(approvalHash(c));
  });
  it('changes with any material change', () => {
    const h = approvalHash(content());
    const c = content();
    expect(approvalHash({ ...c, policyVersionId: 'pol_v2' })).not.toBe(h);
    expect(approvalHash({ ...c, items: [{ ...c.items[0]!, amountCents: 15001 }, c.items[1]!] })).not.toBe(h);
    expect(approvalHash({ ...c, items: [{ ...c.items[0]!, destination: { ...c.items[0]!.destination, wallet: 'PAYPAL' } }, c.items[1]!] })).not.toBe(h);
    expect(approvalHash({ ...c, items: [{ ...c.items[0]!, destination: { ...c.items[0]!.destination, value: '@lan-nguyem' } }, c.items[1]!] })).not.toBe(h);
    expect(approvalHash({ ...c, items: [c.items[0]!] })).not.toBe(h);
  });
  it('exposes the payload for auditors', () => {
    const p = approvalPayload(content());
    expect(p.requestIds).toEqual(['req_lan', 'req_maria']);
    expect(p.totalCents).toBe(25000);
    expect(p.v).toBe(1);
  });
  it('rejects empty, duplicate and non-positive/non-integer items', () => {
    expect(() => approvalHash(content({ items: [] }))).toThrow(/at least one/);
    const c = content();
    expect(() => approvalHash({ ...c, items: [c.items[0]!, c.items[0]!] })).toThrow(/duplicate/);
    expect(() => approvalHash({ ...c, items: [{ ...c.items[0]!, amountCents: 0 }] })).toThrow(RangeError);
    expect(() => approvalHash({ ...c, items: [{ ...c.items[0]!, amountCents: 1.5 }] })).toThrow(RangeError);
  });
});

describe('two-person approval flow', () => {
  it('creates a pending approval with sorted ids and total', () => {
    const a = createApproval('apr_1', content());
    expect(a).toMatchObject({ id: 'apr_1', requestIds: ['req_lan', 'req_maria'], totalCents: 25000, status: 'pending', approvers: [] });
    expect(a.hash).toBe(approvalHash(content()));
  });
  it('needs two distinct organizers to complete', () => {
    const a0 = createApproval('apr_1', content());
    const r1 = addApprover(a0, dana);
    expect(r1).toMatchObject({ ok: true, changed: true, complete: false });
    if (!r1.ok) throw new Error();
    expect(r1.approval.status).toBe('pending');
    expect(a0.approvers).toEqual([]); // pure
    const r2 = addApprover(r1.approval, marcus);
    expect(r2).toMatchObject({ ok: true, changed: true, complete: true });
    if (!r2.ok) throw new Error();
    expect(r2.approval.status).toBe('complete');
    expect(r2.approval.approvers.map((x) => x.organizerId)).toEqual(['org_dana', 'org_marcus']);
  });
  it('treats a double tap by the same organizer as a no-op (never completes alone)', () => {
    const r1 = addApprover(createApproval('a', content()), dana);
    if (!r1.ok) throw new Error();
    const r2 = addApprover(r1.approval, { ...dana, organizerId: ' org_dana ', at: 'later', deviceLabel: 'laptop' });
    expect(r2).toMatchObject({ ok: true, changed: false, complete: false });
    if (r2.ok) expect(r2.approval).toBe(r1.approval);
  });
  it('rejects blank organizer ids and non-organizers', () => {
    const a = createApproval('a', content());
    expect(addApprover(a, { ...dana, organizerId: '  ' })).toMatchObject({ ok: false, reason: 'INVALID_APPROVER' });
    expect(addApprover(a, dana, { eligibleOrganizerIds: ['org_marcus'] })).toMatchObject({ ok: false, reason: 'NOT_AN_ORGANIZER' });
    expect(addApprover(a, dana, { eligibleOrganizerIds: new Set(['org_dana']) }).ok).toBe(true);
  });
  it('voids the approval when the content changed since it was created', () => {
    const r1 = addApprover(createApproval('a', content()), dana);
    if (!r1.ok) throw new Error();
    const changed = content({ items: [{ ...content().items[0]!, amountCents: 99_00 }] });
    const r2 = addApprover(r1.approval, marcus, { currentContent: changed });
    expect(r2).toMatchObject({ ok: false, reason: 'CONTENT_CHANGED' });
    expect(r2.approval.status).toBe('void');
    expect(addApprover(r2.approval, marcus)).toMatchObject({ ok: false, reason: 'VOID' });
  });
  it('accepts unchanged content', () => {
    const r = addApprover(createApproval('a', content()), dana, { currentContent: content() });
    expect(r.ok).toBe(true);
  });
  it('supports higher thresholds but never fewer than two', () => {
    let a = createApproval('a', content());
    for (const id of ['o1', 'o2']) {
      const r = addApprover(a, { ...dana, organizerId: id }, { required: 3 });
      if (!r.ok) throw new Error();
      a = r.approval;
    }
    expect(a.status).toBe('pending');
    const r3 = addApprover(a, { ...dana, organizerId: 'o3' }, { required: 3 });
    expect(r3.ok && r3.complete).toBe(true);
    expect(() => addApprover(a, dana, { required: 1 })).toThrow(/at least 2/);
    expect(() => requiredApprovers(2.5)).toThrow();
    expect(requiredApprovers()).toBe(2);
  });
  it('lets a third organizer add themselves to a complete approval without changing status', () => {
    let a = createApproval('a', content());
    for (const ap of [dana, marcus]) {
      const r = addApprover(a, ap);
      if (r.ok) a = r.approval;
    }
    const r = addApprover(a, { ...dana, organizerId: 'org_third' });
    expect(r.ok && r.approval.status).toBe('complete');
  });
  it('gates execution on completeness, distinct approvers and an untampered hash', () => {
    let a = createApproval('a', content());
    expect(canExecute(a, content())).toBe(false);
    for (const ap of [dana, marcus]) {
      const r = addApprover(a, ap);
      if (r.ok) a = r.approval;
    }
    expect(canExecute(a, content())).toBe(true);
    expect(canExecute(a, content({ policyVersionId: 'other' }))).toBe(false);
    // forged record: "complete" with the same organizer twice
    expect(canExecute({ ...a, approvers: [dana, dana] }, content())).toBe(false);
    const executed = markExecuted(a);
    expect(executed.status).toBe('executed');
    expect(canExecute(executed, content())).toBe(false);
    expect(addApprover(executed, { ...dana, organizerId: 'x' })).toMatchObject({ ok: false, reason: 'ALREADY_EXECUTED' });
    expect(() => markExecuted(executed)).toThrow();
    expect(() => markExecuted(createApproval('b', content()))).toThrow(/pending/);
    expect(() => voidApproval(executed)).toThrow();
    expect(voidApproval(a).status).toBe('void');
  });
});

describe('PayPal idempotency ids', () => {
  const a = createApproval('a', content());
  it('sender_batch_id = nl_ + first 24 hex of the approval hash', () => {
    expect(senderBatchIdFor(a)).toBe(`nl_${a.hash.slice(0, 24)}`);
    expect(senderBatchIdFor(a)).toHaveLength(27);
    expect(senderBatchIdFor(createApproval('different-id', content()))).toBe(senderBatchIdFor(a));
  });
  it('rejects malformed hashes', () => {
    expect(() => senderBatchIdFor({ hash: 'abc' })).toThrow();
  });
  it('sender_item_id is deterministic, unique per request and ≤ 63 chars', () => {
    const x = senderItemIdFor(a, 'req_lan');
    expect(x).toBe(senderItemIdFor(a, 'req_lan'));
    expect(x).not.toBe(senderItemIdFor(a, 'req_maria'));
    expect(x).toMatch(/^nli_[0-9a-f]{24}$/);
    expect(x.length).toBeLessThanOrEqual(63);
  });
});
