import {
  BULK_LINE_NOT_FOUND,
  BULK_LINE_WITHOUT_CODE,
  BulkLineLookupClient,
  matchBulkPurchaseLines,
} from './purchase-order-bulk-lines.util';

/**
 * QUI-1004 — la carga masiva de compras solo acepta productos EXISTENTES de la
 * tienda; una fila sin producto es error de esa fila y no se crea nada.
 */
const STORE = 3;
const OTHER_STORE = 4;

const products = [
  { id: 1, store_id: STORE, state: 'active', name: 'Café', sku: 'CAF-1', barcode: '7701' },
  { id: 2, store_id: STORE, state: 'archived', name: 'Viejo', sku: 'OLD-1', barcode: null },
  { id: 3, store_id: OTHER_STORE, state: 'active', name: 'Ajeno', sku: 'AJ-1', barcode: '9999' },
  { id: 4, store_id: STORE, state: 'active', name: 'Camisa', sku: 'CAM', barcode: null },
];
const variants = [
  { id: 40, product_id: 4, sku: 'CAM-M', barcode: '7702', name: 'M', product: products[3] },
];

function inScope(p: any, where: any) {
  return p.store_id === where.store_id && p.state !== where.state.not;
}
function codeMatch(row: any, or: any[]) {
  return or.some(
    (c) => (c.sku && c.sku.in.includes(row.sku)) || (c.barcode && c.barcode.in.includes(row.barcode)),
  );
}

function buildClient() {
  const calls: any[] = [];
  const client: BulkLineLookupClient = {
    products: {
      findMany: async (args: any) => {
        calls.push(args);
        return products.filter((p) => inScope(p, args.where) && codeMatch(p, args.where.OR));
      },
    },
    product_variants: {
      findMany: async (args: any) => {
        calls.push(args);
        return variants
          .filter((v) => inScope(v.product, args.where.products) && codeMatch(v, args.where.OR))
          .map((v) => ({ ...v, products: { name: v.product.name } }));
      },
    },
  };
  return { client, calls };
}

describe('matchBulkPurchaseLines', () => {
  it('empareja por SKU, código de barras y variante; lo demás es error de su fila', async () => {
    const { client } = buildClient();
    const result = await matchBulkPurchaseLines(client, STORE, [
      { sku: ' CAF-1 ' },
      { barcode: '7701' },
      { sku: 'CAM-M' },
      { sku: 'NO-EXISTE' },
      { sku: 'OLD-1' },
      {},
    ]);

    expect(result[0]).toMatchObject({ product_id: 1, product_name: 'Café' });
    expect(result[1]).toMatchObject({ product_id: 1 });
    expect(result[2]).toMatchObject({
      product_id: 4,
      product_variant_id: 40,
      product_name: 'Camisa - M',
    });
    expect(result[3]).toMatchObject({
      product_id: null,
      error: { code: BULK_LINE_NOT_FOUND, message: 'producto no encontrado' },
    });
    // Un producto archivado no se reutiliza: la fila es error, no se revive.
    expect(result[4].error?.code).toBe(BULK_LINE_NOT_FOUND);
    expect(result[5].error?.code).toBe(BULK_LINE_WITHOUT_CODE);
  });

  it('nunca empareja con productos de otra tienda', async () => {
    const { client, calls } = buildClient();
    const result = await matchBulkPurchaseLines(client, STORE, [
      { sku: 'AJ-1' },
      { barcode: '9999' },
    ]);
    expect(result.every((r) => r.error?.code === BULK_LINE_NOT_FOUND)).toBe(true);
    expect(calls[0].where.store_id).toBe(STORE);
    expect(calls[1].where.products.store_id).toBe(STORE);
  });

  it('consulta el lote completo en dos viajes, no uno por fila', async () => {
    const { client, calls } = buildClient();
    await matchBulkPurchaseLines(
      client,
      STORE,
      Array.from({ length: 50 }, (_, i) => ({ sku: `SKU-${i}` })),
    );
    expect(calls).toHaveLength(2);
  });
});
