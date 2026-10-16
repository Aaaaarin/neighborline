/** A real recording through the engine: only the transcript is kept, and the AI trace has no PII. */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getRequest, listAudit } from '@neighborline/db';
import { startHarness, type Harness } from './harness';

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(async () => {
  await h?.close();
});
const db = async () => (await (h.engine as unknown as { state: Promise<{ ctx: { db: never } }> }).state).ctx.db;

describe('privacy by default', () => {
  it('deletes the raw recording after transcription (AUDIO_RETENTION=none) and audits it', async () => {
    const { requestId } = await h.engine.startIntake({ groupSlug: 'eastside', channel: 'web_voice', lang: 'vi' });
    const bytes = new Uint8Array(2048).fill(7);
    const res = await h.engine.submitAudio(requestId, { audio: new Blob([bytes], { type: 'audio/webm' }), lang: 'vi' });
    expect(res.transcript.text.length).toBeGreaterThan(0);
    const r = (await getRequest(await db(), requestId))!;
    expect(r.audioRef).toBeUndefined();
    expect(r.originalText.length).toBeGreaterThan(0);
    const row = (await listAudit(await db())).find((e) => e.entityId === requestId && e.action.startsWith('audio.'))!;
    expect(row).toMatchObject({ action: 'audio.deleted', data: { bytes: 2048, retention: 'none' } });
  });

  it('AI trace summaries shown on organizer cards carry no emails, phones or handles', async () => {
    const queue = await h.engine.listRequests();
    for (const v of queue) if (v.aiTrace) expect(v.aiTrace.summary).not.toMatch(/@[a-z]|\d{3}[-.\s]\d{4}/i);
  });
});
