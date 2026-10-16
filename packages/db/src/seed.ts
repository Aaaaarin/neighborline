/**
 * Demo seed: Eastside Mutual Aid, two organizers, policy v1, ~3 weeks of realistic history
 * (13 paid requests across 6 languages, one unclaimed→claimed, one declined) and ~$4,800
 * from 60 donors — enough for the transparency report to have real (k-anonymous) rows.
 * Every request goes through the real flow: compute → rail check → approve ×2 → batch → webhook.
 */
import {
  checkRail,
  computeAmount,
  demoPolicy,
  sha256Hex,
  type DonationSource,
  type Group,
  type Lang,
  type Organizer,
  type PayoutDestination,
  type Policy,
} from '@neighborline/core';
import type { Db } from './client.js';
import { activatePolicy, createGroup, createOrganizer, getGroupBySlug, listOrganizers, getActivePolicy, getRailHandles } from './repo/groups.js';
import { createRequest, getHistoryForDestination, updateRequest } from './repo/requests.js';
import { addApproverTx, createOrGetApproval } from './repo/approvals.js';
import { createBatch, getTodaySpentCents, upsertItemFromEvent } from './repo/payouts.js';
import { recordDonation } from './repo/misc.js';

export const DEMO_GROUP = {
  id: 'grp_eastside',
  slug: 'eastside',
  name: 'Eastside Mutual Aid',
  paypalEmail: 'organizers@eastside-mutualaid.org',
  venmoHandle: '@eastside-mutualaid',
} as const;

export const DEMO_ORGANIZERS = [
  { id: 'org_dana', name: 'Dana', handles: ['dana@eastside-mutualaid.org', '@dana-eastside'], lang: 'en' as Lang },
  { id: 'org_marcus', name: 'Marcus', handles: ['marcus@eastside-mutualaid.org', '@marcus-eastside', '+1 555 010 9000'], lang: 'en' as Lang },
];

interface SeedRequest {
  daysAgo: number;
  lang: Lang;
  category: string;
  requestedCents?: number;
  dest: PayoutDestination;
  original: string;
  english: string;
  outcome: 'paid' | 'unclaimed_then_paid' | 'declined';
  minutesToApprove: number;
}

const v = (value: string, nameOnFile: string): PayoutDestination => ({ wallet: 'VENMO', type: 'USER_HANDLE', value, nameOnFile });
const p = (value: string, nameOnFile: string): PayoutDestination => ({ wallet: 'PAYPAL', type: 'EMAIL', value, nameOnFile });

export const SEED_REQUESTS: SeedRequest[] = [
  { daysAgo: 20, lang: 'vi', category: 'utility_outage', dest: v('@hoa-tran', 'Tran Thi Hoa'), original: 'Nhà tôi mất điện từ hôm qua, tôi cần mua máy sưởi nhỏ.', english: 'Power has been out since yesterday; I need a small heater.', outcome: 'paid', minutesToApprove: 4 },
  { daysAgo: 19, lang: 'es', category: 'groceries', dest: p('rosa.martinez@example.com', 'Rosa Martinez'), original: 'Necesito comida para mis tres hijos esta semana.', english: 'I need food for my three kids this week.', outcome: 'paid', minutesToApprove: 6 },
  { daysAgo: 18, lang: 'ht', category: 'medicine_copay', requestedCents: 85_00, dest: p('jean.desir@example.com', 'Jean Desir'), original: 'Mwen bezwen peye kopeman pou medikaman tansyon mwen.', english: 'I need to pay the co-pay for my blood pressure medicine.', outcome: 'paid', minutesToApprove: 3 },
  { daysAgo: 17, lang: 'vi', category: 'groceries', requestedCents: 80_00, dest: v('@minh-le', 'Le Van Minh'), original: 'Tôi cần tiền mua thực phẩm cho gia đình.', english: 'I need money for groceries for my family.', outcome: 'paid', minutesToApprove: 9 },
  { daysAgo: 15, lang: 'es', category: 'transport', requestedCents: 45_00, dest: v('@carlos-ruiz', 'Carlos Ruiz'), original: 'Necesito el pase de autobús para ir a mis citas médicas.', english: 'I need a bus pass to get to my medical appointments.', outcome: 'paid', minutesToApprove: 5 },
  { daysAgo: 14, lang: 'zh', category: 'medicine_copay', dest: p('wei.chen@example.com', 'Chen Wei'), original: '我需要支付药品的自付费用。', english: 'I need to pay my medicine co-pay.', outcome: 'paid', minutesToApprove: 7 },
  { daysAgo: 12, lang: 'ar', category: 'groceries', dest: v('@amina-haddad', 'Amina Haddad'), original: 'أحتاج إلى شراء طعام لعائلتي هذا الأسبوع.', english: 'I need to buy food for my family this week.', outcome: 'paid', minutesToApprove: 4 },
  { daysAgo: 11, lang: 'ht', category: 'utility_outage', dest: v('@marie-pierre', 'Marie Pierre'), original: 'Kouran an koupe depi de jou, mwen bezwen yon ti chofaj.', english: 'The power has been out for two days; I need a small heater.', outcome: 'paid', minutesToApprove: 2 },
  { daysAgo: 9, lang: 'es', category: 'rent_gap', dest: p('luz.gomez@example.com', 'Luz Gomez'), original: 'Me faltan 250 dólares para la renta de este mes.', english: 'I am $250 short on this month’s rent.', outcome: 'unclaimed_then_paid', minutesToApprove: 8 },
  { daysAgo: 7, lang: 'vi', category: 'medicine_copay', requestedCents: 60_00, dest: p('thu.pham@example.com', 'Pham Thi Thu'), original: 'Tôi cần trả tiền thuốc cho mẹ tôi.', english: 'I need to pay for my mother’s medicine.', outcome: 'paid', minutesToApprove: 5 },
  { daysAgo: 5, lang: 'ht', category: 'groceries', requestedCents: 90_00, dest: v('@rose-stlouis', 'Rose St. Louis'), original: 'Mwen bezwen manje pou pitit mwen yo.', english: 'I need food for my children.', outcome: 'paid', minutesToApprove: 6 },
  { daysAgo: 4, lang: 'en', category: 'transport', dest: v('@jamal-wright', 'Jamal Wright'), original: 'My car broke down and I need gas money to get to work for the week.', english: 'My car broke down and I need gas money to get to work for the week.', outcome: 'paid', minutesToApprove: 3 },
  { daysAgo: 3, lang: 'es', category: 'utility_outage', dest: v('@ana-flores', 'Ana Flores'), original: 'Se fue la luz por la tormenta y necesito un calentador.', english: 'The storm knocked out the power and I need a heater.', outcome: 'paid', minutesToApprove: 4 },
  { daysAgo: 2, lang: 'en', category: 'other', dest: v('@sam-porter', 'Sam Porter'), original: 'Asking for help with a phone bill. Another group already covered it, so you can close this.', english: 'Asking for help with a phone bill. Another group already covered it, so you can close this.', outcome: 'declined', minutesToApprove: 0 },
];

/** Fake-but-plausible 17-char PayPal transaction id, deterministic per seed key. */
export const seedTransactionId = (key: string): string => sha256Hex(key).slice(0, 17).toUpperCase();

const DONATION_PLAN: Array<[count: number, usd: number]> = [[20, 25], [20, 50], [10, 100], [6, 150], [3, 300], [1, 500]];
const SOURCES: DonationSource[] = ['PAYPAL', 'VENMO', 'PAYPAL', 'CARD', 'PAYLATER', 'VENMO', 'SUBSCRIPTION', 'PAYPAL'];

export interface SeedResult {
  group: Group;
  organizers: Organizer[];
  policy: Policy;
  alreadySeeded: boolean;
}

export async function seedDemo(db: Db, opts: { now?: Date } = {}): Promise<SeedResult> {
  const now = opts.now ?? new Date();
  const existing = await getGroupBySlug(db, DEMO_GROUP.slug);
  if (existing) {
    const policy = await getActivePolicy(db, existing.id);
    return { group: existing, organizers: await listOrganizers(db, existing.id), policy: policy as Policy, alreadySeeded: true };
  }
  const minutes = (base: Date, m: number) => new Date(base.getTime() + m * 60_000);
  const start = new Date(now.getTime() - 28 * 86_400_000);

  await createGroup(db, {
    id: DEMO_GROUP.id,
    slug: DEMO_GROUP.slug,
    name: DEMO_GROUP.name,
    officialHandles: [
      { wallet: 'PAYPAL', type: 'EMAIL', value: DEMO_GROUP.paypalEmail },
      { wallet: 'VENMO', type: 'USER_HANDLE', value: DEMO_GROUP.venmoHandle },
    ],
    fiscalSponsor: { name: 'Eastside Community Foundation', paypalBusinessVerified: true, payoutsEnabled: true, charityConfirmed: true },
  });
  for (const o of DEMO_ORGANIZERS) await createOrganizer(db, { ...o, groupId: DEMO_GROUP.id });
  const policy = await activatePolicy(db, demoPolicy({ groupId: DEMO_GROUP.id, createdAt: start.toISOString() }), { actor: 'org_dana' });
  const handles = await getRailHandles(db, DEMO_GROUP.id);

  // Donations: 60 donors, $4,800, spread over the last 28 days.
  let n = 0;
  for (const [count, usd] of DONATION_PLAN) {
    for (let i = 0; i < count; i++, n++) {
      const at = new Date(start.getTime() + ((n * 37) % 60) * (27 * 86_400_000) / 60 + n * 61_000);
      const source = SOURCES[n % SOURCES.length] as DonationSource;
      await recordDonation(db, {
        id: `don_seed_${String(n + 1).padStart(2, '0')}`,
        groupId: DEMO_GROUP.id,
        amountCents: usd * 100,
        source,
        donorKey: `donor_${String(n + 1).padStart(2, '0')}`,
        paypalOrderId: `SEEDORDER${String(n + 1).padStart(3, '0')}`,
        ...(source === 'SUBSCRIPTION' ? { paypalSubscriptionId: `I-SEED${n + 1}` } : {}),
        transactionId: seedTransactionId(`don:${n}`),
        createdAt: at.toISOString(),
      });
    }
  }

  // Requests through the real pipeline.
  for (const [i, s] of SEED_REQUESTS.entries()) {
    const createdAt = new Date(now.getTime() - s.daysAgo * 86_400_000 - (i % 5) * 3_600_000);
    const id = `req_seed_${String(i + 1).padStart(2, '0')}`;
    await createRequest(db, {
      id,
      groupId: DEMO_GROUP.id,
      channel: i % 3 === 0 ? 'web_voice' : i % 3 === 1 ? 'whatsapp' : 'web_text',
      lang: s.lang,
      originalText: s.original,
      englishText: s.english,
      payoutDestination: s.dest,
      createdAt: createdAt.toISOString(),
    });
    const history = await getHistoryForDestination(db, s.dest, 30, { now: createdAt });
    const amount = computeAmount({
      policy,
      extraction: { category: s.category, ...(s.requestedCents ? { requestedAmountCents: s.requestedCents } : {}) },
      history,
      todaySpentCents: await getTodaySpentCents(db, DEMO_GROUP.id, { now: createdAt }),
      destination: s.dest,
      now: createdAt,
      requestId: id,
    });
    if (!amount.ok) throw new Error(`seed request ${id} unexpectedly blocked: ${amount.flags.map((f) => f.code).join(',')}`);
    const railFlags = checkRail({ destination: s.dest, ...handles, history, policy, text: [s.original, s.english], now: createdAt, requestId: id });
    await updateRequest(
      db,
      id,
      { status: 'awaiting_approval', confirmedByRequester: true, computed: amount.computed, policyVersionId: policy.id, railFlags },
      { at: minutes(createdAt, 1) },
    );
    if (s.outcome === 'declined') {
      await updateRequest(db, id, { status: 'declined' }, { actor: 'org_marcus', at: minutes(createdAt, 30) });
      continue;
    }
    const { approval } = await createOrGetApproval(db, { requestIds: [id], actor: 'org_dana' });
    const t1 = minutes(createdAt, Math.max(1, s.minutesToApprove - 1));
    const t2 = minutes(createdAt, s.minutesToApprove);
    await addApproverTx(db, { approvalId: approval.id, organizerId: 'org_dana', deviceLabel: 'Dana’s phone', at: t1 });
    await addApproverTx(db, { approvalId: approval.id, organizerId: 'org_marcus', deviceLabel: 'Marcus’s phone', at: t2 });
    const { items } = await createBatch(db, { approvalId: approval.id, now: new Date(t2.getTime() + 10_000) });
    const item = items[0];
    if (!item) throw new Error('seed batch has no items');
    const paypalItemId = `SEEDITEM${String(i + 1).padStart(4, '0')}`;
    const txn = seedTransactionId(`item:${id}`);
    if (s.outcome === 'unclaimed_then_paid') {
      await upsertItemFromEvent(db, { senderItemId: item.senderItemId, paypalItemId, status: 'UNCLAIMED', at: new Date(t2.getTime() + 95_000) });
      await upsertItemFromEvent(db, { paypalItemId, status: 'SUCCESS', transactionId: txn, at: minutes(t2, 140) });
    } else {
      await upsertItemFromEvent(db, {
        senderItemId: item.senderItemId,
        paypalItemId,
        status: 'SUCCESS',
        transactionId: txn,
        at: new Date(t2.getTime() + 70_000 + (i % 4) * 9_000),
      });
    }
  }

  const group = (await getGroupBySlug(db, DEMO_GROUP.slug)) as Group;
  return { group, organizers: await listOrganizers(db, group.id), policy, alreadySeeded: false };
}
