/**
 * Demo seed: Eastside Mutual Aid, two organizers, policy v1, ~4 weeks of realistic history
 * (25 paid requests from 25 households in 6 languages, one unclaimed→claimed, one declined) and ~$4,800
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
import { sql } from 'drizzle-orm';
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
  // A second wave, so that with k = 5 the report still has real rows (vi, es, ht ≥ 5 households;
  // utility outage, groceries and medicine ≥ 5).
  { daysAgo: 26, lang: 'vi', category: 'utility_outage', dest: p('lien.nguyen@example.com', 'Nguyen Thi Lien'), original: 'Cây đổ làm đứt dây điện nhà tôi. Tôi cần đèn pin và máy sưởi.', english: 'A tree took down my power line. I need a flashlight and a heater.', outcome: 'paid', minutesToApprove: 7 },
  { daysAgo: 25, lang: 'es', category: 'medicine_copay', requestedCents: 40_00, dest: v('@maria-sosa', 'Maria Sosa'), original: 'Necesito pagar el copago de la insulina de mi esposo.', english: 'I need to pay the co-pay for my husband’s insulin.', outcome: 'paid', minutesToApprove: 5 },
  { daysAgo: 24, lang: 'ht', category: 'groceries', requestedCents: 70_00, dest: p('louis.charles@example.com', 'Louis Charles'), original: 'Frijidè a pa mache depi kouran an koupe, tout manje yo gate.', english: 'The fridge stopped when the power went out and all the food spoiled.', outcome: 'paid', minutesToApprove: 6 },
  { daysAgo: 23, lang: 'zh', category: 'groceries', requestedCents: 60_00, dest: v('@li-na-zhou', 'Zhou Li Na'), original: '停电后冰箱里的食物都坏了，需要买菜。', english: 'After the outage the food in the fridge spoiled; I need groceries.', outcome: 'paid', minutesToApprove: 8 },
  { daysAgo: 22, lang: 'ar', category: 'utility_outage', dest: p('omar.khalil@example.com', 'Omar Khalil'), original: 'انقطعت الكهرباء عن شقتي منذ يومين وأحتاج إلى مدفأة صغيرة.', english: 'My apartment has had no power for two days and I need a small heater.', outcome: 'paid', minutesToApprove: 4 },
  { daysAgo: 21, lang: 'en', category: 'groceries', requestedCents: 75_00, dest: v('@dee-morgan', 'Dee Morgan'), original: 'Lost a week of shifts to the storm. Need groceries for me and my dad.', english: 'Lost a week of shifts to the storm. Need groceries for me and my dad.', outcome: 'paid', minutesToApprove: 6 },
  { daysAgo: 16, lang: 'vi', category: 'groceries', requestedCents: 65_00, dest: v('@bao-vo', 'Vo Quoc Bao'), original: 'Tôi mất việc mấy ngày vì bão, cần tiền mua gạo và rau.', english: 'I lost a few days of work to the storm and need money for rice and vegetables.', outcome: 'paid', minutesToApprove: 4 },
  { daysAgo: 13, lang: 'es', category: 'groceries', requestedCents: 85_00, dest: p('elena.cruz@example.com', 'Elena Cruz'), original: 'Somos cinco en casa y se nos acabó la comida.', english: 'There are five of us at home and we ran out of food.', outcome: 'paid', minutesToApprove: 7 },
  { daysAgo: 10, lang: 'ht', category: 'medicine_copay', requestedCents: 50_00, dest: v('@nadege-joseph', 'Nadege Joseph'), original: 'Mwen bezwen peye pou medikaman sik mwen.', english: 'I need to pay for my diabetes medicine.', outcome: 'paid', minutesToApprove: 5 },
  { daysAgo: 8, lang: 'zh', category: 'utility_outage', dest: p('jun.huang@example.com', 'Huang Jun'), original: '家里停电三天了，老人怕冷，需要买取暖器。', english: 'No power at home for three days; my elderly parent is cold and we need a heater.', outcome: 'paid', minutesToApprove: 9 },
  { daysAgo: 6, lang: 'ar', category: 'medicine_copay', requestedCents: 55_00, dest: v('@yusuf-saleh', 'Yusuf Saleh'), original: 'أحتاج إلى دفع ثمن دواء الربو لابني.', english: 'I need to pay for my son’s asthma medicine.', outcome: 'paid', minutesToApprove: 3 },
  { daysAgo: 1, lang: 'en', category: 'utility_outage', dest: v('@pat-oneil', 'Pat O’Neil'), original: 'Power is still out on our block. Need a space heater for my kids’ room.', english: 'Power is still out on our block. Need a space heater for my kids’ room.', outcome: 'paid', minutesToApprove: 5 },
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

/**
 * Seed the demo group in ONE transaction: a process that dies half-way (a build worker, a killed
 * boot) leaves nothing behind instead of a group without an active policy. Concurrent seeders are
 * serialized by a transaction-scoped advisory lock, so the second one sees the first one's rows.
 */
export async function seedDemo(db: Db, opts: { now?: Date } = {}): Promise<SeedResult> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(4242001)`);
    return seedDemoTx(tx as unknown as Db, opts);
  });
}

async function seedDemoTx(db: Db, opts: { now?: Date }): Promise<SeedResult> {
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
