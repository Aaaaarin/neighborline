/**
 * Passkey labels an organizer can tell apart in "Devices that can sign" (QA-2 P3: three passkeys all
 * read "Priya's device"). Pure.
 */
export const DEVICE_LABEL_MAX = 60;

/**
 * `label` if no live passkey of this organizer already has it (ignoring case and spacing), else the
 * first free "<label> 2", "<label> 3", … cut to fit the 60-character limit.
 */
export function uniqueDeviceLabel(label: string, taken: readonly string[], max = DEVICE_LABEL_MAX): string {
  const norm = (s: string) => s.normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase();
  const used = new Set(taken.map(norm));
  const base = label.replace(/\s+/g, ' ').trim().slice(0, max);
  if (!used.has(norm(base))) return base;
  for (let n = 2; ; n++) {
    const suffix = ` ${n}`;
    const candidate = `${base.slice(0, max - suffix.length).trimEnd()}${suffix}`;
    if (!used.has(norm(candidate))) return candidate;
  }
}
