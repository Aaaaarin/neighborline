/**
 * What the line is waiting to hear from the neighbor, and the vetted words around it:
 *  - the one clarifying question (payout → category → household), with tappable answers in their language
 *  - the appeal after a decline (reply REVIEW, or anything): back to the queue for a different organizer
 * The answers are plain text in the neighbor's language, so they go through the same intake agent as
 * anything typed (live LLM or the offline extractor, which knows these exact labels).
 */
import type { HelpRequest, Lang, Policy } from '@neighborline/core';
import { questionText } from '@neighborline/agents';
import type { DeclineReasonCode, ThreadQuestion } from '../../types';
import type { RequestMeta } from './meta';

type Key = Exclude<ThreadQuestion['key'], 'appeal'>;

/** Policy labels cover en/es/vi/ht/zh/ar; the other supported languages get these (same words the extractor knows). */
const EXTRA_LABELS: Record<string, Partial<Record<Lang, string>>> = {
  utility_outage: { ko: '정전·난방 문제', ru: 'Нет света или отопления', fr: 'Coupure de courant ou de chauffage', tl: 'Walang kuryente o heater' },
  groceries: { ko: '식료품', ru: 'Продукты', fr: 'Courses alimentaires', tl: 'Pagkain' },
  medicine_copay: { ko: '약값', ru: 'Лекарства', fr: 'Médicaments', tl: 'Gamot' },
  rent_gap: { ko: '월세 부족', ru: 'Аренда жилья', fr: 'Loyer', tl: 'Kulang sa upa' },
  transport: { ko: '교통비', ru: 'Проезд', fr: 'Transport', tl: 'Pamasahe' },
  other: { ko: '기타', ru: 'Другое', fr: 'Autre chose', tl: 'Iba pa' },
};

export function categoryLabelIn(policy: Policy, key: string, lang: Lang): string {
  const c = policy.categories.find((x) => x.key === key);
  return c?.label[lang] ?? EXTRA_LABELS[key]?.[lang] ?? c?.label.en ?? key;
}

/** "3 people", in words the extractor reads back as a household size. */
export function householdAnswer(n: number, lang: Lang): string {
  const by: Record<Lang, string> = {
    en: n === 1 ? '1 person' : `${n} people`,
    es: n === 1 ? '1 persona' : `${n} personas`,
    vi: `${n} người`,
    ht: `${n} moun`,
    zh: `${n}口人`,
    ar: `${n} أشخاص`,
    fr: n === 1 ? '1 personne' : `${n} personnes`,
    tl: `${n} tao`,
    ko: `${n}명`,
    ru: n >= 2 && n <= 4 ? `${n} человека` : `${n} человек`,
  };
  return by[lang];
}

/** The pending question, derived from the stored request so it survives a server restart. */
export function questionFor(r: HelpRequest, policy: Policy | null, meta: RequestMeta | undefined, opts: { blocked: boolean }): ThreadQuestion | null {
  const lang = r.lang;
  if (r.status === 'declined') return appealQuestion(lang, meta);
  if (opts.blocked) return null;
  let key: Key | null = null;
  let optional = false;
  const x = r.extracted;
  if (r.status === 'needs_clarification') {
    key = !x ? 'ask_again' : x.missing.includes('payout') || !r.payoutDestination ? 'ask_payout' : x.missing.includes('category') ? 'ask_category' : 'ask_again';
  } else if (r.status === 'intake' && x && x.missing.includes('household')) {
    key = 'ask_household';
    optional = true;
  }
  if (!key) return null;
  const text = meta?.question?.key === key && meta.question.lang === lang ? meta.question.text : questionText(key, lang);
  const answers =
    key === 'ask_household'
      ? [1, 2, 3, 4, 5, 6].map((n) => ({ label: String(n), send: householdAnswer(n, lang) }))
      : key === 'ask_category' && policy
        ? policy.categories.map((c) => {
            const label = categoryLabelIn(policy, c.key, lang);
            return { label, send: label };
          })
        : [];
  return { key, text, optional, answers };
}

/* ---------- appeal ---------- */

const REVIEW_WORD: Partial<Record<Lang, string>> = { en: 'REVIEW', es: 'REVISAR', vi: 'XEM LẠI', ht: 'REVIZE', ar: 'مراجعة', zh: '复查' };

function appealQuestion(lang: Lang, meta: RequestMeta | undefined): ThreadQuestion | null {
  if (meta?.appeal) return null; // one appeal per request; a second organizer's decision is final
  const word = REVIEW_WORD[lang] ?? 'REVIEW';
  const text: Partial<Record<Lang, string>> = {
    en: 'Think this is wrong? Reply REVIEW, or tell us what we missed.',
    es: '¿Cree que es un error? Responda REVISAR o cuéntenos qué se nos pasó.',
    vi: 'Bạn thấy chưa đúng? Nhắn XEM LẠI, hoặc cho chúng tôi biết điều còn thiếu.',
    ht: 'Ou panse se yon erè? Reponn REVIZE, oswa di nou sa nou rate.',
    ar: 'هل ترى أن هذا خطأ؟ ردّ بكلمة مراجعة، أو أخبرنا بما فاتنا.',
    zh: '觉得有误？请回复“复查”，或告诉我们漏掉了什么。',
  };
  return { key: 'appeal', text: text[lang] ?? text.en!, optional: true, answers: [{ label: word, send: word }] };
}

export function appealAck(lang: Lang): { text: string; textEn: string } {
  const by: Partial<Record<Lang, string>> = {
    en: 'Thank you. A different organizer will look at your request again within 24 hours. We’ll message you here.',
    es: 'Gracias. Otra persona del grupo revisará su solicitud de nuevo en 24 horas. Le escribiremos aquí.',
    vi: 'Cảm ơn bạn. Một người khác trong nhóm sẽ xem lại yêu cầu của bạn trong 24 giờ. Chúng tôi sẽ nhắn bạn ở đây.',
    ht: 'Mèsi. Yon lòt òganizatè ap gade demann ou an ankò nan 24 èdtan. N ap ekri w isit la.',
    ar: 'شكرًا لك. سيراجع منظّم آخر طلبك مرة أخرى خلال 24 ساعة، وسنراسلك هنا.',
    zh: '谢谢。另一位组织者会在24小时内重新查看您的申请，我们会在这里回复您。',
  };
  return { text: by[lang] ?? by.en!, textEn: by.en! };
}

export const DECLINE_REASON_EN: Record<DeclineReasonCode, string> = {
  outside_area: 'Outside our area',
  household_cap: 'Household reached this month’s limit',
  needs_info: 'Need more information',
  not_covered: 'Not covered by our rules',
  other: 'Something else',
};
