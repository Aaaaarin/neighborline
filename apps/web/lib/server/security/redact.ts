/**
 * Redacted views for anonymous readers (QA P1-4). What a visitor who is not an organizer, and does
 * not own the request, may see: first name and neighborhood, category, the computed amount and its
 * rule citation, approval progress, masked payout destination, payout status. Never the transcript,
 * the neighbor's own words in an appeal, a phone number, an address or a full handle.
 */
import { redactPII, type HelpRequest, type RailFlag, type StageEvent } from '@neighborline/core';
import type { RequestView, StreamMessage } from '../../types';
import { maskReceiver } from '../engine/ledger';
import { accessTo, type Access, type Viewer } from './viewer';

// "1100 Oak St", "22 N. Alberta Street apt 3B", "PO Box 12"
const ADDRESS = /\b\d{1,6}\s+(?:[NSEW]\.?\s+)?(?:[\p{L}0-9'.-]+\s+){0,3}(?:st|street|ave|avenue|rd|road|blvd|boulevard|dr|drive|ln|lane|way|ct|court|pl|place|hwy|highway|ter|terrace|pkwy|parkway|cir|circle|calle|avenida|duong|đường)\b\.?(?:\s*(?:apt|apartment|unit|#|suite|ste)\.?\s*[\w-]+)?/giu;
const PO_BOX = /\bp\.?\s?o\.?\s+box\s+\d+\b/giu;

/** Contacts (emails, phones, handles) and street addresses masked. */
export function redactText(text: string): string {
  return redactPII(text).replace(ADDRESS, '[address]').replace(PO_BOX, '[address]');
}

export const firstName = (name: string): string => name.trim().split(/\s+/)[0] ?? 'Neighbor';
const initial = (name: string | undefined) => (name ? `${[...name.trim()][0] ?? ''}.` : undefined);

function redactRequest(r: HelpRequest, categoryLabel: string): HelpRequest {
  const { audioRef: _a, contact: _c, ...rest } = r;
  const items = (r.extracted?.requestedItems ?? []).map(redactText);
  const generic = [categoryLabel, items.join(', ')].filter(Boolean).join(' · ');
  return {
    ...rest,
    originalText: '',
    englishText: '',
    photoRefs: [],
    ...(r.payoutDestination
      ? {
          payoutDestination: {
            wallet: r.payoutDestination.wallet,
            type: r.payoutDestination.type,
            value: maskReceiver(r.payoutDestination.value),
            ...(r.payoutDestination.nameOnFile ? { nameOnFile: initial(r.payoutDestination.nameOnFile) } : {}),
          },
        }
      : {}),
    ...(r.extracted
      ? {
          extracted: {
            ...r.extracted,
            summaryEn: generic,
            summaryNative: generic,
            requestedItems: items,
            ...(r.extracted.payout ? { payout: { ...r.extracted.payout, value: maskReceiver(r.extracted.payout.value) } } : {}),
          },
        }
      : {}),
    railFlags: r.railFlags.map((f: RailFlag) => ({ ...f, detail: redactText(f.detail) })),
  } as HelpRequest;
}

export function redactRequestView(v: RequestView): RequestView {
  // The redacted summary is a generic English line, so the offline-translation hint no longer applies.
  const { decline, appeal, summaryUntranslated: _u, sandboxStandIn, ...rest } = v;
  return {
    ...rest,
    request: redactRequest(v.request, v.categoryLabel),
    requester: { displayName: firstName(v.requester.displayName), ...(v.requester.area ? { area: v.requester.area } : {}) },
    ...(v.aiTrace ? { aiTrace: { ...v.aiTrace, summary: redactText(v.aiTrace.summary) } } : {}),
    payout: v.payout ? { batch: v.payout.batch, item: { ...v.payout.item, receiver: maskReceiver(v.payout.item.receiver) } } : null,
    ...(decline ? { decline: { organizerId: decline.organizerId, reasonCode: decline.reasonCode, at: decline.at } } : {}),
    ...(appeal
      ? {
          appeal: {
            ...appeal,
            text: '',
            ...(appeal.textEn !== undefined ? { textEn: '' } : {}),
            firstDecline: (({ note: _n, ...fd }) => fd)(appeal.firstDecline),
          },
        }
      : {}),
    ...(sandboxStandIn
      ? {
          sandboxStandIn: {
            // The Venmo label names the handle ("…standing in for @handle"): mask it there too.
            note: sandboxStandIn.scripted ? sandboxStandIn.note.split(sandboxStandIn.scripted.value.replace(/^@/, '')).join(maskReceiver(sandboxStandIn.scripted.value).replace(/^@/, '')) : sandboxStandIn.note,
            ...(sandboxStandIn.scripted ? { scripted: { wallet: sandboxStandIn.scripted.wallet, value: maskReceiver(sandboxStandIn.scripted.value) } } : {}),
          },
        }
      : {}),
    redacted: true,
  };
}

/** Apply the viewer's access to a list: own/organizer full, others redacted, hidden dropped. */
export function viewsFor(viewer: Viewer, views: RequestView[]): RequestView[] {
  const out: RequestView[] = [];
  for (const v of views) {
    const a = accessTo(viewer, v.request.id);
    if (a === 'full') out.push(v);
    else if (a === 'redacted') out.push(redactRequestView(v));
  }
  return out;
}

export function viewFor(viewer: Viewer, v: RequestView | null): RequestView | null {
  if (!v) return null;
  const a = accessTo(viewer, v.request.id);
  return a === 'full' ? v : a === 'redacted' ? redactRequestView(v) : null;
}

function redactEvent(e: StageEvent): StageEvent {
  switch (e.type) {
    case 'request.transcribed':
    case 'request.readback':
    case 'notify.sent':
      return { ...e, text: '' };
    case 'request.flagged':
      return { ...e, flags: e.flags.map((f) => ({ ...f, detail: redactText(f.detail) })) };
    default:
      return e;
  }
}

/** The best access the viewer has to any request a stream message touches (no requests: public). */
export function messageAccess(viewer: Viewer, m: StreamMessage): Access {
  if (m.kind !== 'stage' || m.requestIds.length === 0) return 'full';
  let best: Access = 'hidden';
  for (const id of m.requestIds) {
    const a = accessTo(viewer, id);
    if (a === 'full') return 'full';
    if (a === 'redacted') best = 'redacted';
  }
  return best;
}

/** The stream message this viewer may receive (null = drop it). */
export function streamMessageFor(viewer: Viewer, m: StreamMessage): StreamMessage | null {
  const a = messageAccess(viewer, m);
  if (a === 'hidden') return null;
  if (a === 'full' || m.kind !== 'stage') return m;
  return { ...m, event: redactEvent(m.event) };
}
