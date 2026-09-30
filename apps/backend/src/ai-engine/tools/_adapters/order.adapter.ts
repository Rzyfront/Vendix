import { DEFAULT_TOOL_VERSION } from '../interfaces/tool.interface';
import type { StockDemandLine } from '../../../domains/store/inventory/shared/services/stock-validator.service';

/**
 * Adaptador de presentación del contrato `orders` (T6, paso 15).
 *
 * Mudado desde `domains/orders.tools.ts`: `customerName` (con fallback al
 * snapshot de dirección para invitados), `compactOrder`, `toStockLines` y
 * `summarizeItems` viven aquí, versionados, en vez de inline en la factory.
 *
 * Reglas del adaptador:
 *
 * - `ORDER_ADAPTER_VERSION` implementa la versión del contrato de las tools
 *   (`version: '1'`). `compactOrder` acepta la versión esperada por el
 *   llamante: si no coincide, degrada con `note` explícito en vez de fallar
 *   o de adivinar la forma nueva.
 * - Degradación honesta: las columnas ausentes viajan ausentes (nunca
 *   inventadas) y cuando falta la identidad mínima (`id`/`order_number`) o
 *   la versión pedida no coincide, la fila porta `note` explicando qué pasa.
 *   En el camino feliz no hay `note`: la forma es idéntica a la de antes del
 *   paso 15.
 * - Migración que renombre columnas usadas por estos mappers actualiza
 *   adaptador + contrato + spec en la misma PR (ver specs `*.adapter.spec.ts`).
 */

export const ORDER_ADAPTER_VERSION: string = DEFAULT_TOOL_VERSION;

/**
 * Nombre del cliente. Las órdenes de invitado no tienen `users`; el nombre vive
 * en el snapshot de dirección, así que hay que rascarlo de ahí antes de rendirse.
 */
export function customerName(order: any): string {
  const user = order?.users;
  if (user) {
    const full = [user.first_name, user.last_name].filter(Boolean).join(' ');
    if (full.trim()) return full.trim();
    if (user.email) return user.email;
  }

  const snapshot = order?.shipping_address_snapshot;
  if (snapshot && typeof snapshot === 'object') {
    const candidate =
      snapshot.full_name ??
      snapshot.recipient_name ??
      snapshot.name ??
      [snapshot.first_name, snapshot.last_name].filter(Boolean).join(' ');
    if (candidate && String(candidate).trim()) return String(candidate).trim();
  }

  return 'Invitado (sin cliente registrado)';
}

/** Fila compacta para listados. Nunca incluyas los ítems completos aquí. */
export function compactOrder(
  order: any,
  expectedVersion: string = ORDER_ADAPTER_VERSION,
): Record<string, any> {
  const notes: string[] = [];
  if (expectedVersion !== ORDER_ADAPTER_VERSION) {
    notes.push(
      `Contrato v${expectedVersion} pedido al adaptador v${ORDER_ADAPTER_VERSION}: se devuelve la proyección v${ORDER_ADAPTER_VERSION} sin inventar campos.`,
    );
  }
  if (order?.id == null || order?.order_number == null) {
    notes.push(
      'La orden llegó sin identificador (id/order_number): la fila viaja con nulls y no sirve como referencia.',
    );
  }
  return {
    order_id: order.id,
    numero: order.order_number,
    cliente: customerName(order),
    customer_id: order.customer_id ?? null,
    estado: order.state,
    canal: order.channel,
    tipo_entrega: order.delivery_type,
    total: num(order.grand_total),
    pagado: num(order.total_paid),
    saldo_pendiente: num(order.remaining_balance),
    cumplimiento_despacho: order.dispatch_fulfillment,
    items: Array.isArray(order.order_items) ? order.order_items.length : null,
    creada: order.created_at,
    ...(notes.length ? { note: notes.join(' ') } : {}),
  };
}

/**
 * Demanda validable por `StockValidatorService`: solo renglones con
 * `product_id`. Los renglones `custom`/servicio sin producto no consumen
 * stock y nunca bloquean.
 */
export function toStockLines(
  items: Array<{
    product_id?: unknown;
    product_variant_id?: unknown;
    quantity?: unknown;
    product_name?: unknown;
  }>,
): StockDemandLine[] {
  return items
    .filter((item) => item.product_id !== undefined && item.product_id !== null)
    .map((item) => ({
      product_id: Number(item.product_id),
      product_variant_id:
        item.product_variant_id == null ? null : Number(item.product_variant_id),
      quantity: Number(item.quantity),
      product_name: item.product_name ? String(item.product_name) : undefined,
    }))
    .filter(
      (line) =>
        Number.isFinite(line.product_id) &&
        line.product_id > 0 &&
        line.quantity > 0,
    );
}

/** "2× Coca Cola 1L + 1× Pan": sujeto humano para previews y cambios. */
export function summarizeItems(
  items: Array<{ quantity?: unknown; product_name?: unknown }>,
): string {
  return items
    .map((item) => `${item.quantity ?? '?'}× ${item.product_name ?? 'ítem'}`)
    .join(' + ');
}

function num(value: any): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : 0;
}
