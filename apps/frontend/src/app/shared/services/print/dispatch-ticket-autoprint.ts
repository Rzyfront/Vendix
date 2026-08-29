import type { PrintTrigger } from './document-print.service';

/**
 * Contexto que decide si el tiquete de despacho debe auto-imprimirse.
 *
 * Los campos se leen en el caller (componente/servicio) desde el `Order` y las
 * settings de la tienda. El helper es una función pura: así el POS, la
 * postventa (D.2) y el futuro segundo origen vía ruta (D.3) comparten la MISMA
 * cadena de guards sin duplicarla ni divergir.
 *
 * ⚠️ NOMBRES INVERTIDOS (decisión del usuario, 2026-08-29): en el enum de
 * Vendix `direct_delivery` = venta de MOSTRADOR y `home_delivery` = envío a
 * domicilio. Lo que en Pollo Árabe se llama "entrega directa al domicilio" es
 * `home_delivery` en el sistema. El guard NO abre `direct_delivery` ni
 * `pickup`; solo imprime para `home_delivery` o con la marca explícita
 * `isShippingSale` — misma regla que el POS
 * (`pos-order-confirmation.component.ts:1103-1113`).
 */
export interface ShouldAutoPrintDispatchTicketContext {
  /**
   * `print_dispatch_ticket_enabled` — formato del tiquete habilitado (ADR-7).
   * Default `true` (las tiendas nuevas pueden imprimirlo manual sin tocar
   * settings). Si `false`, ningún disparador imprime.
   */
  printDispatchTicketEnabled: boolean;
  /**
   * Toggle de auto-impresión del ORIGEN. Con `trigger === 'automatic'` se
   * exige; con `'explicit'` no aplica. En postventa el caller pasa
   * `print_dispatch_ticket_auto_on_postventa`; el POS pasa
   * `print_dispatch_ticket_auto_with_pos`.
   */
  printDispatchTicketAuto?: boolean;
  /** `order.delivery_type`. */
  deliveryType?: string | null;
  /** Marca explícita de venta con envío (POS). Ausente en postventa → false. */
  isShippingSale?: boolean;
}

/**
 * Cadena de guards para decidir si el tiquete de despacho debe imprimirse.
 *
 * Orden exacto del POS (`pos-order-confirmation.component.ts:1170-1178`):
 * 1. formato habilitado (`print_dispatch_ticket_enabled`),
 * 2. toggle de auto-impresión del origen (solo trigger `'automatic'`),
 * 3. `direct_delivery` (mostrador) nunca imprime (ADR-6),
 * 4. solo venta con envío (`home_delivery` o `isShippingSale`).
 *
 * Devuelve `true` solo si TODAS pasan; `false` en el primer guard que falla.
 */
export function shouldAutoPrintDispatchTicket(
  trigger: PrintTrigger,
  context: ShouldAutoPrintDispatchTicketContext,
): boolean {
  const enabled = context.printDispatchTicketEnabled ?? true;
  if (!enabled) return false;

  if (trigger === 'automatic' && !context.printDispatchTicketAuto) return false;

  // ADR-6: la entrega es en mostrador, no hay envío que despachar.
  if (context.deliveryType === 'direct_delivery') return false;

  // Solo venta con envío. `pickup` (retiro) y `other` tampoco imprimen.
  if (context.deliveryType !== 'home_delivery' && !context.isShippingSale) {
    return false;
  }

  return true;
}
