/**
 * QUI-892 — Un reenvío/remake a cocina crea una NUEVA fila `kitchen_ticket_items`
 * (mayor id, otro ticket) para el mismo `order_item_id`; la fila vieja queda
 * "superada". La verdad de una línea es su ÚLTIMA fila: este util centraliza
 * ese criterio (bloqueo de finalización) y el cierre de las filas superadas.
 */

const TERMINAL = ['delivered', 'cancelled'];

export interface LineAwaitingKitchenDelivery {
  order_item_id: number;
  product_name: string;
  variant_label: string | null;
  quantity: number;
  status: string;
}

/**
 * Líneas NO canceladas con filas de cocina cuya última fila no es terminal.
 * Las filas viejas (superadas por un reenvío) no cuentan.
 */
export async function findLinesAwaitingKitchenDelivery(
  client: any,
  orderId: number,
): Promise<LineAwaitingKitchenDelivery[]> {
  const lines = await client.order_items.findMany({
    where: {
      order_id: orderId,
      cancelled_at: null,
      kitchen_ticket_items: { some: {} },
    },
    select: {
      id: true,
      product_name: true,
      kitchen_ticket_items: {
        orderBy: { id: 'desc' },
        take: 1,
        select: { status: true, quantity: true, variant_label: true },
      },
    },
  });
  const blocking: LineAwaitingKitchenDelivery[] = [];
  for (const line of lines ?? []) {
    const last = line.kitchen_ticket_items?.[0];
    if (last?.status != null && !TERMINAL.includes(last.status)) {
      blocking.push({
        order_item_id: line.id,
        product_name: line.product_name,
        variant_label: last.variant_label ?? null,
        quantity: last.quantity,
        status: last.status,
      });
    }
  }
  return blocking;
}

/**
 * Si la última fila de cada línea ya está `delivered`, cancela (solo estado)
 * las filas anteriores no terminales y recalcula los tickets afectados.
 * No toca inventario ni borra filas. Devuelve los ids de tickets afectados.
 */
export async function closeSupersededKitchenRows(
  client: any,
  orderItemIds: number[],
): Promise<number[]> {
  if (!orderItemIds || orderItemIds.length === 0) return [];
  const affected = new Set<number>();

  for (const orderItemId of orderItemIds) {
    const latest = await client.kitchen_ticket_items.findFirst({
      where: { order_item_id: orderItemId },
      orderBy: { id: 'desc' },
      select: { id: true, status: true },
    });
    if (!latest || latest.status !== 'delivered') continue;

    const where = {
      order_item_id: orderItemId,
      id: { lt: latest.id },
      status: { notIn: TERMINAL },
    };
    const stale = await client.kitchen_ticket_items.findMany({
      where,
      select: { kitchen_ticket_id: true },
    });
    if (!stale || stale.length === 0) continue;
    await client.kitchen_ticket_items.updateMany({
      where,
      data: { status: 'cancelled', updated_at: new Date() },
    });
    for (const s of stale) affected.add(s.kitchen_ticket_id);
  }

  for (const ticketId of affected) {
    const rows = await client.kitchen_ticket_items.findMany({
      where: { kitchen_ticket_id: ticketId },
      select: { status: true },
    });
    const allTerminal =
      rows.length > 0 && rows.every((r: any) => TERMINAL.includes(r.status));
    if (!allTerminal) continue;
    const anyDelivered = rows.some((r: any) => r.status === 'delivered');
    await client.kitchen_tickets.update({
      where: { id: ticketId },
      data: {
        status: anyDelivered ? 'delivered' : 'cancelled',
        updated_at: new Date(),
      },
    });
  }
  return [...affected];
}
