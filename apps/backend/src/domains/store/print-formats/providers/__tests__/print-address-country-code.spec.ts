/**
 * Regresión SYS_INTERNAL_001 en POST /api/store/print-formats/render:
 * `addresses` NO tiene columna `country` (solo `country_code` — ver
 * `model addresses` en schema.prisma). Pedir `country: true` en un `select`
 * lanza `Unknown field 'country' for select statement` (500).
 *
 * Fija además el fallback CO/Bogotá de `mapUserAddress` (siempre emite) y la
 * prioridad `country_code` real > `country` legacy > `'CO'`.
 */
import * as fs from 'fs';
import * as path from 'path';
import { mapUserAddress } from '../../lib/customer-address';

const PROVIDER_FILES = [
  '../fiscal-document-print.mapper.ts',
  '../withholding-suffered.provider.ts',
  '../withholding-practiced.provider.ts',
  '../withholding-employee.provider.ts',
];

function readProvider(rel: string): string {
  return fs.readFileSync(path.join(__dirname, rel), 'utf8');
}

describe('print-formats: selects de direcciones usan country_code (no country)', () => {
  it.each(PROVIDER_FILES)(
    '%s: ningún select pide `country: true`; pide `country_code: true`',
    (rel) => {
      const src = readProvider(rel);
      // `country\s*:` NO matchea `country_code:` (tras `country` viene `_`,
      // no `:`), así que este grep solo caza la columna inexistente.
      expect(src).not.toMatch(/country\s*:\s*true/);
      expect(src).toMatch(/country_code\s*:\s*true/);
    },
  );
});

describe('mapUserAddress: fallback CO/Bogotá + prioridad country_code', () => {
  it('sin dirección (null/undefined/vacía) devuelve el default CO/Bogotá', () => {
    const expected = {
      address: 'Bogotá D.C., CO',
      city: 'Bogotá D.C.',
      country: 'CO',
    };
    expect(mapUserAddress(null)).toEqual(expected);
    expect(mapUserAddress(undefined)).toEqual(expected);
    expect(mapUserAddress({})).toEqual(expected);
  });

  it('`country_code` real manda sobre `country` legacy', () => {
    expect(
      mapUserAddress({ city: 'Medellín', country: 'US', country_code: 'CO' })
        .country,
    ).toBe('CO');
  });

  it('`country` legacy sigue funcionando cuando no hay `country_code`', () => {
    const out = mapUserAddress({ city: 'Cali', country: 'US' });
    expect(out.country).toBe('US');
    expect(out.address).toBe('Cali');
  });

  it('sin país en la fila, el país cae a `CO` pero conserva la dirección', () => {
    const out = mapUserAddress({
      address_line1: 'Calle 45 # 12-30',
      city: 'Bogotá D.C.',
    });
    expect(out.country).toBe('CO');
    expect(out.address).toBe('Calle 45 # 12-30, Bogotá D.C.');
  });
});
