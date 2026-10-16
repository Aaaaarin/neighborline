/**
 * Donation inflows for the transparency report, read through PayPal's official Agent Toolkit
 * (`@paypal/agent-toolkit`, tool `list_transactions` → GET /v1/reporting/transactions).
 * We call the toolkit's tool handler directly with fixed arguments — no model decides anything
 * here, and the toolkit is configured with ONLY `transactions.list` enabled (read-only).
 */
import { parseUsdToCents } from '@neighborline/core';
import inflowFixture from '../../fixtures/inflows.json';

export interface Inflow {
  transactionId: string;
  amountCents: number;
  currency: string;
  at: string;
  eventCode: string;
  /** PayPal transaction_status: S success, P pending, D denied, V reversed. */
  status: string;
}
export interface InflowRange {
  /** ISO-8601 with seconds. PayPal allows at most 31 days per query. */
  startDate: string;
  endDate: string;
}
export interface InflowSource {
  readonly id: string;
  listInflows(range: InflowRange): Promise<Inflow[]>;
}
export interface InflowSummary {
  source: string;
  count: number;
  totalCents: number;
  transactionIds: string[];
}

interface TxDetail {
  transaction_info?: {
    transaction_id?: string;
    transaction_event_code?: string;
    transaction_initiation_date?: string;
    transaction_amount?: { currency_code?: string; value?: string };
    transaction_status?: string;
  };
}

const signedCents = (value: string): number | null => {
  const neg = value.trim().startsWith('-');
  const c = parseUsdToCents(value.trim().replace(/^-/, ''));
  return c === null ? null : neg ? -c : c;
};

/** Transaction Search JSON → positive-amount inflows (payouts/fees are negative and skipped). */
export function parseTransactionSearch(json: unknown): Inflow[] {
  const details = (json as { transaction_details?: TxDetail[] } | null)?.transaction_details ?? [];
  const out: Inflow[] = [];
  for (const d of details) {
    const t = d.transaction_info;
    const cents = t?.transaction_amount?.value ? signedCents(t.transaction_amount.value) : null;
    if (!t?.transaction_id || cents === null || cents <= 0) continue;
    out.push({
      transactionId: t.transaction_id,
      amountCents: cents,
      currency: t.transaction_amount?.currency_code ?? 'USD',
      at: t.transaction_initiation_date ?? '',
      eventCode: t.transaction_event_code ?? '',
      status: t.transaction_status ?? '',
    });
  }
  return out;
}

/** Completed (status S) inflows only. */
export function summarizeInflows(inflows: readonly Inflow[], source: string): InflowSummary {
  const done = inflows.filter((i) => i.status === 'S' && i.currency === 'USD');
  return { source, count: done.length, totalCents: done.reduce((a, i) => a + i.amountCents, 0), transactionIds: done.map((i) => i.transactionId).sort() };
}

export class FixtureInflowSource implements InflowSource {
  readonly id = 'fixture';
  async listInflows(_range: InflowRange): Promise<Inflow[]> {
    return parseTransactionSearch(inflowFixture);
  }
}

/** Minimal structural view of `@paypal/agent-toolkit/openai`'s PayPalAgentToolkit. */
interface ToolkitLike {
  handleToolCall(call: { id: string; type: 'function'; function: { name: string; arguments: string } }): Promise<{ content: unknown }>;
}
type ToolkitCtor = new (args: {
  clientId: string;
  clientSecret: string;
  configuration: { actions: Record<string, Record<string, boolean>>; context?: Record<string, unknown> };
}) => ToolkitLike;

export interface PayPalToolkitInflowOptions {
  clientId: string;
  clientSecret: string;
  sandbox?: boolean;
  /** Inject a toolkit (tests). */
  toolkit?: ToolkitLike;
}

export class PayPalToolkitInflowSource implements InflowSource {
  readonly id = 'paypal-agent-toolkit:list_transactions';
  private toolkit: ToolkitLike | undefined;
  constructor(private readonly opts: PayPalToolkitInflowOptions) {
    this.toolkit = opts.toolkit;
  }

  private async load(): Promise<ToolkitLike> {
    if (this.toolkit) return this.toolkit;
    // Loaded at runtime by Node (not bundled): the toolkit is an optional, server-only dependency.
    const specifier = '@paypal/agent-toolkit/openai';
    const mod = (await import(/* webpackIgnore: true */ specifier)) as { PayPalAgentToolkit: ToolkitCtor };
    this.toolkit = new mod.PayPalAgentToolkit({
      clientId: this.opts.clientId,
      clientSecret: this.opts.clientSecret,
      configuration: { actions: { transactions: { list: true } }, context: { sandbox: this.opts.sandbox ?? true } },
    });
    return this.toolkit;
  }

  async listInflows(range: InflowRange): Promise<Inflow[]> {
    const toolkit = await this.load();
    const res = await toolkit.handleToolCall({
      id: `nl_inflows_${Date.now()}`,
      type: 'function',
      function: {
        name: 'list_transactions',
        arguments: JSON.stringify({ start_date: range.startDate, end_date: range.endDate, transaction_status: 'S', page_size: 500, page: 1 }),
      },
    });
    const content = typeof res.content === 'string' ? JSON.parse(res.content) : res.content;
    const err = (content as { error?: { message?: string } } | null)?.error;
    if (err) throw new Error(`PayPal Agent Toolkit list_transactions failed: ${err.message ?? 'unknown error'}`);
    return parseTransactionSearch(content);
  }
}
