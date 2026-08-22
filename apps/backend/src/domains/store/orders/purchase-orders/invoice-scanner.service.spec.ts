import { InvoiceScannerService } from './invoice-scanner.service';
import { StoreCurrencyInfo } from '../../../../ai-engine/utils/ocr-money.util';
import { VatResponsibilityService } from '@common/helpers/vat-responsibility.helper';

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

// ---------------------------------------------------------------------------
// CP-PURCHASE-TRANSPARENCY — `matchProducts`
// ---------------------------------------------------------------------------

type ScannerMockOptions = {
  /** Producto devuelto por el nivel 1 (búsqueda exacta por SKU). */
  skuProduct?: Record<string, unknown> | null;
  /** Filas de `supplier_products` del nivel 2. */
  supplierCatalog?: Array<Record<string, unknown>>;
  /** Productos devueltos por el nivel 3 (búsqueda por palabras). */
  nameMatches?: Array<Record<string, unknown>>;
  /** Filas de `products` que resuelven el factor de empaque (I.b). */
  packaging?: Array<Record<string, unknown>>;
  /** Proveedor emparejado por tax_id (habilita el nivel 2). */
  supplier?: Record<string, unknown> | null;
  fiscalData?: unknown;
  fiscalThrows?: boolean;
};

function buildScanner(options: ScannerMockOptions = {}) {
  const productFindMany = jest.fn(async ({ where }: any) => {
    // `products.findMany` tiene DOS llamantes: el nivel 3 del emparejador
    // (filtra por `OR` de nombres) y la lectura de factores de empaque
    // (filtra por `id: { in: [...] }`). Se distinguen por la forma del where.
    if (where?.id?.in) return options.packaging ?? [];
    return options.nameMatches ?? [];
  });

  const prisma: any = {
    products: {
      findFirst: jest.fn(async () => options.skuProduct ?? null),
      findMany: productFindMany,
    },
    supplier_products: {
      findMany: jest.fn(async () => options.supplierCatalog ?? []),
    },
    suppliers: {
      findFirst: jest.fn(async () => options.supplier ?? null),
      findMany: jest.fn(async () => []),
    },
    withoutScope: jest.fn(() => ({
      tax_categories: { findMany: jest.fn(async () => []) },
    })),
  };

  const settingsService: any = {
    getFiscalData: options.fiscalThrows
      ? jest.fn(async () => {
          throw new Error('settings unavailable');
        })
      : jest.fn(async () =>
          options.fiscalData === undefined
            ? { tax_responsibilities: ['O-48'] }
            : options.fiscalData,
        ),
  };

  const service = new InvoiceScannerService(
    null as any,
    prisma as any,
    null as any,
    settingsService as any,
    null as any,
    new VatResponsibilityService(),
  );

  return { service, prisma, productFindMany };
}

/** Resultado de escaneo mínimo con las líneas que pida el test. */
function scanned(lineItems: Array<Record<string, unknown>>): any {
  return {
    supplier: { name: 'OCEAN TRADING SAS', tax_id: '900066371-6' },
    invoice_number: 'FV-1',
    invoice_date: '2026-02-01',
    prices_include_tax: false,
    line_items: lineItems,
    subtotal: 0,
    tax_amount: 0,
    total: 0,
    confidence: 95,
  };
}

/** ¿Algún warning contiene este fragmento? */
function hasWarning(warnings: string[], fragment: string): boolean {
  return warnings.some((w) => w.includes(fragment));
}

/**
 * D.1 — la puerta de entrada del defecto reportado en producción: «cuando
 * vuelvo a hacer esas compras la compra me calcula el costo teniendo en cuenta
 * el costo ya existente de los productos eliminados». El operador archiva el
 * producto, la restricción `@@unique([store_id, sku])` le impide crear uno
 * nuevo con el mismo SKU, así que vuelve a cargar la factura — y el escáner le
 * volvía a sellar `selected_product_id` contra el archivado con confianza 95,
 * sin intervención humana.
 */
describe('InvoiceScannerService.matchProducts — D.1 productos archivados', () => {
  const archivedBySku = {
    id: 378,
    name: 'AGUA CRISTAL 600ML',
    sku: 'AGU-600',
    cost_price: 3,
    state: 'archived',
  };

  it('no empareja un producto archivado encontrado por SKU', async () => {
    const { service } = buildScanner({ skuProduct: archivedBySku });

    const result = await service.matchProducts(
      scanned([
        {
          description: 'AGUA CRISTAL 600ML',
          quantity: 10,
          unit_price: 100,
          total: 1000,
          sku_if_visible: 'AGU-600',
        },
      ]),
    );

    expect(result.items).toHaveLength(1);
    expect(result.items[0].match_status).toBe('new');
    expect(result.items[0].selected_product_id).toBeUndefined();
    expect(result.items[0].candidates).toEqual([]);
  });

  it('la línea NO desaparece y el motivo del descarte viaja en warnings', async () => {
    const { service } = buildScanner({ skuProduct: archivedBySku });

    const result = await service.matchProducts(
      scanned([
        {
          description: 'AGUA CRISTAL 600ML',
          quantity: 10,
          unit_price: 100,
          total: 1000,
          sku_if_visible: 'AGU-600',
        },
      ]),
    );

    expect(hasWarning(result.warnings, 'ARCHIVADO')).toBe(true);
    expect(hasWarning(result.warnings, 'AGUA CRISTAL 600ML')).toBe(true);
    expect(hasWarning(result.warnings, 'SKU AGU-600')).toBe(true);
    // No se degrada al aviso genérico: el operador tiene que saber que el
    // producto existe y está archivado, no que "no hay coincidencias".
    expect(hasWarning(result.warnings, 'sin coincidencias en el catálogo')).toBe(
      false,
    );
  });

  it('un producto ACTIVO con el mismo SKU sigue emparejando con confianza 95', async () => {
    const { service } = buildScanner({
      skuProduct: { ...archivedBySku, state: 'active' },
    });

    const result = await service.matchProducts(
      scanned([
        {
          description: 'AGUA CRISTAL 600ML',
          quantity: 10,
          unit_price: 100,
          total: 1000,
          sku_if_visible: 'AGU-600',
        },
      ]),
    );

    expect(result.items[0].match_status).toBe('matched');
    expect(result.items[0].selected_product_id).toBe(378);
    expect(result.items[0].candidates[0].confidence).toBe(95);
    expect(hasWarning(result.warnings, 'ARCHIVADO')).toBe(false);
  });

  it('el nivel 2 (catálogo del proveedor) también excluye archivados', async () => {
    const { service } = buildScanner({
      supplier: { id: 7, name: 'OCEAN TRADING SAS', tax_id: '900066371-6' },
      supplierCatalog: [
        {
          supplier_sku: 'AGU-600',
          cost_per_unit: 3,
          products: {
            id: 378,
            name: 'AGUA CRISTAL 600ML',
            sku: 'AGU-600',
            cost_price: 3,
            state: 'archived',
          },
        },
      ],
    });

    const result = await service.matchProducts(
      scanned([
        {
          description: 'AGUA CRISTAL 600ML',
          quantity: 10,
          unit_price: 100,
          total: 1000,
          sku_if_visible: 'AGU-600',
        },
      ]),
    );

    expect(result.items[0].match_status).toBe('new');
    expect(result.items[0].selected_product_id).toBeUndefined();
    expect(hasWarning(result.warnings, 'ARCHIVADO')).toBe(true);
  });

  it('avisa cuando el SKU impreso es de un archivado pero se propuso otro producto', async () => {
    const { service } = buildScanner({
      skuProduct: archivedBySku,
      nameMatches: [
        {
          id: 900,
          name: 'AGUA CRISTAL 600ML',
          sku: 'AGU-600-V2',
          cost_price: 120,
        },
      ],
    });

    const result = await service.matchProducts(
      scanned([
        {
          description: 'AGUA CRISTAL 600ML',
          quantity: 10,
          unit_price: 100,
          total: 1000,
          sku_if_visible: 'AGU-600',
        },
      ]),
    );

    expect(result.items[0].selected_product_id).toBe(900);
    expect(hasWarning(result.warnings, 'el SKU impreso pertenece a')).toBe(true);
  });
});

/**
 * I.a — B.0 hizo que el escáner fallara cerrado ante un fallo fiscal, pero lo
 * hacía en silencio: el IVA de la factura entera se capitalizaba al costo sin
 * que el operador supiera que se había tomado una decisión fiscal por él.
 */
describe('InvoiceScannerService.matchProducts — I.a aviso de estado fiscal', () => {
  const line = [
    { description: 'X', quantity: 1, unit_price: 100, total: 100 },
  ];

  it('cuando NO hay configuración fiscal, recomienda el asistente', async () => {
    const { service } = buildScanner({ fiscalData: {} });

    const result = await service.matchProducts(scanned(line));

    expect(hasWarning(result.warnings, '/admin/fiscal/wizard')).toBe(true);
    expect(hasWarning(result.warnings, 'se suma al costo del inventario')).toBe(
      true,
    );
  });

  it('cuando la lectura FALLA, invita a reintentar y NO habla de configuración faltante', async () => {
    const { service } = buildScanner({ fiscalThrows: true });

    const result = await service.matchProducts(scanned(line));

    expect(hasWarning(result.warnings, 'No es que falte configuración')).toBe(
      true,
    );
    expect(hasWarning(result.warnings, 'vuelve')).toBe(true);
    // Mandarlo al asistente sería mentirle: puede tenerlo configurado.
    expect(hasWarning(result.warnings, '/admin/fiscal/wizard')).toBe(false);
  });

  it('un comercio con O-48 declarado no recibe ningún aviso fiscal', async () => {
    const { service } = buildScanner({
      fiscalData: { tax_responsibilities: ['O-48'] },
    });

    const result = await service.matchProducts(scanned(line));

    expect(hasWarning(result.warnings, 'fiscal')).toBe(false);
    expect(hasWarning(result.warnings, 'IVA')).toBe(false);
  });

  it('un comercio con O-49 declarado tampoco: no es indeterminado, es una decisión', async () => {
    const { service } = buildScanner({
      fiscalData: { tax_responsibilities: ['O-49'] },
    });

    const result = await service.matchProducts(scanned(line));

    expect(hasWarning(result.warnings, '/admin/fiscal/wizard')).toBe(false);
    expect(hasWarning(result.warnings, 'No es que falte configuración')).toBe(
      false,
    );
  });
});

/**
 * I.b — `quantity_ordered` es `Int` y se queda `Int`. El escáner es el puente
 * entre «2,5 cajas» impresas en el papel y el entero que la columna guarda.
 */
describe('InvoiceScannerService.matchProducts — I.b cantidades fraccionarias', () => {
  const activeProduct = {
    id: 55,
    name: 'CERVEZA LATA 330ML',
    sku: 'CER-330',
    cost_price: 1000,
    state: 'active',
  };

  /** Producto retail: factor de empaque declarado, sin conversión al recibir. */
  const retailPackaging = {
    id: 55,
    is_ingredient: false,
    purchase_to_stock_factor: 12,
    stock_uom_id: null,
    purchase_uom_id: null,
    stock_unit: 'unidad',
    purchase_unit: 'caja',
  };

  function fractionalLine(quantity: number, unitPrice = 12000) {
    return [
      {
        description: 'CERVEZA LATA 330ML',
        quantity,
        unit_price: unitPrice,
        total: quantity * unitPrice,
        sku_if_visible: 'CER-330',
      },
    ];
  }

  it('convierte 2,5 cajas a 30 unidades y conserva el total de la línea', async () => {
    const { service } = buildScanner({
      skuProduct: activeProduct,
      packaging: [retailPackaging],
    });

    const result = await service.matchProducts(scanned(fractionalLine(2.5)));

    const item = result.items[0];
    expect(item.quantity).toBe(30);
    expect(item.unit_price).toBe(1000);
    expect(item.unit_cost_net).toBe(1000);
    // Invariante: el dinero de la línea no se mueve.
    expect(item.quantity * item.unit_price).toBe(2.5 * 12000);
    expect(hasWarning(result.warnings, 'El total de la línea no cambia')).toBe(
      true,
    );
    expect(hasWarning(result.warnings, '2,5')).toBe(true);
    expect(hasWarning(result.warnings, '30 unidad')).toBe(true);
  });

  it('NO convierte cuando la recepción va a aplicar el mismo factor (doble conversión)', async () => {
    const { service } = buildScanner({
      skuProduct: activeProduct,
      packaging: [
        {
          ...retailPackaging,
          is_ingredient: true,
          stock_uom_id: 3,
          purchase_uom_id: 4,
        },
      ],
    });

    const result = await service.matchProducts(scanned(fractionalLine(2.5)));

    const item = result.items[0];
    expect(item.quantity).toBe(3);
    // El costo unitario alimenta el CPP/FIFO: no se toca nunca al redondear.
    expect(item.unit_price).toBe(12000);
    expect(hasWarning(result.warnings, 'se aplica al RECIBIR')).toBe(true);
  });

  it('redondea con aviso cuando la conversión tampoco da un entero', async () => {
    const { service } = buildScanner({
      skuProduct: activeProduct,
      packaging: [{ ...retailPackaging, purchase_to_stock_factor: 5 }],
    });

    const result = await service.matchProducts(scanned(fractionalLine(2.5)));

    expect(result.items[0].quantity).toBe(3);
    expect(hasWarning(result.warnings, 'tampoco es un entero')).toBe(true);
    expect(hasWarning(result.warnings, '12,5')).toBe(true);
  });

  it('sin factor de empaque, redondea y lo dice con las dos cifras', async () => {
    const { service } = buildScanner({
      skuProduct: activeProduct,
      packaging: [{ ...retailPackaging, purchase_to_stock_factor: null }],
    });

    const result = await service.matchProducts(scanned(fractionalLine(2.5)));

    expect(result.items[0].quantity).toBe(3);
    expect(
      hasWarning(result.warnings, 'no tiene un factor de empaque configurado'),
    ).toBe(true);
    expect(hasWarning(result.warnings, 'pasa de 30000 a 36000')).toBe(true);
  });

  it('nunca deja la cantidad en cero: 0,315 sin producto emparejado sube a 1 y avisa', async () => {
    const { service } = buildScanner({ skuProduct: null });

    const result = await service.matchProducts(
      scanned([
        {
          description: 'CARNE RES KG',
          quantity: 0.315,
          unit_price: 40000,
          total: 12600,
        },
      ]),
    );

    expect(result.items[0].quantity).toBe(1);
    expect(hasWarning(result.warnings, '0,315')).toBe(true);
    expect(
      hasWarning(result.warnings, 'todavía no está emparejada con un producto'),
    ).toBe(true);
  });

  it('una factura sin fracciones no dispara ni una consulta de empaque', async () => {
    const { service, productFindMany } = buildScanner({
      skuProduct: activeProduct,
    });

    const result = await service.matchProducts(scanned(fractionalLine(3)));

    expect(result.items[0].quantity).toBe(3);
    expect(result.items[0].unit_price).toBe(12000);
    const packagingCalls = productFindMany.mock.calls.filter(
      ([args]: any[]) => args?.where?.id?.in,
    );
    expect(packagingCalls).toHaveLength(0);
  });
});

/**
 * El tope de 100 líneas del DTO es alcanzable desde una factura real de
 * distribuidora. Sin este aviso, el 400 llega al final de la revisión.
 */
describe('InvoiceScannerService.matchProducts — tope de líneas', () => {
  it('avisa cuando la factura supera el máximo de líneas de una orden', async () => {
    const { service } = buildScanner({});
    const lines = Array.from({ length: 101 }, (_, i) => ({
      description: `ITEM ${i}`,
      quantity: 1,
      unit_price: 100,
      total: 100,
    }));

    const result = await service.matchProducts(scanned(lines));

    expect(result.items).toHaveLength(101);
    expect(hasWarning(result.warnings, 'admite máximo 100')).toBe(true);
  });

  it('una factura de 100 líneas exactas no dispara el aviso', async () => {
    const { service } = buildScanner({});
    const lines = Array.from({ length: 100 }, (_, i) => ({
      description: `ITEM ${i}`,
      quantity: 1,
      unit_price: 100,
      total: 100,
    }));

    const result = await service.matchProducts(scanned(lines));

    expect(hasWarning(result.warnings, 'admite máximo 100')).toBe(false);
  });
});
