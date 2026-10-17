/** The payout the demo is about, in MCP tool-argument form, plus the conversions both sides need. */
import type { CreateBatchInput } from '@neighborline/paypal';
import { toPayPalValue } from '@neighborline/paypal';

export interface McpPayoutItem {
  sender_item_id: string;
  amount_cents: number;
  currency?: string;
  receiver: string;
  recipient_type: 'EMAIL' | 'PHONE' | 'USER_HANDLE' | 'PAYPAL_ID';
  wallet?: 'PAYPAL' | 'VENMO';
  note?: string;
  purpose?: string;
}

export interface McpBatchArgs {
  sender_batch_id: string;
  email_subject?: string;
  items: McpPayoutItem[];
}

export const USER_REQUEST = 'Pay Mrs. Lan $150 on Venmo (@lan-nguyen54) for her heating bill.';

export function lanBatch(senderBatchId: string): McpBatchArgs {
  return {
    sender_batch_id: senderBatchId,
    email_subject: 'Your neighbors sent you help',
    items: [
      {
        sender_item_id: 'req_lan_heat',
        amount_cents: 15000,
        currency: 'USD',
        receiver: '@lan-nguyen54',
        recipient_type: 'USER_HANDLE',
        wallet: 'VENMO',
        note: 'Đã gửi $150 từ hàng xóm',
        purpose: 'NON_GOODS_OR_SERVICES',
      },
    ],
  };
}

/** Same mapping the MCP server applies before computing the digest. */
export function toBatchInput(a: McpBatchArgs): Pick<CreateBatchInput, 'senderBatchId' | 'items'> {
  return {
    senderBatchId: a.sender_batch_id,
    items: a.items.map((i) => ({
      senderItemId: i.sender_item_id,
      amountCents: i.amount_cents,
      currency: i.currency ?? 'USD',
      receiver: i.receiver,
      recipientType: i.recipient_type,
      wallet: i.wallet ?? 'PAYPAL',
      ...(i.note !== undefined ? { note: i.note } : {}),
    })),
  };
}

/** 150000 → "$1,500.00". String/integer formatting only: no floats for money. */
export function usd(cents: number): string {
  const [dollars, fraction] = toPayPalValue(cents).split('.') as [string, string];
  return `$${dollars.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${fraction}`;
}

/** "$150.00 → @lan-nguyen54 (Venmo)" for one item, "3 items, $420.00" for more. */
export function describeBatch(a: Pick<McpBatchArgs, 'items'>): string {
  if (a.items.length === 1) {
    const i = a.items[0]!;
    return `${usd(i.amount_cents)} → ${i.receiver} (${i.wallet === 'VENMO' ? 'Venmo' : 'PayPal'})`;
  }
  return `${a.items.length} items, ${usd(a.items.reduce((s, i) => s + i.amount_cents, 0))}`;
}
