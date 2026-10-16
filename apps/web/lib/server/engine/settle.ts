/**
 * Apply a payout item status (from a verified webhook, a poll, or a cancel) through the core item
 * state machine (db.upsertItemFromEvent → core.applyItemEvent: idempotent, never regresses), then
 * tell the neighbor in their language (agents.notify, vetted templates, code-filled amounts).
 */
import { render, walletName, type Channel, type PayoutItemStatus } from '@neighborline/core';
import { notifyKeyFor } from '@neighborline/agents';
import { formatUsd } from '@neighborline/core';
import { getRequest, recordNotification, upsertItemFromEvent, type ItemEventOutcome } from '@neighborline/db';
import type { BaseCtx } from './context';
import { nowIso } from './events';

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
  const n = await ctx.agents.notify.render({ key, lang: req.lang, amountCents: item.amountCents, wallet: item.wallet, ...(name ? { name } : {}) });
  const channel: Channel = req.channel === 'sms' ? 'sms' : 'whatsapp';
  const textEn = render(key, 'en', { amount: formatUsd(item.amountCents), wallet: walletName(item.wallet), ...(name ? { name } : {}) });
  ctx.meta.message(req.id, {
    from: 'line',
    kind: key === 'paid' ? 'paid' : 'claim_help',
    lang: req.lang,
    text: n.text,
    textEn,
    meta: { amountCents: item.amountCents, wallet: item.wallet, receiver: item.receiver, channel, ...(item.transactionId ? { transactionId: item.transactionId } : {}) },
  });
  await recordNotification(ctx.db, { requestId: req.id, channel, lang: req.lang, messageKey: key, text: n.text, status: 'sent' });
  ctx.bus.emit({ type: 'notify.sent', at: nowIso(), requestId: req.id, lang: req.lang, text: n.text, channel }, [req.id]);
  return out;
}
