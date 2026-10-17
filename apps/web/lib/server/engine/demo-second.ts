/**
 * DEMO_MODE: Dana's scripted second signature on a visitor's own /call request (QA-2 P1-1).
 *
 * A visitor plays Marcus only (security/access.ts). On /demo the script signs as Dana; without the same
 * here, a request a judge sends from /call and approves as Marcus on /organizer would wait at "1 of 2"
 * forever. So when a visitor's demo-key tap as Marcus is the first signature on requests they sent
 * from /call (`req_v_<their tag>_…`), the server signs as Dana with her labelled demo key after a beat,
 * exactly as /demo does. Never on the seeded queue, demo runs (the scenario script handles those),
 * a request that was declined and appealed (a different organizer must look), or with DEMO_MODE off.
 */
import type { SignerKind } from '../../types';
import { DEMO_SEAT } from '../passkeys/demo-signer';

export const SCRIPTED_SECOND = 'org_dana';
/** The time Dana takes to "read the card", like the /demo beat. */
export const SCRIPTED_SECOND_MS = 4_000;

const CALL_ID = /^req_v_[0-9a-f]{12}_[0-9a-f]+$/;

export function wantsScriptedSecond(input: {
  demoMode: boolean;
  requestIds: readonly string[];
  signer: { organizerId: string; kind: SignerKind };
  count: number;
  executed: boolean;
  appealed: boolean;
}): boolean {
  return (
    input.demoMode &&
    !input.executed &&
    input.count === 1 &&
    !input.appealed &&
    input.signer.organizerId === DEMO_SEAT &&
    input.signer.kind === 'demo_key' &&
    input.requestIds.length > 0 &&
    input.requestIds.every((id) => CALL_ID.test(id))
  );
}
