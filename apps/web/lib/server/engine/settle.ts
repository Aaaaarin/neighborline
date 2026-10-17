/**
 * Apply a payout item status (from a verified webhook, a poll, or a cancel) through the core item
 * state machine (db.upsertItemFromEvent → core.applyItemEvent: idempotent, never regresses), then
 * tell the neighbor in their language (agents.notify, vetted templates, code-filled amounts).
 */
import type { Channel, PayoutItemStatus } from '@neighborline/core';
import { notifyKeyFor } from '@neighborline/agents';
import { getRequest, recordNotification, upsertItemFromEvent, type ItemEventOutcome } from '@neighborline/db';
import type { BaseCtx } from './context';
import { nowIso } from './events';
import { errorText, log } from '../log';

export async function applyItemStatus(
  ctx: BaseCtx,
  ev: { senderItemId?: string; paypalItemId?: string; status: PayoutItemStatus; transactionId?: string; actor: string },
): Promise<ItemEventOutcome | null> {
  const out = await upsertItemFromEvent(ctx.db, {
    ...(ev.senderItemId ? { senderItemId: ev.senderItemId } : {}),
    ...(ev.paypalItemId ? { paypalItemId: ev.paypalItemId } : {}),
    status: ev.status,
    ...(ev.transactionId ? { transactionId: ev.transactionId } : {}),
    actor: ev.actor,
  });
  if (!out || !out.changed) return out;
  const item = out.item;
  ctx.bus.emit(
    {
      type: 'payout.item_updated',
      at: nowIso(),
      itemId: item.id,
      requestId: item.requestId,
      status: item.status,
      ...(item.paypalItemId ? { paypalItemId: item.paypalItemId } : {}),
      ...(item.transactionId ? { transactionId: item.transactionId } : {}),
    },
    [item.requestId],
  );
  const key = notifyKeyFor({ itemStatus: item.status });
  const req = key ? await getRequest(ctx.db, item.requestId) : null;
  if (!key || !req) return out;
  const meta = ctx.meta.ensure(req.id);
  const name = meta.displayName && meta.displayName !== 'Neighbor' ? meta.displayName : undefined;
  const n = await ctx.agents.notify.render({ key, lang: req.lang, amountCents: item.amountCents, wallet: item.wallet, addressForm: req.extracted?.addressForm, ...(name ? { name } : {}) });
  const channel: Channel = req.channel === 'sms' ? 'sms' : req.channel === 'phone' ? 'phone' : 'whatsapp';
  const textEn = n.textEn;
  ctx.meta.message(req.id, {
    from: 'line',
    kind: key === 'paid' ? 'paid' : 'claim_help',
    lang: req.lang,
    text: n.text,
    textEn,
    meta: { amountCents: item.amountCents, wallet: item.wallet, receiver: item.receiver, channel, ...(item.transactionId ? { transactionId: item.transactionId } : {}) },
  });
  const rec = await recordNotification(ctx.db, { requestId: req.id, channel, lang: req.lang, messageKey: key, text: n.text, status: 'sent' });
  // A neighbor who called in hears it too: a call-back in their language (lib/server/voice/outbound.ts).
  if (ctx.outbound && req.contact?.phone) {
    const tz = (ctx.gen.group as { timezone?: string }).timezone;
    ctx.outbound
      .notify({ id: rec.id, requestId: req.id, key, lang: req.lang, text: n.text, textEn, phone: req.contact.phone, ...(tz ? { timezone: tz } : {}), ...(req.extracted?.addressForm ? { addressForm: req.extracted.addressForm } : {}) })
      .catch((err) => log.warn('notify.outbound_failed', { requestId: req.id, error: errorText(err) }));
  }
  ctx.bus.emit({ type: 'notify.sent', at: nowIso(), requestId: req.id, lang: req.lang, text: n.text, channel }, [req.id]);
  return out;
}
