/**
 * Prompt-injection heuristics for request text (any language). Result is only ever a `review`
 * flag: the intake agent has no money tools and amounts are computed from policy regardless.
 *
 * Design rule — protect the rail, not suspect the person: polite pleas ("please approve my
 * request", "I need $1,200 for rent") must NOT match. We look for text that addresses the
 * system (instructions, roles, markers, coercing approval) rather than describing a need.
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
  | 'addressed_to_ai';

export interface InjectionSignal {
  id: InjectionSignalId;
  excerpt: string;
}

type Rule = { id: InjectionSignalId; patterns: RegExp[] };

// Patterns run against a lowercased, diacritic-stripped copy (Latin scripts) AND the lowercased original
// (CJK / Arabic), so write Latin-script patterns without accents.
const RULES: Rule[] = [
  {
    id: 'ignore_instructions',
    patterns: [
      /\b(ignore|disregard|forget|override|bypass)\b[^.!?\n]{0,40}\b(instructions?|rules?|polic(?:y|ies)|prompts?|guidelines?|constraints?)\b/,
      /\b(ignora|ignore|ignoren|olvida|olvide|olviden|omite|omita)\b[^.!?\n]{0,30}\b(instrucciones|reglas|normas|indicaciones)\b/,
      /\b(ignorez|ignore|oublie|oubliez)\b[^.!?\n]{0,30}\b(instructions|regles|consignes)\b/,
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
    ],
  },
];

const DIRECTIVE =
  /\b(send|pay|transfer|wire|give|release|disburse|approve|deposit|envia|envie|manda|mande|paga|pague|transfiere|deposita|gui|chuyen|voye|peye)\b(?!\w)|(发|转|汇|给我|ارسل|أرسل|حول|ادفع)/;
const AMOUNT =
  /(?:\$|usd\s?)\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?|(\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?\s?(?:dollars?|usd|dolares|dolar|do la|dola|美元|美金|块|دولار)/g;

const HIDDEN = /[\u200B\u202A-\u202E\u2060\u2066-\u2069]|[\u{E0000}-\u{E007F}]/u;
const BLOB = /[A-Za-z0-9+/]{60,}={0,2}|\b[0-9a-f]{64,}\b/;

/** Lowercase, NFKC, strip diacritics (đ→d), collapse whitespace. */
export function foldText(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/đ/g, 'd')
    .replace(/[’'`]/g, ' ')
    .replace(/\s+/g, ' ');
}

/** Undo common leetspeak ("1gn0re y0ur ru1es") so the same patterns see letters. 1 becomes l. */
export function unLeet(folded: string): string {
  return folded.replace(/[0134578@$|]/g, (c) => ({ '0': 'o', '1': 'l', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b', '@': 'a', $: 's', '|': 'l' })[c] ?? c);
}

const MAX_EXCERPT = 48;
const excerptAt = (text: string, index: number, len: number): string => {
  const raw = text.slice(index, index + Math.min(len, MAX_EXCERPT)).trim();
  return len > MAX_EXCERPT ? `${raw}…` : raw;
};

export interface InjectionOptions {
  /** Amounts above this (in cents), paired with a directive verb, are flagged. */
  largeAmountCents?: number;
}

export function detectPromptInjection(text: string, opts: InjectionOptions = {}): InjectionSignal[] {
  if (!text) return [];
  const signals: InjectionSignal[] = [];
  const lowered = text.normalize('NFKC').toLowerCase();
  const folded = foldText(text);
  // Only words that mix letters and digits are rewritten, so "$150" and "9000" stay numbers.
  const leet = /[a-z][0134578@$|]|[0134578@$|][a-z]/.test(folded) ? folded.replace(/\S+/g, (w) => (/[a-z]/.test(w) && /[0134578@$|]/.test(w) ? unLeet(w) : w)) : null;

  for (const rule of RULES) {
    for (const re of rule.patterns) {
      const m = re.exec(folded) ?? re.exec(lowered) ?? (leet ? re.exec(leet) : null);
      if (m) {
        signals.push({ id: rule.id, excerpt: excerptAt(m.input, m.index, m[0].length) });
        break;
      }
    }
  }
  const hidden = HIDDEN.exec(text) ?? (text.indexOf('\uFEFF', 1) > 0 ? ['\uFEFF'] : null);
  if (hidden) signals.push({ id: 'hidden_characters', excerpt: `U+${(hidden[0].codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, '0')}` });

  const blob = BLOB.exec(text);
  if (blob && /\d/.test(blob[0]) && /[a-z]/i.test(blob[0])) {
    signals.push({ id: 'encoded_blob', excerpt: `${blob[0].slice(0, 16)}… (${blob[0].length} chars)` });
  }

  if (opts.largeAmountCents !== undefined) {
    for (const m of folded.matchAll(AMOUNT)) {
      const digits = (m[1] ?? m[2] ?? '').replace(/,/g, '');
      const cents = Number(digits) * 100;
      if (!Number.isFinite(cents) || cents <= opts.largeAmountCents) continue;
      const before = folded.slice(Math.max(0, (m.index ?? 0) - 24), m.index ?? 0);
      if (DIRECTIVE.test(before)) {
        signals.push({ id: 'large_amount_directive', excerpt: excerptAt(folded, Math.max(0, (m.index ?? 0) - 24), 24 + m[0].length) });
        break;
      }
    }
  }
  return signals;
}
