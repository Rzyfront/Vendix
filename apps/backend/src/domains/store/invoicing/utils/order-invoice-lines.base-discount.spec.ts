import { projectOrderInvoiceLines } from './order-invoice-lines.util';
import { projectOrderDiscountedTaxes } from '../../payments/utils/order-sale-tax-payload.util';

/**
 * P1-1 — contrato `order_items.discount_amount` (descuento de BASE por línea).
 * `total_price` = base antes del descuento; `order_item_taxes` ya post-descuento;
 * `orders.discount_amount` = Σ descuentos de base. NULL = contrato legado.
 */
const iva = (rate: string, amount: string) => ({
  tax_name: `IVA ${rate}`,
  tax_rate: rate,
  tax_amount: amount,
  tax_type: 'iva',
  is_inclusive: false,
});
const line = (
  total_price: string,
  discount_amount: string | null,
  tax_amount: string,
  rate: string | null,
) => ({
  quantity: 1,
  total_price,
  discount_amount,
  tax_amount_item: tax_amount,
  order_item_taxes: rate ? [iva(rate, tax_amount)] : [],
});

describe('contrato de descuento de base por línea', () => {
  it('1M al 19 % + 1M exento, cupón 50 %: IVA 95.000, total 1.095.000', () => {
    const items = [
      line('1000000', '500000', '95000', '0.19'),
      line('1000000', '500000', '0', null),
    ];
    const r = projectOrderInvoiceLines(items, '1000000');
    expect(r.error).toBeUndefined();
    expect(r.lines[0].base.toString()).toBe('500000');
    expect(r.lines[0].discount.toString()).toBe('500000');
    expect(r.lines[0].tax_total.toString()).toBe('95000');
    expect(r.lines[1].base.toString()).toBe('500000');
    expect(r.lines[1].tax_total.toString()).toBe('0');
    const tax = r.lines.reduce((a, l) => a + Number(l.tax_total), 0);
    const total = r.lines.reduce((a, l) => a + Number(l.base) + Number(l.tax_total), 0);
    expect(tax).toBe(95000);
    expect(total).toBe(1095000);
    expect(r.allocated_discount.toString()).toBe('1000000');
  });

  it('19 % + 5 % con cupón 10 %', () => {
    // bases 1.000.000 y 500.000; d = 100.000 y 50.000; IVA 171.000 y INC-like 5 % = 22.500
    const items = [
      line('1000000', '100000', '171000', '0.19'),
      line('500000', '50000', '22500', '0.05'),
    ];
    const r = projectOrderInvoiceLines(items, '150000');
    expect(r.error).toBeUndefined();
    expect(r.lines.map((l) => l.base.toString())).toEqual(['900000', '450000']);
    expect(r.lines.map((l) => l.tax_total.toString())).toEqual(['171000', '22500']);
    const total = r.lines.reduce((a, l) => a + Number(l.base) + Number(l.tax_total), 0);
    expect(total).toBe(1543500);
  });

  it('cupón 100 %: base 0 e impuesto 0', () => {
    const r = projectOrderInvoiceLines(
      [line('1000000', '1000000', '0', '0.19')],
      '1000000',
    );
    expect(r.error).toBeUndefined();
    expect(r.lines[0].base.toString()).toBe('0');
    expect(r.lines[0].tax_total.toString()).toBe('0');
    expect(r.allocated_discount.toString()).toBe('1000000');
  });

  it('descuento de línea mayor que su base falla cerrado', () => {
    const r = projectOrderInvoiceLines([line('100', '150', '0', null)], '150');
    expect(r.error?.code).toBe('discount_exceeds_lines');
  });

  it('legado (NULL en todas las líneas): reparte el descuento BRUTO como siempre', () => {
    // 1M al 19 % + 1M exento, descuento bruto 1.095.000 (50 % de 2.190.000)
    const items = [
      line('1000000', null, '190000', '0.19'),
      line('1000000', null, '0', null),
    ];
    const r = projectOrderInvoiceLines(items, '595000');
    expect(r.error).toBeUndefined();
    // Reparto por bruto (1.190.000 / 1.000.000): la línea gravada absorbe más.
    expect(r.lines[0].reason).toBe('order_discount');
    expect(r.lines[0].order_discount_share.toString()).toBe('323310.51');
    expect(r.lines[1].order_discount_share.toString()).toBe('271689.49');
    expect(r.allocated_discount.toString()).toBe('595000');
  });

  it('projectOrderDiscountedTaxes: contrato nuevo declara la cuota persistida', () => {
    const items = [
      line('1000000', '500000', '95000', '0.19'),
      line('1000000', '500000', '0', null),
    ];
    const out = projectOrderDiscountedTaxes(
      items as any,
      {
        discount_amount: '1000000',
        tax_amount: '95000',
        subtotal_amount: '2000000',
      } as any,
      'orden',
    );
    expect(out).not.toBeNull();
    expect(out!.product_tax_cents).toBe(9500000);
    expect(out!.discount_cents).toBe(100000000);
  });
});
