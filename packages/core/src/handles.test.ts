import { describe, expect, it } from 'vitest';
import { hasNonLatinLetters, latinizeLookalikes } from './handles.js';
import { checkHandles } from './rail.js';

describe('latinizeLookalikes (EVAL finding 4)', () => {
  it('maps Cyrillic/Greek lookalikes inside Latin words and handles', () => {
    expect(latinizeLookalikes('Venmo @riversіde-pantry')).toBe('Venmo @riverside-pantry'); // Cyrillic і
    expect(latinizeLookalikes('@раntry-help')).toBe('@pantry-help'); // all-lookalike handle
    expect(latinizeLookalikes('mail оrg@exаmple.com')).toBe('mail org@example.com');
    expect(latinizeLookalikes('@sοphia-k')).toBe('@sophia-k'); // Greek ο
  });
  it('leaves words written wholly in another script alone', () => {
    expect(latinizeLookalikes('мой венмо собака ivan')).toBe('мой венмо собака ivan');
    expect(latinizeLookalikes('我的是lina.zhang')).toBe('我的是lina.zhang');
    expect(latinizeLookalikes('Нужны лекарства')).toBe('Нужны лекарства');
  });
  it('a lookalike handle keeps looking like the group handle after latinizing (not after stripping)', () => {
    const group = ['@riverside-pantry-org'];
    const attack = '@riverside-pantrу-оrg'; // Cyrillic у and о
    const stripped = attack.replace(/[^\x00-\x7f]/g, '');
    const latin = latinizeLookalikes(attack);
    expect(hasNonLatinLetters(attack)).toBe(true);
    expect(latin).toBe('@riverside-pantry-org');
    expect(checkHandles({ type: 'USER_HANDLE', value: latin }, group, []).map((f) => f.code)).toEqual(['DEST_IS_GROUP_HANDLE']);
    expect(stripped).toBe('@riverside-pantr-rg');
  });
});
