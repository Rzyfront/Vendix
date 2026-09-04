/**
 * CP-print-token-flow A.1 — `users.addresses[0]` → `StandardPrintParty`.
 * Sin dirección: `{}` para que el compositor no emita fila (invariante 1).
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

  it('sin dirección devuelve objeto vacío (sin claves que pintar)', () => {
    expect(mapUserAddress(null)).toEqual({});
    expect(mapUserAddress(undefined)).toEqual({});
    expect(mapUserAddress({})).toEqual({});
  });

  it('solo ciudad produce `address` con la ciudad', () => {
    expect(mapUserAddress({ city: 'Cali' })).toEqual({
      address: 'Cali',
      city: 'Cali',
    });
  });
});
