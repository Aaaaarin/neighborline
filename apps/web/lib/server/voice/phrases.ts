/**
 * What the phone line says around the AI read-back, written natively per language. These are fixed
 * prompts (no money, no names): amounts and payout messages come from the vetted core catalog via
 * agents.notify. vi/es/ht/ar follow the reviewed message catalog's register; zh/ko/ru/fr/tl await a
 * native-speaker pass (same status as apps/web/lib/i18n.ts). Missing languages fall back to English.
 */
import type { Lang } from '@neighborline/core';

export type PhraseKey =
  | 'greeting'
  | 'oneMoment'
  | 'confirmPrompt'
  | 'tryAgain'
  | 'filed'
  | 'payoutChoice'
  | 'sayVenmo'
  | 'sayPaypal'
  | 'answerAfterBeep'
  | 'pressN'
  | 'notHeard'
  | 'trouble'
  | 'gaveUp'
  | 'tooMany'
  | 'anonymous'
  | 'tooLong'
  | 'goodbye'
  | 'callIntro'
  | 'callAgain';

type Table = Record<PhraseKey, string>;

const en: Table = {
  greeting: 'After the beep, tell us what you need, in any language.',
  oneMoment: 'Thank you. One moment while we listen to your message.',
  confirmPrompt: 'If that is right, press 1. To try again, press 2.',
  tryAgain: 'Okay. After the beep, tell us again what you need.',
  filed: 'Thank you. Two neighbors will look at it. We will call or text you back.',
  payoutChoice: 'We also need to know where to send the money. To say your Venmo username, press 1. To say your PayPal email, press 2.',
  sayVenmo: 'After the beep, say your Venmo username, slowly.',
  sayPaypal: 'After the beep, say your PayPal email address, slowly.',
  answerAfterBeep: 'Please answer after the beep.',
  pressN: 'For {label}, press {n}.',
  notHeard: 'Sorry, we did not hear anything.',
  trouble: 'Sorry, something went wrong on our side. Please call again in a few minutes.',
  gaveUp: 'Sorry, we could not get it right this time. Please call again, or ask someone you trust to call with you.',
  tooMany: 'You have called many times today. Please call again later.',
  anonymous: 'Neighborline needs your phone number to call you back. Please call again without hiding your number.',
  tooLong: 'We have to end this call now. Please call again if you need to.',
  goodbye: 'Goodbye. Take care.',
  callIntro: 'Hello, this is Neighborline, calling about your request.',
  callAgain: 'To hear this again, call us back at this number.',
};

const PHRASES: Partial<Record<Lang, Table>> = {
  en,
  es: {
    greeting: 'Después del tono, díganos qué necesita, en cualquier idioma.',
    oneMoment: 'Gracias. Un momento mientras escuchamos su mensaje.',
    confirmPrompt: 'Si está bien, oprima 1. Para intentarlo de nuevo, oprima 2.',
    tryAgain: 'Está bien. Después del tono, díganos otra vez qué necesita.',
    filed: 'Gracias. Dos vecinos van a revisarlo. Le llamaremos o le enviaremos un mensaje.',
    payoutChoice: 'También necesitamos saber a dónde enviar el dinero. Para decir su usuario de Venmo, oprima 1. Para decir su correo de PayPal, oprima 2.',
    sayVenmo: 'Después del tono, diga su usuario de Venmo, despacio.',
    sayPaypal: 'Después del tono, diga su correo de PayPal, despacio.',
    answerAfterBeep: 'Por favor, conteste después del tono.',
    pressN: 'Para {label}, oprima {n}.',
    notHeard: 'Perdón, no escuchamos nada.',
    trouble: 'Perdón, algo falló de nuestro lado. Por favor, llame otra vez en unos minutos.',
    gaveUp: 'Perdón, esta vez no lo pudimos entender bien. Por favor, llame otra vez, o pídale a alguien de confianza que llame con usted.',
    tooMany: 'Usted ha llamado muchas veces hoy. Por favor, llame más tarde.',
    anonymous: 'Neighborline necesita su número para devolverle la llamada. Por favor, llame otra vez sin ocultar su número.',
    tooLong: 'Tenemos que terminar esta llamada. Llame otra vez si lo necesita.',
    goodbye: 'Adiós. Cuídese.',
    callIntro: 'Hola, le llamamos de Neighborline sobre su solicitud.',
    callAgain: 'Para escuchar esto otra vez, llámenos a este número.',
  },
  vi: {
    greeting: 'Sau tiếng bíp, xin cho chúng tôi biết bạn cần gì, bằng bất kỳ ngôn ngữ nào.',
    oneMoment: 'Cảm ơn bạn. Xin chờ một chút để chúng tôi nghe tin nhắn của bạn.',
    confirmPrompt: 'Nếu đúng, xin bấm số 1. Để nói lại, xin bấm số 2.',
    tryAgain: 'Được rồi. Sau tiếng bíp, xin nói lại bạn cần gì.',
    filed: 'Cảm ơn bạn. Hai người hàng xóm sẽ xem yêu cầu này. Chúng tôi sẽ gọi hoặc nhắn tin lại cho bạn.',
    payoutChoice: 'Chúng tôi cũng cần biết gửi tiền vào đâu. Để nói tên Venmo, xin bấm số 1. Để nói email PayPal, xin bấm số 2.',
    sayVenmo: 'Sau tiếng bíp, xin nói chậm tên người dùng Venmo của bạn.',
    sayPaypal: 'Sau tiếng bíp, xin nói chậm địa chỉ email PayPal của bạn.',
    answerAfterBeep: 'Xin trả lời sau tiếng bíp.',
    pressN: 'Nếu là {label}, xin bấm số {n}.',
    notHeard: 'Xin lỗi, chúng tôi không nghe thấy gì.',
    trouble: 'Xin lỗi, hệ thống của chúng tôi đang gặp sự cố. Xin gọi lại sau vài phút.',
    gaveUp: 'Xin lỗi, lần này chúng tôi chưa hiểu đúng. Xin gọi lại, hoặc nhờ một người bạn tin cậy gọi cùng.',
    tooMany: 'Hôm nay bạn đã gọi nhiều lần. Xin gọi lại sau.',
    anonymous: 'Neighborline cần số điện thoại của bạn để gọi lại. Xin gọi lại mà không ẩn số.',
    tooLong: 'Chúng tôi phải kết thúc cuộc gọi này. Nếu cần, xin gọi lại.',
    goodbye: 'Chào bạn. Bạn giữ gìn sức khỏe nhé.',
    callIntro: 'Xin chào, đây là Neighborline, gọi về yêu cầu của bạn.',
    callAgain: 'Để nghe lại, xin gọi lại số này.',
  },
  ht: {
    greeting: 'Apre bip la, di nou sa w bezwen, nan nenpòt lang.',
    oneMoment: 'Mèsi. Tann yon ti moman pandan n ap koute mesaj ou a.',
    confirmPrompt: 'Si se sa, peze 1. Pou eseye ankò, peze 2.',
    tryAgain: 'Dakò. Apre bip la, di nou ankò sa w bezwen.',
    filed: 'Mèsi. De vwazen pral gade l. N ap rele w oswa voye yon mesaj ba ou.',
    payoutChoice: 'Nou bezwen konnen tou ki kote pou nou voye lajan an. Pou di non Venmo ou, peze 1. Pou di imèl PayPal ou, peze 2.',
    sayVenmo: 'Apre bip la, di non itilizatè Venmo ou, dousman.',
    sayPaypal: 'Apre bip la, di adrès imèl PayPal ou, dousman.',
    answerAfterBeep: 'Tanpri reponn apre bip la.',
    pressN: 'Pou {label}, peze {n}.',
    notHeard: 'Padon, nou pa tande anyen.',
    trouble: 'Padon, gen yon pwoblèm bò kote nou. Tanpri rele ankò nan kèk minit.',
    gaveUp: 'Padon, fwa sa a nou pa t rive konprann byen. Tanpri rele ankò, oswa mande yon moun ou fè konfyans rele avè w.',
    tooMany: 'Ou rele anpil fwa jodi a. Tanpri rele pita.',
    anonymous: 'Neighborline bezwen nimewo telefòn ou pou n ka rele w. Tanpri rele ankò san w pa kache nimewo w.',
    tooLong: 'Nou oblije fini apèl la kounye a. Rele ankò si w bezwen.',
    goodbye: 'Orevwa. Pran swen tèt ou.',
    callIntro: 'Bonjou, se Neighborline k ap rele w pou demann ou an.',
    callAgain: 'Pou tande sa ankò, rele nou nan nimewo sa a.',
  },
  zh: {
    greeting: '听到提示音后，请用任何语言告诉我们您需要什么。',
    oneMoment: '谢谢。请稍等，我们正在听您的留言。',
    confirmPrompt: '如果正确，请按1。如果要重新说，请按2。',
    tryAgain: '好的。听到提示音后，请再说一遍您需要什么。',
    filed: '谢谢。两位邻居会查看您的申请。我们会给您回电话或发短信。',
    payoutChoice: '我们还需要知道把钱汇到哪里。要说您的Venmo用户名，请按1。要说您的PayPal邮箱，请按2。',
    sayVenmo: '听到提示音后，请慢慢说出您的Venmo用户名。',
    sayPaypal: '听到提示音后，请慢慢说出您的PayPal邮箱地址。',
    answerAfterBeep: '请在提示音后回答。',
    pressN: '{label}，请按{n}。',
    notHeard: '抱歉，我们没有听到声音。',
    trouble: '抱歉，我们这边出了问题。请过几分钟再打来。',
    gaveUp: '抱歉，这次我们没能听清楚。请再打来，或请一位您信任的人陪您一起打。',
    tooMany: '您今天已经打了很多次。请稍后再打。',
    anonymous: 'Neighborline需要您的电话号码才能给您回电。请不要隐藏号码，再打一次。',
    tooLong: '我们现在必须结束这次通话。如有需要，请再打来。',
    goodbye: '再见，请多保重。',
    callIntro: '您好，这里是Neighborline，关于您的申请给您打电话。',
    callAgain: '如需再听一遍，请回拨这个号码。',
  },
  ar: {
    greeting: 'بعد سماع الصفارة، أخبرنا بما تحتاجه، بأي لغة.',
    oneMoment: 'شكرًا لك. لحظة من فضلك بينما نستمع إلى رسالتك.',
    confirmPrompt: 'إذا كان هذا صحيحًا، اضغط 1. للمحاولة مرة أخرى، اضغط 2.',
    tryAgain: 'حسنًا. بعد الصفارة، أخبرنا مرة أخرى بما تحتاجه.',
    filed: 'شكرًا لك. سيراجع طلبك جاران اثنان. سنتصل بك أو نرسل لك رسالة.',
    payoutChoice: 'نحتاج أيضًا أن نعرف إلى أين نرسل المال. لتقول اسم المستخدم في Venmo، اضغط 1. لتقول بريدك الإلكتروني في PayPal، اضغط 2.',
    sayVenmo: 'بعد الصفارة، قل اسم المستخدم في Venmo ببطء.',
    sayPaypal: 'بعد الصفارة، قل عنوان بريدك الإلكتروني في PayPal ببطء.',
    answerAfterBeep: 'من فضلك أجب بعد الصفارة.',
    pressN: 'لـ {label}، اضغط {n}.',
    notHeard: 'عذرًا، لم نسمع شيئًا.',
    trouble: 'عذرًا، حدث خطأ من جهتنا. من فضلك اتصل مرة أخرى بعد بضع دقائق.',
    gaveUp: 'عذرًا، لم نتمكن من فهم طلبك بشكل صحيح هذه المرة. من فضلك اتصل مرة أخرى، أو اطلب من شخص تثق به أن يتصل معك.',
    tooMany: 'لقد اتصلت مرات كثيرة اليوم. من فضلك اتصل لاحقًا.',
    anonymous: 'يحتاج Neighborline إلى رقم هاتفك ليتصل بك. من فضلك اتصل مرة أخرى دون إخفاء رقمك.',
    tooLong: 'علينا إنهاء هذه المكالمة الآن. اتصل مرة أخرى إذا احتجت.',
    goodbye: 'مع السلامة. اعتنِ بنفسك.',
    callIntro: 'مرحبًا، معك Neighborline، نتصل بخصوص طلبك.',
    callAgain: 'لسماع هذا مرة أخرى، اتصل بنا على هذا الرقم.',
  },
  fr: {
    greeting: 'Après le bip, dites-nous ce dont vous avez besoin, dans n’importe quelle langue.',
    oneMoment: 'Merci. Un instant, nous écoutons votre message.',
    confirmPrompt: 'Si c’est correct, appuyez sur 1. Pour recommencer, appuyez sur 2.',
    tryAgain: 'D’accord. Après le bip, redites-nous ce dont vous avez besoin.',
    filed: 'Merci. Deux voisins vont regarder votre demande. Nous vous rappellerons ou vous enverrons un message.',
    payoutChoice: 'Nous devons aussi savoir où envoyer l’argent. Pour dire votre nom d’utilisateur Venmo, appuyez sur 1. Pour dire votre e-mail PayPal, appuyez sur 2.',
    sayVenmo: 'Après le bip, dites lentement votre nom d’utilisateur Venmo.',
    sayPaypal: 'Après le bip, dites lentement votre adresse e-mail PayPal.',
    answerAfterBeep: 'Merci de répondre après le bip.',
    pressN: 'Pour {label}, appuyez sur {n}.',
    notHeard: 'Désolé, nous n’avons rien entendu.',
    trouble: 'Désolé, un problème est survenu de notre côté. Merci de rappeler dans quelques minutes.',
    gaveUp: 'Désolé, nous n’avons pas bien compris cette fois. Merci de rappeler, ou de demander à une personne de confiance d’appeler avec vous.',
    tooMany: 'Vous avez appelé de nombreuses fois aujourd’hui. Merci de rappeler plus tard.',
    anonymous: 'Neighborline a besoin de votre numéro pour vous rappeler. Merci de rappeler sans masquer votre numéro.',
    tooLong: 'Nous devons terminer cet appel. Rappelez-nous si besoin.',
    goodbye: 'Au revoir. Prenez soin de vous.',
    callIntro: 'Bonjour, ici Neighborline, nous vous appelons au sujet de votre demande.',
    callAgain: 'Pour réécouter ce message, rappelez ce numéro.',
  },
  ko: {
    greeting: '삐 소리가 나면, 어떤 언어로든 필요한 것을 말씀해 주세요.',
    oneMoment: '감사합니다. 메시지를 듣는 동안 잠시만 기다려 주세요.',
    confirmPrompt: '맞으면 1번을 누르세요. 다시 말씀하시려면 2번을 누르세요.',
    tryAgain: '알겠습니다. 삐 소리가 나면 필요한 것을 다시 말씀해 주세요.',
    filed: '감사합니다. 이웃 두 명이 확인할 거예요. 전화나 문자로 다시 연락드리겠습니다.',
    payoutChoice: '돈을 어디로 보낼지도 알아야 합니다. 벤모 사용자 이름을 말씀하시려면 1번, 페이팔 이메일을 말씀하시려면 2번을 누르세요.',
    sayVenmo: '삐 소리가 나면 벤모 사용자 이름을 천천히 말씀해 주세요.',
    sayPaypal: '삐 소리가 나면 페이팔 이메일 주소를 천천히 말씀해 주세요.',
    answerAfterBeep: '삐 소리가 난 후에 대답해 주세요.',
    pressN: '{label}은(는) {n}번을 누르세요.',
    notHeard: '죄송합니다. 아무 소리도 들리지 않았어요.',
    trouble: '죄송합니다. 저희 쪽에 문제가 생겼습니다. 몇 분 후에 다시 전화해 주세요.',
    gaveUp: '죄송합니다. 이번에는 제대로 알아듣지 못했어요. 다시 전화하시거나, 믿을 수 있는 분과 함께 전화해 주세요.',
    tooMany: '오늘 여러 번 전화하셨어요. 나중에 다시 전화해 주세요.',
    anonymous: 'Neighborline이 다시 연락드리려면 전화번호가 필요합니다. 번호를 숨기지 말고 다시 전화해 주세요.',
    tooLong: '이제 통화를 끝내야 합니다. 필요하시면 다시 전화해 주세요.',
    goodbye: '안녕히 계세요. 건강하세요.',
    callIntro: '안녕하세요, Neighborline입니다. 요청하신 건으로 전화드렸습니다.',
    callAgain: '다시 들으시려면 이 번호로 전화해 주세요.',
  },
  ru: {
    greeting: 'После сигнала скажите, что вам нужно, на любом языке.',
    oneMoment: 'Спасибо. Подождите минутку, мы слушаем ваше сообщение.',
    confirmPrompt: 'Если всё верно, нажмите 1. Чтобы сказать заново, нажмите 2.',
    tryAgain: 'Хорошо. После сигнала скажите ещё раз, что вам нужно.',
    filed: 'Спасибо. Двое соседей посмотрят вашу просьбу. Мы перезвоним или напишем вам.',
    payoutChoice: 'Нам также нужно знать, куда отправить деньги. Чтобы назвать имя пользователя Venmo, нажмите 1. Чтобы назвать почту PayPal, нажмите 2.',
    sayVenmo: 'После сигнала медленно назовите ваше имя пользователя Venmo.',
    sayPaypal: 'После сигнала медленно назовите ваш адрес почты PayPal.',
    answerAfterBeep: 'Пожалуйста, ответьте после сигнала.',
    pressN: '{label} — нажмите {n}.',
    notHeard: 'Извините, мы ничего не услышали.',
    trouble: 'Извините, у нас что-то сломалось. Пожалуйста, перезвоните через несколько минут.',
    gaveUp: 'Извините, в этот раз мы не смогли всё правильно понять. Пожалуйста, позвоните ещё раз или попросите близкого человека позвонить вместе с вами.',
    tooMany: 'Сегодня вы звонили уже много раз. Пожалуйста, позвоните позже.',
    anonymous: 'Neighborline нужен ваш номер, чтобы перезвонить. Пожалуйста, позвоните ещё раз, не скрывая номер.',
    tooLong: 'Нам нужно завершить звонок. Позвоните ещё раз, если нужно.',
    goodbye: 'До свидания. Берегите себя.',
    callIntro: 'Здравствуйте, это Neighborline, звоним по вашей просьбе.',
    callAgain: 'Чтобы прослушать ещё раз, перезвоните на этот номер.',
  },
  tl: {
    greeting: 'Pagkatapos ng beep, sabihin sa amin kung ano ang kailangan mo, sa kahit anong wika.',
    oneMoment: 'Salamat. Sandali lang habang pinapakinggan namin ang mensahe mo.',
    confirmPrompt: 'Kung tama, pindutin ang 1. Para ulitin, pindutin ang 2.',
    tryAgain: 'Sige. Pagkatapos ng beep, sabihin ulit kung ano ang kailangan mo.',
    filed: 'Salamat. Dalawang kapitbahay ang titingin dito. Tatawagan o ite-text ka namin.',
    payoutChoice: 'Kailangan din naming malaman kung saan ipapadala ang pera. Para sabihin ang Venmo username mo, pindutin ang 1. Para sabihin ang PayPal email mo, pindutin ang 2.',
    sayVenmo: 'Pagkatapos ng beep, sabihin nang dahan-dahan ang Venmo username mo.',
    sayPaypal: 'Pagkatapos ng beep, sabihin nang dahan-dahan ang PayPal email address mo.',
    answerAfterBeep: 'Pakisagot pagkatapos ng beep.',
    pressN: 'Para sa {label}, pindutin ang {n}.',
    notHeard: 'Paumanhin, wala kaming narinig.',
    trouble: 'Paumanhin, may problema sa aming panig. Pakitawag ulit pagkalipas ng ilang minuto.',
    gaveUp: 'Paumanhin, hindi namin ito nakuha nang tama ngayon. Pakitawag ulit, o magpasama sa taong pinagkakatiwalaan mo.',
    tooMany: 'Maraming beses ka nang tumawag ngayong araw. Pakitawag ulit mamaya.',
    anonymous: 'Kailangan ng Neighborline ang numero mo para matawagan ka. Pakitawag ulit nang hindi itinatago ang numero mo.',
    tooLong: 'Kailangan na naming tapusin ang tawag na ito. Tumawag ulit kung kailangan.',
    goodbye: 'Paalam. Mag-ingat ka.',
    callIntro: 'Hello, ito ang Neighborline, tumatawag tungkol sa kahilingan mo.',
    callAgain: 'Para marinig ulit ito, tawagan kami sa numerong ito.',
  },
};

/** The phrase in `lang`, else English; {slots} filled from `vars`. */
export function phrase(key: PhraseKey, lang: Lang, vars: Record<string, string | number> = {}): { text: string; lang: Lang } {
  const table = PHRASES[lang];
  const used: Lang = table ? lang : 'en';
  const raw = (table ?? en)[key];
  return { text: raw.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? '')), lang: used };
}

export const PHRASE_LANGS = Object.keys(PHRASES) as Lang[];
