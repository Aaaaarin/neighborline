/**
 * Deterministic narrative built only from fact strings. Used offline (fixture mode) and as the
 * fallback when the model's narrative fails the number check twice.
 */
import type { Fact } from './facts.js';

const CLOSING = [
  'Every payout was approved by two volunteers, and every amount came from the group\'s written rules, not from a computer\'s judgment.',
  'Software only transcribes, translates and drafts messages; people make the decisions.',
  'Each figure on this page links to a PayPal transaction ID, so anyone can check the math.',
  'Thank you to everyone who gave, and to the neighbors who trusted us with their requests.',
  'If you have questions about how we work, reply to any of our messages and a volunteer will answer.',
];

export function templateNarrative(facts: readonly Fact[]): { headline: string; narrative: string } {
  const v = (key: string): string | undefined => facts.find((f) => f.key === key)?.value;
  const group = v('group') ?? 'Our group';
  const s: string[] = [];
  const period = v('period');
  s.push(`${period ? `From ${period}, ` : ''}neighbors gave ${v('donated')} through ${v('donations')} from ${v('donors')}.`);
  s.push(`${group} sent ${v('paid_out')} directly to neighbors in ${v('payouts')}, reaching ${v('people_helped')}.`);
  const cats = facts.filter((f) => f.key.startsWith('category.')).map((f) => `${f.label.replace(/^Category: /, '').toLowerCase()} (${f.value})`);
  if (cats.length) s.push(`The money went to ${cats.join('; ')}.`);
  if (v('languages')) s.push(`People asked for help in ${v('languages')}. Each person was answered in their own language.`);
  if (v('ttc_p50')) s.push(`The typical time from a voice note to cash in hand was ${v('ttc_p50')}${v('ttc_p90') ? `, and 9 in 10 people had their money within ${v('ttc_p90')}` : ''}.`);
  if (v('unclaimed')) s.push(`Payments not claimed at first: ${v('unclaimed')}.`);
  if (v('paypal_inflows')) s.push(`PayPal's own records, read through the PayPal Agent Toolkit, show ${v('paypal_inflows')}.`);
  s.push(`To protect privacy, ${v('privacy')}.`);
  const out = [...s];
  for (const c of CLOSING) {
    if (out.join(' ').split(/\s+/).length >= 150) break;
    out.push(c);
  }
  return { headline: `${group}: where the money went`, narrative: out.join(' ') };
}
