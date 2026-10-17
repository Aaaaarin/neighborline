/**
 * Vietnamese register variants of the message catalog (i18n.ts holds the neutral "bạn" text).
 *
 *  viElder: the neighbor is an elder (bà / ông / cô / chú / bác). Volunteers speak as juniors
 *           ("chúng cháu"), soften with "ạ" / "Dạ", and greet even without a name ("Chào bà ạ").
 *  viPeer:  anh / chị / em. Volunteers stay "chúng tôi"; no "ạ".
 *
 * {you} / {You} are the address form mid-sentence / at a sentence start (address.ts fills them).
 * Written whole per register, never by swapping words in the neutral text. Pure: no I/O.
 */
import { RAIL_REFUSED_NOTICE } from './rail-notice.js';

type Key =
  | 'readback_intro'
  | 'ask_payout'
  | 'ask_household'
  | 'confirmed_waiting'
  | 'approved_sending'
  | 'paid'
  | 'unclaimed_help'
  | 'declined_with_appeal'
  | 'needs_info'
  | 'payout_rail_refused';

export const VI_CATALOG_REGISTERS: { readonly viElder: Readonly<Record<Key, string>>; readonly viPeer: Readonly<Record<Key, string>> } = {
  viElder: {
    readback_intro: 'Dạ, chúng cháu hiểu như sau. {You} xem giúp chúng cháu có đúng không ạ:',
    ask_payout: 'Chúng cháu nên gửi tiền vào đâu ạ? {You} cho chúng cháu xin email PayPal hoặc tên Venmo của {you} ạ.',
    ask_household: 'Nhà {you} có mấy người, tính cả {you} ạ?',
    confirmed_waiting: 'Cảm ơn {you} ạ. Hai tình nguyện viên đang xem yêu cầu của {you}. Có quyết định là chúng cháu nhắn cho {you} ngay ạ.',
    approved_sending: 'Tin vui ạ: yêu cầu của {you} đã được duyệt. Chúng cháu đang gửi {amount} vào {wallet} của {you}.',
    paid: 'Chào {you}[[ {name}]] ạ. Chúng cháu đã gửi {amount} vào {wallet} của {you}. Mong số tiền này giúp được {you} phần nào. {You} giữ gìn sức khỏe nhé ạ.',
    unclaimed_help:
      'Chúng cháu đã gửi {amount} qua {wallet}, nhưng tiền chưa được nhận. Để nhận tiền, {you} mở {wallet} hoặc đăng ký bằng đúng email hoặc số điện thoại {you} đã cho chúng cháu. Nếu cần giúp, {you} cứ trả lời tin nhắn này ạ.',
    declined_with_appeal:
      'Chúng cháu rất tiếc ạ. Theo quy định hiện tại của nhóm, chúng cháu chưa thể gửi tiền cho yêu cầu này. Đây không phải là đánh giá về {you}. Nếu {you} muốn một tình nguyện viên xem lại, {you} cứ trả lời tin nhắn này ạ.',
    needs_info: 'Chào {you}[[ {name}]] ạ. Một tình nguyện viên có một câu hỏi ngắn về yêu cầu của {you}. Khi nào tiện, {you} trả lời ở đây giúp chúng cháu nhé ạ.',
    payout_rail_refused: RAIL_REFUSED_NOTICE.viElder,
  },
  viPeer: {
    readback_intro: 'Đây là những gì chúng tôi hiểu. Xin {you} kiểm tra xem có đúng không:',
    ask_payout: 'Chúng tôi nên gửi tiền vào đâu? {You} có thể cho email PayPal hoặc tên người dùng Venmo.',
    ask_household: 'Nhà {you} có bao nhiêu người, tính cả {you}?',
    confirmed_waiting: 'Cảm ơn {you}. Hai tình nguyện viên đang xem yêu cầu của {you}. Chúng tôi sẽ nhắn cho {you} ngay khi có quyết định.',
    approved_sending: 'Tin vui: yêu cầu của {you} đã được duyệt. Chúng tôi đang gửi {amount} vào {wallet} của {you}.',
    paid: '[[Chào {you} {name}. ]]Đã gửi {amount} vào {wallet} của {you}. Mong số tiền này giúp được {you}. {You} giữ gìn sức khỏe nhé.',
    unclaimed_help:
      'Chúng tôi đã gửi {amount} qua {wallet}, nhưng tiền chưa được nhận. Để nhận tiền, {you} hãy mở {wallet} hoặc đăng ký bằng đúng email hoặc số điện thoại đã cho chúng tôi. Nếu cần giúp, {you} cứ trả lời tin nhắn này.',
    declined_with_appeal:
      'Rất tiếc, theo quy định hiện tại của nhóm, chúng tôi chưa thể gửi tiền cho yêu cầu này. Đây không phải là đánh giá về {you}. Nếu {you} muốn một tình nguyện viên xem lại, xin trả lời tin nhắn này.',
    needs_info: '[[Chào {you} {name}. ]]Một tình nguyện viên có một câu hỏi ngắn về yêu cầu của {you}. {You} vui lòng trả lời ở đây khi tiện nhé.',
    payout_rail_refused: RAIL_REFUSED_NOTICE.viPeer,
  },
};
