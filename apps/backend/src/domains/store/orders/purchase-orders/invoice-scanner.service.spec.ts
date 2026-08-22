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
    // P0.1 — constructor ahora recibe VatResponsibilityService; el path
    // probado (normalizeOcrResponse) no toca responsabilidades fiscales, así
    // que null es seguro y mantiene el arnés en seco.
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

  /**
   * QUI-661 hotfix — el descuento impreso como PORCENTAJE.
   *
   * El defecto: una factura que imprime "-20%" en la columna de descuento pero
   * no repite el monto en pesos hacía que la IA emitiera `discount_amount: 0`
   * (el prompt solo pedía dinero y le exigía convertir), y el descuento visible
   * en el papel simplemente desaparecía del modal, del carrito y de la orden.
   *
   * El porcentaje es el dato más robusto que la IA puede leer porque es
   * invariante a la base: 20% es 20% con IVA incluido o sin él. Por eso ahora
   * se pide y se conserva, y el monto se deriva cuando falta.
   */
  describe('descuento de línea por porcentaje', () => {
    /** Factura de una sola línea, con el pie ya cuadrado contra esa línea. */
    function oneLine(
      line: Record<string, unknown>,
      overrides: Record<string, unknown> = {},
    ) {
      return invoice({
        line_items: [
          {
            description: 'JP FIZZY LATA 250ML',
            quantity: 1,
            unit_price: 1000,
            total: 1000,
            tax_rate: 0,
            ...line,
          },
        ],
        subtotal: 1000,
        tax_amount: 0,
        total: 1000,
        ...overrides,
      });
    }

    it('deriva el monto desde el porcentaje y lo aplana en una factura con IVA incluido', () => {
      // 2 x 1.190 bruto, 20% de descuento, IVA 19% ya incluido en el precio.
      // Bruto descontado = 476; neto = 476 / 1,19 = 400.
      const result = normalize(
        oneLine(
          {
            quantity: 2,
            unit_price: 1190,
            total: 1904,
            tax_rate: 0.19,
            discount_percentage: 20,
          },
          { prices_include_tax: true, subtotal: 1600, total: 1904 },
        ),
      );

      const item = result.line_items[0];
      expect(item.discount_amount).toBeCloseTo((2 * 1190 * 0.2) / 1.19, 9);
      expect(item.discount_amount).toBeCloseTo(400, 9);
      // El porcentaje NO se aplana: es adimensional.
      expect(item.discount_percentage).toBe(20);
    });

    it('no aplana el monto derivado cuando la factura es exclusiva de IVA', () => {
      const result = normalize(
        oneLine(
          {
            quantity: 2,
            unit_price: 1190,
            total: 2266,
            tax_rate: 0.19,
            discount_percentage: 20,
          },
          { prices_include_tax: false, subtotal: 1904, total: 2266 },
        ),
      );

      const item = result.line_items[0];
      expect(item.discount_amount).toBe(476);
      expect(item.discount_percentage).toBe(20);
    });

    it('respeta el monto impreso cuando la IA emite AMBOS y conserva el porcentaje sin reconciliar', () => {
      // 100 en dinero y un 99% imposible en la misma línea. El monto es lo que
      // el proveedor cobró: manda. El porcentaje viaja como procedencia — no se
      // recalcula ni se avisa, porque no hay nada que decidir.
      const result = normalize(
        oneLine(
          {
            quantity: 1,
            unit_price: 1190,
            total: 1090,
            tax_rate: 0.19,
            discount_amount: 100,
            discount_percentage: 99,
          },
          { prices_include_tax: true, subtotal: 916, total: 1090 },
        ),
      );

      const item = result.line_items[0];
      // Aplanado según la base (inclusiva), NO derivado del 99%.
      expect(item.discount_amount).toBeCloseTo(100 / 1.19, 9);
      expect(item.discount_percentage).toBe(99);
    });

    it('recorta a 100 un porcentaje fuera de rango', () => {
      const result = normalize(
        oneLine({ discount_percentage: 250 }),
      );

      const item = result.line_items[0];
      expect(item.discount_percentage).toBe(100);
      // Recortado al 100%, el monto derivado es la línea entera, nunca 2,5x.
      expect(item.discount_amount).toBe(1000);
    });

    it('descarta un porcentaje negativo', () => {
      const result = normalize(oneLine({ discount_percentage: -5 }));

      const item = result.line_items[0];
      expect(item.discount_percentage).toBeUndefined();
      expect(item.discount_amount).toBeUndefined();
    });

    it('descarta un porcentaje no numérico', () => {
      const result = normalize(oneLine({ discount_percentage: 'veinte' }));

      const item = result.line_items[0];
      expect(item.discount_percentage).toBeUndefined();
      expect(item.discount_amount).toBeUndefined();
    });

    it('deja el porcentaje en undefined cuando la factura no lo imprime', () => {
      const result = normalize(oneLine({ discount_amount: 150 }));

      const item = result.line_items[0];
      expect(item.discount_amount).toBe(150);
      expect(item.discount_percentage).toBeUndefined();
    });

    it('nunca pasa el porcentaje por la reparación de separadores', () => {
      // 20 es veinte por ciento, no veinte mil. Misma regla que `tax_rate`:
      // `repairScannedAmount` solo aplica a dinero.
      const result = normalize(oneLine({ discount_percentage: 20 }));

      expect(result.line_items[0].discount_percentage).toBe(20);
      expect(result.scan_warnings).toBeUndefined();
    });
  });
});
