/** Route-level checks shared by the API handlers (who may read, write or approve what). */
import { HttpError } from '../errors';
import { DEMO_SEAT, demoModeOn } from '../passkeys/demo-signer';
import { services } from '../services';
import { enforceLimit, type LimitClass } from './rate-limit';
import { accessTo, ownsAll, viewerOf, type Viewer } from './viewer';
import { ownerTagOf } from './visitor';

/**
 * The neighbor side of a request (thread, text, audio, confirm) belongs to the visitor who started it,
 * or to an organizer. Everyone else gets 404 (not 403: no oracle for which ids exist).
 * ENGINE=mock ids carry no visitor tag; that in-memory fallback keeps the old open behaviour.
 */
export async function requireRequester(req: Request, requestId: string): Promise<Viewer> {
  const viewer = await viewerOf(req);
  if (process.env.ENGINE === 'mock' && !ownerTagOf(requestId)) return viewer;
  if (accessTo(viewer, requestId) !== 'full') throw new HttpError(404, 'No such request');
  return viewer;
}

/** Rate limits for an intake call; live AI calls also spend from the "ai" buckets. */
export function limitIntake(req: Request, viewer: Viewer | null, opts: { ai?: boolean } = {}): void {
  const tag = viewer?.visitor?.tag ?? null;
  enforceLimit(req, 'intake', { visitorTag: tag });
  if (opts.ai ?? services().modes.aiMode === 'live') enforceLimit(req, 'ai', { visitorTag: tag });
}

export function limit(req: Request, cls: LimitClass, viewer: Viewer | null): void {
  enforceLimit(req, cls, { visitorTag: viewer?.visitor?.tag ?? null });
}

/**
 * A demo key from the public API: only in DEMO_MODE, only as the demo seat (Marcus), and only on the
 * caller's own runs. Dana's and Priya's demo keys are used by the server's scripted scenarios and the
 * seed, never by a browser, so a single visitor can never assemble two approvals (QA P1-6).
 */
export function assertPublicDemoKey(viewer: Viewer, organizerId: string | undefined, requestIds: readonly string[]): void {
  if (!demoModeOn(process.env)) throw new HttpError(403, 'Demo keys are off (DEMO_MODE is off). Sign with your passkey.');
  if (organizerId !== DEMO_SEAT) throw new HttpError(403, 'In this demo you can approve as Marcus only; Dana is played by the demo script.');
  if (!ownsAll(viewer, requestIds)) throw new HttpError(403, 'Demo keys approve only your own demo runs. Play a scenario on /demo, or sign in as an organizer.');
}
