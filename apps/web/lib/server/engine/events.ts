/**
 * In-process event bus for the SSE stream (/api/stream). Keeps a bounded log so a browser that
 * subscribes after `playScenario` started can replay one request's history (INTEGRATION.md).
 */
import type { StageEvent } from '@neighborline/core';
import type { StreamMessage } from '../../types';

export class EventBus {
  private log: Array<Extract<StreamMessage, { kind: 'stage' }>> = [];
  private listeners = new Set<(m: StreamMessage) => void>();

  constructor(private readonly max = 5000) {}

  emit(event: StageEvent, requestIds: string[]): void {
    const msg = { kind: 'stage' as const, event, requestIds };
    this.log.push(msg);
    if (this.log.length > this.max) this.log.splice(0, this.log.length - this.max);
    for (const l of this.listeners) {
      try {
        l(msg);
      } catch {
        /* a broken SSE client must not break the engine */
      }
    }
  }

  /** A message that is not about any request (e.g. {kind: 'reset'}); not kept in the replay log. */
  broadcast(msg: StreamMessage): void {
    for (const l of this.listeners) {
      try {
        l(msg);
      } catch {
        /* ignore */
      }
    }
  }

  subscribe(listener: (m: StreamMessage) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  replay(requestId: string): StreamMessage[] {
    return this.log.filter((m) => m.requestIds.includes(requestId));
  }

  /** Events for one request (tests, scenario runner). */
  eventsFor(requestId: string): StageEvent[] {
    return this.log.filter((m) => m.requestIds.includes(requestId)).map((m) => m.event);
  }

  /** Events of the most recent request that reached SUCCESS (for the measured speed on /). */
  latestPaid(): StageEvent[] | null {
    for (let i = this.log.length - 1; i >= 0; i--) {
      const m = this.log[i]!;
      if (m.event.type === 'payout.item_updated' && m.event.status === 'SUCCESS' && m.requestIds[0]) return this.eventsFor(m.requestIds[0]);
    }
    return null;
  }

  clear(): void {
    this.log = [];
  }
}

export const nowIso = (): string => new Date().toISOString();
