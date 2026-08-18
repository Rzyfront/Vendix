import { InvoiceScannerService } from './invoice-scanner.service';
import { StoreCurrencyInfo } from '../../../../ai-engine/utils/ocr-money.util';

const COP: StoreCurrencyInfo = { code: 'COP', decimal_places: 0 };

/**
 * `normalizeOcrResponse` es privado y no toca ninguna de las cinco
 * dependencias inyectadas (solo `this.logger`, `normalizeLineItem` y
 * `dominantTaxRate`), así que se instancia en seco. Construir el módulo de Nest
 * para ejercitar una función pura sería ruido.
 */
function normalize(raw: unknown, currency: StoreCurrencyInfo = COP) {
  const service = new InvoiceScannerService(
    null as any,
    null as any,
    null as any,
    null as any,
    null as any,
  );
  return (service as any).normalizeOcrResponse(raw, currency);
}

/** Factura mínima: dos líneas de 1.000 y 2.000 impresas. */
function invoice(overrides: Record<string, unknown> = {}) {
  return {
    supplier: { name: 'OCEAN TRADING SAS', tax_id: '900066371-6' },
    invoice_number: 'FV-1',
    invoice_date: '2026-02-01',
    prices_include_tax: false,
    line_items: [
      {
        description: 'JP FIZZY LATA 250ML',
        quantity: 1,
        unit_price: 1000,
        total: 1000,
        tax_rate: 0,
      },
      {
        description: 'JP ROSADO BOT 750 ML',
        quantity: 1,
        unit_price: 2000,
        total: 2000,
        tax_rate: 0,
      },
    ],
    subtotal: 3000,
    tax_amount: 0,
    total: 3000,
    confidence: 95,
    ...overrides,
  };
}

describe('InvoiceScannerService.normalizeOcrResponse', () => {
  describe('campos requeridos', () => {
    it('rechaza una respuesta sin proveedor', () => {
      expect(() => normalize(invoice({ supplier: undefined }))).toThrow(
        /supplier or line_items/,
      );
    });

    it('rechaza una respuesta sin line_items', () => {
      expect(() => normalize(invoice({ line_items: undefined }))).toThrow(
        /supplier or line_items/,
      );
    });

    it('rechaza una respuesta con line_items vacío', () => {
      expect(() => normalize(invoice({ line_items: [] }))).toThrow(
        /supplier or line_items/,
      );
    });
  });

  /**
   * El defecto reportado en producción: la factura de OCEAN TRADING SAS llegó
   * con proveedor y 18 líneas perfectas pero `subtotal: null, total: null`
   * (pie de página fuera de la vista del modelo en un PDF multipágina), y el
   * escaneo entero moría con INV_SCAN_INCOMPLETE.
   */
  describe('total ilegible', () => {
    it('deriva el total de las líneas cuando llega null', () => {
      const result = normalize(invoice({ total: null, subtotal: null }));

      expect(result.total).toBe(3000);
      expect(result.scan_warnings).toEqual(
        expect.arrayContaining([expect.stringContaining('sumando las líneas')]),
      );
    });

    it('trata un total de cero como ilegible en vez de guardarlo', () => {
      const result = normalize(invoice({ total: 0 }));

      expect(result.total).toBe(3000);
      expect(result.scan_warnings).toEqual(
        expect.arrayContaining([expect.stringContaining('sumando las líneas')]),
      );
    });

    it('no contrasta el total derivado contra la suma de las líneas', () => {
      // Sería compararlo consigo mismo: el aviso de descuadre es imposible y
      // solo confundiría en la revisión.
      const result = normalize(invoice({ total: null }));

      expect(result.scan_warnings).not.toEqual(
        expect.arrayContaining([expect.stringContaining('no coincide con')]),
      );
    });

    it('avisa distinto cuando tampoco las líneas suman', () => {
      const result = normalize(
        invoice({
          total: null,
          line_items: [
            {
              description: 'SIN VALOR',
              quantity: 1,
              unit_price: 0,
              total: 0,
              tax_rate: 0,
            },
          ],
        }),
      );

      expect(result.total).toBe(0);
      expect(result.scan_warnings).toEqual(
        expect.arrayContaining([
          expect.stringContaining('Ingrésalo manualmente'),
        ]),
      );
    });
  });

  describe('total impreso', () => {
    it('lo respeta y no emite aviso de derivación', () => {
      const result = normalize(invoice());

      expect(result.total).toBe(3000);
      expect(result.scan_warnings).toBeUndefined();
    });

    it('sigue avisando cuando el impreso no cuadra con las líneas', () => {
      const result = normalize(invoice({ total: 9999 }));

      expect(result.total).toBe(9999);
      expect(result.scan_warnings).toEqual(
        expect.arrayContaining([expect.stringContaining('no coincide con')]),
      );
    });
  });
});
