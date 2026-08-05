import { BadRequestException } from '@nestjs/common';

import {
  assertPlausibleFiscalDate,
  parsePlausibleFiscalDate,
} from './fiscal-date.util';

/**
 * El caso que motivó estas cotas llegó a producción: una `resolution_date` de
 * `0001-01-01` guardada sin queja, que después viajó al período de autorización
 * del XML y se manifestó horas más tarde como un lote que la DIAN no clasificaba.
 */
describe('fiscal-date.util', () => {
  it('rechaza el año que produce un <input type="date"> a medio teclear', () => {
    expect(() =>
      assertPlausibleFiscalDate('fecha de resolución', new Date('0001-01-01')),
    ).toThrow(BadRequestException);
  });

  it('nombra el campo culpable en el mensaje, no "revisa el formulario"', () => {
    expect(() =>
      parsePlausibleFiscalDate('fecha de resolución', '0001-01-01'),
    ).toThrow(/fecha de resolución/);
  });

  it('rechaza una fecha inválida sin reventar con NaN', () => {
    expect(() =>
      assertPlausibleFiscalDate('válida desde', new Date('no-es-fecha')),
    ).toThrow(/no es una fecha válida/);
  });

  it('rechaza años previos a la facturación electrónica en Colombia', () => {
    expect(() =>
      assertPlausibleFiscalDate('válida desde', new Date('2015-12-31')),
    ).toThrow(BadRequestException);
  });

  it('acepta 2016, el primer año válido', () => {
    expect(() =>
      assertPlausibleFiscalDate('válida desde', new Date('2016-01-01')),
    ).not.toThrow();
  });

  it('acepta la vigencia real de la resolución de habilitación (2019 → 2030)', () => {
    // Los valores que la DIAN asigna en habilitación: si estas cotas los
    // rechazaran, bloquearían el único set de pruebas que existe.
    expect(() =>
      assertPlausibleFiscalDate('válida desde', new Date('2019-01-19')),
    ).not.toThrow();
    expect(() =>
      assertPlausibleFiscalDate('válida hasta', new Date('2030-01-19')),
    ).not.toThrow();
  });

  it('rechaza una fecha más de una década adelante', () => {
    const tooFar = new Date();
    tooFar.setUTCFullYear(tooFar.getUTCFullYear() + 11);
    expect(() =>
      assertPlausibleFiscalDate('válida hasta', tooFar),
    ).toThrow(BadRequestException);
  });

  it('devuelve la fecha convertida cuando es plausible', () => {
    const parsed = parsePlausibleFiscalDate('fecha de resolución', '2024-03-15');
    expect(parsed.toISOString().slice(0, 10)).toBe('2024-03-15');
  });
});
