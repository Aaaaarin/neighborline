import { policyTextSansVersion } from '@neighborline/core';

/** The rules text as the server compares it: LF line ends, trimmed, title version marker "(vN)" removed. */
const normalized = (s: string): string => policyTextSansVersion(s.replace(/\r\n?/g, '\n').trim());

/**
 * Has the organizer changed the wording since this draft? The server stamps the draft's title with the
 * version it will become ("… (v1)" → "… (v2)", core stampPolicyVersion), so that marker, line endings and
 * surrounding whitespace never count as an edit; any other change does.
 */
export function rulesEditedSince(text: string, draftSourceText: string): boolean {
  return normalized(text) !== normalized(draftSourceText);
}
