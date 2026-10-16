import type { Lang } from '@neighborline/core';
import type { GroupView, Organizer } from '../../types';

export const ORGANIZERS: Organizer[] = [
  { id: 'org_dana', name: 'Dana', handle: '@dana-okafor', deviceLabel: "Dana's phone" },
  { id: 'org_marcus', name: 'Marcus', handle: '@marcus-lee-pdx', deviceLabel: "Marcus's phone" },
  { id: 'org_priya', name: 'Priya', handle: '@priya-s', deviceLabel: "Priya's phone" },
];

export const GROUP_HANDLE = '@eastside-mutualaid';

export interface MockCategory {
  key: string;
  label: Record<'en' | 'es' | 'vi' | 'ht', string>;
  maxCents: number;
  perHouseholdPer30dCents: number;
}

export const POLICY = {
  id: 'pol_eastside_v1',
  version: 1,
  sourceText:
    'Utility outages: up to $150 a request, $300 a month per household. Groceries: up to $100, $200 a month. ' +
    'Medicine and copays: up to $120, $240 a month. Rides: up to $50, $100 a month. ' +
    'No household gets more than $400 in 30 days. We spend at most $2,000 a day. Every payout needs two organizers.',
  householdCapPer30dCents: 40_000,
  dailyBudgetCents: 200_000,
  maxRequestsPerDestinationPer30d: 3,
  approvalsRequired: 2,
  categories: [
    {
      key: 'utility_outage',
      label: { en: 'Utility outage', es: 'Corte de luz o servicios', vi: 'Mất điện, nước, ga', ht: 'Kouran oswa sèvis koupe' },
      maxCents: 15_000,
      perHouseholdPer30dCents: 30_000,
    },
    {
      key: 'groceries',
      label: { en: 'Groceries', es: 'Comida', vi: 'Thực phẩm', ht: 'Manje' },
      maxCents: 10_000,
      perHouseholdPer30dCents: 20_000,
    },
    {
      key: 'medicine_copay',
      label: { en: 'Medicine & copays', es: 'Medicinas y copagos', vi: 'Thuốc men', ht: 'Medikaman ak copay' },
      maxCents: 12_000,
      perHouseholdPer30dCents: 24_000,
    },
    {
      key: 'transport',
      label: { en: 'Rides & transport', es: 'Transporte', vi: 'Đi lại', ht: 'Transpò' },
      maxCents: 5_000,
      perHouseholdPer30dCents: 10_000,
    },
  ] satisfies MockCategory[],
};

export function category(key: string): MockCategory | undefined {
  return POLICY.categories.find((c) => c.key === key);
}

export function categoryLabel(key: string, lang: Lang = 'en'): string {
  const c = category(key);
  if (!c) return 'Other';
  const l = (lang in c.label ? lang : 'en') as keyof MockCategory['label'];
  return c.label[l];
}

export function citation(key: string): string {
  const c = category(key);
  if (!c) return `Policy v${POLICY.version} · Not covered by a category`;
  return `Policy v${POLICY.version} · ${c.label.en} · up to $${c.maxCents / 100}`;
}

export function groupView(simulatedPaypal: boolean): GroupView {
  return {
    id: 'grp_eastside',
    slug: 'eastside',
    name: 'Eastside Mutual Aid',
    payoutHandle: GROUP_HANDLE,
    fiscalSponsor: {
      name: 'Eastside Community Foundation', // same as packages/db seed.ts
      checks: [
        {
          key: 'business_account',
          label: 'PayPal Business account in the sponsor’s name',
          ok: true,
          simulated: simulatedPaypal,
          detail: 'Payouts are sent from the fiscal sponsor’s Business account, never a personal one.',
        },
        {
          key: 'charity_confirmed',
          label: '501(c)(3) status confirmed with PayPal',
          ok: true,
          simulated: true,
          detail: 'Confirmed charity status lowers fees and labels donations correctly. Sandbox accounts cannot be confirmed, so this is simulated.',
        },
        {
          key: 'payouts_enabled',
          label: 'Payouts API enabled',
          ok: true,
          simulated: simulatedPaypal,
          detail: 'Payouts must be enabled by PayPal on the live account. In sandbox it is on by default.',
        },
        {
          key: 'purpose_donations',
          label: 'Every payout item tagged purpose = NON_GOODS_OR_SERVICES',
          ok: true,
          simulated: false,
          detail: 'Set on each Payouts item so PayPal and Venmo treat the money as mutual aid, not income for goods.',
        },
        {
          key: 'webhooks_verified',
          label: 'Webhook signatures verified',
          ok: true,
          simulated: simulatedPaypal,
          detail: 'Every payout status change comes from a PayPal webhook whose signature we check before believing it.',
        },
      ],
    },
    organizers: ORGANIZERS,
    policy: {
      id: POLICY.id,
      version: POLICY.version,
      categories: POLICY.categories.map((c) => ({
        key: c.key,
        label: c.label.en,
        maxCents: c.maxCents,
        perHouseholdPer30dCents: c.perHouseholdPer30dCents,
      })),
      householdCapPer30dCents: POLICY.householdCapPer30dCents,
      dailyBudgetCents: POLICY.dailyBudgetCents,
      approvalsRequired: POLICY.approvalsRequired,
    },
  };
}
