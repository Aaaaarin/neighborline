/**
 * What the neighbor is told when PayPal refuses a payout at the account level (FAILED_RAIL: the
 * sponsor's account is restricted, locked or not authorized). Written natively for every intake
 * language. Neutral on purpose: the neighbor did nothing wrong, no money moved, and the volunteers
 * already know. It never promises an amount, a time, or a particular way of getting the money.
 * Pure: no I/O.
 */
import { LANGS, type Lang } from './schemas.js';

/** Arabic needs no bidi isolation: the only Latin word, PayPal, sits inside one RTL sentence. */
export const RAIL_REFUSED_NOTICE: Readonly<Record<Lang, string>> = {
  en: 'Your request was approved, but PayPal could not send the money right now. Nothing is wrong on your side. The volunteers have been told and will message you here.',
  es: 'Su solicitud fue aprobada, pero PayPal no pudo enviar el dinero en este momento. No es un problema de su parte. Los voluntarios ya lo saben y le escribirán aquí.',
  vi: 'Yêu cầu của bạn đã được duyệt, nhưng hiện giờ PayPal chưa gửi được tiền. Bạn không làm gì sai cả. Các tình nguyện viên đã được báo và sẽ nhắn cho bạn ở đây.',
  ht: 'Yo apwouve demann ou an, men PayPal pa t ka voye lajan an kounye a. Pa gen anyen ki mal sou bò pa w. Volontè yo konnen sa epi y ap ekri w isit la.',
  zh: '您的申请已获批准，但 PayPal 暂时无法汇出这笔钱。这不是您的问题。志愿者已经知道了，会在这里给您发消息。',
  ar: 'تمت الموافقة على طلبك، لكن PayPal لم يتمكن من إرسال المال الآن. لا توجد أي مشكلة من جهتك. أُبلغ المتطوعون وسيراسلونك هنا.',
  fr: "Votre demande a été approuvée, mais PayPal n'a pas pu envoyer l'argent pour le moment. Le problème ne vient pas de vous. Les bénévoles sont prévenus et vous écriront ici.",
  tl: 'Naaprubahan ang iyong kahilingan, pero hindi maipadala ng PayPal ang pera sa ngayon. Wala kang pagkakamali rito. Alam na ito ng mga boluntaryo at magme-message sila sa iyo rito.',
  ko: '요청이 승인되었지만 지금은 PayPal에서 돈을 보내지 못했습니다. 잘못하신 것은 없습니다. 봉사자들이 이미 알고 있으며 여기로 연락드리겠습니다.',
  ru: 'Ваша просьба одобрена, но PayPal сейчас не смог отправить деньги. С вашей стороны всё в порядке. Волонтёры уже знают об этом и напишут вам здесь.',
};

/** The notice in the neighbor's language (English for anything unknown), with the English for organizers. */
export function railRefusedNotice(lang: Lang | string): { lang: Lang; text: string; textEn: string } {
  const primary = String(lang).toLowerCase().split(/[-_]/)[0] ?? 'en';
  const l = (LANGS as readonly string[]).includes(primary) ? (primary as Lang) : 'en';
  return { lang: l, text: RAIL_REFUSED_NOTICE[l], textEn: RAIL_REFUSED_NOTICE.en };
}
