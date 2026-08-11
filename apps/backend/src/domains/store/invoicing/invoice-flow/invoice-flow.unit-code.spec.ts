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
    const service = new InvoiceFlowService(
      prisma as any,
      {} as any,
      { emit: jest.fn() } as any,
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
