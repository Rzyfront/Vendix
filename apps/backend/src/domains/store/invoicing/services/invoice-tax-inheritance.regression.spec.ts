import { Prisma } from '@prisma/client';
import { InvoiceCalculatorService } from './invoice-calculator.service';
import { InvoicingService } from '../invoicing.service';

/**
 * Regresión A.6 — herencia a factura y precedencia override > asignación >
 * catálogo (A.4, F-020), más tasa ausente ⇒ 0 sin 500 (ERR-03).
 *
 * Parte 1: motor aritmético público (`InvoiceCalculatorService.calculate`,
 * sin DB): despeje inclusivo, buckets por (tasa, tipo, flag) y truncado.
 * Parte 2: precedencia REAL de `applyTaxCatalogToLine` invocada por
 * prototipo con `this` mínimo (solo usa `logger.warn` en divergencias).
 *
 * Cifras a mano. Tarifas en PORCENTAJE (19 = 19%), que es el contrato de
 * `CreateInvoiceTaxDto` y de `invoice_taxes.tax_rate`.
 */
describe('factura — herencia is_inclusive y precedencia (F-020)', () => {
  const calc = () => new InvoiceCalculatorService();

  describe('motor: despeje y buckets (paridad con A.3)', () => {
    it('agregado: 100000 + IVA 19% ⇒ base 100000.00, impuesto 19000.00, total 119000.00', () => {
      const out = calc().calculate({
        items: [
          {
            quantity: 1,
            unit_price: 100000,
            taxes: [{ tax_name: 'IVA', tax_rate: 19, tax_type: 'iva' }],
          },
        ],
      });
      expect(out.lines[0].line_extension_amount).toBe('100000.00');
      expect(out.lines[0].taxes[0]).toMatchObject({
        tax_type: 'iva',
        is_inclusive: false,
        taxable_amount: '100000.00',
        tax_amount: '19000.00',
      });
      expect(out.totals).toMatchObject({
        total_before_tax: '100000.00',
        total_amount: '119000.00',
      });
    });

    it('inclusivo: 119000 con IVA dentro ⇒ base 100000.00, impuesto 19000.00, total 119000.00', () => {
      const out = calc().calculate({
        items: [
          {
            quantity: 1,
            unit_price: 119000,
            is_inclusive: true,
            taxes: [{ tax_name: 'IVA', tax_rate: 19, tax_type: 'iva' }],
          },
        ],
      });
      expect(out.lines[0].line_extension_amount).toBe('100000.00');
      expect(out.lines[0].taxes[0].tax_amount).toBe('19000.00');
      expect(out.totals.total_before_tax).toBe('100000.00');
      expect(out.totals.total_amount).toBe('119000.00');
    });

    it('mixto: misma tasa en inclusiva y agregada NO se mezclan (bucket por flag)', () => {
      // B0 = trunc(100000/1.08) = 92592.59; +1¢ ⇒ 92592.60 con
      // INC = trunc(92592.60×0.08) = 7407.40 (cierra 100000.00) e
      // IVA = trunc(92592.60×0.19) = 17592.59 (agregado, sobre la base final).
      // El IVA declara `is_inclusive: false` EXPLÍCITO: el contrato del motor
      // es "ausente ⇒ hereda el flag de la línea", y el default de la línea
      // se engancha a true cuando ALGÚN impuesto es inclusivo — un mixto a
      // medias se volvería todo-inclusivo (base 78740.16 post-A.2). Los canales
      // (createFromOrder/manual) siempre persisten el flag por fila (A.4).
      // NOTA de truncado (F-005, actualizada en A.2 por ser «caso del bug»,
      // PLAN objetivo 5): base+cuotas = 117592.59 = lo cobrado
      // (100000 + 17592.59). El centavo que faltaba se absorbió en la base;
      // la cabecera sigue cuadrando con sus líneas (FAU14), que es lo que la
      // DIAN valida. El cambio no es silencioso: lo fija este caso.
      const out = calc().calculate({
        items: [
          {
            quantity: 1,
            unit_price: 100000,
            taxes: [
              {
                tax_name: 'INC',
                tax_rate: 8,
                tax_type: 'inc',
                is_inclusive: true,
              },
              {
                tax_name: 'IVA',
                tax_rate: 19,
                tax_type: 'iva',
                is_inclusive: false,
              },
            ],
          },
        ],
      });
      expect(out.lines[0].line_extension_amount).toBe('92592.60');
      expect(out.lines[0].taxes).toHaveLength(2);
      expect(out.header_taxes).toHaveLength(2);
      expect(out.totals).toMatchObject({
        total_before_tax: '92592.60',
        tax_amount: '24999.99',
        total_amount: '117592.59',
      });
    });

    it('override por-tasa gana al default de línea (y viceversa)', () => {
      const line = (lineIncl: boolean, taxIncl?: boolean) =>
        calc().calculate({
          items: [
            {
              quantity: 1,
              unit_price: 119000,
              is_inclusive: lineIncl,
              taxes: [
                {
                  tax_name: 'IVA',
                  tax_rate: 19,
                  tax_type: 'iva',
                  ...(taxIncl === undefined ? {} : { is_inclusive: taxIncl }),
                },
              ],
            },
          ],
        });
      // Línea agregada + tasa inclusiva ⇒ se despeja (override manda).
      expect(
        line(false, true).lines[0].line_extension_amount,
      ).toBe('100000.00');
      // Línea inclusiva + tasa agregada ⇒ NO se despeja para esa tasa.
      expect(line(true, false).lines[0].line_extension_amount).toBe('119000.00');
      // Sin override rige la línea.
      expect(line(true).lines[0].line_extension_amount).toBe('100000.00');
    });

    it('mixto a medias: el flag ausente hereda la línea (enganchada a inclusivo)', () => {
      // Contrato documentado del motor, fijado aquí a propósito: si UNA tasa
      // es inclusiva y la otra omite el flag, la línea defaultea a inclusivo
      // y AMBAS despejan (100000/1.27 = B0 78740.15, +1¢ ⇒ 78740.16 post-A.2,
      // «caso del bug», PLAN objetivo 5). Por eso A.4 persiste el flag por
      // fila en todos los canales: al motor solo llega mixto explícito.
      // Quien cambie este default mueve facturación DIAN.
      const out = calc().calculate({
        items: [
          {
            quantity: 1,
            unit_price: 100000,
            taxes: [
              { tax_name: 'INC', tax_rate: 8, tax_type: 'inc', is_inclusive: true },
              { tax_name: 'IVA', tax_rate: 19, tax_type: 'iva' },
            ],
          },
        ],
      });
      expect(out.lines[0].line_extension_amount).toBe('78740.16');
    });
  });

  describe('ERR-03 — tasa ausente ⇒ 0, sin lanzar', () => {
    it('tax_rate 0/null y tax_type ausente ⇒ cuota 0.00, tipo iva', () => {
      const out = calc().calculate({
        items: [
          {
            quantity: 1,
            unit_price: 50000,
            taxes: [
              { tax_name: 'IVA', tax_rate: 0, tax_type: 'iva' },
              { tax_name: 'X', tax_rate: null },
            ],
          },
        ],
      });
      expect(out.lines[0].taxes[0].tax_amount).toBe('0.00');
      expect(out.lines[0].taxes[1].tax_amount).toBe('0.00');
      expect(out.lines[0].taxes[1].tax_type).toBe('iva');
      expect(out.totals.total_amount).toBe('50000.00');
    });

    it('línea sin taxes no lanza y aporta su neto', () => {
      const out = calc().calculate({
        items: [{ quantity: 2, unit_price: 25000 }],
      });
      expect(out.lines[0].line_extension_amount).toBe('50000.00');
      expect(out.totals.total_amount).toBe('50000.00');
    });
  });

  describe('precedencia override-línea > asignación > catálogo/tasa (F-020)', () => {
    const catalog = {
      rates: new Map([
        [
          7,
          {
            tax_rate: new Prisma.Decimal(19),
            tax_type: 'iva',
            tax_name: 'IVA',
            is_inclusive: false,
            tax_category_id: 11,
          },
        ],
      ]),
      assignment_inclusive: new Map([['5|11', true]]),
    };

    const apply = (taxes: unknown, productId?: number) =>
      (InvoicingService.prototype as any).applyTaxCatalogToLine.call(
        { logger: { warn: jest.fn() } },
        taxes,
        catalog,
        'spec',
        0,
        productId,
      );

    it('override explícito true gana a asignación y catálogo', () => {
      const [row] = apply(
        [{ tax_rate_id: 7, tax_name: 'viejo', tax_rate: 19, is_inclusive: true }],
        5,
      );
      expect(row.is_inclusive).toBe(true);
      // El catálogo igual manda en tarifa y nombre (copia rancia del panel).
      expect(row.tax_rate.equals(new Prisma.Decimal(19))).toBe(true);
      expect(row.tax_name).toBe('IVA');
    });

    it('sin override manda la asignación (true) sobre el catálogo (false)', () => {
      const [row] = apply(
        [{ tax_rate_id: 7, tax_name: 'IVA', tax_rate: 19 }],
        5,
      );
      expect(row.is_inclusive).toBe(true);
    });

    it('sin override ni asignación rige el default del catálogo', () => {
      const [row] = apply(
        [{ tax_rate_id: 7, tax_name: 'IVA', tax_rate: 19 }],
        9,
      );
      expect(row.is_inclusive).toBe(false);
    });

    it('tarifa desconocida pasa tal cual (sin catálogo no hay verdad que aplicar)', () => {
      const [row] = apply(
        [{ tax_rate_id: 999, tax_name: 'X', tax_rate: 5, is_inclusive: true }],
        5,
      );
      expect(row.is_inclusive).toBe(true);
      expect(row.tax_rate).toBe(5);
    });
  });
});
