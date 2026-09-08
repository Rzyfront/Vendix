/**
 * CP-print-token-flow A.1 — `users.addresses[0]` → `StandardPrintParty`.
 * Sin dirección: default Colombia / Bogotá D.C. (siempre emite).
 */
import { mapUserAddress } from '../customer-address';

describe('mapUserAddress', () => {
  it('combina línea 1, línea 2 y ciudad en `address`', () => {
    expect(
      mapUserAddress({
        address_line1: 'Carrera 15 # 88-64',
        address_line2: 'Apto 501',
        city: 'Bogotá D.C.',
        state_province: 'Cundinamarca',
        country: 'CO',
      }),
    ).toEqual({
      address: 'Carrera 15 # 88-64, Apto 501, Bogotá D.C.',
      address_line1: 'Carrera 15 # 88-64',
      address_line2: 'Apto 501',
      city: 'Bogotá D.C.',
      state_province: 'Cundinamarca',
      country: 'CO',
    });
  });

  it('sin dirección devuelve el default CO/Bogotá (siempre emite)', () => {
    const expected = {
      address: 'Bogotá D.C., CO',
      city: 'Bogotá D.C.',
      country: 'CO',
    };
    expect(mapUserAddress(null)).toEqual(expected);
    expect(mapUserAddress(undefined)).toEqual(expected);
    expect(mapUserAddress({})).toEqual(expected);
  });

  it('solo ciudad produce `address` con la ciudad (más país fallback CO)', () => {
    expect(mapUserAddress({ city: 'Cali' })).toEqual({
      address: 'Cali',
      city: 'Cali',
      country: 'CO',
    });
  });
});
