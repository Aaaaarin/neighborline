import { describe, expect, it } from 'vitest';
import { getScenario } from '../fixtures/scenarios.js';
import { detectAddressForm, isGroundedAddressForm } from './address-form.js';
import { finalizeExtraction } from './grounding.js';
import { heuristicExtract } from './heuristic.js';

describe('detectAddressForm (Vietnamese, from the person’s own words)', () => {
  it.each([
    ['Xin chào, tôi là bà Lan, ở khu Eastside. … tôi với ông nhà tôi. Cảm ơn các cháu nhiều lắm.', 'bà'],
    ['Chào các cháu, tôi là ông Sáu. Nhà tôi bị mất điện.', 'ông'],
    ['Tui là cô Hạnh, nhà ở đường Pine.', 'cô'],
    ['Tôi là chú Tâm, xe tôi bị hư.', 'chú'],
    ['Bác tên là Tư. Bác cần tiền thuốc.', 'bác'],
    ['Chào anh chị, em là Hoa. Em cần tiền mua đồ ăn.', 'em'],
    ['Mình là chị Mai, nhà có ba người.', 'chị'],
    ['Tôi là anh Dũng, tôi bị cắt giờ làm.', 'anh'],
    ['Nhà tôi mất điện. Cảm ơn các cháu nhiều.', 'bác'],
    ['Các con ơi, nhà bác bị ngập.', 'bác'],
  ])('%s → %s', (text, form) => {
    expect(detectAddressForm(text)).toBe(form);
  });

  it.each([
    'Nhà tôi bị mất điện hai ngày rồi. Venmo của tôi là @an-tran.',
    'Tôi sống với hai con và ông nhà tôi.', // her children and husband, not how she wants to be called
    'Bà tôi bị bệnh, tôi cần tiền thuốc cho bà.', // her grandmother
    'Tôi là người ở khu Eastside.',
  ])('no form: %s', (text) => {
    expect(detectAddressForm(text)).toBeUndefined();
  });

  it('grounds a model form only in the words', () => {
    expect(isGroundedAddressForm('bà', 'tôi là bà Lan')).toBe(true);
    expect(isGroundedAddressForm('bà', 'Nhà tôi mất điện.')).toBe(false);
    expect(isGroundedAddressForm('bác', 'Cảm ơn các cháu.')).toBe(true);
    expect(isGroundedAddressForm('bạn', 'anything')).toBe(true);
    expect(isGroundedAddressForm('chị', 'nhà chịu lạnh')).toBe(false); // "chịu" is not "chị"
  });
});

describe('address form in the extraction', () => {
  const lan = getScenario('lan_vi');
  it('Mrs. Lan’s fixture says "bà", and grounding keeps it', () => {
    expect(lan.extraction.addressForm).toBe('bà');
    expect(finalizeExtraction(lan.extraction, lan.transcript).extraction.addressForm).toBe('bà');
  });
  it('her own self-introduction wins over a model that heard "ông nhà tôi"', () => {
    const { extraction, notes } = finalizeExtraction({ ...lan.extraction, addressForm: 'ông' }, lan.transcript);
    expect(extraction.addressForm).toBe('bà');
    expect(notes.join(' ')).toContain('model said ông');
  });
  it('a model form the words do not back is dropped, and never kept for another language', () => {
    expect(finalizeExtraction({ ...lan.extraction, addressForm: 'chị' }, 'Nhà tôi mất điện, Venmo của tôi là @lan-nguyen54').extraction.addressForm).toBeUndefined();
    const rosa = getScenario('rosa_es');
    expect(finalizeExtraction({ ...rosa.extraction, addressForm: 'bà' }, rosa.transcript).extraction.addressForm).toBeUndefined();
  });
  it('the offline extractor finds it too (vi only)', () => {
    expect(heuristicExtract(lan.transcript, ['utility_outage'], 'vi').addressForm).toBe('bà');
    expect(heuristicExtract('Hola, soy la señora Ana.', ['groceries'], 'es').addressForm).toBeUndefined();
  });
});
