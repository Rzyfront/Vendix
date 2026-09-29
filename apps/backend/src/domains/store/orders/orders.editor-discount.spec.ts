import { OrdersService } from './orders.service';

/**
 * Contrato POS en el editor de órdenes ("Modificar orden"): el descuento se
 * traslada a la BASE y el impuesto se recalcula sobre la base descontada.
 * Los helpers son puros: se invocan sobre el prototipo sin construir el servicio.
 */
describe('OrdersService editor discount contract', () => {
  const proto = OrdersService.prototype as any;
  const self = {
    plannedLinePreDiscountTax: proto.plannedLinePreDiscountTax,
    grossOfPlannedLines: proto.grossOfPlannedLines,
  } as any;
  self.plannedLinePreDiscountTax = proto.plannedLinePreDiscountTax.bind(self);
  const apply = (lines: any[], gross: number) =>
    proto.applyGrossDiscountToPlannedLines.call(self, lines, gross);

  const line = (base: number, taxAmount = base * 0.19) => ({
    unit_price: base, total_price: base, tax_rate: 0.19,
    tax_amount_item: taxAmount, final_unit_price: base * 1.19,
    line_tax_total: taxAmount,
    taxes: [{ tax_rate_id: 1, tax_name: 'IVA', tax_rate: 0.19,
      tax_amount: taxAmount, tax_type: 'VAT', is_compound: false,
      is_inclusive: false }],
    source: 'catalog',
  });

  it('cupón 100 % ⇒ base 0, impuesto 0 y descuento de base = base', () => {
    const r = apply([line(1000)], 1190);
    expect(r.tax).toBe(0);
    expect(r.baseDiscount).toBe(1000);
    expect(r.discountByLine).toEqual([1000]);
    expect(r.lines[0].line_tax_total).toBe(0);
  });

  it('cupón 10 % con líneas al 19 % ⇒ impuesto sobre la base descontada', () => {
    const r = apply([line(1000)], 119);
    expect(r.baseDiscount).toBe(100);
    expect(r.tax).toBe(171);
    expect(r.lines[0].taxes[0].tax_amount).toBe(171);
  });

  it('idempotente: una fila ya descontada se reconstruye desde tarifa × base', () => {
    // Impuesto persistido rancio (post-descuento anterior) = 171.
    const r = apply([line(1000, 171)], 119);
    expect(r.tax).toBe(171);
    expect(r.baseDiscount).toBe(100);
  });

  it('sin descuento restituye el impuesto pre-descuento', () => {
    const r = apply([line(1000, 171)], 0);
    expect(r.tax).toBe(190);
    expect(r.baseDiscount).toBe(0);
  });
});
