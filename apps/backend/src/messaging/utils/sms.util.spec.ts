import {
  countSmsSegments,
  estimateSmsCost,
  normalizeE164,
  parseSmsPriceTable,
  pricePerSegment,
} from './sms.util';

describe('sms.util', () => {
  describe('normalizeE164', () => {
    it.each([
      ['+57 300 123 4567', '+573001234567'],
      ['(300) 123-4567', '+573001234567'],
      ['3001234567', '+573001234567'],
      ['573001234567', '+573001234567'],
      ['0057 300 123 4567', '+573001234567'],
      ['+1 (212) 555-0100', '+12125550100'],
    ])('%s → %s', (raw, expected) => {
      expect(normalizeE164(raw)).toBe(expected);
    });

    it.each([[''], ['   '], [null], ['12'], ['+0123456789'], ['abc'], ['+5730012345678901']])(
      'rejects %p',
      (raw) => {
        expect(normalizeE164(raw as string | null)).toBeNull();
      },
    );
  });

  describe('countSmsSegments', () => {
    it('GSM-7: 160 characters fit in one segment, 161 need two', () => {
      expect(countSmsSegments('a'.repeat(160))).toEqual({ encoding: 'GSM-7', units: 160, segments: 1 });
      expect(countSmsSegments('a'.repeat(161))).toEqual({ encoding: 'GSM-7', units: 161, segments: 2 });
    });

    it('extension characters count double', () => {
      expect(countSmsSegments('€'.repeat(80))).toMatchObject({ units: 160, segments: 1 });
      expect(countSmsSegments('€'.repeat(81))).toMatchObject({ units: 162, segments: 2 });
    });

    it('UCS-2 when a character is outside GSM-7 (accents like á, emoji)', () => {
      expect(countSmsSegments('á'.repeat(70))).toEqual({ encoding: 'UCS-2', units: 70, segments: 1 });
      expect(countSmsSegments('á'.repeat(71))).toEqual({ encoding: 'UCS-2', units: 71, segments: 2 });
      expect(countSmsSegments('Hola 👋')).toMatchObject({ encoding: 'UCS-2' });
    });
  });

  describe('prices', () => {
    it('parses the table and ignores invalid entries', () => {
      expect(parseSmsPriceTable('{"57":0.0075,"1":"0.009","x":1,"58":-1,"default":0.05}')).toEqual({
        '57': 0.0075,
        '1': 0.009,
        default: 0.05,
      });
      expect(parseSmsPriceTable('not json')).toEqual({});
      expect(parseSmsPriceTable(undefined)).toEqual({});
    });

    it('longest calling-code prefix wins, then default, then the fallback', () => {
      const table = { '1': 0.009, '1876': 0.2, default: 0.05 };
      expect(pricePerSegment('+18765550100', table, 1)).toBe(0.2);
      expect(pricePerSegment('+12125550100', table, 1)).toBe(0.009);
      expect(pricePerSegment('+573001234567', table, 1)).toBe(0.05);
      expect(pricePerSegment('+573001234567', {}, 1)).toBe(1);
    });

    it('estimates segments × price, rounded up to 4 decimals without float noise', () => {
      expect(estimateSmsCost('+573001234567', 'Hola', { '57': 0.0075 }, 1).cost).toBe(0.0075);
      expect(estimateSmsCost('+573001234567', 'a'.repeat(161), { '57': 0.0075 }, 1).cost).toBe(0.015);
      expect(estimateSmsCost('+573001234567', 'Hola', { '57': 0.00751 }, 1).cost).toBe(0.0076);
    });
  });
});
