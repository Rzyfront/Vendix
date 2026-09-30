import {
  editedHeaderDiscountFields,
  isHeaderDiscountGross,
  resolveCartHeaderDiscount,
  seedHeaderDiscount,
} from './scan-header-discount.util';

const taxed = { taxes: [{ tax_type: 'iva' as const, tax_rate: 19, calc_mode: 'percent' as const, fixed_amount_per_unit: null, amount_override: null }] };
const legacy = {};
const scan = { discount_amount: 10000, discount_amount_printed: 11900 };

describe('scan-header-discount.util (QUI-855)', () => {
  it('bruto sólo si hay línea con taxes Y impreso > 0', () => {
    expect(isHeaderDiscountGross(scan, [taxed])).toBeTrue();
    expect(isHeaderDiscountGross(scan, [legacy])).toBeFalse();
    expect(isHeaderDiscountGross({ discount_amount: 10000 }, [taxed])).toBeFalse();
  });

  it('siembra en la unidad correspondiente', () => {
    expect(seedHeaderDiscount(scan, [taxed])).toEqual({ value: 11900, gross: true });
    expect(seedHeaderDiscount(scan, [legacy])).toEqual({ value: 10000, gross: false });
  });

  it('cifra editada: bruto ⇒ impreso + equivalente neto; neto ⇒ impreso null', () => {
    expect(editedHeaderDiscountFields(scan, 5950, true)).toEqual({
      discount_amount: 5000,
      discount_amount_printed: 5950,
    });
    expect(editedHeaderDiscountFields(scan, 7, false)).toEqual({
      discount_amount: 7,
      discount_amount_printed: null,
    });
  });

  it('sin descuento de origen ni edición no se emite cifra (null/null)', () => {
    expect(editedHeaderDiscountFields({}, 0, false, 0)).toEqual({
      discount_amount: null,
      discount_amount_printed: null,
    });
    expect(editedHeaderDiscountFields(scan, 0, true, 11900)).toEqual({
      discount_amount: 0,
      discount_amount_printed: 0,
    });
  });

  it('el carrito lee impreso (incluido 0) sólo con líneas taxes; si no, el neto', () => {
    expect(resolveCartHeaderDiscount(scan, [taxed])).toBe(11900);
    expect(resolveCartHeaderDiscount({ ...scan, discount_amount_printed: 0 }, [taxed])).toBe(0);
    expect(resolveCartHeaderDiscount(scan, [legacy])).toBe(10000);
    expect(resolveCartHeaderDiscount({ discount_amount: 10000, discount_amount_printed: null }, [taxed])).toBe(10000);
    expect(resolveCartHeaderDiscount({ discount_amount: null, discount_amount_printed: null }, [taxed])).toBeNull();
  });
});
