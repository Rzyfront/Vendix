/**
 * Conteo de usos de promociones (`promotions.usage_count`) ligado al ciclo de
 * vida de la orden. `usage_count` es lo que hace cumplir `usage_limit`: si una
 * orden cancelada no devuelve su uso, una promo "primeras 50 ventas" se agota
 * con ventas que nunca ocurrieron.
 *
 * Las filas de `order_promotions` NO se borran ni se ponen en 0 al cancelar:
 * son historial (auditoría y reportes). El límite por cliente ya excluye las
 * órdenes canceladas/reembolsadas en el motor.
 *
 * Funciones puras sobre el cliente de la transacción del llamador, para que
 * el ajuste sea atómico con el cambio de estado de la orden.
 */

/**
 * Cliente de transacción de Prisma (o el scoped). Se tipa abierto, igual que
 * `applyPromotion(tx?: any)`: los delegados genéricos de Prisma no encajan en
 * una firma estructural estrecha. Solo se usan `order_promotions.findMany` y
 * `promotions.updateMany`.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PromotionUsageTx = any;

/** Devuelve el uso de cada promoción que la orden consumió (con descuento). */
export async function releaseOrderPromotionUsage(
  tx: PromotionUsageTx,
  orderId: number,
): Promise<number[]> {
  if (!tx?.order_promotions?.findMany || !tx?.promotions?.updateMany) return [];
  const rows = await tx.order_promotions.findMany({
    where: { order_id: orderId, discount_amount: { gt: 0 } },
    select: { promotion_id: true },
  });
  const ids: number[] = Array.from(
    new Set<number>(
      (rows as Array<{ promotion_id: number }>).map((r) => Number(r.promotion_id)),
    ),
  );
  if (ids.length > 0) {
    // Una promoción aparece una sola vez por orden (unique order_id +
    // promotion_id), así que un decremento por promoción es exacto. El piso en
    // 0 evita contadores negativos en datos previos a este ajuste.
    await tx.promotions.updateMany({
      where: { id: { in: ids }, usage_count: { gt: 0 } },
      data: { usage_count: { decrement: 1 } },
    });
  }
  return ids;
}

/**
 * Ajusta `usage_count` cuando una orden cambia el conjunto de promociones que
 * le aplican (editor de órdenes): suma uno a las que entran y resta uno a las
 * que salen. Las que se mantienen no cambian.
 */
export async function syncOrderPromotionUsage(
  tx: PromotionUsageTx,
  beforeIds: number[],
  afterIds: number[],
): Promise<void> {
  const before = new Set(beforeIds.map(Number));
  const after = new Set(afterIds.map(Number));
  const added = Array.from(after).filter((id) => !before.has(id));
  const removed = Array.from(before).filter((id) => !after.has(id));
  if (added.length > 0) {
    await tx.promotions.updateMany({
      where: { id: { in: added } },
      data: { usage_count: { increment: 1 } },
    });
  }
  if (removed.length > 0) {
    await tx.promotions.updateMany({
      where: { id: { in: removed }, usage_count: { gt: 0 } },
      data: { usage_count: { decrement: 1 } },
    });
  }
}
