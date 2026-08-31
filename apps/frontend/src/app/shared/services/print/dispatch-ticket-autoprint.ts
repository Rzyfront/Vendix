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
 * `home_delivery` en el sistema.
 *
 * ⚠️ Decisión del usuario, 2026-08-31: el MISMO documento `dispatch_ticket`
 * sirve como tiquete de reclamo cuando el cliente paga en mostrador y espera
 * a que le preparen la comida (`direct_delivery` y `pickup`). Eso es opt-in:
 * el setting `print_dispatch_ticket_on_counter` (default false) abre la
 * puerta para esos dos tipos de entrega, sin tocar `dine_in` (la comanda
 * de cocina ya cubre ese caso) ni `other` (no definido). Esta es una
 * ENMIENDA al ADR-6: el guard original `direct_delivery → false` sigue
 * siendo el camino por defecto; el nuevo interruptor lo reemplaza solo
 * cuando el admin lo activa.
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
  /**
   * `print_dispatch_ticket_on_counter` — opt-in por admin para que el
   * tiquete de despacho se imprima también en ventas de MOSTRADOR
   * (`direct_delivery`) y PARA LLEVAR (`pickup`). Default `false`.
   * Con `false`, el predicado aplica los guards originales (ADR-6) y
   * devuelve `false` para esos dos tipos de entrega. Con `true`,
   * `direct_delivery` y `pickup` pasan el guard 4; `dine_in` y `other`
   * siguen en `false` aunque el interruptor esté prendido.
   */
  counterEnabled?: boolean;
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
 * 3. con `counterEnabled === false` (camino por defecto, ADR-6):
 *    - `direct_delivery` (mostrador) nunca imprime.
 *    - solo venta con envío (`home_delivery` o `isShippingSale`).
 *    con `counterEnabled === true` (enmienda, decisión del usuario 2026-08-31):
 *    - `direct_delivery` y `pickup` también imprimen (cliente que paga
 *      y espera, reclama con el tiquete).
 *    - `home_delivery` y `isShippingSale` siguen imprimiendo (sin cambio).
 *    - `dine_in` y `other` siguen en `false` (no se imprimen NUNCA en
 *      esta rama — es el borde que se rompe si la condición queda al revés).
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

  // ─── Guard 3/4 — entrega ──────────────────────────────────────────
  if (!context.counterEnabled) {
    // ADR-6 (camino por defecto): la entrega es en mostrador, no hay envío.
    if (context.deliveryType === 'direct_delivery') return false;
    // Solo venta con envío. `pickup` (retiro) y `other` tampoco imprimen.
    if (context.deliveryType !== 'home_delivery' && !context.isShippingSale) {
      return false;
    }
  } else {
    // Enmienda 2026-08-31: mostrador y para llevar también imprimen.
    // El resto de la cadena (`home_delivery`, `isShippingSale`) sigue
    // pasando por construcción. La lista explícita de tipos válidos
    // mantiene `dine_in` y `other` en `false` aunque el interruptor
    // esté prendido — ese es el borde que NO se puede invertir.
    const counterTypes = ['direct_delivery', 'pickup'];
    if (
      context.deliveryType !== 'home_delivery' &&
      !context.isShippingSale &&
      !counterTypes.includes(context.deliveryType ?? '')
    ) {
      return false;
    }
  }

  return true;
}
