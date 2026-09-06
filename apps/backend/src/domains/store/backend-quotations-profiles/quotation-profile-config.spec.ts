import { ErrorCodes, VendixHttpException } from '@common/errors';

import {
  normalizeAndAssertQuotationProfileConfig,
} from './quotation-profile-config';
import { normalizeQuotationName } from './dto/quotation-profile-name';

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (error) {
    return (error as VendixHttpException)?.errorCode;
  }
  return undefined;
}

function responseOf(fn: () => unknown): any {
  try {
    fn();
  } catch (error) {
    return (error as VendixHttpException)?.getResponse?.();
  }
  return undefined;
}

describe('B.1 · normalizeAndAssertQuotationProfileConfig', () => {
  it('acepta el objeto vacío (perfil plantilla sin números)', () => {
    expect(normalizeAndAssertQuotationProfileConfig({})).toEqual({});
  });

  it('acepta porcentajes AIU en rango y recorta textos', () => {
    expect(
      normalizeAndAssertQuotationProfileConfig({
        admin_percent: 8,
        contingency_percent: 5,
        profit_percent: 7,
        validity_days: 30,
        payment_terms: '  50/50  ',
        notes: 'Obra norte',
      }),
    ).toEqual({
      admin_percent: 8,
      contingency_percent: 5,
      profit_percent: 7,
      validity_days: 30,
      payment_terms: '50/50',
      notes: 'Obra norte',
    });
  });

  it('rechaza porcentaje fuera de rango con QPROFILE_CONFIG_001', () => {
    expect(
      codeOf(() =>
        normalizeAndAssertQuotationProfileConfig({ profit_percent: 101 }),
      ),
    ).toBe(ErrorCodes.QPROFILE_CONFIG_001.code);
  });

  it('rechaza porcentaje no numérico y vigencia no entera', () => {
    expect(
      codeOf(() =>
        normalizeAndAssertQuotationProfileConfig({ admin_percent: '8' }),
      ),
    ).toBe(ErrorCodes.QPROFILE_CONFIG_001.code);
    expect(
      codeOf(() =>
        normalizeAndAssertQuotationProfileConfig({ validity_days: 1.5 }),
      ),
    ).toBe(ErrorCodes.QPROFILE_CONFIG_001.code);
  });

  it('rechaza claves desconocidas con su ruta con puntos en details', () => {
    const body = responseOf(() =>
      normalizeAndAssertQuotationProfileConfig({ aiu: 10 }),
    ) as { details?: { issues: Array<{ field: string }> } };
    expect(
      body?.details?.issues?.some((i) => i.field === 'config.aiu'),
    ).toBe(true);
  });

  it('rechaza lo que no es objeto (arreglo, texto, null)', () => {
    for (const bad of [[], 'x', null, 42]) {
      expect(codeOf(() => normalizeAndAssertQuotationProfileConfig(bad))).toBe(
        ErrorCodes.QPROFILE_CONFIG_001.code,
      );
    }
  });

  it('rechaza textos que exceden la cota', () => {
    expect(
      codeOf(() =>
        normalizeAndAssertQuotationProfileConfig({
          payment_terms: 'x'.repeat(501),
        }),
      ),
    ).toBe(ErrorCodes.QPROFILE_CONFIG_001.code);
  });
});

describe('B.1 · normalizeQuotationName', () => {
  it('recorta y colapsa espacios sin tocar la caja', () => {
    expect(normalizeQuotationName('  Obra   norte\t')).toBe('Obra norte');
    expect(normalizeQuotationName('AIU  Obras')).toBe('AIU Obras');
  });
});
