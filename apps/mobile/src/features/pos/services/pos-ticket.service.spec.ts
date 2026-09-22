// Spec para el spec del backend: apps/backend/src/common/helpers/vat-responsibility.helper.spec.ts.
// Si este spec pasa y el backend no, hay divergencia.

import { isVatResponsible, resolveFiscalQualitiesLine } from './pos-ticket.service';

describe('isVatResponsible (mirror del helper backend)', () => {
  describe('responsabilidad explícita (RUT casilla 53)', () => {
    it('O-48 ⇒ true', () => {
      expect(isVatResponsible({ tax_responsibilities: ['O-48'] } as any)).toBe(true);
    });
    it('O-49 sin O-48 ⇒ false', () => {
      expect(isVatResponsible({ tax_responsibilities: ['O-49'] } as any)).toBe(false);
    });
    it('O-48 coexiste con O-49 ⇒ O-48 gana', () => {
      expect(isVatResponsible({ tax_responsibilities: ['O-48', 'O-49'] } as any)).toBe(true);
    });
  });
  describe('fallback por tax_regime', () => {
    it('COMUN + responsabilidades vacías ⇒ true', () => {
      expect(isVatResponsible({ tax_responsibilities: [], tax_regime: 'COMUN' } as any)).toBe(true);
    });
    it('SIMPLIFICADO + responsabilidades vacías ⇒ false', () => {
      expect(isVatResponsible({ tax_responsibilities: [], tax_regime: 'SIMPLIFICADO' } as any)).toBe(false);
    });
  });
  describe('rama indeterminada (fail-closed post-F4)', () => {
    it('sin responsabilidades y sin régimen ⇒ false', () => {
      expect(isVatResponsible({ tax_responsibilities: [] } as any)).toBe(false);
    });
    it('fiscalData null ⇒ false', () => {
      expect(isVatResponsible(null as any)).toBe(false);
    });
    it('fiscalData undefined ⇒ false', () => {
      expect(isVatResponsible(undefined as any)).toBe(false);
    });
  });
});

/**
 * GEMELO DECLARADO — el mismo cuerpo de casos corre en
 * `apps/frontend/.../pos/services/pos-ticket.service.spec.ts` y en
 * `apps/backend/.../print-formats/services/fiscal-invoice-pdf-render.service.spec.ts`.
 * Si este pasa y alguno de aquellos no, los tiquetes divergieron.
 *
 * Num. 12 del art. 11 de la Res. DIAN 000165/2023: cuatro calidades, y sólo
 * «cuando corresponda». El tiquete NO declara régimen: esa leyenda venía del
 * art. 506 E.T., derogado por la Ley 1943/2018 (art. 122) y la Ley 2010/2019
 * (art. 160).
 */
describe('resolveFiscalQualitiesLine (num. 12 art. 11 Res. 000165/2023)', () => {
  it('Pollo Árabe (INC, sin O-13/O-15/O-23/O-47) ⇒ ninguna línea', () => {
    expect(
      resolveFiscalQualitiesLine([
        'O-05',
        'O-07',
        'O-14',
        'O-33',
        'O-42',
        'O-52',
        'O-55',
      ]),
    ).toBe('');
  });

  it('la leyenda derogada no se reemplaza por «No responsable de IVA»', () => {
    expect(resolveFiscalQualitiesLine(['O-49'])).toBe('');
    expect(resolveFiscalQualitiesLine(['O-48'])).toBe('');
  });

  it('gran contribuyente + autorretenedor ⇒ dos calidades en el orden del num. 12', () => {
    expect(resolveFiscalQualitiesLine(['O-15', 'O-13'])).toBe(
      'Autorretenedor del Impuesto sobre la Renta y Complementarios | Gran contribuyente',
    );
  });

  it('régimen SIMPLE ⇒ su calidad', () => {
    expect(resolveFiscalQualitiesLine(['O-47'])).toBe(
      'Contribuyente del Régimen Simple de Tributación (SIMPLE)',
    );
  });

  it('agente retenedor de IVA ⇒ su calidad', () => {
    expect(resolveFiscalQualitiesLine(['O-23'])).toBe(
      'Agente retenedor del Impuesto sobre las Ventas (IVA)',
    );
  });

  it('normaliza la casilla 53 cruda', () => {
    expect(resolveFiscalQualitiesLine(['13', '15'])).toBe(
      resolveFiscalQualitiesLine(['O-13', 'O-15']),
    );
    expect(resolveFiscalQualitiesLine(['o-47'])).toBe(
      'Contribuyente del Régimen Simple de Tributación (SIMPLE)',
    );
  });

  it('tolera vacío, ausente y entradas no-string', () => {
    expect(resolveFiscalQualitiesLine([])).toBe('');
    expect(resolveFiscalQualitiesLine(undefined)).toBe('');
    expect(resolveFiscalQualitiesLine(null)).toBe('');
    expect(resolveFiscalQualitiesLine([null, 13, {}])).toBe('');
  });
});
