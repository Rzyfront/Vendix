/**
 * Precio por N unidades de stock — la *price unit* (`Preiseinheit`) de SAP.
 *
 * Espejo móvil de
 * `apps/backend/src/domains/store/products/services/price-unit.util.ts`.
 * Se copia (no se importa) porque backend y móvil son proyectos separados:
 * `mobile-dev` RULE 4 prohíbe el import cruzado. Los nombres son los MISMOS a
 * propósito — `resolveLineTotal`, `resolveUnitPriceAtBase`, `roundMoney` — para
 * que la paridad se pueda auditar leyendo los dos archivos en paralelo.
 *
 * El problema que resuelve: cuando el stock vive en la unidad mínima, el precio
 * unitario deja de ser representable. `order_items.unit_price` es
 * `Decimal(12,2)`, así que una cinta a $5 el metro son $0,005 por milímetro:
 * redondea a $0,01 y cobra el DOBLE, y el error se multiplica por la cantidad.
 *
 * La salida no es más decimales sino otra escala: `products.price_unit_quantity`
 * dice a cuántas unidades de stock corresponde `base_price`. Un cable en
 * milímetros guarda `base_price = 5000` y `price_unit_quantity = 1000` —"$5.000
 * por metro"— y el total de una línea es:
 *
 *     total = unit_price × quantity / price_unit_quantity
 *
 * El redondeo va AL FINAL, sobre el total de la línea, nunca sobre el precio
 * unitario intermedio: 2.500 mm de un cable a $5/m se cobran $12,50 exactos;
 * resolverlo por precio unitario redondeado ($0,01/mm) cobraría $25.
 *
 * Con `price_unit_quantity = 1` (el default, y el valor de TODO el catálogo
 * existente) la fórmula colapsa a `unit_price × quantity`: cero regresión.
 */

/** Redondeo a centavos, el mismo que usa el resto del dominio de dinero. */
export function roundMoney(value: number): number {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

/**
 * Total NETO (sin impuesto) de una línea de venta.
 *
 * `priceUnitQuantity` nulo, 0, negativo o 1 devuelve el producto simple — nunca
 * divide por cero ni por un valor negativo.
 *
 * ⚠️ Una línea vendida por PRESENTACIÓN no pasa por acá con su escala: en ese
 * caso `unitPrice` es el precio del paquete completo y `quantity` cuenta
 * paquetes, no unidades de stock. Dividir otra vez cobraría de menos. Es la
 * misma exclusión que aplica el backend con `options.hasTierAtIndex` en
 * `normalizePriceUnitLines`.
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
 * márgenes, donde la escala comercial estorba. Devuelve un número SIN redondear
 * a centavos a propósito: quien lo consuma decide la precisión (redondearlo acá
 * es exactamente el bug que la feature vino a evitar).
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
 * Escala del precio de un producto, normalizada.
 *
 * Devuelve siempre un entero >= 1: ausente, no numérico o <= 1 colapsan a 1,
 * que es el comportamiento histórico. Se usa para decidir si una superficie
 * (ticket, carrito, cuota) tiene que hablar de escala o puede ignorarla.
 *
 * Idéntica a `resolvePriceUnitQuantity` del web
 * (`apps/frontend/src/app/private/modules/store/pos/utils/line-units.util.ts`),
 * truncado incluido: la columna es `Int`, así que truncar nunca cambia un valor
 * legítimo y evita que un decimal accidental produzca dos escalas distintas en
 * los dos clientes.
 */
export function resolvePriceUnitQuantity(
  priceUnitQuantity?: number | null,
): number {
  const n = Number(priceUnitQuantity ?? 1);
  return Number.isFinite(n) && n > 1 ? Math.trunc(n) : 1;
}
