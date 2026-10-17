/**
 * Per-request presentation state that is not part of the domain record: the neighbor's message
 * thread, first name + neighborhood, the AI trace summary and the "why this amount" breakdown.
 * Lives in memory per DB generation; if the process restarts, views degrade gracefully (the thread
 * is rebuilt from the stored request text + recorded notifications).
 */
import { randomBytes } from 'node:crypto';
import type { Lang } from '@neighborline/core';
import type { ScenarioId, RequestView, ThreadMessage } from '../../types';
import type { LocalizedNote } from '../fixtures/templates';
import type { StandIn } from './sandbox-standin';
import { nowIso } from './events';

export interface RequestMeta {
  displayName: string;
  area?: string;
  audioSeconds?: number;
  aiTrace?: NonNullable<RequestView['aiTrace']>;
  breakdown?: RequestView['amountBreakdown'];
  decline?: RequestView['decline'];
  /** The decline note as the neighbor got it (translated, or the original with a line saying so). */
  declineNoteLocal?: LocalizedNote;
  /** The neighbor asked for another look after a decline (one appeal per request). */
  appeal?: { at: string; text: string; textEn?: string; firstDecline: NonNullable<RequestView['decline']>; closed?: boolean };
  /** The clarifying question last asked, in the neighbor's language (the agent may have translated it). */
  question?: { key: string; text: string; lang: Lang };
  /** Set for /demo runs and sample voice notes. */
  scenario?: ScenarioId;
  speed: number;
  nameOnFile?: string;
  /** PAYPAL_MODE=sandbox /demo runs: where the payout really goes instead of the scripted destination (sandbox-standin.ts). */
  standIn?: StandIn;
  thread: ThreadMessage[];
}

export class MetaStore {
  private map = new Map<string, RequestMeta>();

  get(id: string): RequestMeta | undefined {
    return this.map.get(id);
  }

  ensure(id: string, init: Partial<RequestMeta> = {}): RequestMeta {
    let m = this.map.get(id);
    if (!m) {
      m = { displayName: 'Neighbor', speed: 1, thread: [], ...init };
      this.map.set(id, m);
    }
    return m;
  }

  message(id: string, msg: Omit<ThreadMessage, 'id' | 'at'>): ThreadMessage {
    const full: ThreadMessage = { id: `m_${randomBytes(5).toString('hex')}`, at: nowIso(), ...msg };
    this.ensure(id).thread.push(full);
    return full;
  }

  /** Bound memory on a long-running public demo. */
  prune(max = 2000): void {
    if (this.map.size <= max) return;
    const drop = this.map.size - max;
    let i = 0;
    for (const k of this.map.keys()) {
      if (i++ >= drop) break;
      this.map.delete(k);
    }
  }
}
