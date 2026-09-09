/**
 * Regresión SYS_INTERNAL_001 en POST /api/store/print-formats/render:
 * `addresses` NO tiene columna `country` (solo `country_code` — ver
 * `model addresses` en schema.prisma). Pedir `country: true` en un `select`
 * lanza `Unknown field 'country' for select statement` (500).
 *
 * Fija además la prioridad `country_code` real > `country` legacy > `'CO'`, y
 * el candado anti-relleno: `mapUserAddress` NO fabrica ubicación cuando el
 * adquirente no tiene dirección (ver `customer-address.ts` y la regla del lado
 * XML en `dian-geography.ts` / `ubl-common.builder.ts`).
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

describe('mapUserAddress: sin relleno + prioridad country_code', () => {
  it('sin dirección (null/undefined/vacía) devuelve `{}`', () => {
    expect(mapUserAddress(null)).toEqual({});
    expect(mapUserAddress(undefined)).toEqual({});
    expect(mapUserAddress({})).toEqual({});
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

describe('candado anti-relleno: `customer-address.ts` no fabrica domicilio', () => {
  const SRC = fs.readFileSync(
    path.join(__dirname, '../../lib/customer-address.ts'),
    'utf8',
  );
  // Se quitan comentarios: el docblock SÍ menciona Bogotá — explica por qué
  // no se rellena, citando la regla del XML. Lo prohibido es el literal vivo.
  const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

  it('ningún literal ejecutable menciona Bogotá', () => {
    expect(CODE).not.toMatch(/Bogot/);
  });

  it('el camino «sin datos» retorna vacío, no un objeto con claves', () => {
    // Falla si alguien reintroduce `return { address: ..., city: ... }` en la
    // rama de «no hay dirección».
    expect(CODE).toMatch(/if\s*\(!hasAny\)\s*return\s*\{\s*\}\s*;/);
  });
});
