/**
 * Two requests already waiting in the organizer queue (so /organizer is never empty on a fresh demo),
 * filed through the same pipeline as live traffic: computeAmount + checkRail → awaiting_approval.
 * Ana's PayPal email was paid once before under another name, so the rail raises a *review* flag.
 * Idempotent: does nothing when the rows already exist.
 */
import {
  checkRail,
  computeAmount,
  type Group,
  type IntakeExtraction,
  type Lang,
  type Organizer,
  type PayoutDestination,
  type Policy,
} from '@neighborline/core';
import {
  addApproverTx,
  appendAudit,
  createBatch,
  createOrGetApproval,
  createOrganizer,
  createRequest,
  getHistoryForDestination,
  getRailHandles,
  getRequest,
  getTodaySpentCents,
  listOrganizers,
  seedTransactionId,
  updateRequest,
  upsertItemFromEvent,
  type Db,
  type Executor,
} from '@neighborline/db';
import { demoModeOn, demoSign } from '../passkeys/demo-signer';

export const PRIYA = { id: 'org_priya', name: 'Priya', handles: ['priya@eastside-mutualaid.org', '@priya-eastside'], lang: 'en' as Lang };

interface QueueSeed {
  id: string;
  lang: Lang;
  channel: 'whatsapp' | 'sms';
  displayName: string;
  area: string;
  original: string;
  english: string;
  extraction: IntakeExtraction;
  dest: PayoutDestination;
  minutesAgo: number;
}

/** First name + neighborhood for the seeded queue (organizers never see full names). */
export const QUEUE_PEOPLE: Record<string, { displayName: string; area: string }> = {};

const QUEUE: QueueSeed[] = [
  {
    id: 'req_seed_q_minh',
    lang: 'vi',
    channel: 'whatsapp',
    displayName: 'Minh',
    area: 'Montavilla',
    original: 'Tủ lạnh hư vì mất điện, đồ ăn hỏng hết. Nhà 3 người. Xin giúp $80 mua đồ ăn. Venmo @minh-tran-88.',
    english: 'Fridge died in the outage and all the food spoiled. 3 people at home. Asking for $80 for groceries. Venmo @minh-tran-88.',
    extraction: {
      lang: 'vi',
      summaryEn: 'Food spoiled after the outage. Household of 3. Asks $80 for groceries.',
      summaryNative: 'Đồ ăn hỏng vì mất điện. Nhà 3 người. Xin $80 mua đồ ăn.',
      category: 'groceries',
      householdSize: 3,
      urgency: 'today',
      requestedItems: ['groceries'],
      requestedAmountCents: 8_000,
      payout: { wallet: 'VENMO', type: 'USER_HANDLE', value: '@minh-tran-88' },
      missing: [],
      confidence: 0.9,
    },
    dest: { wallet: 'VENMO', type: 'USER_HANDLE', value: '@minh-tran-88', nameOnFile: 'Tran Van Minh' },
    minutesAgo: 14,
  },
  {
    id: 'req_seed_q_ana',
    lang: 'es',
    channel: 'sms',
    displayName: 'Ana',
    area: 'Brentwood-Darlington',
    original: 'Se fue la luz y la calefacción es eléctrica. Tengo un bebé. Necesito para un calentador. PayPal ana.r.lopez@example.com',
    english: 'The power went out and the heat is electric. I have a baby. I need money for a heater. PayPal ana.r.lopez@example.com',
    extraction: {
      lang: 'es',
      summaryEn: 'Power out, electric heat, has a baby. Needs a space heater.',
      summaryNative: 'Sin luz, calefacción eléctrica, tiene un bebé. Necesita un calentador.',
      category: 'utility_outage',
      householdSize: 2,
      urgency: 'today',
      requestedItems: ['space heater'],
      payout: { wallet: 'PAYPAL', type: 'EMAIL', value: 'ana.r.lopez@example.com' },
      missing: [],
      confidence: 0.9,
    },
    dest: { wallet: 'PAYPAL', type: 'EMAIL', value: 'ana.r.lopez@example.com', nameOnFile: 'Ana R. Lopez' },
    minutesAgo: 6,
  },
];
for (const q of QUEUE) QUEUE_PEOPLE[q.id] = { displayName: q.displayName, area: q.area };

async function file(db: Executor, policy: Policy, q: { id: string; createdAt: Date; lang: Lang; channel: QueueSeed['channel']; original: string; english: string; extraction?: IntakeExtraction; category: string; requestedCents?: number; dest: PayoutDestination }) {
  await createRequest(db, {
    id: q.id,
    groupId: policy.groupId,
    channel: q.channel,
    lang: q.lang,
    originalText: q.original,
    englishText: q.english,
    ...(q.extraction ? { extracted: q.extraction } : {}),
    payoutDestination: q.dest,
    createdAt: q.createdAt.toISOString(),
  });
  const history = await getHistoryForDestination(db, q.dest, 30, { now: q.createdAt });
  const amount = computeAmount({
    policy,
    extraction: { category: q.category, ...(q.requestedCents ? { requestedAmountCents: q.requestedCents } : {}) },
    history,
    todaySpentCents: await getTodaySpentCents(db, policy.groupId, { now: q.createdAt }),
    destination: q.dest,
    now: q.createdAt,
    requestId: q.id,
  });
  if (!amount.ok) throw new Error(`demo queue request ${q.id} blocked: ${amount.flags.map((f) => f.code).join(',')}`);
  const railFlags = checkRail({ destination: q.dest, ...(await getRailHandles(db, policy.groupId)), history, policy, text: [q.original, q.english], now: q.createdAt, requestId: q.id });
  await updateRequest(db, q.id, { status: 'awaiting_approval', confirmedByRequester: true, computed: amount.computed, policyVersionId: policy.id, railFlags }, { at: new Date(q.createdAt.getTime() + 60_000) });
}

/** Seeded approvals are signed with the organizers' labelled demo keys (DEMO_MODE), like /demo taps. */
async function signSeeded(db: Executor, groupId: string, organizerId: string, approvalHash: string, at?: Date) {
  if (demoModeOn(process.env)) await demoSign(db, process.env, { groupId, organizerId, approvalHash, ...(at ? { at } : {}) });
}

/**
 * One transaction: a crash or a concurrent boot never leaves half a queue (e.g. Ana's earlier payout
 * without Minh), and a second process that loses the race sees the rows and does nothing.
 */
export async function seedDemoQueue(db: Db, s: { group: Group; policy: Policy; organizers: Organizer[] }): Promise<void> {
  if (await getRequest(db, QUEUE[0]!.id)) return;
  await db.transaction(async (tx) => {
    if (await getRequest(tx, QUEUE[0]!.id)) return;
    await seedQueueRows(tx, s);
  });
}

async function seedQueueRows(db: Executor, s: { group: Group; policy: Policy; organizers: Organizer[] }): Promise<void> {
  if (!s.organizers.some((o) => o.id === PRIYA.id) && !(await listOrganizers(db, s.group.id)).some((o) => o.id === PRIYA.id)) await createOrganizer(db, { ...PRIYA, groupId: s.group.id });
  const now = Date.now();

  // Ana's email was paid 9 days ago under a different name → DUP_DESTINATION_DIFF_NAME (review, not block).
  const prevAt = new Date(now - 9 * 86_400_000);
  const prevId = 'req_seed_q_ana_prev';
  await file(db, s.policy, {
    id: prevId,
    createdAt: prevAt,
    lang: 'es',
    channel: 'sms',
    original: 'Necesito ayuda con la comida esta semana. PayPal ana.r.lopez@example.com',
    english: 'I need help with food this week. PayPal ana.r.lopez@example.com',
    category: 'groceries',
    requestedCents: 6_000,
    dest: { wallet: 'PAYPAL', type: 'EMAIL', value: 'ana.r.lopez@example.com', nameOnFile: 'Beatriz Ortega' },
  });
  const { approval } = await createOrGetApproval(db, { requestIds: [prevId], actor: 'org_dana' });
  const danaAt = new Date(prevAt.getTime() + 3 * 60_000);
  const marcusAt = new Date(prevAt.getTime() + 5 * 60_000);
  await signSeeded(db, s.group.id, 'org_dana', approval.hash, danaAt);
  await addApproverTx(db, { approvalId: approval.id, organizerId: 'org_dana', deviceLabel: 'Dana’s phone (demo key)', at: danaAt });
  await signSeeded(db, s.group.id, 'org_marcus', approval.hash, marcusAt);
  await addApproverTx(db, { approvalId: approval.id, organizerId: 'org_marcus', deviceLabel: 'Marcus’s phone (demo key)', at: marcusAt });
  const { items } = await createBatch(db, { approvalId: approval.id, now: new Date(prevAt.getTime() + 5 * 60_000 + 5_000) });
  await upsertItemFromEvent(db, {
    senderItemId: items[0]!.senderItemId,
    paypalItemId: 'SEEDITEM9001',
    status: 'SUCCESS',
    transactionId: seedTransactionId(`item:${prevId}`),
    at: new Date(prevAt.getTime() + 6 * 60_000 + 20_000),
  });

  await seedUnclaimed(db, s);

  for (const q of QUEUE) {
    await file(db, s.policy, {
      id: q.id,
      createdAt: new Date(now - q.minutesAgo * 60_000),
      lang: q.lang,
      channel: q.channel,
      original: q.original,
      english: q.english,
      extraction: q.extraction,
      category: q.extraction.category,
      ...(q.extraction.requestedAmountCents ? { requestedCents: q.extraction.requestedAmountCents } : {}),
      dest: q.dest,
    });
  }
  // Priya already said yes to Minh; one more organizer completes it.
  const minh = await createOrGetApproval(db, { requestIds: ['req_seed_q_minh'], actor: PRIYA.id });
  await signSeeded(db, s.group.id, PRIYA.id, minh.approval.hash);
  await addApproverTx(db, { approvalId: minh.approval.id, organizerId: PRIYA.id, deviceLabel: 'Priya’s phone (demo key)' });
}

/** The one payout in the seeded month that is genuinely still unclaimed (JUDGE-PANEL-2 #3b). */
export const SEED_UNCLAIMED = { id: 'req_seed_27', paypalItemId: 'SEEDITEM9002', daysAgo: 25, hoursAgo: 3 } as const;

/**
 * Graciela asked 25 days ago; her PayPal payout went out but she never claimed it. The line followed up
 * in Spanish on the scheduled days (1, 3, 7, 14, 21: workflows/src/policy.ts), so the unclaimed sweep
 * sees five nudges, and on day 25 the scheduled check raises the organizer alert for exactly this item
 * (PayPal returns it on day 30). The ledger row, the Unclaimed total and the alert all describe it.
 */
async function seedUnclaimed(db: Executor, s: { group: Group; policy: Policy }) {
  const createdAt = new Date(Date.now() - (SEED_UNCLAIMED.daysAgo * 24 + SEED_UNCLAIMED.hoursAgo) * 3_600_000);
  const id = SEED_UNCLAIMED.id;
  await file(db, s.policy, {
    id,
    createdAt,
    lang: 'es',
    channel: 'sms',
    original: 'Con la tormenta perdí el trabajo esta semana y no tengo para la comida. Somos cuatro. Mi PayPal es graciela.mora@example.com',
    english: 'I lost work this week because of the storm and can’t afford food. There are four of us. My PayPal is graciela.mora@example.com',
    category: 'groceries',
    requestedCents: 9_000,
    dest: { wallet: 'PAYPAL', type: 'EMAIL', value: 'graciela.mora@example.com', nameOnFile: 'Graciela Mora' },
  });
  const { approval } = await createOrGetApproval(db, { requestIds: [id], actor: 'org_dana' });
  const danaAt = new Date(createdAt.getTime() + 4 * 60_000);
  const marcusAt = new Date(createdAt.getTime() + 7 * 60_000);
  await signSeeded(db, s.group.id, 'org_dana', approval.hash, danaAt);
  await addApproverTx(db, { approvalId: approval.id, organizerId: 'org_dana', deviceLabel: 'Dana’s phone (demo key)', at: danaAt });
  await signSeeded(db, s.group.id, 'org_marcus', approval.hash, marcusAt);
  await addApproverTx(db, { approvalId: approval.id, organizerId: 'org_marcus', deviceLabel: 'Marcus’s phone (demo key)', at: marcusAt });
  const sentAt = new Date(marcusAt.getTime() + 5_000);
  const { items } = await createBatch(db, { approvalId: approval.id, now: sentAt });
  const item = items[0]!;
  const unclaimedAt = new Date(sentAt.getTime() + 95_000);
  await upsertItemFromEvent(db, { senderItemId: item.senderItemId, paypalItemId: SEED_UNCLAIMED.paypalItemId, status: 'UNCLAIMED', at: unclaimedAt });
  for (const [n, days] of [1, 3, 7, 14, 21].entries()) {
    await appendAudit(db, {
      actor: 'workflow',
      action: 'unclaimed.renotify',
      entityType: 'payout_item',
      entityId: item.id,
      data: { nudgeNumber: n + 1, lang: 'es', channel: 'sms', idempotencyKey: `renotify:${item.id}:${n + 1}`, seeded: true },
      at: new Date(unclaimedAt.getTime() + days * 86_400_000),
    });
  }
}
