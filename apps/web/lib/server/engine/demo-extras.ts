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
  createBatch,
  createOrGetApproval,
  createOrganizer,
  createRequest,
  getHistoryForDestination,
  getRailHandles,
  getRequest,
  getTodaySpentCents,
  seedTransactionId,
  updateRequest,
  upsertItemFromEvent,
  type Db,
} from '@neighborline/db';

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

async function file(db: Db, policy: Policy, q: { id: string; createdAt: Date; lang: Lang; channel: QueueSeed['channel']; original: string; english: string; extraction?: IntakeExtraction; category: string; requestedCents?: number; dest: PayoutDestination }) {
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

export async function seedDemoQueue(db: Db, s: { group: Group; policy: Policy; organizers: Organizer[] }): Promise<void> {
  if (await getRequest(db, QUEUE[0]!.id)) return;
  if (!s.organizers.some((o) => o.id === PRIYA.id)) await createOrganizer(db, { ...PRIYA, groupId: s.group.id });
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
  await addApproverTx(db, { approvalId: approval.id, organizerId: 'org_dana', deviceLabel: 'Dana’s phone', at: new Date(prevAt.getTime() + 3 * 60_000) });
  await addApproverTx(db, { approvalId: approval.id, organizerId: 'org_marcus', deviceLabel: 'Marcus’s phone', at: new Date(prevAt.getTime() + 5 * 60_000) });
  const { items } = await createBatch(db, { approvalId: approval.id, now: new Date(prevAt.getTime() + 5 * 60_000 + 5_000) });
  await upsertItemFromEvent(db, {
    senderItemId: items[0]!.senderItemId,
    paypalItemId: 'SEEDITEM9001',
    status: 'SUCCESS',
    transactionId: seedTransactionId(`item:${prevId}`),
    at: new Date(prevAt.getTime() + 6 * 60_000 + 20_000),
  });

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
  await addApproverTx(db, { approvalId: minh.approval.id, organizerId: PRIYA.id, deviceLabel: 'Priya’s phone' });
}
