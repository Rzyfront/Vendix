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
 * Escala saneada: entero > 1, o 1 (sin escala). Espejo exacto de
 * `resolvePriceUnitQuantity` en el frontend
 * (`apps/frontend/.../pos/utils/line-units.util.ts`) para que las dos puntas
 * dividan por el mismo número.
 */
export function resolvePriceUnitScale(value: unknown): number {
  const n = Number(value ?? 1);
  return Number.isFinite(n) && n > 1 ? n : 1;
}

/**
 * Unidades de PRECIO que cobra una línea a partir de sus unidades crudas.
 *
 * `rawUnits` es lo que el dominio ya venía usando como multiplicador (el peso
 * capturado en una línea de peso, o la cantidad en unidades de stock en todas
 * las demás). La escala solo lo convierte: 3.000 mm de un cable publicado por
 * metro son 3 unidades de precio. Con escala 1 devuelve `rawUnits` intacto.
 */
export function resolvePriceUnits(
  rawUnits: number,
  priceUnitQuantity?: number | null,
): number {
  const scale = resolvePriceUnitScale(priceUnitQuantity);
  return scale > 1 ? Number(rawUnits) / scale : Number(rawUnits);
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
  return roundMoney(
    Number(unitPrice) * resolvePriceUnits(Number(quantity), priceUnitQuantity),
  );
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
  /** Precio unitario SIN impuesto. Misma magnitud que `total_price`. */
  unit_price?: number | null;
  /**
   * Precio unitario CON impuesto, cuando el cliente lo envía. No se persiste
   * desde acá: solo sirve como testigo de en qué magnitud ese mismo cliente
   * construyó `total_price` (ver `readTotalAsNet`).
   */
  final_unit_price?: number | null;
  total_price?: number | null;
  tax_amount_item?: number | null;
};

/** Dos totales de dinero se consideran el mismo si difieren menos de medio centavo. */
const sameMoney = (a: number, b: number): boolean => Math.abs(a - b) < 0.005;

/**
 * CONTRATO DE MAGNITUDES — QUI-648.
 *
 * `order_items.total_price` es NETO. Es la columna que suma
 * `orders.subtotal_amount`, y el camino de cobro POS
 * (`PaymentsService.buildOrderItemSnapshot`) la escribe como
 * `unit_price_neto × unidades`. Ese es el contrato de la tabla, verificado
 * contra las filas ya persistidas.
 *
 * El problema es que un cliente puede construir `total_price` en BRUTO. El POS
 * web lo hace hoy contra `PUT /store/orders/:id/items`: manda `unit_price`
 * neto, `final_unit_price` bruto y `total_price = final_unit_price × unidades`
 * (bruto). Comparar el esperado neto (`unit_price × quantity / N`) contra ese
 * bruto es comparar peras con manzanas: la diferencia que sale de ahí no es el
 * desfase de la escala sino el IVA de la línea, y aplicarla como delta de
 * cabecera le restaría el IVA a un `subtotal` que ya venía neto y correcto.
 * Con `N = 1` nunca se dispara —esta función entera solo corre para productos
 * con escala—, y por eso el defecto es invisible hoy.
 *
 * La salida NO es suponer una magnitud sino LEERLA. `unit_price` y
 * `final_unit_price` son las dos caras del mismo precio unitario, así que su
 * razón ES `1/(1+tasa)` sin consultar la base ni asumir la tarifa. Con eso, el
 * total recibido se lee en sus dos interpretaciones posibles y gana la que
 * cuadra con la aritmética:
 *
 *   1. ¿Cuadra con el esperado leído en NETO? → el cliente ya aplicó la escala
 *      y mandó neto. No se toca nada.
 *   2. ¿Cuadra con el esperado leído en BRUTO? → el cliente ya aplicó la
 *      escala pero la mandó en bruto. La línea se re-expresa en neto (que es
 *      lo que la columna significa) y la CABECERA NO SE MUEVE: no hubo
 *      desfase de escala que compensar.
 *   3. Ninguna cuadra → el cliente no aplicó la escala. La línea se corrige y
 *      el delta de cabecera se calcula contra la base NETA sin escalar
 *      (`unit_price × quantity`), que es exactamente el dinero que la escala
 *      quita — nunca contra el total del cliente, cuya magnitud es incierta.
 *
 * Sin `final_unit_price` (o con una línea sin impuesto, donde bruto == neto)
 * las dos lecturas coinciden y el comportamiento es idéntico al histórico.
 */
function readTotalAsNet(received: number, line: PriceUnitAdjustableLine): number {
  const gross = Number(line.final_unit_price ?? NaN);
  const net = Number(line.unit_price ?? NaN);
  if (
    !Number.isFinite(gross) ||
    !Number.isFinite(net) ||
    gross <= 0 ||
    net <= 0 ||
    gross <= net
  ) {
    return received;
  }
  return roundMoney(received * (net / gross));
}

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
 *
 * La comparación corre siempre en magnitud NETA — ver `readTotalAsNet` para el
 * porqué y para qué pasa cuando el cliente manda `total_price` con impuesto.
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

    const unitPrice = Number(line.unit_price ?? 0);
    const quantity = Number(line.quantity ?? 0);
    // Neto CON escala: lo que la columna tiene que terminar guardando.
    const expected = resolveLineTotal(unitPrice, quantity, n);
    // Neto SIN escala: la aritmética histórica, y la única base contra la que
    // se puede medir cuánto dinero quita la escala.
    const unscaled = roundMoney(unitPrice * quantity);

    const received = roundMoney(Number(line.total_price ?? 0));
    const receivedAsNet = readTotalAsNet(received, line);

    // Caso 1 — el cliente ya aplicó la escala y mandó neto: nada que hacer.
    if (sameMoney(received, expected)) return;

    // Caso 2 — ya aplicó la escala pero la mandó en bruto: la línea se
    // re-expresa en la magnitud de la columna y la cabecera no se mueve.
    if (sameMoney(receivedAsNet, expected)) {
      line.total_price = expected;
      result.adjusted += 1;
      return;
    }

    // Caso 3 — no aplicó la escala. El delta de cabecera es el efecto puro de
    // la escala medido en neto; el total del cliente solo se usa como
    // respaldo cuando no reconocemos ninguna de las dos lecturas (una línea
    // con el total editado a mano), que es el comportamiento histórico.
    const previous = sameMoney(received, unscaled) ? received : receivedAsNet;

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
