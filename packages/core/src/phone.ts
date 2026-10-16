/**
 * Phone numbers as payout destinations, normalized to E.164 ("+15035550147").
 *
 * People say their number the way they dial it at home: "503 555 0147", "(503) 555-0147",
 * "1 503 555 0147", "+1 503…", "00 33 6 12 34 56 78". A number without a country code is read in
 * the group's default region (US unless configured). Pure: no I/O, no metadata tables beyond the
 * calling codes and national lengths below.
 */

export interface PhoneRegion {
  /** Country calling code without "+". */
  callingCode: string;
  /** Allowed lengths of the national significant number (without trunk prefix). */
  nationalLengths: readonly number[];
  /** Trunk prefix dialed before national numbers at home ("0" in France), stripped. */
  trunkPrefix?: string;
  /** Shape of a valid national number, when the plan has one (NANP area codes never start with 0 or 1). */
  nationalPattern?: RegExp;
}

/** The regions our groups' neighbors most often dial from. Add a row to support another. */
export const PHONE_REGIONS: Readonly<Record<string, PhoneRegion>> = {
  US: { callingCode: '1', nationalLengths: [10], nationalPattern: /^[2-9]\d{9}$/ },
  CA: { callingCode: '1', nationalLengths: [10], nationalPattern: /^[2-9]\d{9}$/ },
  MX: { callingCode: '52', nationalLengths: [10] },
  GB: { callingCode: '44', nationalLengths: [9, 10], trunkPrefix: '0' },
  FR: { callingCode: '33', nationalLengths: [9], trunkPrefix: '0' },
  PH: { callingCode: '63', nationalLengths: [10], trunkPrefix: '0' },
  VN: { callingCode: '84', nationalLengths: [9, 10], trunkPrefix: '0' },
  HT: { callingCode: '509', nationalLengths: [8] },
  KR: { callingCode: '82', nationalLengths: [9, 10], trunkPrefix: '0' },
};

export const DEFAULT_PHONE_REGION = 'US';

/**
 * "+1 (503) 555-0147" | "503 555 0147" | "15035550147" | "0033 6 12 34 56 78" → E.164, or null when
 * it cannot be a phone number in that region (too short, too long, wrong national length).
 */
export function toE164(raw: string, region: string = DEFAULT_PHONE_REGION): string | null {
  const trimmed = raw.normalize('NFKC').trim();
  if (/[\p{L}]/u.test(trimmed)) return null;
  let digits = trimmed.replace(/\D/g, '');
  const international = trimmed.startsWith('+') || digits.startsWith('00');
  if (international) {
    if (!trimmed.startsWith('+')) digits = digits.slice(2);
    return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  }
  const r = PHONE_REGIONS[region.toUpperCase()] ?? PHONE_REGIONS[DEFAULT_PHONE_REGION];
  if (!r) return null;
  const national = (n: string): boolean => r.nationalLengths.includes(n.length) && (!r.nationalPattern || r.nationalPattern.test(n));
  // Dialed with the country code but no "+" ("1 503 555 0147").
  if (digits.startsWith(r.callingCode) && national(digits.slice(r.callingCode.length))) return `+${digits}`;
  if (r.trunkPrefix && digits.startsWith(r.trunkPrefix) && national(digits.slice(r.trunkPrefix.length))) {
    return `+${r.callingCode}${digits.slice(r.trunkPrefix.length)}`;
  }
  if (national(digits)) return `+${r.callingCode}${digits}`;
  return null;
}

/**
 * Phone-shaped digit runs in free text, as written: digits in groups separated by spaces, dots,
 * dashes or parentheses ("503 555 0147", "(206) 555-0118", "+1-857-555-0148"), 8 to 15 digits in
 * all. Amounts ("$1,200") and years never reach 8 digits, so they are not phones.
 */
export function phoneRuns(text: string): Array<{ raw: string; index: number }> {
  const out: Array<{ raw: string; index: number }> = [];
  // Only a Latin letter or digit right before breaks a run: "手机号是206 555 0118" is a phone.
  // Groups joined by ONE separator, so "We are 4. 503 555 0147" yields "503 555 0147", not "4. 503…".
  const re = /(?<![\p{Script=Latin}\p{N}@$€£.,_-])(\+?\(?\d+\)?(?:[ .-]?\(?\d+\)?)+)(?![\p{N}])/gu;
  for (const m of text.normalize('NFKC').matchAll(re)) {
    const raw = m[1] ?? '';
    const n = raw.replace(/\D/g, '').length;
    // A phone ends in a group of 2+ digits ("06 12 34 56 78"); "1.500.000"-style amounts fail the length check or E.164.
    if (n >= 8 && n <= 15 && /\d{2,}$/.test(raw)) out.push({ raw, index: m.index ?? 0 });
  }
  return out;
}

/** "4 503 555 0147" (household size spoken right before the number) → also try without leading groups. */
function candidates(raw: string): string[] {
  const groups = raw.split(/(?<=\d\)?)[ .-](?=\(?\d)/);
  return groups.map((_, i) => groups.slice(i).join(' ')).filter((c) => c.replace(/\D/g, '').length >= 8);
}

/** Every phone number in the text, normalized to E.164 in `region` (deduplicated, in order). */
export function phonesInText(text: string, region: string = DEFAULT_PHONE_REGION): string[] {
  const out: string[] = [];
  for (const { raw } of phoneRuns(text)) {
    const e164 = candidates(raw).map((c) => toE164(c, region)).find((x) => x !== null);
    if (e164 && !out.includes(e164)) out.push(e164);
  }
  return out;
}
