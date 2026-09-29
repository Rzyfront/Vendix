import { VendixHttpException } from '@common/errors/vendix-http.exception';
import {
  assertProductTaxComboValid,
  findProductTaxComboViolation,
} from './product-tax-combination.util';

describe('product tax combination (P1-4)', () => {
  const iva = { id: 1, name: 'IVA 19%', tax_type: 'iva', tax_rates: [{ store_id: 7 }] };
  const iva5 = { id: 2, name: 'IVA 5%', tax_type: 'iva', tax_rates: [{ store_id: 7 }] };
  const inc = { id: 3, name: 'INC 8%', tax_type: 'inc', tax_rates: [{ store_id: 7 }] };
  const inc16 = { id: 4, name: 'INC 16%', tax_type: 'inc', tax_rates: [] };
  const ica = { id: 5, name: 'ICA', tax_type: 'ica', tax_rates: [{ store_id: null }] };
  const untyped = { id: 6, name: 'Impuesto viejo', tax_type: null, tax_rates: [] };

  it('vacío y una sola categoría son válidos', () => {
    expect(findProductTaxComboViolation([])).toBeNull();
    expect(findProductTaxComboViolation([iva])).toBeNull();
    expect(findProductTaxComboViolation([inc])).toBeNull();
  });

  it('IVA + ICA e INC + ICA conviven', () => {
    expect(findProductTaxComboViolation([iva, ica], { storeId: 7 })).toBeNull();
    expect(findProductTaxComboViolation([inc, ica], { storeId: 7 })).toBeNull();
  });

  it('dos IVA ⇒ duplicate_tax_type con ambos ids', () => {
    const v = findProductTaxComboViolation([iva, iva5]);
    expect(v?.reason).toBe('duplicate_tax_type');
    expect(v?.tax_category_ids).toEqual([1, 2]);
    expect(v?.message).toContain('2 categorías de IVA');
  });

  it('dos INC ⇒ duplicate_tax_type', () => {
    expect(findProductTaxComboViolation([inc, inc16])?.reason).toBe(
      'duplicate_tax_type',
    );
  });

  it('tax_type null cuenta como IVA (misma lectura que calculateProductTaxes)', () => {
    expect(findProductTaxComboViolation([iva, untyped])?.reason).toBe(
      'duplicate_tax_type',
    );
    expect(findProductTaxComboViolation([untyped, inc])?.reason).toBe(
      'iva_inc_exclusive',
    );
  });

  it('IVA + INC ⇒ iva_inc_exclusive', () => {
    const v = findProductTaxComboViolation([iva, inc]);
    expect(v?.reason).toBe('iva_inc_exclusive');
    expect(v?.tax_category_ids).toEqual([1, 3]);
  });

  it.each(['withholding', 'reteiva', 'reteica'])(
    'retención %s ⇒ withholding_not_assignable',
    (tax_type) => {
      const v = findProductTaxComboViolation([
        iva,
        { id: 9, name: 'Rete', tax_type, tax_rates: [] },
      ]);
      expect(v?.reason).toBe('withholding_not_assignable');
      expect(v?.tax_category_ids).toEqual([9]);
    },
  );

  it('categoría con dos tarifas aplicables a la tienda ⇒ multiple_rates', () => {
    const doble = {
      id: 10,
      name: 'IVA doble',
      tax_type: 'iva',
      tax_rates: [{ store_id: 7 }, { store_id: null }],
    };
    expect(findProductTaxComboViolation([doble], { storeId: 7 })?.reason).toBe(
      'multiple_rates',
    );
  });

  it('tarifas de OTRA tienda no cuentan', () => {
    const global = {
      id: 11,
      name: 'IVA global',
      tax_type: 'iva',
      tax_rates: [{ store_id: 7 }, { store_id: 8 }],
    };
    expect(findProductTaxComboViolation([global], { storeId: 7 })).toBeNull();
    expect(findProductTaxComboViolation([global])?.reason).toBe('multiple_rates');
  });

  it('assert lanza 400 PROD_TAX_COMBO_001 con motivo y detalles', () => {
    let err: any;
    try {
      assertProductTaxComboValid([iva, inc]);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(VendixHttpException);
    expect(err.getStatus()).toBe(400);
    expect(err.errorCode).toBe('PROD_TAX_COMBO_001');
    expect(err.getResponse()).toEqual(
      expect.objectContaining({
        error_code: 'PROD_TAX_COMBO_001',
        details: { reason: 'iva_inc_exclusive', tax_category_ids: [1, 3] },
      }),
    );
  });
});
