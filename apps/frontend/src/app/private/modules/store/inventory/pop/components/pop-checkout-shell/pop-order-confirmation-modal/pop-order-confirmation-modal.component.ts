import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from '@angular/core';

import {
  ButtonComponent,
  IconComponent,
  ModalComponent,
} from '../../../../../../../../shared/components';
import { CurrencyPipe } from '../../../../../../../../shared/pipes/currency';

/**
 * Estado legible de la OC para el badge del modal.
 *
 * CP-PURCHASE-TRANSPARENCY (T2/D.2) — las claves son EXACTAMENTE los cinco
 * valores de `purchase_order_status_enum`
 * (`apps/backend/prisma/schema.prisma`):
 *
 *   draft · approved · partial · received · cancelled
 *
 * El mapa anterior declaraba además `created`, `paid` y `closed`, que la
 * columna `purchase_orders.status` NO puede tomar, y traducía `partial` como
 * «Pago parcial» cuando en ESTE eje significa recepción parcial (ver
 * `PurchaseOrdersService.receive`: `all_items_received → received`,
 * `some_items_received → partial`). Lo pagado vive en otra columna
 * (`payment_status`) y este badge no habla de ella.
 *
 * Un valor fuera del enum ya no se traduce a una etiqueta inventada: se pinta
 * tal cual llegó (ver `stateLabel`). Antes caía a «Creada», que es un estado
 * que no existe — la interfaz nombraba una situación que la base de datos no
 * podía tener.
 */
const STATE_LABELS: Record<string, string> = {
  draft: 'Borrador',
  approved: 'Aprobada',
  partial: 'Recibida parcialmente',
  received: 'Recibida',
  cancelled: 'Cancelada',
};

const STATE_BADGE_VARIANT: Record<string, 'success' | 'primary' | 'warning' | 'neutral'> = {
  draft: 'neutral',
  approved: 'primary',
  partial: 'warning',
  received: 'success',
  cancelled: 'neutral',
};

/** Lo que se pinta cuando el servidor no informó estado alguno. */
const STATE_UNKNOWN_LABEL = 'Sin confirmar';

/**
 * CP-ID-VNDX-2026-08-21-POP-MODAL — Modal standalone post-creación de OC.
 *
 * Reemplaza el panel `app-success` que vivía dentro de `pop-checkout-shell`.
 * Pinta info (número + total + estado) y ofrece al operador dos caminos:
 *
 *  - «Nueva compra» (variante secondary/borde): cierra el modal y limpia el
 *    carrito para empezar otra OC desde el taller POP.
 *  - «Ver orden» (variante primary/relleno): navega al detalle de la OC
 *    recién creada en `/admin/orders/purchase-orders/:id`.
 *
 * El header X, el clic en overlay y el ESC se tratan como atajos de
 * «Nueva compra» para no obligar al operador a elegir ruta cuando solo
 * quiere seguir trabajando.
 *
 * El padre controla la visibilidad con `[isOpen]`. El modal no conoce el
 * wizard — sólo recibe los datos ya resueltos.
 */
@Component({
  selector: 'app-pop-order-confirmation-modal',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ButtonComponent, IconComponent, ModalComponent, CurrencyPipe],
  templateUrl: './pop-order-confirmation-modal.component.html',
  styleUrl: './pop-order-confirmation-modal.component.scss',
})
export class PopOrderConfirmationModalComponent {
  readonly isOpen = input<boolean>(false);
  readonly orderNumber = input<string>('');
  readonly total = input<number>(0);
  /**
   * Estado real de la OC, tal como lo devolvió el servidor. Arranca VACÍO —
   * antes traía `'created'` por defecto, un estado que
   * `purchase_order_status_enum` no contempla: el modal afirmaba algo cuando
   * el padre no le había dicho nada.
   */
  readonly state = input<string>('');
  /**
   * ID numérico de la OC recién creada. Se proyecta al output `viewOrder`
   * para que el padre navegue al detalle. Es opcional: si el padre no lo
   * pasa, el botón «Ver orden» simplemente queda deshabilitado para no
   * navegar a una ruta con id falsamente válido.
   */
  readonly orderId = input<number | null>(null);

  /** El operador eligió empezar otra OC. El padre limpia el carrito. */
  readonly newPurchase = output<void>();
  /** El operador eligió ir al detalle de la OC recién creada. */
  readonly viewOrder = output<void>();

  /**
   * Etiqueta legible del estado para el badge.
   *
   * Sin estado ⇒ «Sin confirmar»: no sabemos en qué quedó la orden y decirlo
   * es más honesto que elegirle un estado. Estado desconocido ⇒ el token del
   * servidor tal cual, para no traducirlo a algo que podría no ser cierto.
   */
  readonly stateLabel = computed<string>(() => {
    const raw = (this.state() ?? '').toString().trim().toLowerCase();
    if (!raw) return STATE_UNKNOWN_LABEL;
    return STATE_LABELS[raw] ?? raw;
  });

  /** Variante del badge según estado. Lo no reconocido va en `neutral`. */
  readonly stateVariant = computed<
    'success' | 'primary' | 'warning' | 'neutral'
  >(() => {
    const raw = (this.state() ?? '').toString().trim().toLowerCase();
    return STATE_BADGE_VARIANT[raw] ?? 'neutral';
  });

  /**
   * Número a mostrar: si el backend no adjuntó `order_number` (caso raro en
   * seeds/dev), caemos al id numérico para no pintar la línea vacía.
   */
  readonly displayNumber = computed<string>(() => {
    const num = (this.orderNumber() ?? '').toString().trim();
    if (num) return num;
    // El id no llega como input (el padre lo manda en `orderNumber`); si
    // quedó vacío igualmente, pintamos un placeholder no roto.
    return 'OC';
  });

  /** Habilita «Ver orden» solo cuando hay id real para navegar. */
  readonly canViewOrder = computed<boolean>(() => {
    const id = this.orderId();
    return typeof id === 'number' && Number.isFinite(id) && id > 0;
  });

  /**
   * Cierre "neutro" (X del header, click en overlay, ESC). Lo tratamos como
   * «Nueva compra» para no obligar al operador a elegir un botón. El padre
   * limpia el carrito igual que en el camino explícito.
   */
  onClosed(): void {
    this.newPurchase.emit();
  }

  onNewPurchase(): void {
    this.newPurchase.emit();
  }

  onViewOrder(): void {
    if (!this.canViewOrder()) return;
    this.viewOrder.emit();
  }
}
