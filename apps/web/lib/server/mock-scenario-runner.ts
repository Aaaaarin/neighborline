/**
 * Scripted stage scenarios. Each step calls the same engine methods real traffic would
 * (confirmIntake, approve), so the demo exercises the real code path — only the timing is scripted.
 */
import type { PlayMode, ScenarioId, ScenarioRun } from '../types';
import { HttpError } from './errors';
import { SCENARIOS } from './fixtures/scenarios';
import type { MockEngine } from './mock-engine';

const now = () => new Date().toISOString();

export async function runScenario(e: MockEngine, input: { scenario: ScenarioId; mode: PlayMode; speed?: number }): Promise<ScenarioRun> {
  const s = SCENARIOS[input.scenario];
  if (!s) throw new HttpError(400, 'Unknown scenario');
  const speed = Math.min(20, Math.max(0.25, input.speed ?? 1));
  const rec = e.newRec({ channel: s.channel, lang: s.lang, displayName: s.requester.displayName, area: s.requester.area, speed });
  rec.scenario = s.id;
  const id = rec.request.id;
  const manualOrganizerId = input.mode === 'manual' ? 'org_marcus' : null;
  e.emit({ type: 'request.created', at: now(), requestId: id, lang: s.lang, channel: s.channel }, [id]);

  if (s.outcome === 'blocked') {
    e.applyScript(rec, s);
    e.msg(rec, { from: 'neighbor', kind: 'text', lang: s.lang, text: s.transcript, textEn: s.transcriptEn, meta: { channel: 'sms' } });
    e.later(rec, 1800, () => {
      rec.request.status = 'awaiting_approval';
      e.emit({ type: 'request.flagged', at: now(), requestId: id, flags: rec.request.railFlags }, [id]);
    });
    e.later(rec, 3800, () => {
      e.msg(rec, { from: 'line', kind: 'blocked', lang: s.lang, text: s.readback, textEn: s.readbackEn });
      e.emit({ type: 'notify.sent', at: now(), requestId: id, lang: s.lang, text: s.readback, channel: 'sms' }, [id]);
    });
    return { requestId: id, scenario: s.id, mode: input.mode, speed, manualOrganizerId };
  }

  // Voice note arrives: bubble first, transcript fills in when STT finishes.
  const voice = e.msg(rec, { from: 'neighbor', kind: 'voice', lang: s.lang, text: '', meta: { audioSeconds: s.audioSeconds } });
  rec.audioSeconds = s.audioSeconds;
  e.later(rec, 2600, () => {
    e.applyScript(rec, s);
    voice.text = s.transcript;
    voice.textEn = s.transcriptEn;
    e.emit({ type: 'request.transcribed', at: now(), requestId: id, text: s.transcript, lang: s.lang }, [id]);
  });
  e.later(rec, 4800, () => {
    e.msg(rec, { from: 'line', kind: 'readback', lang: s.lang, text: s.readback, textEn: s.readbackEn });
    e.emit({ type: 'request.readback', at: now(), requestId: id, text: s.readback, lang: s.lang }, [id]);
  });
  e.later(rec, 9500, () => void e.confirmIntake(id, { confirmed: true }));
  e.later(rec, 16_500, () => void e.approve({ requestIds: [id], organizerId: 'org_dana', signer: { kind: 'demo_key' } }).catch(() => {}));
  if (input.mode === 'auto') {
    e.later(rec, 23_500, () => void e.approve({ requestIds: [id], organizerId: 'org_marcus', signer: { kind: 'demo_key' } }).catch(() => {}));
  }
  return { requestId: id, scenario: s.id, mode: input.mode, speed, manualOrganizerId };
}
