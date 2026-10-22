import { cashMovementDetail } from './cash-session-report.component';

describe('cashMovementDetail', () => {
  it('recorta, omite vacíos y repetidos', () => {
    expect(cashMovementDetail(['a', ' a ', null, 'b'])).toBe('a · b');
  });

  it('devuelve cadena vacía si no hay partes útiles', () => {
    expect(cashMovementDetail([null, undefined, '  '])).toBe('');
  });

  it('conserva el orden de primera aparición', () => {
    expect(cashMovementDetail(['X', 'Taxi', 'X'])).toBe('X · Taxi');
  });
});
