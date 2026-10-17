/** In-memory state of the fake. Wire-format records (snake_case) so handlers can return them nearly as-is. */

export interface Money {
  currency: string;
  value: string;
}
export interface Link {
  href: string;
  rel: string;
  method: string;
  encType?: string;
}

export type TransactionStatus =
  | 'SUCCESS'
  | 'FAILED'
  | 'PENDING'
  | 'UNCLAIMED'
  | 'RETURNED'
  | 'ONHOLD'
  | 'BLOCKED'
  | 'REFUNDED'
  | 'REVERSED';
export type BatchStatus = 'DENIED' | 'PENDING' | 'PROCESSING' | 'SUCCESS' | 'CANCELED';

export interface PayoutItemRequest {
  recipient_type?: string;
  amount: Money;
  note?: string;
  receiver: string;
  sender_item_id?: string;
  recipient_wallet?: string;
  purpose?: string;
  notification_language?: string;
  application_context?: { social_feed_privacy?: string; logo_url?: string; holler_url?: string };
  [k: string]: unknown;
}

export interface PayoutItemRec {
  payout_item_id: string;
  transaction_id?: string;
  activity_id?: string;
  transaction_status: TransactionStatus;
  payout_item_fee: Money;
  payout_batch_id: string;
  sender_batch_id?: string;
  payout_item: PayoutItemRequest;
  time_processed?: string;
  errors?: { name: string; message: string; information_link: string };
  /** Epoch ms when a ledger transaction was created (Transaction Search visibility). */
  txnAtMs?: number;
}

export interface BatchRec {
  payout_batch_id: string;
  batch_status: BatchStatus;
  time_created: string;
  time_completed?: string;
  sender_batch_header: Record<string, unknown> & { sender_batch_id?: string };
  itemIds: string[];
  currency: string;
  amountCents: number;
  /** Request hash of the create call, for PayPal-Request-Id replay. */
  requestId?: string;
}

export interface CaptureRec {
  id: string;
  status: 'COMPLETED' | 'PENDING' | 'DECLINED' | 'REFUNDED';
  amount: { currency_code: string; value: string };
  feeCents: number;
  custom_id?: string;
  invoice_id?: string;
  create_time: string;
  txnAtMs: number;
}

export interface OrderRec {
  id: string;
  intent: string;
  status: 'CREATED' | 'SAVED' | 'APPROVED' | 'VOIDED' | 'COMPLETED' | 'PAYER_ACTION_REQUIRED';
  purchase_units: Array<Record<string, unknown> & { amount: { currency_code: string; value: string } }>;
  create_time: string;
  update_time: string;
  payer?: { email_address: string; payer_id: string; name: { given_name: string; surname: string } };
  fundingSource?: 'paypal' | 'venmo';
  experience?: Record<string, unknown>;
  capture?: CaptureRec;
}

export interface ProductRec {
  id: string;
  name: string;
  description?: string;
  type: string;
  category?: string;
  create_time: string;
  update_time: string;
}

export interface PlanRec {
  id: string;
  product_id: string;
  name: string;
  description?: string;
  status: 'CREATED' | 'ACTIVE' | 'INACTIVE';
  billing_cycles: unknown[];
  payment_preferences?: unknown;
  usage_type: 'LICENSED';
  create_time: string;
  update_time: string;
}

export interface SaleRec {
  id: string;
  amountCents: number;
  currency: string;
  create_time: string;
  txnAtMs: number;
  billing_agreement_id: string;
  custom?: string;
}

export interface SubscriptionRec {
  id: string;
  plan_id: string;
  status: 'APPROVAL_PENDING' | 'APPROVED' | 'ACTIVE' | 'SUSPENDED' | 'CANCELLED' | 'EXPIRED';
  custom_id?: string;
  subscriber?: Record<string, unknown>;
  create_time: string;
  update_time: string;
  start_time: string;
  sales: SaleRec[];
}

export interface SentWebhook {
  eventId: string;
  eventType: string;
  transmissionId: string;
  transmissionTime: string;
  transmissionSig: string;
  certUrl: string;
  authAlgo: string;
  webhookId: string;
  rawBody: string;
  /** Simulator events are delivered but (like real PayPal) are not verifiable by postback. */
  simulated: boolean;
  target?: string;
  deliveryStatus: 'PENDING' | 'DELIVERED' | 'FAILED' | 'NO_TARGET';
  attempts: number;
  lastResponseStatus?: number;
}

/** A webhook subscription made with POST /v1/notifications/webhooks (the dashboard's "Add webhook"). */
export interface RegisteredWebhook {
  id: string;
  /** client_id of the REST app that created it: each app sees only its own subscriptions, like PayPal. */
  app: string;
  url: string;
  event_types: Array<{ name: string; description?: string; status?: string }>;
  create_time: string;
}

export interface IdempotencyRec {
  bodyHash: string;
  /** Resource the original request created; replay returns its latest state. */
  resourceId: string;
}

export interface FakeState {
  tokens: Map<string, number>;
  /** access token → client_id it was issued to. */
  tokenClients: Map<string, string>;
  batches: Map<string, BatchRec>;
  /** sender_batch_id → payout_batch_id (PayPal rejects reuse for 30 days). */
  senderBatchIds: Map<string, string>;
  items: Map<string, PayoutItemRec>;
  orders: Map<string, OrderRec>;
  products: Map<string, ProductRec>;
  plans: Map<string, PlanRec>;
  subscriptions: Map<string, SubscriptionRec>;
  /** `${scope}:${PayPal-Request-Id}` → original request. */
  idempotency: Map<string, IdempotencyRec>;
  webhooks: SentWebhook[];
  events: Map<string, unknown>;
  /** Webhook subscriptions (id → subscription). Events go to each matching one, signed with its id. */
  registeredWebhooks: Map<string, RegisteredWebhook>;
}

export function createState(): FakeState {
  return {
    tokens: new Map(),
    tokenClients: new Map(),
    batches: new Map(),
    senderBatchIds: new Map(),
    items: new Map(),
    orders: new Map(),
    products: new Map(),
    plans: new Map(),
    subscriptions: new Map(),
    idempotency: new Map(),
    webhooks: [],
    events: new Map(),
    registeredWebhooks: new Map(),
  };
}

/** JSON-friendly snapshot for GET /__fake/state. */
export function snapshot(state: FakeState) {
  const obj = <V>(m: Map<string, V>) => Object.fromEntries(m);
  return {
    batches: obj(state.batches),
    senderBatchIds: obj(state.senderBatchIds),
    items: obj(state.items),
    orders: obj(state.orders),
    products: obj(state.products),
    plans: obj(state.plans),
    subscriptions: obj(state.subscriptions),
    webhooks: state.webhooks.map(({ rawBody: _raw, transmissionSig: _sig, ...w }) => w),
    registeredWebhooks: [...state.registeredWebhooks.values()],
    activeTokens: state.tokens.size,
  };
}
