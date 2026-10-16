/**
 * Vetted requester-notification templates. The NotifyAgent fills slots; it never writes free text
 * about money. Slots: {amount} {wallet} {name}. A segment wrapped in [[ ]] is dropped when any
 * slot inside it is missing (used for the optional greeting "Hi {name}.").
 */
import type { Lang } from './schemas.js';

export const MESSAGE_KEYS = [
  'readback_intro',
  'ask_payout',
  'ask_household',
  'confirmed_waiting',
  'approved_sending',
  'paid',
  'unclaimed_help',
  'declined_with_appeal',
  'needs_info',
] as const;
export type MessageKey = (typeof MESSAGE_KEYS)[number];

export const CATALOG_LANGS = ['en', 'es', 'vi', 'ht', 'zh', 'ar'] as const;
export type CatalogLang = (typeof CATALOG_LANGS)[number];

export type TemplateVars = Partial<Record<'amount' | 'wallet' | 'name', string>>;

export const CATALOG: Readonly<Record<CatalogLang, Readonly<Record<MessageKey, string>>>> = {
  en: {
    readback_intro: 'Here is what I understood. Please tell me if it is right:',
    ask_payout: 'Where should we send the money? You can give us a PayPal email or a Venmo username.',
    ask_household: 'How many people live in your home, including you?',
    confirmed_waiting: 'Thank you. Two volunteers are looking at your request now. We will message you as soon as they decide.',
    approved_sending: 'Good news: your request was approved. We are sending {amount} to your {wallet} now.',
    paid: '[[Hi {name}. ]]{amount} has been sent to your {wallet}. We hope it helps. Take care.',
    unclaimed_help:
      'We sent {amount} to {wallet}, but it has not been claimed yet. To get it, open {wallet} or sign up with the same email or phone number you gave us. Reply here if you need help.',
    declined_with_appeal:
      'We are sorry. Under the group’s current rules we could not send money for this request. This is not a judgment about you. Reply here if you would like a volunteer to look at it again.',
    needs_info: '[[Hi {name}. ]]A volunteer has a quick question about your request. Please reply here when you can.',
  },
  es: {
    readback_intro: 'Esto es lo que entendí. Por favor, dígame si está bien:',
    ask_payout: '¿A dónde le enviamos el dinero? Puede darnos un correo de PayPal o un usuario de Venmo.',
    ask_household: '¿Cuántas personas en total viven en su casa (usted también cuenta)?',
    confirmed_waiting: 'Gracias. Dos voluntarios están revisando su solicitud. Le avisaremos en cuanto decidan.',
    approved_sending: 'Buenas noticias: su solicitud fue aprobada. Le estamos enviando {amount} a su {wallet}.',
    paid: '[[Hola, {name}. ]]Ya le enviamos {amount} a su {wallet}. Esperamos que le ayude. Cuídese mucho.',
    unclaimed_help:
      'Le enviamos {amount} por {wallet}, pero todavía no lo ha cobrado. Para recibirlo, abra {wallet} o regístrese con el mismo correo o número de teléfono que nos dio. Si necesita ayuda, responda a este mensaje.',
    declined_with_appeal:
      'Lo sentimos. Con las reglas actuales del grupo no pudimos enviar dinero para esta solicitud. No es un juicio sobre usted. Si quiere que un voluntario la revise de nuevo, responda a este mensaje.',
    needs_info: '[[Hola, {name}. ]]Un voluntario tiene una pregunta rápida sobre su solicitud. Por favor, responda aquí cuando pueda.',
  },
  vi: {
    readback_intro: 'Đây là những gì chúng tôi hiểu. Xin bạn kiểm tra xem có đúng không:',
    ask_payout: 'Chúng tôi nên gửi tiền vào đâu? Bạn có thể cho email PayPal hoặc tên người dùng Venmo.',
    ask_household: 'Nhà bạn có bao nhiêu người, tính cả bạn?',
    confirmed_waiting: 'Cảm ơn bạn. Hai tình nguyện viên đang xem yêu cầu của bạn. Chúng tôi sẽ nhắn cho bạn ngay khi có quyết định.',
    approved_sending: 'Tin vui: yêu cầu của bạn đã được duyệt. Chúng tôi đang gửi {amount} vào {wallet} của bạn.',
    paid: '[[Chào {name}. ]]Đã gửi {amount} vào {wallet} của bạn. Mong số tiền này giúp được bạn. Bạn giữ gìn sức khỏe nhé.',
    unclaimed_help:
      'Chúng tôi đã gửi {amount} qua {wallet}, nhưng tiền chưa được nhận. Để nhận tiền, bạn hãy mở {wallet} hoặc đăng ký bằng đúng email hoặc số điện thoại đã cho chúng tôi. Nếu cần giúp, bạn cứ trả lời tin nhắn này.',
    declined_with_appeal:
      'Rất tiếc, theo quy định hiện tại của nhóm, chúng tôi chưa thể gửi tiền cho yêu cầu này. Đây không phải là đánh giá về bạn. Nếu bạn muốn một tình nguyện viên xem lại, xin trả lời tin nhắn này.',
    needs_info: '[[Chào {name}. ]]Một tình nguyện viên có một câu hỏi ngắn về yêu cầu của bạn. Bạn vui lòng trả lời ở đây khi tiện nhé.',
  },
  ht: {
    readback_intro: 'Men sa nou konprann. Tanpri di nou si se sa:',
    ask_payout: 'Ki kote pou nou voye lajan an? Ou ka ban nou yon imèl PayPal oswa yon non itilizatè Venmo.',
    ask_household: 'Konbyen moun ki rete lakay ou, ansanm avè w?',
    confirmed_waiting: 'Mèsi. De volontè ap gade demann ou an kounye a. N ap voye yon mesaj ba ou depi yo deside.',
    approved_sending: 'Bon nouvèl: yo apwouve demann ou an. N ap voye {amount} sou {wallet} ou kounye a.',
    paid: '[[Bonjou {name}. ]]Nou voye {amount} sou {wallet} ou. Nou espere sa ap ede w. Pran swen tèt ou.',
    unclaimed_help:
      'Nou voye {amount} sou {wallet}, men ou poko resevwa l. Pou w jwenn li, louvri {wallet} oswa enskri ak menm imèl oswa nimewo telefòn ou te ban nou an. Si w bezwen èd, reponn mesaj sa a.',
    declined_with_appeal:
      'Nou regrèt. Avèk règ gwoup la kounye a, nou pa t ka voye lajan pou demann sa a. Sa pa yon jijman sou ou. Si w vle yon volontè gade l ankò, reponn mesaj sa a.',
    needs_info: '[[Bonjou {name}. ]]Yon volontè gen yon ti kesyon sou demann ou an. Tanpri reponn isit la lè w kapab.',
  },
  zh: {
    readback_intro: '以下是我们理解的内容，请确认是否正确：',
    ask_payout: '钱应该汇到哪里？您可以提供 PayPal 邮箱或 Venmo 用户名。',
    ask_household: '您家里一共住几个人（包括您自己）？',
    confirmed_waiting: '谢谢您。两位志愿者正在查看您的申请，一有结果我们就会通知您。',
    approved_sending: '好消息：您的申请已获批准。我们正在把 {amount} 汇到您的 {wallet}。',
    paid: '[[{name}，您好。]]{amount} 已汇到您的 {wallet}。希望能帮上忙，请多保重。',
    unclaimed_help:
      '我们已通过 {wallet} 汇出 {amount}，但这笔钱还没有被领取。请打开 {wallet}，或用您提供给我们的同一个邮箱或电话号码注册，即可领取。如需帮助，请直接回复这条消息。',
    declined_with_appeal:
      '很抱歉，按照小组目前的规则，我们无法为这项申请汇款。这并不是对您的评判。如果您希望志愿者重新查看，请回复这条消息。',
    needs_info: '[[{name}，您好。]]一位志愿者对您的申请有个简单的问题，方便时请在这里回复。',
  },
  ar: {
    readback_intro: 'هذا ما فهمناه. من فضلك أخبرنا إن كان صحيحًا:',
    ask_payout: 'إلى أين نرسل المال؟ يمكنك أن تعطينا بريدًا إلكترونيًا لحساب PayPal أو اسم مستخدم في Venmo.',
    ask_household: 'كم شخصًا يعيش في بيتك، بمن فيهم أنت؟',
    confirmed_waiting: 'شكرًا لك. يراجع طلبك الآن متطوعان اثنان. سنرسل لك رسالة فور اتخاذ القرار.',
    approved_sending: 'أخبار سارة: تمت الموافقة على طلبك. نرسل الآن {amount} إلى حسابك في {wallet}.',
    paid: '[[مرحبًا {name}. ]]تم إرسال {amount} إلى حسابك في {wallet}. نتمنى أن يساعدك ذلك. اعتنِ بنفسك.',
    unclaimed_help:
      'أرسلنا {amount} عبر {wallet}، لكن المبلغ لم يُستلم بعد. لاستلامه، افتح {wallet} أو سجّل بنفس البريد الإلكتروني أو رقم الهاتف الذي أعطيتنا إياه. إذا احتجت إلى مساعدة، رُدّ على هذه الرسالة.',
    declined_with_appeal:
      'نأسف، لم نتمكن من إرسال مال لهذا الطلب حسب قواعد المجموعة الحالية. هذا ليس حكمًا عليك. إذا أردت أن يراجعه أحد المتطوعين مرة أخرى، رُدّ على هذه الرسالة.',
    needs_info: '[[مرحبًا {name}. ]]لدى أحد المتطوعين سؤال قصير عن طلبك. من فضلك رُدّ هنا عندما تستطيع.',
  },
};

export class MissingTemplateVarError extends Error {
  constructor(readonly key: MessageKey, readonly lang: string, readonly variable: string) {
    super(`template '${key}' (${lang}) needs {${variable}}`);
    this.name = 'MissingTemplateVarError';
  }
}

export const isCatalogLang = (lang: string): lang is CatalogLang => (CATALOG_LANGS as readonly string[]).includes(lang);

/** Language actually used for `lang` (falls back to English, e.g. for 'fr', 'ko'). */
export const resolveLang = (lang: Lang | string): CatalogLang => {
  const primary = lang.toLowerCase().split(/[-_]/)[0] ?? 'en';
  return isCatalogLang(primary) ? primary : 'en';
};

export const textDirection = (lang: Lang | string): 'rtl' | 'ltr' => (resolveLang(lang) === 'ar' ? 'rtl' : 'ltr');

const SLOT = /\{(\w+)\}/g;
const filled = (v: string | undefined): v is string => v !== undefined && v.trim() !== '';

/** Slots a template needs (outside optional [[ ]] segments). */
export function requiredSlots(template: string): string[] {
  return [...template.replace(/\[\[[\s\S]*?\]\]/g, '').matchAll(SLOT)].map((m) => m[1] as string);
}

/**
 * Render a message. Falls back to English for languages without a catalog. Throws
 * MissingTemplateVarError if a required slot is missing — a "paid" text without an amount is a bug.
 */
export function render(key: MessageKey, lang: Lang | string, vars: TemplateVars = {}): string {
  const l = resolveLang(lang);
  const template = CATALOG[l][key];
  const withOptional = template.replace(/\[\[([\s\S]*?)\]\]/g, (_, seg: string) =>
    [...seg.matchAll(SLOT)].every((m) => filled(vars[m[1] as keyof TemplateVars])) ? seg : '',
  );
  return withOptional.replace(SLOT, (_, name: string) => {
    const v = vars[name as keyof TemplateVars];
    if (!filled(v)) throw new MissingTemplateVarError(key, l, name);
    return v.trim();
  });
}

/** Display name of a wallet in the requester's language (brand names are not translated). */
export const walletName = (wallet: 'PAYPAL' | 'VENMO'): string => (wallet === 'VENMO' ? 'Venmo' : 'PayPal');
