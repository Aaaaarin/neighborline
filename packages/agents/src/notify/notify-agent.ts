/**
 * NotifyAgent: status → message in the neighbor's language from the vetted catalog (core i18n).
 * Code fills every slot (amount is formatted from integer cents, never written by a model).
 * Languages outside the catalog get an LLM translation that must pass a back-translation fact
 * check (amount + wallet survive both directions); otherwise the vetted English text is sent.
 */
import {
  formatUsd,
  isCatalogLang,
  render,
  walletName,
  type MessageKey,
  type PayoutItemStatus,
  type RequestStatus,
  type Wallet,
} from '@neighborline/core';
import type { LLM, TTS } from '../providers/types.js';
import { translateWithCheck, type FactCheck } from '../translate.js';
import type { StructuredTrace } from '../validate.js';

export const NOTIFY_KEYS = ['confirmed_waiting', 'approved_sending', 'paid', 'unclaimed_help', 'declined_with_appeal', 'needs_info'] as const;
export type NotifyKey = (typeof NOTIFY_KEYS)[number] & MessageKey;

/** Which message a state change should trigger (null = no message). */
export function notifyKeyFor(e: { requestStatus?: RequestStatus; itemStatus?: PayoutItemStatus }): NotifyKey | null {
  switch (e.itemStatus) {
    case 'SUCCESS': return 'paid';
    case 'UNCLAIMED': return 'unclaimed_help';
    default: break;
  }
  switch (e.requestStatus) {
    case 'awaiting_approval': return 'confirmed_waiting';
    case 'approved':
    case 'paying': return 'approved_sending';
    case 'paid': return 'paid';
    case 'unclaimed': return 'unclaimed_help';
    case 'declined': return 'declined_with_appeal';
    case 'needs_clarification': return 'needs_info';
    default: return null;
  }
}

export interface NotifyInput {
  key: NotifyKey;
  lang: string;
  amountCents?: number;
  wallet?: Wallet;
  name?: string;
  /** Tone hint for out-of-catalog translation. */
  tone?: string;
  /** Also synthesize speech (callback voice message). */
  speak?: boolean;
}
export interface NotifyResult {
  key: NotifyKey;
  text: string;
  /** Language of `text` (may be 'en' if a translation failed its check). */
  lang: string;
  requestedLang: string;
  source: 'catalog' | 'translated' | 'catalog_en_fallback';
  check?: FactCheck;
  backTranslation?: string;
  audio?: { base64: string; mimeType: string; useBrowserSpeech: boolean };
  traces: StructuredTrace[];
}

export class NotifyAgent {
  constructor(private readonly deps: { llm: LLM; tts?: TTS }) {}

  async render(input: NotifyInput): Promise<NotifyResult> {
    const vars = {
      ...(input.amountCents !== undefined ? { amount: formatUsd(input.amountCents) } : {}),
      ...(input.wallet ? { wallet: walletName(input.wallet) } : {}),
      ...(input.name ? { name: input.name } : {}),
    };
    const base = { key: input.key, requestedLang: input.lang };
    let result: NotifyResult;
    if (isCatalogLang(input.lang)) {
      result = { ...base, text: render(input.key, input.lang, vars), lang: input.lang, source: 'catalog', traces: [] };
    } else {
      const english = render(input.key, 'en', vars);
      const facts = [vars.amount, vars.wallet].filter((x): x is string => !!x);
      const t = await translateWithCheck(this.deps.llm, { text: english, targetLang: input.lang, facts, ...(input.tone ? { tone: input.tone } : {}) });
      result = {
        ...base,
        text: t.text,
        lang: t.translated ? input.lang : 'en',
        source: t.translated ? 'translated' : 'catalog_en_fallback',
        ...(t.check ? { check: t.check } : {}),
        ...(t.backTranslation ? { backTranslation: t.backTranslation } : {}),
        traces: t.traces,
      };
    }
    if (input.speak && this.deps.tts) {
      const s = await this.deps.tts.speak({ text: result.text, lang: result.lang });
      result.audio = { base64: Buffer.from(s.audio).toString('base64'), mimeType: s.mimeType, useBrowserSpeech: s.useBrowserSpeech ?? false };
    }
    return result;
  }
}
