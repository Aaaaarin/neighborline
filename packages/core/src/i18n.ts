/**
 * Vetted requester-notification templates. The NotifyAgent fills slots; it never writes free text
 * about money. Slots: {amount} {wallet} {name}. A segment wrapped in [[ ]] is dropped when any
 * slot inside it is missing (used for the optional greeting "Hi {name}.").
 *
 * Every intake language has a table. fr / tl / ko / ru were added after the first native-speaker
 * packet (machine-assisted, pending native review: see docs/submission/review). Vietnamese also has
 * register variants for elders and peers (i18n-vi.ts, address.ts), chosen by the extracted address form.
 */
import { addressed, viRegister } from './address.js';
import { VI_CATALOG_REGISTERS } from './i18n-vi.js';
import { RAIL_REFUSED_NOTICE } from './rail-notice.js';
import type { AddressForm, Lang } from './schemas.js';

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
  'payout_rail_refused',
] as const;
export type MessageKey = (typeof MESSAGE_KEYS)[number];

export const CATALOG_LANGS = ['en', 'es', 'vi', 'ht', 'zh', 'ar', 'fr', 'tl', 'ko', 'ru'] as const;
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
    payout_rail_refused: RAIL_REFUSED_NOTICE.en,
  },
  es: {
    readback_intro: 'Esto es lo que entendí. Por favor, dígame si está bien:',
    ask_payout: '¿A dónde le enviamos el dinero? Puede darnos un correo de PayPal o un usuario de Venmo.',
    ask_household: '¿Cuántas personas en total viven en su casa (usted también cuenta)?',
    confirmed_waiting: 'Gracias. Dos personas del grupo están revisando su solicitud. Le avisaremos en cuanto decidan.',
    approved_sending: 'Buenas noticias: su solicitud fue aprobada. Le estamos enviando {amount} a su {wallet}.',
    paid: '[[Hola, {name}. ]]Ya le enviamos {amount} a su {wallet}. Esperamos que le ayude. Cuídese mucho.',
    unclaimed_help:
      'Le enviamos {amount} por {wallet}, pero todavía no lo ha cobrado. Para recibirlo, abra {wallet} o regístrese con el mismo correo o número de teléfono que nos dio. Si necesita ayuda, responda a este mensaje.',
    declined_with_appeal:
      'Lo sentimos. Con las reglas actuales del grupo no pudimos enviar dinero para esta solicitud. No es un juicio sobre usted. Si quiere que otra persona del grupo la revise de nuevo, responda a este mensaje.',
    needs_info: '[[Hola, {name}. ]]Una persona del grupo tiene una pregunta rápida sobre su solicitud. Por favor, responda aquí cuando pueda.',
    payout_rail_refused: RAIL_REFUSED_NOTICE.es,
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
    payout_rail_refused: RAIL_REFUSED_NOTICE.vi,
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
    payout_rail_refused: RAIL_REFUSED_NOTICE.ht,
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
    payout_rail_refused: RAIL_REFUSED_NOTICE.zh,
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
    payout_rail_refused: RAIL_REFUSED_NOTICE.ar,
  },
  fr: {
    readback_intro: 'Voici ce que nous avons compris. Dites-nous si c’est juste :',
    ask_payout: 'Où devons-nous envoyer l’argent ? Vous pouvez nous donner une adresse e-mail PayPal ou un nom d’utilisateur Venmo.',
    ask_household: 'Combien de personnes vivent chez vous, en vous comptant ?',
    confirmed_waiting: 'Merci. Deux bénévoles examinent votre demande en ce moment. Nous vous écrirons dès qu’une décision sera prise.',
    approved_sending: 'Bonne nouvelle : votre demande a été approuvée. Nous envoyons maintenant {amount} sur votre {wallet}.',
    paid: '[[Bonjour {name}. ]]Nous avons envoyé {amount} sur votre {wallet}. Nous espérons que cela vous aidera. Prenez soin de vous.',
    unclaimed_help:
      'Nous avons envoyé {amount} via {wallet}, mais l’argent n’a pas encore été récupéré. Pour le recevoir, ouvrez {wallet} ou inscrivez-vous avec la même adresse e-mail ou le même numéro de téléphone que vous nous avez donné. Si vous avez besoin d’aide, répondez à ce message.',
    declined_with_appeal:
      'Nous sommes désolés. Avec les règles actuelles du groupe, nous n’avons pas pu envoyer d’argent pour cette demande. Ce n’est pas un jugement sur vous. Si vous souhaitez qu’une autre personne du groupe la réexamine, répondez à ce message.',
    needs_info: '[[Bonjour {name}. ]]Une personne du groupe a une petite question sur votre demande. Répondez ici quand vous le pourrez, s’il vous plaît.',
    payout_rail_refused: RAIL_REFUSED_NOTICE.fr,
  },
  tl: {
    readback_intro: 'Ito ang pagkakaintindi namin. Pakisabi kung tama:',
    ask_payout: 'Saan namin ipapadala ang pera? Puwede mong ibigay ang email mo sa PayPal o ang username mo sa Venmo.',
    ask_household: 'Ilan kayong nakatira sa bahay, kasama ka?',
    confirmed_waiting: 'Salamat. Tinitingnan na ngayon ng dalawang boluntaryo ang iyong kahilingan. Magme-message kami sa iyo agad kapag may desisyon na.',
    approved_sending: 'Magandang balita: naaprubahan ang iyong kahilingan. Ipinapadala na namin ang {amount} sa iyong {wallet}.',
    paid: '[[Kumusta, {name}. ]]Naipadala na ang {amount} sa iyong {wallet}. Sana makatulong ito. Mag-ingat ka.',
    unclaimed_help:
      'Nagpadala kami ng {amount} sa {wallet}, pero hindi pa ito nakukuha. Para makuha ito, buksan ang {wallet} o mag-sign up gamit ang parehong email o numero ng telepono na ibinigay mo sa amin. Sumagot dito kung kailangan mo ng tulong.',
    declined_with_appeal:
      'Paumanhin. Ayon sa kasalukuyang patakaran ng grupo, hindi kami makapagpadala ng pera para sa kahilingang ito. Hindi ito paghusga sa iyo. Sumagot dito kung gusto mong tingnan ulit ito ng isang boluntaryo.',
    needs_info: '[[Kumusta, {name}. ]]May maikling tanong ang isang boluntaryo tungkol sa iyong kahilingan. Pakisagot dito kapag may oras ka.',
    payout_rail_refused: RAIL_REFUSED_NOTICE.tl,
  },
  ko: {
    readback_intro: '저희가 이해한 내용은 이렇습니다. 맞는지 알려 주세요:',
    ask_payout: '돈을 어디로 보내 드릴까요? PayPal 이메일이나 Venmo 사용자 이름을 알려 주세요.',
    ask_household: '본인을 포함해서 집에 몇 분이 사시나요?',
    confirmed_waiting: '감사합니다. 지금 봉사자 두 명이 요청을 살펴보고 있어요. 결정되는 대로 바로 메시지 드릴게요.',
    approved_sending: '좋은 소식이에요. 요청이 승인되어 지금 {wallet}로 {amount}를 보내 드리고 있어요.',
    paid: '[[{name} 님, 안녕하세요. ]]{wallet}로 {amount}를 보내 드렸어요. 도움이 되길 바랍니다. 건강 조심하세요.',
    unclaimed_help:
      '{wallet}로 {amount}를 보내 드렸는데, 아직 받지 않으셨어요. 받으시려면 {wallet} 앱을 여시거나, 알려 주신 이메일이나 전화번호로 가입해 주세요. 도움이 필요하시면 여기로 답장해 주세요.',
    declined_with_appeal:
      '죄송합니다. 그룹의 현재 규칙으로는 이 요청에 돈을 보내 드릴 수 없었어요. 본인에 대한 평가가 아니에요. 봉사자가 다시 한번 살펴보길 원하시면 여기로 답장해 주세요.',
    needs_info: '[[{name} 님, 안녕하세요. ]]봉사자 한 명이 요청에 대해 간단히 여쭤볼 것이 있어요. 편하실 때 여기로 답장해 주세요.',
    payout_rail_refused: RAIL_REFUSED_NOTICE.ko,
  },
  ru: {
    readback_intro: 'Вот как мы вас поняли. Скажите, пожалуйста, всё ли верно:',
    ask_payout: 'Куда отправить деньги? Укажите email вашего PayPal или имя пользователя в Venmo.',
    ask_household: 'Сколько человек живёт у вас дома, включая вас?',
    confirmed_waiting: 'Спасибо. Сейчас два волонтёра рассматривают вашу просьбу. Мы напишем вам, как только будет решение.',
    approved_sending: 'Хорошая новость: ваша просьба одобрена. Сейчас мы отправляем {amount} на ваш {wallet}.',
    paid: '[[Здравствуйте, {name}. ]]Мы отправили {amount} на ваш {wallet}. Надеемся, это поможет. Берегите себя.',
    unclaimed_help:
      'Мы отправили {amount} через {wallet}, но деньги ещё не получены. Чтобы их получить, откройте {wallet} или зарегистрируйтесь с тем же email или номером телефона, который вы нам дали. Если нужна помощь, ответьте на это сообщение.',
    declined_with_appeal:
      'Нам очень жаль. По текущим правилам группы мы не смогли отправить деньги по этой просьбе. Это не оценка вас лично. Если хотите, чтобы кто-то из волонтёров посмотрел её ещё раз, ответьте на это сообщение.',
    needs_info: '[[Здравствуйте, {name}. ]]У одного из волонтёров есть короткий вопрос о вашей просьбе. Пожалуйста, ответьте здесь, когда сможете.',
    payout_rail_refused: RAIL_REFUSED_NOTICE.ru,
  },
};

export class MissingTemplateVarError extends Error {
  constructor(readonly key: MessageKey, readonly lang: string, readonly variable: string) {
    super(`template '${key}' (${lang}) needs {${variable}}`);
    this.name = 'MissingTemplateVarError';
  }
}

export const isCatalogLang = (lang: string): lang is CatalogLang => (CATALOG_LANGS as readonly string[]).includes(lang);

/** Language actually used for `lang` (falls back to English for anything outside the ten, e.g. 'pt'). */
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

export interface RenderOptions {
  /** Vietnamese only: picks the elder / peer variant and fills {you} / {You} (address.ts). */
  addressForm?: AddressForm | null | undefined;
}

/** The template for this key, language and (Vietnamese) address form, with {you} / {You} filled. */
export function templateFor(key: MessageKey, lang: Lang | string, opts: RenderOptions = {}): string {
  const l = resolveLang(lang);
  const reg = l === 'vi' ? viRegister(opts.addressForm) : 'neutral';
  const template = reg === 'elder' ? VI_CATALOG_REGISTERS.viElder[key] : reg === 'peer' ? VI_CATALOG_REGISTERS.viPeer[key] : CATALOG[l][key];
  return addressed(template, opts.addressForm);
}

/**
 * Render a message. Falls back to English for languages without a catalog. Throws
 * MissingTemplateVarError if a required slot is missing — a "paid" text without an amount is a bug.
 */
export function render(key: MessageKey, lang: Lang | string, vars: TemplateVars = {}, opts: RenderOptions = {}): string {
  const l = resolveLang(lang);
  const template = templateFor(key, l, opts);
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
