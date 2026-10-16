/**
 * Language patterns for detectPromptInjection (injection.ts). Patterns run against a lowercased,
 * diacritic-stripped copy (Latin scripts; Arabic hamza forms fold to bare alef) AND the lowercased
 * original (CJK / Cyrillic), so write Latin-script patterns without accents.
 */

export type InjectionSignalId =
  | 'ignore_instructions'
  | 'system_marker'
  | 'role_override'
  | 'approval_coercion'
  | 'structured_payload'
  | 'encoded_blob'
  | 'hidden_characters'
  | 'large_amount_directive'
  | 'authority_claim'
  | 'addressed_to_ai';

export interface InjectionSignal {
  id: InjectionSignalId;
  excerpt: string;
}

type Rule = { id: InjectionSignalId; patterns: RegExp[] };

/** A privileged role someone asks the assistant to play. */
export const PRIVILEGED_ROLES = [
  'organi[sz]er', 'admin', 'administrator', 'approver', 'moderator', 'coordinator', 'supervisor', 'treasurer', 'the system', 'developer',
  'organizador', 'organizadora', 'administrador', 'administradora', 'coordinador', 'coordinadora', 'aprobador',
  'organisateur', 'organisatrice', 'administrateur', 'administratrice', 'coordinateur', 'tresorier',
  'nguoi to chuc', 'ban to chuc', 'quan tri', 'nguoi duyet', 'truong nhom', 'thu quy',
  'oganizate', 'organizate', 'administrate', 'kowodonate',
  '组织者', '负责人', '管理员', '审批人', '工作人员', '财务',
  'المنظم', 'المسؤول', 'المدير', 'المشرف', 'امين الصندوق',
  'организатор', 'администратор', 'модератор', 'координатор', 'казначе',
  '운영자', '운영진', '관리자', '주최자', '승인자', '담당자',
  'tagapag-?ayos', 'tagapamahala', 'tagapag-?apruba',
].join('|');

/** Verbs that ask the assistant to play a part ("pretend", "play the role of", "đóng vai", "扮演"). */
export const ROLE_PLAY_VERBS = [
  '\\bpretend\\b', '\\bplay(ing)? the (role|part)\\b', '\\brole-?play\\b', '\\bact as\\b', '\\bact like\\b', '\\bimpersonate\\b',
  '\\bfinge\\b', '\\bfingir\\b', '\\bfinja\\b', '\\bhaz(te)? (de|pasar por)\\b', '\\b(juega|interpreta) el papel\\b', '\\bactua como\\b',
  '\\bfais semblant\\b', '\\bfaites semblant\\b', '\\bjoue[zr]? le role\\b', '\\bincarne[zr]?\\b', '\\bagis comme\\b',
  '\\bdong vai\\b', '\\bgia vo\\b', '\\bgia lam\\b', '\\bnhap vai\\b',
  '\\bpran wol\\b', '\\bfe (tankou|kom si) ou se\\b', '\\bpretann\\b',
  '扮演', '假装', '充当', '冒充',
  'تظاهر', 'العب دور', 'تقمص', 'مثل دور', 'تصرف ك',
  'притворись', 'притворитесь', 'сыграй\\S* роль', 'представь\\S*,? что ты', 'веди себя как',
  '역할을', '인 척', '척 해', '척하', '역할극',
  '\\bmagpanggap\\b', '\\bkunwari\\b', '\\bgumanap\\b',
].join('|');

export const RULES: readonly Rule[] = [
  {
    id: 'ignore_instructions',
    patterns: [
      /\b(ignore|disregard|forget|override|bypass)\b[^.!?\n]{0,40}\b(instructions?|rules?|polic(?:y|ies)|prompts?|guidelines?|constraints?)\b/,
      /\b(ignora|ignorar|ignore|ignoren|olvida|olvidar|olvide|olviden|omite|omita|omitir)\b[^.!?\n]{0,30}\b(instrucciones|reglas|normas|indicaciones)\b/,
      /\b(ignorez|ignorer|ignore|oublie|oubliez|oublier)\b[^.!?\n]{0,30}\b(instructions|regles|consignes)\b/,
      /\b(bo qua|phot lo|quen di|quen)\b[^.!?\n]{0,30}\b(huong dan|quy tac|quy dinh|chi thi|lenh)\b/,
      /\b(inyore|bliye)\b[^.!?\n]{0,30}\b(enstriksyon|reg|regleman|lod)\b/,
      /(忽略|无视|忽视|不要理会|忘记|忘掉|忽略掉)[^。！？\n]{0,12}(指令|指示|规则|提示|说明)/,
      /(تجاهل|انس|إنس|تخط)[^.!؟\n]{0,25}(التعليمات|القواعد|الأوامر|التوجيهات)/,
      // ru (run on the lowercased original: NFKD folding would turn й into и)
      /(игнорир\S*|не обращай внимания на|не обращайте внимания на|забудь\S*|забуд\S*|пропусти\S*|отмени\S*)[^.!?\n]{0,40}(инструкци\S*|правил\S*|указани\S*|ограничени\S*|политик\S*)/,
      // ko: object first ("이전의 모든 지시를 무시하고") or verb first
      /(지시|지침|규칙|명령|안내|프롬프트|정책)[^.!?\n]{0,15}(무시|잊어|잊고)/,
      /(무시하고|무시해|잊어버려)[^.!?\n]{0,15}(지시|지침|규칙|명령)/,
      // tl
      /\b(huwag pansinin|wag pansinin|huwag sundin|wag sundin|balewalain|kalimutan|i-?ignore)\b[^.!?\n]{0,40}\b(tagubilin|panuntunan|patakaran|alituntunin|utos|instructions?|rules?)\b/,
      // leetspeak, on the leet-folded copy (1→l, so "ignore" may read "lgnore")
      /\b[il]gn[o0]re\b[^.!?\n]{0,40}\b(lnstructl[o0]ns?|instructions?|ru[il]es?|p[o0][il]ic(?:y|ies))\b/,
    ],
  },
  {
    id: 'system_marker',
    patterns: [
      /system\s*prompt/,
      /<\|?\s*(system|im_start|im_end|endoftext)\s*\|?>/,
      /\[\/?(inst|system|sys)\]/,
      /^\s*(system|assistant|developer)\s*:/m,
      /#{2,}\s*(instruction|system|new rules)/,
      /<\/?(system|instructions?|prompt)>/,
      /\b(prompt|indicaciones|instrucciones) del sistema\b/,
      /\b(loi nhac|chi thi) he thong\b/,
      /(系统提示|系统指令|系统消息)/,
      /(موجه النظام|تعليمات النظام)/,
      /(системн\S* (промпт|инструкци\S*|сообщени\S*))/,
      /(시스템 프롬프트|시스템 지시|시스템 메시지)/,
    ],
  },
  {
    id: 'role_override',
    patterns: [
      /\byou are now\b/,
      /\bfrom now on,? you\b/,
      /\b(act|behave) as (an? |the )?(admin|administrator|organizer|developer|system|supervisor)\b/,
      /\bpretend (to be|you are)\b/,
      /\b(developer|god|admin) mode\b/,
      /\bjailbreak|\bdo anything now\b/,
      /\b(ahora eres|a partir de ahora eres|actua como (un )?(administrador|organizador))\b/,
      /\b(tu es maintenant|vous etes maintenant)\b/,
      /\b(bay gio ban la|tu gio ban la)\b/,
      /\bkounye a ou se\b/,
      /(你现在是|从现在起你|从现在开始你|假装你是)/,
      /(أنت الآن|انت الان|من الآن أنت)/,
      /(теперь ты|ты теперь|отныне ты|притворись)/,
      /(지금부터 너는|이제 너는|이제 당신은|지금부터 당신은)/,
      /\b(ikaw na ngayon ang|mula ngayon ikaw)\b/,
      // Role-play: a role-play verb aimed at a privileged role ("Hãy đóng vai người tổ chức", "joue le rôle de l'organisateur").
      new RegExp(`(${ROLE_PLAY_VERBS})[^.!?。！？\\n]{0,30}(${PRIVILEGED_ROLES})`, 'u'),
      // Korean puts the role first: "운영자 역할을 해 주세요", "관리자인 척 해".
      new RegExp(`(${PRIVILEGED_ROLES})[^.!?\\n]{0,6}(역할을|역할극|인 척|인척|처럼 행동)`, 'u'),
    ],
  },
  {
    id: 'approval_coercion',
    patterns: [
      /\b(auto[- ]?approved?|pre[- ]?approved)\b/,
      /\bapprove\b[^.!?\n]{0,25}\b(automatically|without (review|checking|verification|approval|a second))\b/,
      /\b(you|agent|ai|assistant|system|bot)\s+(must|should|will|have to|need to|are required to)\s+approve\b/,
      /\bmark\b[^.!?\n]{0,25}\bas\s+(approved|verified|paid|priority|eligible)\b/,
      /\b(skip|bypass|override|disable)\b[^.!?\n]{0,25}\b(approvals?|review|verification|caps?|limits?|two[- ]person|second approver)\b/,
      /\bset (the )?(amount|payout|cap|limit) to\b/,
      // Instructions about the amount field ("please put 3000 in the amount", "change the amount to"), not "I put…".
      /(?<!\b(i|we|i ve|i have|i d|they|she|he) )\b(put|enter|type|write|change|raise|increase|bump|make)\b[^.!?\n]{0,25}\b(in|into|as|to|for)\s+(the\s+)?(amount|payout|requested amount|amount field)\b/,
      /\bthe (real|correct|actual|right) amount (is|should be)\b/,
      /\b(pon|ponga|pongan|cambia|cambie|escribe|escriba)\b[^.!?\n]{0,25}\b(en el|como el?)\s+(monto|cantidad|importe)\b/,
      /\b(mettez|mets|mettre|changez|ecrivez|inscrivez)\b[^.!?\n]{0,25}\b(comme|dans le|au)\s+montant\b/,
      /\b(ghi|dat|doi|nhap)\b[^.!?\n]{0,20}\bso tien (la|thanh)\b/,
      /(金额(改为|设为|写成|填)|把金额)/,
      /(поставь\S*|впиши\S*|измени\S*|укажи\S*)[^.!?\n]{0,25}(сумм\S*)/,
      /(금액을)[^.!?\n]{0,15}(설정|변경|입력|바꿔|올려)/,
      /\b(aprobacion automatica|aprueba(?:lo|la)? automaticamente|debes aprobar|marca(?:lo|la)? como aprobad[oa])\b/,
      /\b(approuve[zr]? automatiquement|approbation automatique)\b/,
      /\b(tu dong phe duyet|tu dong duyet|phai phe duyet|bo qua (buoc )?(phe )?duyet)\b/,
      /\b(apwouve l otomatikman|ou dwe apwouve)\b/,
      /(自动批准|直接批准|必须批准|跳过审核|跳过审批|标记为已批准)/,
      /(وافق تلقائيا|الموافقة التلقائية|يجب أن توافق|يجب ان توافق)/,
      /(одобр\S* автоматически|автоматически одобр\S*|автоматическ\S* одобрени\S*|(ты|вы) должн\S* одобрить|без (проверки|одобрения))/,
      /(자동으로 승인|자동 승인|승인해야 (한다|합니다|해)|검토 없이 승인|승인된 것으로 표시)/,
      /\b(awtomatikong (i-?)?aprubahan|dapat mong aprubahan|dapat ninyong aprubahan|aprubahan nang walang)\b/,
      /\bappr[o0][vu]e\b[^.!?\n]{0,25}\b(automat[il]cal+y|w[il]th[o0]ut (review|check[il]ng|ver[il]f[il]cat[il][o0]n))\b/,
    ],
  },
  {
    id: 'structured_payload',
    patterns: [
      /\b(function_call|tool_call|tool_use|tool_result)\b/,
      /<\/?(tool|function)[\s>]/,
      /\{\s*"[a-z_]{2,40}"\s*:/,
      /"(requestedamountcents|amountcents|approved|approvers|status|policy)"\s*:/,
    ],
  },
  {
    // Text written to the model rather than to the organizers: "(Note for the AI system: …)",
    // "Message to the assistant: …", "To the AI, …". A neighbor describing a need never needs this.
    id: 'addressed_to_ai',
    patterns: [
      /\b(note|message|instructions?|memo|reminder|ps|p\.s\.)\s+(for|to)\s+(the\s+|any\s+|this\s+)?(ai|a\.i\.|assistant|ai assistant|ai system|chatbot|language model|llm)\b/,
      /\b(to|dear|hey|hi|attention)\s+(the\s+)?(ai|a\.i\.|ai system|ai assistant|assistant|chatbot|language model|llm|bot)\s*[:,—-]/,
      /\bto the (ai|ai system|language model|llm|chatbot)\b/,
      /\b(nota|mensaje|instrucciones?)\s+(para|a|al)\s+(la\s+|el\s+)?(ia|asistente)\b/,
      /\b(note|message)\s+(pour|a)\s+(l\s*|le\s+)?(ia|assistant)\b/,
      /\b(ghi chu|loi nhan|tin nhan)\s+(cho|gui)\s+(ai|tro ly)\b/,
      /(给ai的|给人工智能|给助手的|致ai|致助手)/,
      /(записка|сообщение|примечание|заметка)\s+(для|к)\s+(ии|ai|ассистент\S*|нейросет\S*)/,
      /(ai에게|인공지능에게|어시스턴트에게|챗봇에게)/,
      /\b(paalala|mensahe|tala)\s+(para sa|sa)\s+(ai|assistant)\b/,
      /\b(not|mesaj|enstriksyon)\s+(pou|bay)\s+(ai|ia|asistan|entelijans atifisyel)\b/,
      // ar (folded: hamza forms → bare alef): "ملاحظة للذكاء الاصطناعي", "رسالة إلى المساعد", "إلى الذكاء الاصطناعي:"
      /(ملاحظة|رسالة|تعليمات|تنبيه|تذكير|ملحوظة)\s*(لل|الى ال|ل)(ذكاء الاصطناعي|ذكاء الصناعي|مساعد|روبوت|بوت|نظام)/,
      /(الى|يا|عزيزي)\s+(الذكاء الاصطناعي|المساعد الذكي|الروبوت)\s*[:،,]/,
      /(给|致)\s*(人工智能|ai|助手|机器人)\s*[:：,，]/,
    ],
  },
];

/**
 * Claims that someone in charge already approved the request or raised the person's limit. Alone
 * this is not flagged (a neighbor may truthfully say an organizer approved them); it is flagged next
 * to an amount above the household cap in the same sentence (see detectPromptInjection).
 */
export const AUTHORITY_CLAIMS: readonly RegExp[] = [
  /\b(organi[sz]ers?|admins?|administrators?|coordinators?|moderators?|supervisors?|treasurer|staff|the team|the group|paypal|venmo)\b[^.!?\n]{0,30}\b(already |have |has |)(approved|authori[sz]ed|okayed|ok d|verified|signed off|agreed|confirmed|raised|increased|waived|lifted|doubled|cleared)\b/,
  /\b(limit|cap|maximum|max|allowance|ceiling)\b[^.!?\n]{0,20}\b(was|has been|is|got|been|were)\s+(raised|increased|lifted|waived|removed|doubled|extended|bumped)\b/,
  /\b(organizador(es|as)?|administrador(es|as)?|coordinador(es|as)?|el equipo|el grupo)\b[^.!?\n]{0,25}\b(ya )?(aprobaron|aprobo|autorizaron|autorizo|verificaron|confirmaron|subieron|aumentaron)\b/,
  /\b(limite|tope|maximo)\b[^.!?\n]{0,20}\b(subio|aumento|subieron|aumentaron|fue (subido|aumentado|ampliado))\b/,
  /\b(organisat(eur|rice)s?|administrat(eur|rice)s?|l equipe|le groupe)\b[^.!?\n]{0,25}\b(ont|a) (deja )?(approuve|autorise|valide|confirme|augmente|releve)\b/,
  /\b(plafond|limite)\b[^.!?\n]{0,20}\b(a ete|est) (augmente|releve|leve|double)e?\b/,
  /\b(ban to chuc|nguoi to chuc|quan tri( vien)?)\b[^.!?\n]{0,20}\b(da )?(duyet|phe duyet|dong y|cho phep|xac nhan|tang)\b/,
  /\b(oganizate|organizate|administrate)\b[^.!?\n]{0,20}\b(te |deja )?(apwouve|dako|otorize|ogmante|verifye)\b/,
  /(组织者|负责人|管理员|工作人员|互助组|组织)[^。！？\n]{0,8}(已经|已)?(同意|批准|确认|核实|提高|上调|授权)/,
  /(المنظمون|المنظمين|المنظم|المسؤول|الادارة|المشرف)[^.!؟\n]{0,20}(وافق|اكد|صادق|رفع|سمح)/,
  /(организатор\S*|администратор\S*|координатор\S*)[^.!?\n]{0,25}(одобрил\S*|разрешил\S*|подтвердил\S*|повысил\S*|утвердил\S*|согласовал\S*)/,
  /(лимит\S*|предел\S*)[^.!?\n]{0,20}(повысил\S*|увеличил\S*|подняли|сняли)/,
  /(운영진|관리자|주최측|담당자|운영자)[^.!?\n]{0,15}(승인|허락|확인|동의|올려)/,
  /\b(organizer|tagapag-?ayos|admin|tagapamahala)\b[^.!?\n]{0,25}\b(pumayag|nag-?apruba|inaprubahan|aprubado|tinaasan)\b/,
];

/** Payment verbs (folded). A large amount only counts when one of these directs it (see detectPromptInjection). */
export const DIRECTIVE =
  /\b(send|pay|transfer|wire|give|release|disburse|approve|deposit|(?:envia|envie|manda|mande|paga|pague|transfiere|deposita)(?:me|nos|le|les)?|gui|chuyen|voye|peye|envoyez|envoie|versez|virez|payez|ipadala|bayaran)\b(?!\w)|(отправь|пришли|переведи|перечисли|发|转|汇|给我|ارسل|أرسل|حول|ادفع|보내|송금|입금)/gu;

/**
 * What may come right before an imperative payment verb: a clause start or "please". Not "and" or
 * "just": "we work and pay $4,500 in rent" describes a life, it does not give an order.
 */
export const IMPERATIVE_LEAD =
  /(^|[.!?;:,\n。！？，；：()"“]|(?<![\p{L}\p{N}])(please|pls|plz|kindly|por favor|favor de|s il vous plait|svp|tanpri|xin|hay|paki|пожалуйста)|请你?|马上|立刻|제발|빨리)\s*$/u;

/** "send me …", "envíame", "给我转", "отправь мне": the payment is directed to the writer. */
export const SELF_RECIPIENT =
  /\b(send|pay|give|transfer|wire) me\b|\b(enviame|mandame|pagame|dame|transfiereme|depositame|envoyez-moi|envoie-moi|donne-moi|donnez-moi|versez-moi|voye (ban |ba )?(mwen|m)|ban mwen|ba mwen|gui cho toi|chuyen cho toi|chuyen khoan cho toi|ipadala sa akin|padalhan mo ako|bigyan mo ako)\b|给我|转给我|汇给我|打给我|发给我|لي(?![\p{L}])|мне(?![\p{L}])|저에게|나에게|제게/u;

/** "… $5,000 to me / to @x / to my Venmo / sou Venmo mwen / 到我的Venmo" right after the amount. */
export const RECIPIENT_AFTER =
  /^\s*(dollars?|usd|dolares|dolar|dola|do la|美元|美金|块|دولار|долларов|달러)?\s*(right away|right now|today|now|asap|immediately|hoy|ahora|ya|tout de suite|kounye a|jodi a|ngay)?\s*(to|into|onto|on|a|al|en|sur|sou|vao|cho|sa|na|на|para|pour|到|至)\s+(me\b|my (venmo|paypal|account|cash ?app|zelle|bank)|mi (venmo|paypal|cuenta)|mon (venmo|paypal|compte)|venmo|paypal|@|[a-z0-9._%+-]+@|tai khoan|我的|мой|мою)/u;
