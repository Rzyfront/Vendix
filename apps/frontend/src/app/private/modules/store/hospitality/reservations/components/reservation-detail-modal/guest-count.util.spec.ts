import { guestCountLabel } from './guest-count.util';

describe('guestCountLabel', () => {
  it('singular and plural adults', () => {
    expect(guestCountLabel(1, 0)).toBe('1 adulto');
    expect(guestCountLabel(2, 0)).toBe('2 adultos');
  });

  it('singular and plural children', () => {
    expect(guestCountLabel(1, 1)).toBe('1 adulto · 1 niño');
    expect(guestCountLabel(2, 2)).toBe('2 adultos · 2 niños');
  });
});
