/**
 * Precio por N unidades de stock — la *price unit* (`Preiseinheit`) de SAP.
 *
 * El problema que resuelve: cuando el stock vive en la unidad mínima, el precio
 * unitario deja de ser representable. `order_items.unit_price` es
 * `Decimal(12,2)`, así que una cinta a $5 el metro son $0,005 por milímetro:
 * redondea a $0,01 y cobra el doble, y el error se multiplica por la cantidad.
 *
 * La salida no es más decimales sino otra escala: `products.price_unit_quantity`
 * dice a cuántas unidades de stock corresponde `base_price`. Un cable en
 * milímetros guarda `base_price = 5000` y `price_unit_quantity = 1000` —"$5.000
 * por metro"— y el total de una línea es:
 *
 *     total = unit_price × quantity / price_unit_quantity
 *
 * Con `price_unit_quantity = 1` (el default) la fórmula colapsa a
 * `unit_price × quantity`, que es la aritmética histórica: ningún producto
 * existente cambia de precio, y por eso el recálculo server-side solo se aplica
 * cuando N > 1.
 *
 * El `client` entra por parámetro para poder recibir el `tx` de una
 * transacción: tomar `this.prisma` dentro de un `$transaction` abriría una
 * segunda conexión del pool y perdería el scoping de tenant.
 */

export type PriceUnitClient = {
  products: { findMany: (args: any) => Promise<any[]> };
};

/** Redondeo a centavos, el mismo que usa el resto del dominio de dinero. */
export function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * Total de una línea. `priceUnitQuantity` nulo, 0 o 1 devuelve el producto
 * simple — nunca divide por cero ni por un valor negativo.
 */
export function resolveLineTotal(
  unitPrice: number,
  quantity: number,
  priceUnitQuantity?: number | null,
): number {
  const n =
    priceUnitQuantity != null && Number.isFinite(Number(priceUnitQuantity))
      ? Number(priceUnitQuantity)
      : 1;
  const divisor = n > 1 ? n : 1;
  return roundMoney((Number(unitPrice) * Number(quantity)) / divisor);
}

/**
 * Precio unitario efectivo por UNA unidad de stock. Útil para costeo y
 * márgenes, donde la escala comercial estorba. Devuelve un número sin redondear
 * a centavos a propósito: quien lo consuma decide la precisión.
 */
export function resolveUnitPriceAtBase(
  unitPrice: number,
  priceUnitQuantity?: number | null,
): number {
  const n =
    priceUnitQuantity != null && Number(priceUnitQuantity) > 1
      ? Number(priceUnitQuantity)
      : 1;
  return Number(unitPrice) / n;
}

/**
 * `price_unit_quantity` de un conjunto de productos, para snapshotear en la
 * línea de venta. Solo devuelve entradas con N > 1: la ausencia significa "1",
 * que es el comportamiento histórico y no necesita persistirse.
 */
export async function resolvePriceUnitQuantities(
  client: PriceUnitClient,
  productIds: number[],
): Promise<Map<number, number>> {
  const ids = Array.from(
    new Set(productIds.filter((id) => Number.isFinite(Number(id)))),
  ).map(Number);
  const out = new Map<number, number>();
  if (ids.length === 0) return out;

  const rows = await client.products.findMany({
    where: { id: { in: ids } },
    select: { id: true, price_unit_quantity: true },
  });
  for (const row of rows) {
    const n = Number(row.price_unit_quantity ?? 1);
    if (Number.isFinite(n) && n > 1) out.set(Number(row.id), n);
  }
  return out;
}

/** Línea de venta mínima que la normalización necesita leer y corregir. */
export type PriceUnitAdjustableLine = {
  product_id?: number | null;
  quantity?: number | null;
  unit_price?: number | null;
  total_price?: number | null;
  tax_amount_item?: number | null;
};

export type PriceUnitNormalization = {
  /** `price_unit_quantity` a snapshotear por índice de línea; `null` = escala 1. */
  priceUnitByIndex: (number | null)[];
  /** Diferencia a aplicar al subtotal de la cabecera. */
  subtotalDelta: number;
  /** Diferencia a aplicar al impuesto de la cabecera. */
  taxDelta: number;
  /** Cuántas líneas fueron corregidas. */
  adjusted: number;
};

/**
 * Corrige el total de las líneas cuyo producto publica su precio por N unidades
 * de stock, y devuelve el snapshot por índice más el desfase de la cabecera.
 *
 * El servidor recalcula en vez de confiar en el total del cliente porque la
 * escala es del producto: el POS, la tienda online y el móvil resuelven el
 * precio por caminos distintos y cualquiera de ellos puede llegar con la
 * aritmética vieja (`unit_price × quantity`). Solo se toca la línea cuando
 * `N > 1` **y** el total recibido difiere, así que un catálogo entero en
 * escala 1 —todo lo existente— pasa por acá sin una sola corrección.
 *
 * Una línea con presentación aplicada queda excluida: ahí `unit_price` es el
 * precio del paquete completo y `quantity` cuenta paquetes, no unidades de
 * stock; dividir otra vez cobraría de menos.
 */
export async function normalizePriceUnitLines<T extends PriceUnitAdjustableLine>(
  client: PriceUnitClient,
  lines: T[],
  options: { hasTierAtIndex?: (index: number) => boolean } = {},
): Promise<PriceUnitNormalization> {
  const result: PriceUnitNormalization = {
    priceUnitByIndex: lines.map(() => null),
    subtotalDelta: 0,
    taxDelta: 0,
    adjusted: 0,
  };

  const productIds = lines
    .map((line, index) =>
      options.hasTierAtIndex?.(index) ? null : line.product_id,
    )
    .filter((id): id is number => typeof id === 'number');
  if (productIds.length === 0) return result;

  const scales = await resolvePriceUnitQuantities(client, productIds);
  if (scales.size === 0) return result;

  lines.forEach((line, index) => {
    if (options.hasTierAtIndex?.(index)) return;
    const n = line.product_id != null ? scales.get(Number(line.product_id)) : undefined;
    if (!n) return;

    result.priceUnitByIndex[index] = n;

    const expected = resolveLineTotal(
      Number(line.unit_price ?? 0),
      Number(line.quantity ?? 0),
      n,
    );
    const previous = roundMoney(Number(line.total_price ?? 0));
    if (Math.abs(expected - previous) < 0.005) return;

    // El impuesto viaja proporcional al total: la tasa no cambia, cambia la
    // base. Sin total previo no hay proporción, así que queda en 0 y el
    // recálculo de la cabecera lo refleja.
    const previousTax = roundMoney(Number(line.tax_amount_item ?? 0));
    const nextTax =
      previous > 0 ? roundMoney((previousTax * expected) / previous) : 0;

    result.subtotalDelta += expected - previous;
    result.taxDelta += nextTax - previousTax;
    result.adjusted += 1;

    line.total_price = expected;
    if (line.tax_amount_item != null) line.tax_amount_item = nextTax;
  });

  result.subtotalDelta = roundMoney(result.subtotalDelta);
  result.taxDelta = roundMoney(result.taxDelta);
  return result;
}
