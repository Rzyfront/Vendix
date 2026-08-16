/**
 * Una venta de mostrador que YA se cobró y YA se confirmó en base de datos.
 *
 * Se emite DESPUÉS del commit de `processPosPayment` a propósito: emitirlo
 * dentro de la transacción dispararía la facturación sobre una venta que
 * todavía puede revertirse, y la DIAN no tiene forma de deshacer un documento
 * que ya aceptó.
 *
 * Lleva el contexto de tenant EXPLÍCITO (organización, tienda, usuario) en vez
 * de confiar en el AsyncLocalStorage del request: el consumidor corre en una
 * continuación desprendida que puede sobrevivir a la respuesta HTTP, y un
 * contexto implícito que se evapora a mitad de camino produce un `Forbidden`
 * de Prisma imposible de diagnosticar.
 */
export interface PosSaleCompletedEvent {
  organization_id: number;
  store_id: number;
  /** Cajero que cerró la venta. Queda como `created_by_user_id` del documento. */
  user_id?: number;
  order_id: number;
  order_number?: string;
  /**
   * Si la tienda quiere que el documento salga solo al cerrar la venta.
   * `false` no cancela nada: la emisión queda disponible bajo demanda desde el
   * POS (`POST /store/invoicing/pos/orders/:orderId/emit`).
   */
  auto_emit: boolean;
}

export const POS_SALE_COMPLETED_EVENT = 'pos.sale.completed';
