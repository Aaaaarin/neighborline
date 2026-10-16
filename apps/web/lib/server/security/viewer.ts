/**
 * Who is reading, and how much of a request they may see (QA P1-4).
 *
 *   organizer   a live passkey session of a real organizer (not a demo-visitor passkey): everything
 *   owner       the visitor whose tag is in the request id (their /demo run or /call request): full
 *   anyone else redacted view (first name + area, masked handles, no transcript, no phone/address);
 *               in DEMO_MODE another visitor's runs are hidden altogether (judges never see each other)
 */
import { demoModeOn } from '@neighborline/passkeys';
import type { OrganizerSession } from '../../types';
import { decodeSession, readSessionFromRequest, SESSION_COOKIE } from '../passkeys/session';
import { services } from '../services';
import { decodeVisitor, ownerTagOf, VISITOR_COOKIE, visitorFromRequest, type Visitor } from './visitor';

export interface Viewer {
  organizer: OrganizerSession | null;
  visitor: Visitor | null;
  demo: boolean;
}

export type Access = 'full' | 'redacted' | 'hidden';

export async function viewerOf(req: Request, env: Record<string, string | undefined> = process.env): Promise<Viewer> {
  const raw = readSessionFromRequest(req);
  const organizer = raw ? await services().liveSession(raw).catch(() => null) : null;
  return { organizer, visitor: visitorFromRequest(req), demo: demoModeOn(env) };
}

/** Same, for server components: pass `await cookies()` from next/headers. */
export async function viewerFromCookies(jar: { get(name: string): { value: string } | undefined }, env: Record<string, string | undefined> = process.env): Promise<Viewer> {
  const raw = decodeSession(jar.get(SESSION_COOKIE)?.value);
  const organizer = raw ? await services().liveSession(raw).catch(() => null) : null;
  return { organizer, visitor: decodeVisitor(jar.get(VISITOR_COOKIE)?.value), demo: demoModeOn(env) };
}

export function accessTo(viewer: Viewer, requestId: string): Access {
  if (viewer.organizer) return 'full';
  const owner = ownerTagOf(requestId);
  if (owner && viewer.visitor?.tag === owner) return 'full';
  if (owner && viewer.demo) return 'hidden';
  return 'redacted';
}

/** Does this visitor own every one of these requests? */
export function ownsAll(viewer: Viewer, requestIds: readonly string[]): boolean {
  const tag = viewer.visitor?.tag;
  return !!tag && requestIds.length > 0 && requestIds.every((id) => ownerTagOf(id) === tag);
}
