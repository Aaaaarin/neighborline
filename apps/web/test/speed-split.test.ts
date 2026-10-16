import { describe, expect, it } from 'vitest';
import type { StageEvent } from '@neighborline/core';
import { splitFrom, type TimedEvent } from '../components/stage/stage-steps';

const T0 = Date.parse('2026-10-16T18:00:00Z');
const ev = (sec: number, e: Partial<StageEvent> & { type: StageEvent['type'] }): TimedEvent => ({ at: T0 + sec * 1000, event: { at: new Date(T0 + sec * 1000).toISOString(), ...e } as StageEvent });

const lan: TimedEvent[] = [
  ev(0, { type: 'request.created', requestId: 'r', lang: 'vi', channel: 'web_voice' } as never),
  ev(2.1, { type: 'request.transcribed' } as never),
  ev(2.3, { type: 'request.readback' } as never),
  ev(9.3, { type: 'request.confirmed' } as never),
  ev(15.4, { type: 'approval.added', count: 1 } as never),
  ev(21.5, { type: 'approval.added', count: 2 } as never),
  ev(21.7, { type: 'payout.batch_created' } as never),
  ev(23.4, { type: 'payout.item_updated', status: 'SUCCESS' } as never),
];

describe('splitFrom (people vs system time)', () => {
  it('a paid run: listening + organizers are people time, the rest is system', () => {
    const s = splitFrom(lan, T0 + 99_000)!;
    expect(s.totalMs).toBe(23_400);
    expect(s.humanMs).toBe(7_000 + 12_200);
    expect(s.machineMs).toBe(23_400 - 19_200);
    expect(s.humanNow).toBe(false);
  });

  it('while the organizers are looking, the open span counts as people time', () => {
    const s = splitFrom(lan.slice(0, 5), T0 + 18_000)!;
    expect(s.humanMs).toBe(7_000 + 8_700);
    expect(s.machineMs).toBe(18_000 - 15_700);
    expect(s.humanNow).toBe(true);
  });

  it('an unclaimed payout waits on the neighbor, not the system', () => {
    const rosa = [...lan.slice(0, 7), ev(23, { type: 'payout.item_updated', status: 'UNCLAIMED' } as never), ev(35, { type: 'payout.item_updated', status: 'SUCCESS' } as never)];
    const s = splitFrom(rosa, T0 + 99_000)!;
    expect(s.humanMs).toBe(7_000 + 12_200 + 12_000);
    expect(s.totalMs).toBe(35_000);
  });

  it('idle → null', () => expect(splitFrom([], T0)).toBeNull());
});
