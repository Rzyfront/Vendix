/** Cliente mínimo (prisma scoped o tx) para sincronizar UoMs de venta. */
export interface SaleUomsWriter {
  product_sale_uoms: {
    deleteMany: (args: any) => Promise<unknown>;
    createMany: (args: any) => Promise<unknown>;
  };
}

export interface SaleUomRow {
  uom_id: number;
  is_principal?: boolean;
}

/**
 * Deja en el producto exactamente `rows` como UoMs de venta (QUI-978).
 *
 * A diferencia de `syncEnabledTierAssignments`, acá SÍ se borra todo y se
 * recrea: las filas no guardan más metadata que `is_principal` (la principal
 * puede moverse de una UoM a otra), así que no hay nada que preservar.
 * Un `uom_id` duplicado se pliega en una sola fila (principal si alguna
 * marca lo pide); la validación de negocio vive en products.service.
 */
export async function syncProductSaleUoms(
  client: SaleUomsWriter,
  productId: number,
  rows: SaleUomRow[],
): Promise<void> {
  await client.product_sale_uoms.deleteMany({
    where: { product_id: productId },
  });

  if (rows.length === 0) return;

  const folded = new Map<number, boolean>();
  for (const row of rows) {
    folded.set(
      row.uom_id,
      (folded.get(row.uom_id) ?? false) || row.is_principal === true,
    );
  }

  await client.product_sale_uoms.createMany({
    data: [...folded.entries()].map(([uom_id, is_principal]) => ({
      product_id: productId,
      uom_id,
      is_principal,
    })),
    skipDuplicates: true,
  });
}

/** Fila persistida con su UoM incluida (`include: { uom: true }` o select). */
export interface PersistedSaleUomRow {
  uom_id: number;
  is_principal: boolean | null;
  uom?: {
    code: string;
    name: string;
    factor_to_base: { toString(): string } | number | string | null;
  } | null;
}

/** Forma pública de una UoM de venta en las respuestas de producto. */
export interface SaleUomView {
  uom_id: number;
  code: string | null;
  name: string | null;
  factor_to_base: number | null;
  is_principal: boolean;
}

/**
 * Proyección única de `product_sale_uoms` a la respuesta (detalle, listado
 * admin, listado POS y ecommerce). Sin filas (o sin include) devuelve `[]`.
 */
export function mapSaleUoms(
  rows: PersistedSaleUomRow[] | null | undefined,
): SaleUomView[] {
  return (rows ?? []).map((row) => ({
    uom_id: row.uom_id,
    code: row.uom?.code ?? null,
    name: row.uom?.name ?? null,
    factor_to_base:
      row.uom?.factor_to_base != null ? Number(row.uom.factor_to_base) : null,
    is_principal: row.is_principal === true,
  }));
}

/**
 * `mapSaleUoms` sobre un producto cuya consulta incluyó (o no)
 * `product_sale_uoms`: los mappers de listado reciben formas distintas según
 * el `select` dinámico, así que se lee la relación sin `any`.
 */
export function saleUomsOf(product: object | null | undefined): SaleUomView[] {
  return mapSaleUoms(
    (product as { product_sale_uoms?: PersistedSaleUomRow[] | null } | null)
      ?.product_sale_uoms,
  );
}
