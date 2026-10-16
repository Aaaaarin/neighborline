/**
 * Vetted message templates for the notify agent, written natively per language.
 * The real NotifyAgent fills these slots; here the mock does it directly.
 */
import type { Lang } from '@neighborline/core';
import type { DeclineReasonCode } from '../../types';

type L = 'en' | 'es' | 'vi' | 'ht';
const pick = (lang: Lang): L => (lang === 'es' || lang === 'vi' || lang === 'ht' ? lang : 'en');

const w = (wallet: 'PAYPAL' | 'VENMO') => (wallet === 'VENMO' ? 'Venmo' : 'PayPal');

export interface Slots {
  amount: string;
  wallet: 'PAYPAL' | 'VENMO';
  receiver: string;
  tx?: string;
}

const T = {
  ack: {
    en: 'Thank you. Two people from the group are looking at your request now. It usually takes a few minutes — we’ll message you the moment the money is sent.',
    es: 'Gracias. Dos personas del grupo están revisando su solicitud. Suele tardar unos minutos; le escribimos en cuanto se envíe el dinero.',
    vi: 'Cảm ơn bạn. Hai người trong nhóm đang xem yêu cầu của bạn. Thường chỉ mất vài phút — gửi tiền xong là chúng tôi nhắn ngay.',
    ht: 'Mèsi. De moun nan gwoup la ap gade demann ou an kounye a. Sa konn pran kèk minit; n ap ekri w touswit lè lajan an pati.',
  },
  sending: {
    en: 'Two neighbors said yes. Sending the money through PayPal now…',
    es: 'Dos vecinos dijeron que sí. Enviando el dinero por PayPal…',
    vi: 'Hai người trong nhóm đã đồng ý. Đang gửi tiền qua PayPal…',
    ht: 'De vwazen di wi. N ap voye lajan an pa PayPal kounye a…',
  },
  needsPayout: {
    en: 'Where should we send the money? Reply with your Venmo username or the email or phone number on your PayPal.',
    es: '¿A dónde le enviamos el dinero? Responda con su usuario de Venmo, o el correo o teléfono de su PayPal.',
    vi: 'Chúng tôi nên gửi tiền vào đâu ạ? Bạn nhắn tên Venmo, hoặc email hay số điện thoại dùng cho PayPal.',
    ht: 'Ki kote pou nou voye lajan an? Reponn ak non Venmo ou, oswa imèl oswa nimewo telefòn PayPal ou.',
  },
};

export function ack(lang: Lang) {
  return { text: T.ack[pick(lang)], textEn: T.ack.en };
}
export function sending(lang: Lang) {
  return { text: T.sending[pick(lang)], textEn: T.sending.en };
}
export function needsPayout(lang: Lang) {
  return { text: T.needsPayout[pick(lang)], textEn: T.needsPayout.en };
}

export function paid(lang: Lang, s: Slots) {
  const tx = s.tx ?? '';
  const by: Record<L, string> = {
    en: `Sent ${s.amount} to your ${w(s.wallet)} (${s.receiver}). Transaction ${tx}. If you don’t see it, just reply here.`,
    es: `Listo: enviamos ${s.amount} a su ${w(s.wallet)} (${s.receiver}). Transacción ${tx}. Si no lo ve, responda aquí.`,
    vi: `Đã gửi ${s.amount} vào ${w(s.wallet)} của bạn (${s.receiver}). Mã giao dịch ${tx}. Nếu chưa thấy tiền, cứ nhắn lại đây.`,
    ht: `Nou voye ${s.amount} sou ${w(s.wallet)} ou (${s.receiver}). Tranzaksyon ${tx}. Si ou pa wè l, reponn isit la.`,
  };
  return { text: by[pick(lang)], textEn: by.en };
}

export function claimHelp(lang: Lang, s: Slots) {
  const by: Record<L, string> = {
    en: `We sent ${s.amount} to ${s.receiver}, but that email doesn’t have a PayPal account yet. To get it: open paypal.com, sign up with that same email, and confirm it. The money waits for you for 30 days. Want us to call and walk you through it? Reply CALL.`,
    es: `Le enviamos ${s.amount} a ${s.receiver}, pero ese correo todavía no tiene cuenta de PayPal. Para recibirlo: abra paypal.com, cree una cuenta con ese mismo correo y confírmelo. El dinero la espera 30 días. ¿Quiere que la llamemos para ayudarla? Responda LLAMAR.`,
    vi: `Chúng tôi đã gửi ${s.amount} tới ${s.receiver}, nhưng email này chưa có tài khoản PayPal. Để nhận tiền: vào paypal.com, đăng ký bằng đúng email này rồi xác nhận. Tiền sẽ được giữ cho bạn trong 30 ngày. Cần chúng tôi gọi điện hướng dẫn không? Nhắn GỌI.`,
    ht: `Nou voye ${s.amount} bay ${s.receiver}, men imèl sa a poko gen kont PayPal. Pou w resevwa l: louvri paypal.com, kreye yon kont ak menm imèl la epi konfime l. Lajan an ap tann ou 30 jou. Ou vle nou rele w pou ede w? Reponn RELE.`,
  };
  return { text: by[pick(lang)], textEn: by.en };
}

export function claimed(lang: Lang, s: Slots) {
  const by: Record<L, string> = {
    en: `It worked — the ${s.amount} is in your PayPal now. Thank you for your patience.`,
    es: `¡Ya está! Los ${s.amount} llegaron a su PayPal. Gracias por su paciencia.`,
    vi: `Xong rồi — ${s.amount} đã vào PayPal của bạn. Cảm ơn bạn đã kiên nhẫn chờ.`,
    ht: `Sa mache — ${s.amount} yo nan PayPal ou kounye a. Mèsi pou pasyans ou.`,
  };
  return { text: by[pick(lang)], textEn: by.en };
}

const REASONS: Record<DeclineReasonCode, Record<L, string>> = {
  outside_area: {
    en: 'your address is outside the area this group covers',
    es: 'su dirección está fuera del área que cubre el grupo',
    vi: 'địa chỉ nằm ngoài khu vực nhóm hỗ trợ',
    ht: 'adrès ou deyò zòn gwoup la kouvri',
  },
  household_cap: {
    en: 'your household already received this month’s limit',
    es: 'su hogar ya recibió el máximo de este mes',
    vi: 'gia đình đã nhận đủ mức hỗ trợ của tháng này',
    ht: 'fanmi w deja resevwa limit mwa sa a',
  },
  needs_info: {
    en: 'we need a little more information first',
    es: 'necesitamos un poco más de información primero',
    vi: 'chúng tôi cần thêm một chút thông tin',
    ht: 'nou bezwen yon ti kras plis enfòmasyon anvan',
  },
  not_covered: {
    en: 'this need isn’t in the group’s rules yet',
    es: 'esta necesidad todavía no está en las reglas del grupo',
    vi: 'nhu cầu này chưa nằm trong quy định của nhóm',
    ht: 'bezwen sa a poko nan règ gwoup la',
  },
  other: {
    en: 'an organizer left a note below',
    es: 'una organizadora dejó una nota abajo',
    vi: 'người duyệt có để lại ghi chú bên dưới',
    ht: 'yon òganizatè kite yon nòt anba a',
  },
};

export const DECLINE_REASON_LABELS: Record<DeclineReasonCode, string> = {
  outside_area: 'Outside our area',
  household_cap: 'Household reached this month’s limit',
  needs_info: 'Need more information',
  not_covered: 'Not covered by our rules',
  other: 'Something else (write a note)',
};

export function declined(lang: Lang, code: DeclineReasonCode, note?: string) {
  const r = REASONS[code];
  const by: Record<L, string> = {
    en: `We can’t send money this time: ${r.en}. If you think that’s wrong, reply REVIEW and a different organizer will look again within 24 hours.`,
    es: `Esta vez no podemos enviar el dinero: ${r.es}. Si cree que es un error, responda REVISAR y otra persona del grupo lo revisará en 24 horas.`,
    vi: `Lần này chúng tôi chưa thể gửi tiền: ${r.vi}. Nếu thấy chưa đúng, bạn nhắn XEM LẠI — một người khác trong nhóm sẽ xem lại trong 24 giờ.`,
    ht: `Fwa sa a nou pa ka voye lajan an: ${r.ht}. Si ou panse se yon erè, reponn REVIZE epi yon lòt òganizatè ap gade l ankò nan 24 èdtan.`,
  };
  const suffix = note ? `\n\n“${note}”` : '';
  return { text: by[pick(lang)] + suffix, textEn: by.en + suffix };
}

export function quickReplies(lang: Lang): { yes: string; fix: string } {
  const by: Record<L, { yes: string; fix: string }> = {
    en: { yes: 'Yes, that’s right', fix: 'Fix something' },
    es: { yes: 'Sí, correcto', fix: 'Corregir' },
    vi: { yes: 'Đúng rồi', fix: 'Sửa lại' },
    ht: { yes: 'Wi, se sa', fix: 'Korije' },
  };
  return by[pick(lang)];
}

/** Read-back for free text in fixture mode (no live translation available). */
export function genericReadback(lang: Lang, s: { summary: string; categoryLabel: string; cap: string; payout?: string }) {
  const dest = s.payout ?? '';
  const by: Record<L, string> = {
    en: `Here’s what we understood: “${s.summary}”. That fits ${s.categoryLabel}; the group’s rules allow up to ${s.cap}.${dest ? ` We’d send it to ${dest}.` : ''} Is that right?`,
    es: `Esto es lo que entendimos: «${s.summary}». Corresponde a ${s.categoryLabel}; las reglas del grupo permiten hasta ${s.cap}.${dest ? ` Lo enviaríamos a ${dest}.` : ''} ¿Es correcto?`,
    vi: `Chúng tôi hiểu như sau: “${s.summary}”. Thuộc mục ${s.categoryLabel}; quy định của nhóm cho phép tới ${s.cap}.${dest ? ` Tiền sẽ gửi vào ${dest}.` : ''} Đúng không ạ?`,
    ht: `Men sa nou konprann: “${s.summary}”. Sa antre nan ${s.categoryLabel}; règ gwoup la pèmèt jiska ${s.cap}.${dest ? ` N ap voye l sou ${dest}.` : ''} Èske se sa?`,
  };
  const en = `Here’s what we understood: “${s.summary}”. That fits ${s.categoryLabel}; the group’s rules allow up to ${s.cap}.${dest ? ` We’d send it to ${dest}.` : ''} Is that right?`;
  return { text: by[pick(lang)], textEn: en };
}
