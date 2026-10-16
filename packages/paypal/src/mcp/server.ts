/**
 * `neighborline-payouts-mcp`: MCP tools for PayPal Payouts — the part the PayPal Agent Toolkit does not cover.
 *
 * Reads (batch/item status, transaction search, reconcile) are free. Money movement is not:
 * `create_payout_batch` requires an `approval_token` that only the human-approval service can mint, bound to the
 * exact batch contents. The default verifier refuses everything, so an agent can never pay out on its own.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { batchDigest, denyAllApprovals, type ApprovalDecision, type ApprovalVerifier } from '../approval.js';
import { PayPalApiError, PayPalError } from '../errors.js';
import { createPayPal, type PayPal } from '../paypal.js';
import type { PayPalClient, PayPalClientOptions } from '../client.js';
import { PAYOUT_PURPOSES, type CreateBatchInput, type NormalizedPayoutItem } from '../payouts.js';
import { reconcile } from '../reconcile.js';
import { VERSION } from '../version.js';

export interface AuditEntry {
  tool: string;
  at: string;
  outcome: 'ok' | 'refused' | 'error';
  detail?: string;
  senderBatchId?: string;
  approvalId?: string;
}

export interface PayoutsMcpOptions {
  paypal: PayPal | PayPalClient | PayPalClientOptions;
  /** Decides whether an approval_token authorizes a batch. Default: refuse all. */
  approvalVerifier?: ApprovalVerifier;
  /** Called for every tool call (no amounts/receivers — just what happened). */
  onAudit?: (entry: AuditEntry) => void;
  name?: string;
  version?: string;
  /**
   * Appended to every refusal of `create_payout_batch`, telling the agent (and its user) where approvals happen.
   * Default: "Payouts need two human approvals in the Neighborline organizer app."
   */
  refusalHint?: string;
}

export const DEFAULT_REFUSAL_HINT = 'Payouts need two human approvals in the Neighborline organizer app.';

const PayoutItemStatusEnum = z.enum(['PENDING', 'SUCCESS', 'UNCLAIMED', 'RETURNED', 'ONHOLD', 'BLOCKED', 'FAILED', 'REFUNDED', 'REVERSED', 'CANCELED']);
const isoDate = z.string().refine((s) => !Number.isNaN(Date.parse(s)), 'must be an ISO-8601 date/time');

const json = (data: unknown): CallToolResult => ({
  content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
  structuredContent: data as Record<string, unknown>,
});
const fail = (message: string): CallToolResult => ({ isError: true, content: [{ type: 'text', text: message }] });

function describeError(err: unknown): string {
  if (err instanceof PayPalApiError) return `PayPal ${err.status} ${err.name}${err.issue ? ` (${err.issue})` : ''}: ${err.message} [debug_id ${err.debugId ?? 'n/a'}]`;
  if (err instanceof PayPalError) return `${err.name}: ${err.message}`;
  return `Unexpected error: ${(err as Error)?.message ?? String(err)}`;
}

const itemView = ({ raw: _raw, ...rest }: NormalizedPayoutItem) => rest;

export function createPayoutsMcpServer(options: PayoutsMcpOptions): McpServer {
  const paypal: PayPal = 'payouts' in options.paypal ? (options.paypal as PayPal) : createPayPal(options.paypal as PayPalClient | PayPalClientOptions);
  const verify = options.approvalVerifier ?? denyAllApprovals;
  const refusalHint = options.refusalHint ?? DEFAULT_REFUSAL_HINT;
  const audit = (e: Omit<AuditEntry, 'at'>) => options.onAudit?.({ ...e, at: new Date().toISOString() });
  const server = new McpServer({ name: options.name ?? 'neighborline-payouts', version: options.version ?? VERSION });

  const guarded = async (tool: string, fn: () => Promise<CallToolResult>, extra: Partial<AuditEntry> = {}): Promise<CallToolResult> => {
    try {
      const r = await fn();
      if (!r.isError) audit({ tool, outcome: 'ok', ...extra });
      return r;
    } catch (err) {
      audit({ tool, outcome: 'error', ...extra, detail: err instanceof PayPalApiError ? `${err.name} ${err.debugId ?? ''}`.trim() : (err as Error).name });
      return fail(describeError(err));
    }
  };

  server.registerTool(
    'get_payout_batch',
    {
      title: 'Get payout batch',
      description:
        'Look up a PayPal/Venmo Payouts batch by payout_batch_id: batch status (PENDING, PROCESSING, SUCCESS, DENIED, CANCELED) and each item with its status (SUCCESS, UNCLAIMED, ONHOLD, BLOCKED, FAILED, RETURNED, …), amount in cents, wallet and PayPal error reason. Read-only.',
      inputSchema: {
        payout_batch_id: z.string().min(1).max(30).describe('PayPal payout_batch_id, e.g. "Y4JB5BNLE8Z88"'),
        page: z.number().int().min(1).max(1000).optional(),
        page_size: z.number().int().min(1).max(1000).optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    ({ payout_batch_id, page, page_size }) =>
      guarded('get_payout_batch', async () => {
        const b = await paypal.payouts.getBatch(payout_batch_id, { ...(page ? { page } : {}), ...(page_size ? { pageSize: page_size } : {}) });
        const { raw: _raw, items, ...rest } = b;
        return json({ ...rest, items: items.map(itemView) });
      }),
  );

  server.registerTool(
    'get_payout_item',
    {
      title: 'Get payout item',
      description:
        'Look up one payout item by payout_item_id. Use it to explain to a recipient what happened: UNCLAIMED means they have no PayPal/Venmo account yet and must claim it within 30 days; ONHOLD/BLOCKED are PayPal reviews. Read-only.',
      inputSchema: { payout_item_id: z.string().min(1).max(30).describe('PayPal payout_item_id') },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    ({ payout_item_id }) => guarded('get_payout_item', async () => json(itemView(await paypal.payouts.getItem(payout_item_id)))),
  );

  server.registerTool(
    'cancel_unclaimed_payout_item',
    {
      title: 'Cancel unclaimed payout item',
      description:
        'Cancel a payout item that is still UNCLAIMED, returning the money to the sender (status becomes RETURNED). Only works on UNCLAIMED items. Use when a recipient gave a wrong email/handle. Does not send money to anyone.',
      inputSchema: {
        payout_item_id: z.string().min(1).max(30),
        reason: z.string().min(3).max(200).describe('Why this is being cancelled (kept in the audit log)'),
      },
      annotations: { destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    ({ payout_item_id, reason }) =>
      guarded('cancel_unclaimed_payout_item', async () => json(itemView(await paypal.payouts.cancelUnclaimedItem(payout_item_id))), { detail: reason }),
  );

  server.registerTool(
    'search_transactions',
    {
      title: 'Search PayPal transactions',
      description:
        'Search the PayPal account ledger (Transaction Search API). Ranges longer than 31 days are split automatically. Note: PayPal shows transactions up to ~3 hours late. Event codes: T0001 payouts, T0006 checkout donations, T0002 subscription payments. Read-only.',
      inputSchema: {
        start_date: isoDate.describe('ISO-8601 start, e.g. 2026-10-01T00:00:00Z'),
        end_date: isoDate.describe('ISO-8601 end'),
        transaction_id: z.string().max(19).optional(),
        transaction_status: z.enum(['D', 'P', 'S', 'V']).optional().describe('D denied, P pending, S success, V reversed'),
        limit: z.number().int().min(1).max(1000).default(200).describe('Max rows returned to the model'),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    ({ start_date, end_date, transaction_id, transaction_status, limit }) =>
      guarded('search_transactions', async () => {
        const rows = await paypal.reporting.searchTransactions({ startDate: start_date, endDate: end_date, ...(transaction_id ? { transactionId: transaction_id } : {}), ...(transaction_status ? { transactionStatus: transaction_status } : {}) });
        return json({ total: rows.length, truncated: rows.length > limit, transactions: rows.slice(0, limit).map(({ raw: _raw, ...t }) => t) });
      }),
  );

  server.registerTool(
    'reconcile_payouts',
    {
      title: 'Reconcile payouts',
      description:
        'Compare our payout ledger (local_items) with PayPal Transaction Search for a date range. Returns matched, amountMismatch, missingAtPayPal, missingLocally, and pendingLag (items younger than PayPal\'s ~3h reporting lag, not errors yet). Read-only.',
      inputSchema: {
        start_date: isoDate,
        end_date: isoDate,
        local_items: z
          .array(
            z.object({
              id: z.string(),
              transaction_id: z.string().optional(),
              amount_cents: z.number().int().positive(),
              status: PayoutItemStatusEnum,
              last_event_at: isoDate.optional(),
            }),
          )
          .max(5000),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    ({ start_date, end_date, local_items }) =>
      guarded('reconcile_payouts', async () => {
        const txns = await paypal.reporting.searchTransactions({ startDate: start_date, endDate: end_date });
        const report = reconcile(
          local_items.map((i) => ({ id: i.id, amountCents: i.amount_cents, status: i.status, transactionId: i.transaction_id, lastEventAt: i.last_event_at })),
          txns,
        );
        const strip = <T extends { raw?: unknown }>({ raw: _raw, ...r }: T) => r;
        return json({
          ok: report.ok,
          summary: report.summary,
          matched: report.matched.map((m) => ({ id: m.local.id, transactionId: m.paypal.transactionId })),
          amountMismatch: report.amountMismatch.map((m) => ({ id: m.local.id, transactionId: m.paypal.transactionId, diffCents: m.diffCents })),
          missingAtPayPal: report.missingAtPayPal,
          pendingLag: report.pendingLag,
          missingLocally: report.missingLocally.map(strip),
          noTransactionId: report.noTransactionId.map((i) => i.id),
        });
      }),
  );

  server.registerTool(
    'create_payout_batch',
    {
      title: 'Create payout batch (requires human approval token)',
      description:
        'Send money via PayPal Payouts to PayPal or Venmo recipients. REQUIRES approval_token (calls without one are refused): a short-lived token issued by the human approval service after two different organizers approved this exact batch (same sender_batch_id, receivers, amounts). You cannot create or modify a token; if the batch differs in any way from what humans approved, the call is refused. Never retry with a different sender_batch_id — a repeated sender_batch_id is safe and returns the original batch.',
      inputSchema: {
        // Optional in the schema on purpose: a call without a token reaches the handler, is refused with a reason the
        // agent can relay to its user, and is audited. A schema validation error would be neither.
        approval_token: z.string().max(4096).optional().describe('REQUIRED to move money. Token from the human approval service. Do not fabricate.'),
        sender_batch_id: z.string().min(1).max(256),
        email_subject: z.string().max(255).optional(),
        email_message: z.string().max(1000).optional(),
        items: z
          .array(
            z.object({
              sender_item_id: z.string().min(1).max(63),
              amount_cents: z.number().int().positive(),
              currency: z.string().length(3).default('USD'),
              receiver: z.string().min(1).max(127),
              recipient_type: z.enum(['EMAIL', 'PHONE', 'USER_HANDLE', 'PAYPAL_ID']),
              wallet: z.enum(['PAYPAL', 'VENMO']).default('PAYPAL'),
              note: z.string().max(4000).optional().describe('Required for Venmo'),
              purpose: z.enum(PAYOUT_PURPOSES).optional(),
            }),
          )
          .min(1)
          .max(500),
      },
      annotations: { destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    async (args) => {
      const batch: CreateBatchInput = {
        senderBatchId: args.sender_batch_id,
        ...(args.email_subject ? { emailSubject: args.email_subject } : {}),
        ...(args.email_message ? { emailMessage: args.email_message } : {}),
        items: args.items.map((i) => ({
          senderItemId: i.sender_item_id,
          amountCents: i.amount_cents,
          currency: i.currency,
          receiver: i.receiver,
          recipientType: i.recipient_type,
          wallet: i.wallet,
          ...(i.note !== undefined ? { note: i.note } : {}),
          ...(i.purpose ? { purpose: i.purpose } : {}),
        })),
      };
      let decision: ApprovalDecision;
      const token = args.approval_token?.trim() ?? '';
      if (!token) {
        decision = { ok: false, reason: 'no approval_token; an agent cannot authorize a payout on its own' };
      } else {
        try {
          decision = await verify({ approvalToken: token, batch, digest: batchDigest(batch) });
        } catch (err) {
          decision = { ok: false, reason: `approval verifier error: ${(err as Error).message}` };
        }
      }
      if (!decision.ok) {
        audit({ tool: 'create_payout_batch', outcome: 'refused', detail: decision.reason, senderBatchId: batch.senderBatchId });
        return fail(`Refused: ${decision.reason}. ${refusalHint}`);
      }
      return guarded(
        'create_payout_batch',
        async () => {
          const { raw: _raw, ...rest } = await paypal.payouts.createBatch(batch);
          return json({ ...rest, approvalId: decision.approvalId ?? null });
        },
        { senderBatchId: batch.senderBatchId, ...(decision.approvalId ? { approvalId: decision.approvalId } : {}) },
      );
    },
  );

  return server;
}
