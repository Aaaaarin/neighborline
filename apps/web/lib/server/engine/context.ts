/** What every engine operation gets: one DB generation (captured at the start of the call) + shared services. */
import { Lang, type Policy } from '@neighborline/core';
import { getActivePolicy, type Db } from '@neighborline/db';
import type { Agents } from '@neighborline/agents';
import type { ScenarioId } from '../../types';
import type { ApprovalService } from '../approval-service';
import { HttpError } from '../errors';
import type { FakePayPalControl, PublicPayPal } from '../paypal';
import type { DbGeneration } from './db-state';
import type { EngineConfig, Env } from './env';
import type { EventBus } from './events';
import type { MetaStore } from './meta';

export interface Ctx {
  gen: DbGeneration;
  db: Db;
  cfg: EngineConfig;
  env: Env;
  agents: Agents;
  paypal: PublicPayPal;
  /** Present only in PAYPAL_MODE=fake. */
  fake: FakePayPalControl | null;
  approvals: ApprovalService;
  bus: EventBus;
  meta: MetaStore;
  /** Run `fn` after `ms` (scaled by speed and NEIGHBORLINE_BEAT_SCALE) unless the demo was reset. */
  later(ms: number, fn: () => Promise<unknown> | unknown, speed?: number): void;
}

/**
 * Context for intake, views and notifications: everything except the approval service. The intake
 * path is handed this narrowed object, so it has no reference to anything that can pay.
 */
export type BaseCtx = Omit<Ctx, 'approvals'>;

export async function activePolicy(ctx: BaseCtx): Promise<Policy> {
  const p = await getActivePolicy(ctx.db, ctx.gen.group.id);
  if (!p) throw new HttpError(503, 'The group has no active policy');
  return p;
}

export const categoriesFor = (p: Policy) => p.categories.map((c) => ({ key: c.key, label: c.label.en ?? c.key }));

export function categoryLabelFor(p: Policy | null, key: string | undefined | null, lang = 'en'): string {
  const c = p?.categories.find((x) => x.key === key);
  if (!c) return 'Other';
  return c.label[lang] ?? c.label.en ?? c.key;
}

export const asLang = (l: string | undefined | null, fallback: Lang = 'en'): Lang => {
  const r = Lang.safeParse((l ?? '').toLowerCase().split(/[-_]/)[0]);
  return r.success ? r.data : fallback;
};

/**
 * Demo rehearsals (/demo "Play scenario") get ids `req_demo_…`. They never count against a real
 * household's 30-day caps, velocity or the daily budget — otherwise the third visitor to play
 * "Mrs. Lan" would be (correctly!) blocked by her household cap.
 */
export const DEMO_PREFIX = 'req_demo_';
export const isDemoId = (id: string): boolean => id.startsWith(DEMO_PREFIX);

/** Web scenario → agents fixture scenario. */
export const FIXTURE_FOR: Record<ScenarioId, string> = { lan: 'lan_vi', rosa: 'rosa_es', jean: 'jean_ht', walter: 'walter_en', blocked: 'inject_en' };

/** Fixture used for a real microphone recording in AI_MODE=fixture, by the language the neighbor picked. */
export function fixtureForLang(lang: Lang | undefined): string {
  switch (lang) {
    case 'es':
      return 'rosa_es';
    case 'ht':
      return 'jean_ht';
    case 'en':
      return 'walter_en';
    default:
      return 'lan_vi';
  }
}
