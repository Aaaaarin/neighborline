/**
 * Requester-facing status copy for the web line: acknowledgement, sending, paid with a transaction id,
 * claim help, the generic read-back and the blocked reply. Written natively per language (en, es, vi,
 * ht, ar; zh, fr, tl, ko, ru machine-assisted and pending native review). Arabic is Modern Standard,
 * with handles and ids isolated left-to-right.
 *
 * Vietnamese has register variants (core address.ts): `viElder` for bà / ông / cô / chú / bác (the
 * volunteers are "chúng cháu", with "ạ") and `viPeer` for anh / chị / em; {you} / {You} are filled with
 * the form. Without a form the neutral `vi` ("bạn") is used. Slots are filled by code, never a model.
 */
import type { Lang, WithViRegisters } from '@neighborline/core';

export interface Slots {
  amount: string;
  wallet: 'PAYPAL' | 'VENMO';
  receiver: string;
  tx?: string;
}
/** Slots with the transaction id resolved (empty when there is none). */
export type FilledSlots = Slots & { tx: string };

export const w = (wallet: 'PAYPAL' | 'VENMO') => (wallet === 'VENMO' ? 'Venmo' : 'PayPal');

export const ACK: WithViRegisters<string> = {
  en: 'Thank you. Two people from the group are looking at your request now. It usually takes a few minutes — we’ll message you the moment the money is sent.',
  es: 'Gracias. Dos personas del grupo están revisando su solicitud. Suele tardar unos minutos; le escribimos en cuanto se envíe el dinero.',
  vi: 'Cảm ơn bạn. Hai người trong nhóm đang xem yêu cầu của bạn. Thường chỉ mất vài phút — gửi tiền xong là chúng tôi nhắn ngay.',
  viElder: 'Cảm ơn {you} ạ. Hai người trong nhóm đang xem yêu cầu của {you}. Thường chỉ mất vài phút — gửi tiền xong là chúng cháu nhắn {you} ngay ạ.',
  viPeer: 'Cảm ơn {you}. Hai người trong nhóm đang xem yêu cầu của {you}. Thường chỉ mất vài phút — gửi tiền xong là chúng tôi nhắn ngay.',
  ht: 'Mèsi. De moun nan gwoup la ap gade demann ou an kounye a. Sa konn pran kèk minit; n ap ekri w touswit lè lajan an pati.',
  ar: 'شكرًا لك. شخصان من المجموعة يراجعان طلبك الآن. يستغرق ذلك عادةً بضع دقائق، وسنراسلك فور إرسال المال.',
  zh: '谢谢您。小组里的两个人正在查看您的申请。通常只需要几分钟，钱一汇出我们就马上通知您。',
  fr: 'Merci. Deux personnes du groupe regardent votre demande en ce moment. Cela prend en général quelques minutes ; nous vous écrirons dès que l’argent sera envoyé.',
  tl: 'Salamat. Tinitingnan na ngayon ng dalawang tao mula sa grupo ang iyong kahilingan. Karaniwang ilang minuto lang ito — magme-message kami sa iyo pagkapadala ng pera.',
  ko: '감사합니다. 그룹의 두 사람이 지금 요청을 살펴보고 있어요. 보통 몇 분이면 되고, 돈이 보내지면 바로 메시지 드릴게요.',
  ru: 'Спасибо. Сейчас два человека из группы смотрят вашу просьбу. Обычно это занимает несколько минут — мы напишем вам, как только деньги будут отправлены.',
};

export const SENDING: WithViRegisters<string> = {
  en: 'Two neighbors said yes. Sending the money through PayPal now…',
  es: 'Dos vecinos dijeron que sí. Enviando el dinero por PayPal…',
  vi: 'Hai người trong nhóm đã đồng ý. Đang gửi tiền qua PayPal…',
  viElder: 'Hai người trong nhóm đã đồng ý rồi ạ. Chúng cháu đang gửi tiền qua PayPal…',
  ht: 'De vwazen di wi. N ap voye lajan an pa PayPal kounye a…',
  ar: 'وافق اثنان من الجيران. نرسل المال عبر PayPal الآن…',
  zh: '两位邻居已经同意了。正在通过 PayPal 汇款…',
  fr: 'Deux voisins ont dit oui. Envoi de l’argent par PayPal en cours…',
  tl: 'Pumayag na ang dalawang kapitbahay. Ipinapadala na ang pera sa PayPal…',
  ko: '이웃 두 명이 승인했어요. 지금 PayPal로 돈을 보내고 있어요…',
  ru: 'Двое соседей сказали «да». Отправляем деньги через PayPal…',
};

export const NEEDS_PAYOUT: WithViRegisters<string> = {
  en: 'Where should we send the money? Reply with your Venmo username or the email or phone number on your PayPal.',
  es: '¿A dónde le enviamos el dinero? Responda con su usuario de Venmo, o el correo o teléfono de su PayPal.',
  vi: 'Chúng tôi nên gửi tiền vào đâu ạ? Bạn nhắn tên Venmo, hoặc email hay số điện thoại dùng cho PayPal.',
  viElder: 'Chúng cháu nên gửi tiền vào đâu ạ? {You} nhắn giúp chúng cháu tên Venmo, hoặc email hay số điện thoại dùng cho PayPal của {you} nhé.',
  viPeer: 'Chúng tôi nên gửi tiền vào đâu? {You} nhắn tên Venmo, hoặc email hay số điện thoại dùng cho PayPal.',
  ht: 'Ki kote pou nou voye lajan an? Reponn ak non Venmo ou, oswa imèl oswa nimewo telefòn PayPal ou.',
  ar: 'إلى أين نرسل المال؟ أرسل اسم المستخدم في Venmo، أو البريد الإلكتروني أو رقم الهاتف المرتبط بحسابك في PayPal.',
  zh: '钱应该汇到哪里？请回复您的 Venmo 用户名，或您 PayPal 账户的邮箱或电话号码。',
  fr: 'Où devons-nous envoyer l’argent ? Répondez avec votre nom d’utilisateur Venmo, ou l’e-mail ou le numéro de téléphone de votre compte PayPal.',
  tl: 'Saan namin ipapadala ang pera? Sumagot gamit ang username mo sa Venmo, o ang email o numero ng telepono ng PayPal mo.',
  ko: '돈을 어디로 보내 드릴까요? Venmo 사용자 이름이나 PayPal에 등록된 이메일 또는 전화번호로 답장해 주세요.',
  ru: 'Куда отправить деньги? Ответьте, указав имя пользователя Venmo или email либо номер телефона вашего PayPal.',
};

export const PAID: WithViRegisters<(s: FilledSlots) => string> = {
  en: (s) => `Sent ${s.amount} to your ${w(s.wallet)} (${s.receiver}). Transaction ${s.tx}. If you don’t see it, just reply here.`,
  es: (s) => `Listo: enviamos ${s.amount} a su ${w(s.wallet)} (${s.receiver}). Transacción ${s.tx}. Si no lo ve, responda aquí.`,
  vi: (s) => `Đã gửi ${s.amount} vào ${w(s.wallet)} của bạn (${s.receiver}). Mã giao dịch ${s.tx}. Nếu chưa thấy tiền, cứ nhắn lại đây.`,
  viElder: (s) => `Chúng cháu đã gửi ${s.amount} vào ${w(s.wallet)} của {you} (${s.receiver}). Mã giao dịch ${s.tx}. Nếu chưa thấy tiền, {you} cứ nhắn lại đây ạ.`,
  viPeer: (s) => `Đã gửi ${s.amount} vào ${w(s.wallet)} của {you} (${s.receiver}). Mã giao dịch ${s.tx}. Nếu chưa thấy tiền, {you} cứ nhắn lại đây.`,
  ht: (s) => `Nou voye ${s.amount} sou ${w(s.wallet)} ou (${s.receiver}). Tranzaksyon ${s.tx}. Si ou pa wè l, reponn isit la.`,
  ar: (s) => `أرسلنا ${s.amount} إلى حسابك في ${w(s.wallet)} (⁦${s.receiver}⁩). رقم العملية ⁦${s.tx}⁩. إن لم يظهر المبلغ، ردّ هنا.`,
  zh: (s) => `已将 ${s.amount} 汇到您的 ${w(s.wallet)}（${s.receiver}）。交易编号 ${s.tx}。如果没看到这笔钱，请直接在这里回复。`,
  fr: (s) => `Nous avons envoyé ${s.amount} sur votre ${w(s.wallet)} (${s.receiver}). Transaction ${s.tx}. Si vous ne voyez pas l’argent, répondez simplement ici.`,
  tl: (s) => `Naipadala na ang ${s.amount} sa iyong ${w(s.wallet)} (${s.receiver}). Transaksyon ${s.tx}. Kung hindi mo pa ito nakikita, sumagot lang dito.`,
  ko: (s) => `${w(s.wallet)}(${s.receiver})로 ${s.amount}를 보내 드렸어요. 거래 번호 ${s.tx}. 보이지 않으면 여기로 답장해 주세요.`,
  ru: (s) => `Мы отправили ${s.amount} на ваш ${w(s.wallet)} (${s.receiver}). Номер операции ${s.tx}. Если вы не видите деньги, просто ответьте здесь.`,
};

export const CLAIM_HELP: WithViRegisters<(s: FilledSlots) => string> = {
  en: (s) => `We sent ${s.amount} to ${s.receiver}, but that email doesn’t have a PayPal account yet. To get it: open paypal.com, sign up with that same email, and confirm it. The money waits for you for 30 days. Want us to call and walk you through it? Reply CALL.`,
  es: (s) => `Le enviamos ${s.amount} a ${s.receiver}, pero ese correo todavía no tiene cuenta de PayPal. Para recibirlo: abra paypal.com, cree una cuenta con ese mismo correo y confírmelo. El dinero se guarda para usted durante 30 días. ¿Quiere que le llamemos y le ayudemos paso a paso? Responda LLAMAR.`,
  vi: (s) => `Chúng tôi đã gửi ${s.amount} tới ${s.receiver}, nhưng email này chưa có tài khoản PayPal. Để nhận tiền: vào paypal.com, đăng ký bằng đúng email này rồi xác nhận. Tiền sẽ được giữ cho bạn trong 30 ngày. Cần chúng tôi gọi điện hướng dẫn không? Nhắn GỌI.`,
  viElder: (s) => `Chúng cháu đã gửi ${s.amount} tới ${s.receiver}, nhưng email này chưa có tài khoản PayPal. Để nhận tiền: {you} vào paypal.com, đăng ký bằng đúng email này rồi xác nhận. Tiền sẽ được giữ cho {you} trong 30 ngày. {You} có cần chúng cháu gọi điện hướng dẫn không ạ? {You} nhắn GỌI là được.`,
  viPeer: (s) => `Chúng tôi đã gửi ${s.amount} tới ${s.receiver}, nhưng email này chưa có tài khoản PayPal. Để nhận tiền: {you} vào paypal.com, đăng ký bằng đúng email này rồi xác nhận. Tiền sẽ được giữ cho {you} trong 30 ngày. {You} cần chúng tôi gọi điện hướng dẫn không? Nhắn GỌI.`,
  ht: (s) => `Nou voye ${s.amount} bay ${s.receiver}, men imèl sa a poko gen kont PayPal. Pou w resevwa l: louvri paypal.com, kreye yon kont ak menm imèl la epi konfime l. Lajan an ap tann ou 30 jou. Ou vle nou rele w pou ede w? Reponn RELE.`,
  ar: (s) => `أرسلنا ${s.amount} إلى ⁦${s.receiver}⁩، لكن هذا البريد الإلكتروني ليس له حساب PayPal بعد. لاستلام المال: افتح paypal.com، وأنشئ حسابًا بالبريد الإلكتروني نفسه، ثم أكّده. يبقى المال بانتظارك 30 يومًا. هل تريد أن نتصل بك لنساعدك خطوة بخطوة؟ ردّ بكلمة اتصال.`,
  zh: (s) => `我们已向 ${s.receiver} 汇出 ${s.amount}，但这个邮箱还没有 PayPal 账户。领取方法：打开 paypal.com，用同一个邮箱注册并完成验证。这笔钱会为您保留 30 天。需要我们打电话一步一步帮您吗？请回复“电话”。`,
  fr: (s) => `Nous avons envoyé ${s.amount} à ${s.receiver}, mais cette adresse e-mail n’a pas encore de compte PayPal. Pour recevoir l’argent : ouvrez paypal.com, inscrivez-vous avec cette même adresse et confirmez-la. L’argent vous attend pendant 30 jours. Voulez-vous que nous vous appelions pour vous guider ? Répondez APPEL.`,
  tl: (s) => `Nagpadala kami ng ${s.amount} sa ${s.receiver}, pero wala pang PayPal account ang email na iyon. Para makuha ito: buksan ang paypal.com, mag-sign up gamit ang parehong email, at kumpirmahin ito. Itatabi ang pera para sa iyo nang 30 araw. Gusto mo bang tawagan ka namin para gabayan ka? Sumagot ng TAWAG.`,
  ko: (s) => `${s.receiver}로 ${s.amount}를 보내 드렸지만, 이 이메일에는 아직 PayPal 계정이 없어요. 받으시려면 paypal.com에 들어가 같은 이메일로 가입하고 이메일 인증을 해 주세요. 돈은 30일 동안 보관돼요. 저희가 전화로 하나씩 도와드릴까요? ‘전화’라고 답장해 주세요.`,
  ru: (s) => `Мы отправили ${s.amount} на ${s.receiver}, но у этого email ещё нет аккаунта PayPal. Чтобы получить деньги, откройте paypal.com, зарегистрируйтесь с этим же email и подтвердите его. Деньги будут ждать вас 30 дней. Хотите, мы позвоним и всё объясним по шагам? Ответьте ЗВОНОК.`,
};

export const CLAIMED: WithViRegisters<(s: FilledSlots) => string> = {
  en: (s) => `It worked — the ${s.amount} is in your PayPal now. Thank you for your patience.`,
  es: (s) => `¡Ya está! Los ${s.amount} llegaron a su PayPal. Gracias por su paciencia.`,
  vi: (s) => `Xong rồi — ${s.amount} đã vào PayPal của bạn. Cảm ơn bạn đã kiên nhẫn chờ.`,
  viElder: (s) => `Xong rồi ạ — ${s.amount} đã vào PayPal của {you}. Cảm ơn {you} đã kiên nhẫn chờ.`,
  viPeer: (s) => `Xong rồi — ${s.amount} đã vào PayPal của {you}. Cảm ơn {you} đã kiên nhẫn chờ.`,
  ht: (s) => `Sa mache — ${s.amount} yo nan PayPal ou kounye a. Mèsi pou pasyans ou.`,
  ar: (s) => `تمّ الأمر، وصل ${s.amount} إلى حسابك في PayPal. شكرًا لصبرك.`,
  zh: (s) => `成功了——${s.amount} 已经到您的 PayPal 了。谢谢您耐心等待。`,
  fr: (s) => `Ça y est : les ${s.amount} sont maintenant sur votre PayPal. Merci de votre patience.`,
  tl: (s) => `Ayos na — nasa PayPal mo na ang ${s.amount}. Salamat sa iyong pasensya.`,
  ko: (s) => `잘 됐어요. 이제 ${s.amount}가 PayPal에 들어가 있어요. 기다려 주셔서 감사합니다.`,
  ru: (s) => `Получилось — ${s.amount} уже на вашем PayPal. Спасибо за терпение.`,
};

/** The two tappable answers under a read-back (the same words as the web UI's yes / fix buttons). */
export const QUICK_REPLIES: Readonly<Record<Lang, { yes: string; fix: string }>> = {
  en: { yes: 'Yes, that’s right', fix: 'Fix something' },
  es: { yes: 'Sí, correcto', fix: 'Corregir' },
  vi: { yes: 'Đúng rồi', fix: 'Sửa lại' },
  ht: { yes: 'Wi, se sa', fix: 'Korije' },
  ar: { yes: 'نعم، هذا صحيح', fix: 'أريد تصحيح شيء' },
  zh: { yes: '对，没错', fix: '需要修改' },
  fr: { yes: 'Oui, c’est bien ça', fix: 'Corriger' },
  tl: { yes: 'Oo, tama', fix: 'May aayusin' },
  ko: { yes: '네, 맞아요', fix: '고칠 게 있어요' },
  ru: { yes: 'Да, всё верно', fix: 'Исправить' },
};

export interface ReadbackSlots {
  summary: string;
  categoryLabel: string;
  cap: string;
  dest: string;
}

/** Read-back for free text in fixture mode (no live translation available). */
export const GENERIC_READBACK: WithViRegisters<(s: ReadbackSlots) => string> = {
  en: (s) => `Here’s what we understood: “${s.summary}”. That fits ${s.categoryLabel}; the group’s rules allow up to ${s.cap}.${s.dest ? ` We’d send it to ${s.dest}.` : ''} Is that right?`,
  es: (s) => `Esto es lo que entendimos: «${s.summary}». Corresponde a ${s.categoryLabel}; las reglas del grupo permiten hasta ${s.cap}.${s.dest ? ` Lo enviaríamos a ${s.dest}.` : ''} ¿Es correcto?`,
  vi: (s) => `Chúng tôi hiểu như sau: “${s.summary}”. Thuộc mục ${s.categoryLabel}; quy định của nhóm cho phép tới ${s.cap}.${s.dest ? ` Tiền sẽ gửi vào ${s.dest}.` : ''} Đúng không ạ?`,
  viElder: (s) => `Dạ, chúng cháu hiểu như sau: “${s.summary}”. Thuộc mục ${s.categoryLabel}; quy định của nhóm cho phép tới ${s.cap}.${s.dest ? ` Tiền sẽ gửi vào ${s.dest}.` : ''} {You} xem có đúng không ạ?`,
  viPeer: (s) => `Chúng tôi hiểu như sau: “${s.summary}”. Thuộc mục ${s.categoryLabel}; quy định của nhóm cho phép tới ${s.cap}.${s.dest ? ` Tiền sẽ gửi vào ${s.dest}.` : ''} Đúng không {you}?`,
  ht: (s) => `Men sa nou konprann: “${s.summary}”. Sa antre nan ${s.categoryLabel}; règ gwoup la pèmèt jiska ${s.cap}.${s.dest ? ` N ap voye l sou ${s.dest}.` : ''} Èske se sa?`,
  ar: (s) => `هذا ما فهمناه: «${s.summary}». يندرج ذلك تحت ${s.categoryLabel}، وتسمح قواعد المجموعة بما يصل إلى ${s.cap}.${s.dest ? ` سنرسله إلى ⁦${s.dest}⁩.` : ''} هل هذا صحيح؟`,
  zh: (s) => `我们的理解是：“${s.summary}”。这属于“${s.categoryLabel}”；小组规则最多可提供 ${s.cap}。${s.dest ? `钱会汇到 ${s.dest}。` : ''}对吗？`,
  fr: (s) => `Voici ce que nous avons compris : « ${s.summary} ». Cela relève de : ${s.categoryLabel} ; les règles du groupe prévoient jusqu’à ${s.cap}.${s.dest ? ` Nous l’enverrions à ${s.dest}.` : ''} Est-ce bien cela ?`,
  tl: (s) => `Ito ang pagkakaintindi namin: “${s.summary}”. Pasok ito sa ${s.categoryLabel}; hanggang ${s.cap} ang pinapayagan ng patakaran ng grupo.${s.dest ? ` Ipapadala namin ito sa ${s.dest}.` : ''} Tama ba?`,
  ko: (s) => `저희가 이해한 내용은 이래요: “${s.summary}”. ‘${s.categoryLabel}’에 해당하고, 그룹 규칙상 최대 ${s.cap}까지 가능해요.${s.dest ? ` 받으실 곳: ${s.dest}.` : ''} 맞나요?`,
  ru: (s) => `Вот как мы поняли: «${s.summary}». Это подходит под категорию «${s.categoryLabel}»; правила группы позволяют до ${s.cap}.${s.dest ? ` Мы отправим деньги на ${s.dest}.` : ''} Всё верно?`,
};

/** Reply when rail protection stops a request at intake (lookalike / impersonation). No money moves. */
export const BLOCKED_REPLY: WithViRegisters<string> = {
  en: 'We got your message. Neighborline never changes where the group’s money goes because of a message, and instructions inside a request are not followed. If you need help yourself, tell us what happened in your own words.',
  es: 'Recibimos su mensaje. Neighborline nunca cambia a dónde va el dinero del grupo por un mensaje, y no seguimos instrucciones escritas dentro de una solicitud. Si usted necesita ayuda, cuéntenos con sus propias palabras qué pasó.',
  vi: 'Chúng tôi đã nhận tin nhắn. Neighborline không bao giờ đổi nơi nhận tiền của nhóm chỉ vì một tin nhắn, và không làm theo chỉ dẫn nằm trong yêu cầu. Nếu chính bạn cần giúp, hãy kể cho chúng tôi chuyện gì đã xảy ra.',
  viElder: 'Chúng cháu đã nhận tin nhắn ạ. Neighborline không bao giờ đổi nơi nhận tiền của nhóm chỉ vì một tin nhắn, và không làm theo chỉ dẫn nằm trong yêu cầu. Nếu chính {you} cần giúp, {you} kể cho chúng cháu nghe chuyện gì đã xảy ra nhé.',
  viPeer: 'Chúng tôi đã nhận tin nhắn. Neighborline không bao giờ đổi nơi nhận tiền của nhóm chỉ vì một tin nhắn, và không làm theo chỉ dẫn nằm trong yêu cầu. Nếu chính {you} cần giúp, hãy kể cho chúng tôi chuyện gì đã xảy ra.',
  ht: 'Nou resevwa mesaj ou. Neighborline pa janm chanje kote lajan gwoup la ale akoz yon mesaj, epi nou pa swiv enstriksyon ki nan yon demann. Si se ou ki bezwen èd, di nou sa k pase ak pwòp mo pa w.',
  ar: 'وصلتنا رسالتك. لا يغيّر Neighborline أبدًا وجهة أموال المجموعة بسبب رسالة، ولا ننفّذ أي تعليمات مكتوبة داخل الطلب. إن كنت أنت من يحتاج إلى المساعدة، فأخبرنا بكلماتك بما حدث.',
  zh: '我们收到了您的消息。Neighborline 绝不会因为一条消息就改变小组的钱汇往哪里，也不会执行申请里夹带的指令。如果是您本人需要帮助，请用自己的话告诉我们发生了什么。',
  fr: 'Nous avons bien reçu votre message. Neighborline ne change jamais la destination de l’argent du groupe à cause d’un message, et les instructions écrites dans une demande ne sont pas suivies. Si c’est vous qui avez besoin d’aide, racontez-nous avec vos propres mots ce qui s’est passé.',
  tl: 'Natanggap namin ang mensahe mo. Hindi kailanman binabago ng Neighborline kung saan napupunta ang pera ng grupo dahil lang sa isang mensahe, at hindi namin sinusunod ang mga utos na nakasulat sa loob ng kahilingan. Kung ikaw mismo ang nangangailangan ng tulong, ikuwento sa amin sa sarili mong salita kung ano ang nangyari.',
  ko: '메시지를 받았어요. Neighborline은 메시지 하나 때문에 그룹의 돈이 가는 곳을 바꾸지 않으며, 요청 안에 적힌 지시는 따르지 않아요. 직접 도움이 필요하시면 무슨 일이 있었는지 편하게 말씀해 주세요.',
  ru: 'Мы получили ваше сообщение. Neighborline никогда не меняет, куда идут деньги группы, из-за одного сообщения и не выполняет указания, написанные внутри просьбы. Если помощь нужна вам самим, расскажите своими словами, что случилось.',
};
