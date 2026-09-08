/**
 * CP-print-token-flow A.1 — `users.addresses[0]` → `StandardPrintParty`.
 * Sin dirección devuelve `{}`: el spread no agrega claves y el compositor no
 * emite fila (invariante 1). NO se fabrica ubicación por defecto — ver el
 * docblock de `customer-address.ts` y la regla del lado XML
 * (`dian-geography.ts`: «NUNCA rellenar Bogotá en silencio»).
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

  it('sin dirección devuelve `{}` (no se inventa ubicación)', () => {
    expect(mapUserAddress(null)).toEqual({});
    expect(mapUserAddress(undefined)).toEqual({});
    expect(mapUserAddress({})).toEqual({});
  });

  it('campos en blanco cuentan como «sin dirección»', () => {
    expect(
      mapUserAddress({
        address_line1: '   ',
        address_line2: '',
        city: '  ',
        state_province: null,
        country: '',
        country_code: '   ',
      }),
    ).toEqual({});
  });

  it('solo ciudad produce `address` con la ciudad (más país fallback CO)', () => {
    expect(mapUserAddress({ city: 'Cali' })).toEqual({
      address: 'Cali',
      city: 'Cali',
      country: 'CO',
    });
  });

  it('solo departamento: `address` usa el departamento, nunca el código ISO', () => {
    const out = mapUserAddress({ state_province: 'Antioquia' });
    expect(out.address).toBe('Antioquia');
    expect(out.state_province).toBe('Antioquia');
    expect(out.country).toBe('CO');
  });

  it('con país pero sin calle/ciudad/departamento no se inventa `address`', () => {
    // Conocer el país no autoriza a escribir un renglón de dirección: caer
    // hasta el país imprimiría «CO» donde va la calle.
    expect(mapUserAddress({ country_code: 'CO' })).toEqual({ country: 'CO' });
    expect(mapUserAddress({ country_code: 'CO' }).address).toBeUndefined();
  });
});
