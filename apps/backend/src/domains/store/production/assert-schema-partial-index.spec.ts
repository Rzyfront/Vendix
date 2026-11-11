/**
 * S17 — el deploy (`prisma/assert-schema-columns.js`) falla si el índice único
 * parcial de producción no existe o existe sin la cláusula `WHERE`.
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const gate = require('../../../../prisma/assert-schema-columns.js') as {
  findBrokenPartialIndexes: (
    rows: Array<{ indexname: string; indexdef: string }>,
    required?: string[],
  ) => string[];
  REQUIRED_PARTIAL_INDEXES: string[];
};

const NAME = 'production_orders_order_id_product_id_product_variant_id_key';

describe('assert-schema-columns: índice parcial de producción (S17)', () => {
  it('exige exactamente el índice production_orders_order_id_product_id_product_variant_id_key', () => {
    expect(gate.REQUIRED_PARTIAL_INDEXES).toEqual([NAME]);
  });

  it('con el índice ausente reporta el faltante (el script sale con error)', () => {
    const broken = gate.findBrokenPartialIndexes([
      { indexname: 'otro_idx', indexdef: 'CREATE INDEX otro_idx ON public.t USING btree (a)' },
    ]);
    expect(broken).toEqual([`índice parcial ${NAME} (no existe)`]);
  });

  it('con el índice presente pero no parcial reporta que no es parcial', () => {
    const broken = gate.findBrokenPartialIndexes([
      {
        indexname: NAME,
        indexdef: `CREATE UNIQUE INDEX ${NAME} ON public.production_orders USING btree (order_id, product_id, product_variant_id)`,
      },
    ]);
    expect(broken).toHaveLength(1);
    expect(broken[0]).toContain('NO es parcial');
  });

  it('con el índice parcial no reporta nada', () => {
    const broken = gate.findBrokenPartialIndexes([
      {
        indexname: NAME,
        indexdef: `CREATE UNIQUE INDEX ${NAME} ON public.production_orders USING btree (order_id, product_id, product_variant_id) NULLS NOT DISTINCT WHERE (order_id IS NOT NULL)`,
      },
    ]);
    expect(broken).toEqual([]);
  });
});
