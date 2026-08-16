import { InvoiceFlowService } from './invoice-flow.service';

/**
 * QUI-648 — la DIAN valida la coherencia entre la cantidad declarada y su
 * unidad. Con el catálogo de una sola dimensión el `'EA'` fijo era inofensivo;
 * desde que una ferretería factura metros, una línea de 3 declarada como `EA`
 * dice "3 unidades" y no "3 metros".
 *
 * Este spec cubre la resolución sin levantar el módulo: la emisión real exige
 * habilitación DIAN de la tienda, que en dev no existe.
 */
describe('InvoiceFlowService · unitCode UN/ECE por línea', () => {
  const CABLE = { id: 1, stock_uom_id: 13 }; // stock en mm
  const CAJA = { id: 2, stock_uom_id: 6 }; // stock en unidades
  const CATALOGO = [
    { code: 'mm', dimension: 'length', factor_to_base: 1 },
    { code: 'cm', dimension: 'length', factor_to_base: 10 },
    { code: 'm', dimension: 'length', factor_to_base: 1000 },
    { code: 'unit', dimension: 'count', factor_to_base: 1 },
    { code: 'doc', dimension: 'count', factor_to_base: 12 },
  ];
  const UNIDADES = [
    { id: 13, code: 'mm', dimension: 'length' },
    { id: 6, code: 'unit', dimension: 'count' },
  ];

  function buildService() {
    const prisma = {
      products: { findMany: jest.fn().mockResolvedValue([CABLE, CAJA]) },
      units_of_measure: {
        findMany: jest
          .fn()
          // 1ª llamada: unidades de stock de los productos de la factura.
          .mockResolvedValueOnce(UNIDADES)
          // 2ª llamada: catálogo completo de esas dimensiones.
          .mockResolvedValueOnce(CATALOGO),
      },
    };
    // El constructor creció con las tres piezas de validación fiscal
    // (identidad del adquiriente, prevalidador del documento y bóveda de la
    // ClTec). Aquí se ejercita `resolveLineUnitCodes`, que no las toca, así que
    // se pasan como dobles vacíos: lo que importa es la aridad.
    const service = new InvoiceFlowService(
      prisma as any,
      {} as any,
      { emit: jest.fn() } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
    return { service, prisma };
  }

  async function resolve(items: any[]) {
    const { service } = buildService();
    return (service as any).resolveLineUnitCodes(items);
  }

  it('declara MTR cuando la presentación equivale a una unidad del catálogo', async () => {
    // 3 "metros" de un producto con stock en mm: 3000 mm consumidos / 3 = 1000,
    // que es exactamente el factor del metro.
    const codes = await resolve([
      { id: 10, product_id: 1, quantity: 3, stock_units_consumed: 3000 },
    ]);
    expect(codes.get(10)).toBe('MTR');
  });

  it('declara EA cuando la presentación no equivale a ninguna unidad', async () => {
    // "Rollo 20 m" = 20.000 mm: son 1 paquete, y ningún código de longitud
    // describe eso sin mentir sobre la cantidad.
    const codes = await resolve([
      { id: 11, product_id: 1, quantity: 1, stock_units_consumed: 20000 },
    ]);
    expect(codes.get(11)).toBe('EA');
  });

  it('declara la unidad de stock cuando la línea no usa presentación', async () => {
    // Sin presentación la cantidad ya está en la unidad mínima: 3000 + MMT es
    // coherente, y es lo que la escala de precio por N produce.
    const codes = await resolve([
      { id: 12, product_id: 1, quantity: 3000, stock_units_consumed: null },
    ]);
    expect(codes.get(12)).toBe('MMT');
  });

  it('mantiene el comportamiento histórico de un producto contable', async () => {
    const codes = await resolve([
      { id: 13, product_id: 2, quantity: 5, stock_units_consumed: null },
    ]);
    expect(codes.get(13)).toBe('EA');
  });

  it('declara DZN cuando la presentación es una docena', async () => {
    const codes = await resolve([
      { id: 14, product_id: 2, quantity: 2, stock_units_consumed: 24 },
    ]);
    expect(codes.get(14)).toBe('DZN');
  });

  it('no declara nada para una línea sin producto', async () => {
    const codes = await resolve([{ id: 15, product_id: null, quantity: 1 }]);
    expect(codes.has(15)).toBe(false);
  });
});

/**
 * QUI-648 — las otras tres dimensiones. El spec de arriba sólo cubría `length`
 * y `count`; masa y volumen nunca se habían ejercido, y ninguna de las dos
 * lecturas (presentación vs escala de precio) estaba documentada para ellas.
 *
 * Catálogo real (`units_of_measure`, medido en dev): la unidad MÍNIMA de cada
 * dimensión tiene `factor_to_base = 1` (g, ml, unit, mm) y las mayores llevan
 * su factor (kg 1.000, L 1.000, doc 12, m 1.000, cm 10).
 */
describe('InvoiceFlowService · unitCode por dimensión (QUI-648)', () => {
  const QUESO = { id: 1, stock_uom_id: 1 }; // stock en g
  const ACEITE = { id: 2, stock_uom_id: 4 }; // stock en ml
  const HUEVOS = { id: 3, stock_uom_id: 6 }; // stock en unidades
  const CABLE_CM = { id: 4, stock_uom_id: 14 }; // stock en cm (NO es la unidad base)

  // `factor_to_base` viaja en la consulta de la unidad de stock: es lo que
  // traduce la escala de la presentación (en unidades de stock) al factor con
  // el que el catálogo está indexado (en unidades base).
  const UNIDADES = [
    { id: 1, code: 'g', dimension: 'mass', factor_to_base: 1 },
    { id: 4, code: 'ml', dimension: 'volume', factor_to_base: 1 },
    { id: 6, code: 'unit', dimension: 'count', factor_to_base: 1 },
    { id: 14, code: 'cm', dimension: 'length', factor_to_base: 10 },
  ];
  const CATALOGO = [
    { code: 'g', dimension: 'mass', factor_to_base: 1 },
    { code: 'kg', dimension: 'mass', factor_to_base: 1000 },
    { code: 'ml', dimension: 'volume', factor_to_base: 1 },
    { code: 'L', dimension: 'volume', factor_to_base: 1000 },
    { code: 'unit', dimension: 'count', factor_to_base: 1 },
    { code: 'doc', dimension: 'count', factor_to_base: 12 },
    { code: 'mm', dimension: 'length', factor_to_base: 1 },
    { code: 'cm', dimension: 'length', factor_to_base: 10 },
    { code: 'm', dimension: 'length', factor_to_base: 1000 },
  ];

  async function resolve(items: any[]) {
    const prisma = {
      products: {
        findMany: jest
          .fn()
          .mockResolvedValue([QUESO, ACEITE, HUEVOS, CABLE_CM]),
      },
      units_of_measure: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce(UNIDADES)
          .mockResolvedValueOnce(CATALOGO),
      },
    };
    // El constructor creció con las tres piezas de validación fiscal
    // (identidad del adquiriente, prevalidador del documento y bóveda de la
    // ClTec). Aquí se ejercita `resolveLineUnitCodes`, que no las toca, así que
    // se pasan como dobles vacíos: lo que importa es la aridad.
    const service = new InvoiceFlowService(
      prisma as any,
      {} as any,
      { emit: jest.fn() } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
    return (service as any).resolveLineUnitCodes(items);
  }

  describe('vendido por presentación (la cantidad cuenta paquetes)', () => {
    it('mass: 2,5 "kg" de un producto en g declara KGM', async () => {
      // 2500 g consumidos / 2,5 paquetes = 1000, el factor del kilo.
      const codes = await resolve([
        { id: 20, product_id: 1, quantity: 2.5, stock_units_consumed: 2500 },
      ]);
      expect(codes.get(20)).toBe('KGM');
    });

    it('volume: 1,5 "L" de un producto en ml declara LTR', async () => {
      const codes = await resolve([
        { id: 21, product_id: 2, quantity: 1.5, stock_units_consumed: 1500 },
      ]);
      expect(codes.get(21)).toBe('LTR');
    });

    it('count: 1,5 docenas de un producto en unidades declara DZN', async () => {
      const codes = await resolve([
        { id: 22, product_id: 3, quantity: 1.5, stock_units_consumed: 18 },
      ]);
      expect(codes.get(22)).toBe('DZN');
    });
  });

  describe('vendido por escala de precio (la cantidad está en unidad mínima)', () => {
    it('mass: 2500 g declara GRM, no KGM', async () => {
      // La escala de precio NO se lee acá: sin `stock_units_consumed` la
      // cantidad ya viaja en unidad mínima, así que 2500 + GRM es coherente
      // como par cantidad/unidad. Ver la nota sobre BaseQuantity abajo.
      const codes = await resolve([
        { id: 30, product_id: 1, quantity: 2500, stock_units_consumed: null },
      ]);
      expect(codes.get(30)).toBe('GRM');
    });

    it('volume: 1500 ml declara MLT', async () => {
      const codes = await resolve([
        { id: 31, product_id: 2, quantity: 1500, stock_units_consumed: null },
      ]);
      expect(codes.get(31)).toBe('MLT');
    });

    it('count: 18 unidades declara EA', async () => {
      const codes = await resolve([
        { id: 32, product_id: 3, quantity: 18, stock_units_consumed: null },
      ]);
      expect(codes.get(32)).toBe('EA');
    });

    it('length con stock en cm declara CMT', async () => {
      const codes = await resolve([
        { id: 33, product_id: 4, quantity: 350, stock_units_consumed: null },
      ]);
      expect(codes.get(33)).toBe('CMT');
    });
  });

  /**
   * La escala de la presentación se calcula en unidades de STOCK
   * (`stock_units_consumed / quantity`) pero el catálogo indexa por
   * `factor_to_base`, que está en unidades BASE. Hay que multiplicar por el
   * `factor_to_base` de la unidad de stock para volverlas conmensurables — lo
   * mismo que hace `resolveSaleUnitCodes` en
   * `products/services/sale-unit-display.util.ts` (`target = n * draft.factor`).
   *
   * Con la unidad mínima como unidad de stock (factor 1) la conversión es la
   * identidad y el defecto era invisible. Con `cm` como unidad de stock
   * —permitido, el catálogo lo marca `is_stock_eligible`— 3 metros daban
   * `300 / 3 = 100`, ninguna unidad de longitud tiene factor 100, y la línea
   * caía a `EA`: declaraba "3 unidades" donde se vendieron 3 metros, que es
   * justo el error que este resolutor nació para evitar.
   */
  it('presentación de 3 m con stock en cm declara MTR', async () => {
    // 300 cm / 3 paquetes = 100 cm por paquete; × factor 10 del cm = 1.000
    // unidades base = el factor del metro.
    const codes = await resolve([
      { id: 40, product_id: 4, quantity: 3, stock_units_consumed: 300 },
    ]);
    expect(codes.get(40)).toBe('MTR');
  });

  it('una presentación que no equivale a ninguna unidad sigue cayendo a EA', async () => {
    // "Rollo x 20 m" de un producto en cm: 2.000 cm / 1 = 2.000, × 10 = 20.000
    // unidades base. Ninguna unidad de longitud vale 20.000 mm, y está bien:
    // es UN rollo, y ningún código de longitud describe eso sin mentir.
    const codes = await resolve([
      { id: 41, product_id: 4, quantity: 1, stock_units_consumed: 2000 },
    ]);
    expect(codes.get(41)).toBe('EA');
  });
});
