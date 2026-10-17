/**
 * Requester-facing decline copy: the reason line, the "a second organizer looked again" final decline,
 * the first decline with its appeal, and the lines around an organizer's free-text note. Native per
 * language (en, es, vi, ht, ar; zh, fr, tl, ko, ru machine-assisted, pending native review).
 *
 * Vietnamese register variants (`viElder` / `viPeer`, {you} / {You}) as in copy-status.ts and core
 * address.ts. Reasons are clauses that slot into the decline sentence, so they carry no final period.
 */
import type { Lang, WithViRegisters } from '@neighborline/core';
import type { DeclineReasonCode } from '../../types';

export const REASONS: Readonly<Record<DeclineReasonCode, WithViRegisters<string>>> = {
  outside_area: {
    en: 'your address is outside the area this group covers',
    es: 'su dirección está fuera del área que cubre el grupo',
    vi: 'địa chỉ nằm ngoài khu vực nhóm hỗ trợ',
    ht: 'adrès ou deyò zòn gwoup la kouvri',
    ar: 'عنوانك خارج المنطقة التي تخدمها المجموعة',
    zh: '您的地址不在本小组服务的范围内',
    fr: 'votre adresse est en dehors de la zone couverte par le groupe',
    tl: 'nasa labas ng lugar na sakop ng grupo ang iyong address',
    ko: '주소가 이 그룹이 돕는 지역 밖이에요',
    ru: 'ваш адрес находится за пределами района, где помогает группа',
  },
  household_cap: {
    en: 'your household already received this month’s limit',
    es: 'su hogar ya recibió el máximo de este mes',
    vi: 'gia đình đã nhận đủ mức hỗ trợ của tháng này',
    ht: 'fanmi w deja resevwa limit mwa sa a',
    ar: 'حصلت أسرتك بالفعل على الحد الأقصى لهذا الشهر',
    zh: '您家这个月已经领到了上限',
    fr: 'votre foyer a déjà reçu le maximum prévu pour ce mois-ci',
    tl: 'natanggap na ng inyong sambahayan ang limitasyon para sa buwang ito',
    ko: '이번 달 가구당 한도를 이미 받으셨어요',
    ru: 'ваша семья уже получила максимум на этот месяц',
  },
  needs_info: {
    en: 'we need a little more information first',
    es: 'necesitamos un poco más de información primero',
    vi: 'chúng tôi cần thêm một chút thông tin',
    viElder: 'chúng cháu cần thêm một chút thông tin',
    ht: 'nou bezwen yon ti kras plis enfòmasyon anvan',
    ar: 'نحتاج أولًا إلى بعض المعلومات الإضافية',
    zh: '我们需要先多了解一些情况',
    fr: 'nous avons d’abord besoin d’un peu plus d’informations',
    tl: 'kailangan muna namin ng kaunti pang impormasyon',
    ko: '먼저 조금 더 알아야 할 것이 있어요',
    ru: 'сначала нам нужно немного больше информации',
  },
  not_covered: {
    en: 'this need isn’t in the group’s rules yet',
    es: 'esta necesidad todavía no está en las reglas del grupo',
    vi: 'nhu cầu này chưa nằm trong quy định của nhóm',
    ht: 'bezwen sa a poko nan règ gwoup la',
    ar: 'هذه الحاجة ليست ضمن قواعد المجموعة بعد',
    zh: '这类需求还不在小组的规则范围内',
    fr: 'ce type de besoin ne figure pas encore dans les règles du groupe',
    tl: 'wala pa sa mga patakaran ng grupo ang ganitong pangangailangan',
    ko: '이런 도움은 아직 그룹 규칙에 들어 있지 않아요',
    ru: 'такая помощь пока не предусмотрена правилами группы',
  },
  other: {
    en: 'an organizer left a note below',
    es: 'alguien del grupo dejó una nota abajo',
    vi: 'người duyệt có để lại ghi chú bên dưới',
    ht: 'yon òganizatè kite yon nòt anba a',
    ar: 'ترك أحد المنظّمين ملاحظة أدناه',
    zh: '组织者在下面留了言',
    fr: 'une personne du groupe a laissé une note ci-dessous',
    tl: 'may iniwang tala sa ibaba ang isang organizer',
    ko: '운영자가 아래에 메모를 남겼어요',
    ru: 'ниже — комментарий от организаторов',
  },
};

/** Reason "other" with no note: say plainly that it was a judgment call, never point at a note that isn't there. */
export const OTHER_NO_NOTE: WithViRegisters<string> = {
  en: 'the organizers couldn’t approve it this time',
  es: 'el grupo no pudo aprobarla esta vez',
  vi: 'nhóm chưa thể duyệt yêu cầu lần này',
  ht: 'òganizatè yo pa t ka apwouve l fwa sa a',
  ar: 'لم يتمكن المنظّمون من الموافقة عليه هذه المرة',
  zh: '组织者这次没能批准',
  fr: 'le groupe n’a pas pu l’approuver cette fois',
  tl: 'hindi ito naaprubahan ng mga organizer sa pagkakataong ito',
  ko: '이번에는 운영자들이 승인하지 못했어요',
  ru: 'в этот раз организаторы не смогли её одобрить',
};

/** A second organizer already looked again: no further appeal is promised. */
export const DECLINE_FINAL: WithViRegisters<(reason: string) => string> = {
  en: (reason) => `A second organizer looked at your request again. We still can’t send money this time: ${reason}. We’re sorry, and you’re welcome to ask again if things change.`,
  es: (reason) => `Otra persona del grupo revisó su solicitud de nuevo. Aun así no podemos enviar el dinero esta vez: ${reason}. Lo sentimos; puede escribirnos otra vez si su situación cambia.`,
  vi: (reason) => `Một người khác trong nhóm đã xem lại yêu cầu của bạn. Lần này chúng tôi vẫn chưa thể gửi tiền: ${reason}. Rất tiếc; nếu hoàn cảnh thay đổi, bạn cứ nhắn lại nhé.`,
  viElder: (reason) => `Một người khác trong nhóm đã xem lại yêu cầu của {you}. Lần này chúng cháu vẫn chưa thể gửi tiền: ${reason}. Chúng cháu rất tiếc ạ; nếu hoàn cảnh thay đổi, {you} cứ nhắn lại nhé.`,
  viPeer: (reason) => `Một người khác trong nhóm đã xem lại yêu cầu của {you}. Lần này chúng tôi vẫn chưa thể gửi tiền: ${reason}. Rất tiếc; nếu hoàn cảnh thay đổi, {you} cứ nhắn lại nhé.`,
  ht: (reason) => `Yon lòt òganizatè gade demann ou an ankò. Fwa sa a nou toujou pa ka voye lajan an: ${reason}. Nou regrèt; si sitiyasyon w chanje, ou ka ekri nou ankò.`,
  ar: (reason) => `راجع منظّم آخر طلبك مرة أخرى. ما زلنا لا نستطيع إرسال المال هذه المرة: ${reason}. نأسف لذلك، ويمكنك أن تكتب لنا من جديد إذا تغيّر وضعك.`,
  zh: (reason) => `另一位组织者重新查看了您的申请。这次我们仍然无法汇款：${reason}。很抱歉；如果情况有变化，欢迎您再来申请。`,
  fr: (reason) => `Une autre personne du groupe a réexaminé votre demande. Nous ne pouvons toujours pas envoyer d’argent cette fois : ${reason}. Nous en sommes désolés ; vous pouvez refaire une demande si votre situation change.`,
  tl: (reason) => `Tiningnan ulit ng isa pang organizer ang iyong kahilingan. Hindi pa rin kami makapagpadala ng pera ngayon: ${reason}. Paumanhin, at puwede kang humingi ulit kapag nagbago ang sitwasyon mo.`,
  ko: (reason) => `다른 운영자가 요청을 다시 살펴봤어요. 그래도 이번에는 돈을 보내 드릴 수 없어요: ${reason}. 죄송합니다. 상황이 달라지면 언제든 다시 요청해 주세요.`,
  ru: (reason) => `Другой организатор ещё раз рассмотрел вашу просьбу. К сожалению, в этот раз мы всё равно не можем отправить деньги: ${reason}. Нам очень жаль. Если ваша ситуация изменится, вы можете обратиться снова.`,
};

/** The first decline: reply REVIEW (in their language) and a different organizer looks again. */
export const DECLINE_WITH_APPEAL: WithViRegisters<(reason: string) => string> = {
  en: (reason) => `We can’t send money this time: ${reason}. If you think that’s wrong, reply REVIEW and a different organizer will look again within 24 hours.`,
  es: (reason) => `Esta vez no podemos enviar el dinero: ${reason}. Si cree que es un error, responda REVISAR y otra persona del grupo lo revisará en 24 horas.`,
  vi: (reason) => `Lần này chúng tôi chưa thể gửi tiền: ${reason}. Nếu thấy chưa đúng, bạn nhắn XEM LẠI — một người khác trong nhóm sẽ xem lại trong 24 giờ.`,
  viElder: (reason) => `Lần này chúng cháu chưa thể gửi tiền ạ: ${reason}. Nếu {you} thấy chưa đúng, {you} nhắn XEM LẠI — một người khác trong nhóm sẽ xem lại trong 24 giờ.`,
  viPeer: (reason) => `Lần này chúng tôi chưa thể gửi tiền: ${reason}. Nếu thấy chưa đúng, {you} nhắn XEM LẠI — một người khác trong nhóm sẽ xem lại trong 24 giờ.`,
  ht: (reason) => `Fwa sa a nou pa ka voye lajan an: ${reason}. Si ou panse se yon erè, reponn REVIZE epi yon lòt òganizatè ap gade l ankò nan 24 èdtan.`,
  ar: (reason) => `لا نستطيع إرسال المال هذه المرة: ${reason}. إن كنت ترى أن هذا خطأ، ردّ بكلمة مراجعة وسيراجع منظّم آخر طلبك خلال 24 ساعة.`,
  zh: (reason) => `这次我们无法汇款：${reason}。如果您觉得有误，请回复“复查”，另一位组织者会在 24 小时内重新查看。`,
  fr: (reason) => `Nous ne pouvons pas envoyer d’argent cette fois : ${reason}. Si vous pensez que c’est une erreur, répondez RÉEXAMEN et une autre personne du groupe regardera à nouveau sous 24 heures.`,
  tl: (reason) => `Hindi kami makapagpadala ng pera ngayon: ${reason}. Kung sa tingin mo ay mali ito, sumagot ng SURIIN at titingnan ulit ito ng ibang organizer sa loob ng 24 oras.`,
  ko: (reason) => `이번에는 돈을 보내 드릴 수 없어요: ${reason}. 잘못되었다고 생각하시면 ‘재검토’라고 답장해 주세요. 다른 운영자가 24시간 안에 다시 살펴볼게요.`,
  ru: (reason) => `В этот раз мы не можем отправить деньги: ${reason}. Если вы считаете, что это ошибка, ответьте ПЕРЕСМОТР, и другой организатор посмотрит ещё раз в течение 24 часов.`,
};

/** Label above an organizer's note that was translated (agents translateWithCheck, back-translation checked). */
export const NOTE_TRANSLATED: Readonly<Record<Lang, string>> = {
  en: 'Note from the organizer:',
  es: 'Nota de la persona del grupo (traducida automáticamente):',
  vi: 'Ghi chú của người duyệt (dịch tự động):',
  ht: 'Nòt òganizatè a (tradui otomatikman):',
  zh: '组织者的留言（自动翻译）：',
  ar: 'ملاحظة المنظّم (مترجمة آليًا):',
  fr: 'Note de l’organisateur (traduite automatiquement) :',
  tl: 'Tala mula sa organizer (awtomatikong isinalin):',
  ko: '운영자의 메모 (자동 번역):',
  ru: 'Комментарий организатора (автоматический перевод):',
};

/** Line above an organizer's note that could not be translated: it is in English, and help is offered. */
export const NOTE_ORIGINAL: WithViRegisters<string> = {
  en: 'Note from the organizer:',
  es: 'La persona del grupo escribió esta nota en inglés. Si necesita ayuda para entenderla, responda aquí.',
  vi: 'Người duyệt viết ghi chú này bằng tiếng Anh. Nếu cần giúp đọc, bạn cứ trả lời tin nhắn này.',
  viElder: 'Người duyệt viết ghi chú này bằng tiếng Anh. Nếu cần giúp đọc, {you} cứ trả lời tin nhắn này ạ.',
  viPeer: 'Người duyệt viết ghi chú này bằng tiếng Anh. Nếu cần giúp đọc, {you} cứ trả lời tin nhắn này.',
  ht: 'Òganizatè a ekri nòt sa a an angle. Si w bezwen èd pou li l, reponn isit la.',
  zh: '组织者用英文写了这条留言。如需帮助理解，请直接回复。',
  ar: 'كتب المنظّم هذه الملاحظة بالإنجليزية. إذا احتجت إلى مساعدة في فهمها، ردّ هنا.',
  fr: 'L’organisateur a écrit cette note en anglais. Si vous avez besoin d’aide pour la lire, répondez ici.',
  tl: 'Isinulat ng organizer ang talang ito sa Ingles. Kung kailangan mo ng tulong sa pagbasa nito, sumagot dito.',
  ko: '운영자가 이 메모를 영어로 작성했습니다. 읽는 데 도움이 필요하시면 여기로 답장해 주세요.',
  ru: 'Организатор написал этот комментарий по-английски. Если нужна помощь с переводом, ответьте на это сообщение.',
};
