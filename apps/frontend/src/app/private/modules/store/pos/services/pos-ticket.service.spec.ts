/**
 * GEMELO DECLARADO — el mismo cuerpo de casos corre en
 * `apps/mobile/src/features/pos/services/pos-ticket.service.spec.ts` y en
 * `apps/backend/.../print-formats/services/fiscal-invoice-pdf-render.service.spec.ts`.
 * Si este pasa y alguno de aquellos no, los tiquetes divergieron.
 *
 * Num. 12 del art. 11 de la Res. DIAN 000165/2023 — cuatro calidades, y sólo
 * «cuando corresponda». El tiquete NO declara régimen: «Responsable de IVA» /
 * «No responsable de IVA» venían del art. 506 E.T., derogado por la Ley
 * 1943/2018 (art. 122) y la Ley 2010/2019 (art. 160). El defecto medido: Pollo
 * Árabe, restaurante responsable únicamente de INC, imprimía una obligación
 * tributaria que no tiene.
 */
import { resolveFiscalQualitiesLine } from './pos-ticket.service';

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
