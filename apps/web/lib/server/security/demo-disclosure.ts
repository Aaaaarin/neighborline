/**
 * The exact sentences /trust shows in its "In this demo" box (and README/DEVPOST quote), derived
 * from the running configuration so they can't drift from the code. NOTES-trust.md mirrors them.
 */
import { demoModeOn } from '@neighborline/passkeys';

export interface DemoDisclosure {
  on: boolean;
  /** One paragraph for the "In this demo" row. */
  text: string;
  /** The same, as a list of exactly what is relaxed (empty when demo mode is off). */
  relaxed: string[];
  /** What stays exactly as it would for real organizers. */
  unchanged: string[];
}

export function demoDisclosure(env: Record<string, string | undefined>, paypalMode: 'fake' | 'sandbox' | 'live'): DemoDisclosure {
  if (!demoModeOn(env)) {
    return {
      on: false,
      text: 'Demo mode is off on this server. There are no demo keys: every approval is signed with an organizer’s own passkey, and the approval service refuses anything else.',
      relaxed: [],
      unchanged: [],
    };
  }
  const money = paypalMode === 'fake' ? 'This demo runs on a local fake PayPal, so no real money moves.' : 'This demo runs on the PayPal sandbox, so no real money moves.';
  const relaxed = [
    'Dana’s approval is scripted and signed with a demo key this server holds: in /demo, and on a request you send yourself from /call once you approve it as Marcus. No person unlocks it, and every card it signs says “demo key”.',
    'You play Marcus. You can sign as him with his demo key, or with a passkey on your own device that this server ties to your browser. Either one signs only the runs you started yourself, never the shared queue or a sign-in. Marcus’s demo key can also be the second signature on a rules draft a real organizer has already signed with a passkey, so one visitor alone can never change the rules.',
    'Your demo runs don’t count against a household’s monthly limit or the daily budget, and other visitors can’t see them.',
  ];
  const unchanged = [
    'The second approval still has to come from a different organizer.',
    'The approval service re-checks both signatures and recomputes every amount before it pays.',
    'Joining as a real organizer still needs an invite code.',
  ];
  return {
    on: true,
    relaxed,
    unchanged,
    text: `${money} Dana, Marcus and Priya are fictional. This is everything the demo relaxes: ${relaxed.join(' ')} Everything else works as it would for real organizers. ${unchanged.join(' ')}`,
  };
}
