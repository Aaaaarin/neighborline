import { describe, expect, it } from 'vitest';
import { DEMO_POLICY_SOURCE_TEXT, stampPolicyVersion } from '@neighborline/core';
import { rulesEditedSince } from './rules-text';

describe('rulesEditedSince (the "You’ve edited the rules since this draft" warning)', () => {
  const draft = stampPolicyVersion(DEMO_POLICY_SOURCE_TEXT, 2);
  it('is false right after drafting, although the server stamped the title (v1) → (v2)', () => {
    expect(draft).not.toBe(DEMO_POLICY_SOURCE_TEXT);
    expect(rulesEditedSince(DEMO_POLICY_SOURCE_TEXT, draft)).toBe(false);
    expect(rulesEditedSince(draft, draft)).toBe(false);
  });
  it('ignores CRLF line ends and surrounding whitespace', () => {
    expect(rulesEditedSince(`  ${DEMO_POLICY_SOURCE_TEXT.replace(/\n/g, '\r\n')}\n\n`, draft)).toBe(false);
  });
  it('is true for any change in wording', () => {
    expect(rulesEditedSince(DEMO_POLICY_SOURCE_TEXT.replace('$150', '$175'), draft)).toBe(true);
    expect(rulesEditedSince(`${DEMO_POLICY_SOURCE_TEXT}\n- Diapers: up to $40.`, draft)).toBe(true);
  });
});
