import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import {
  FulfillmentDay,
  FulfillmentSlot,
  PosScheduledOrderService,
  SlotBlockedReason,
} from '../../services/pos-scheduled-order.service';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { NonProducibleNoticeComponent } from '../../../scheduled-orders/components/non-producible-notice/non-producible-notice.component';
import { CartItem, isProducibleProduct } from '../../models/cart.model';

/**
 * Which part of the scheduled-order picker this instance renders. The checkout
 * splits it across steps: `toggle` (Pedido), `slot` (Cliente: day + slot) and
 * `summary` (Envío: the chosen day/slot above the store's shipping methods).
 * State lives in the service.
 */
export type ScheduledPickerSection = 'toggle' | 'slot' | 'summary';

/** Motivo visible de una franja que no se puede elegir. */
const SLOT_REASON_LABELS: Record<Exclude<SlotBlockedReason, null>, string> = {
  slot_full: 'Sin cupo',
  day_full: 'Día lleno',
  lead_time: 'Muy pronto',
  too_far: 'Muy lejos',
};

interface DayState {
  disabled: boolean;
  /** Motivo corto visible bajo el día cuando está deshabilitado. */
  reason: string | null;
}

/**
 * Selector de "Pedido programado" para el checkout del POS. Solo se renderiza
 * con el ajuste `scheduled_orders.enabled` activo; sin él no aparece nada.
 * Estrategia de uso: primero el día, luego la franja; el método de entrega es el
 * de los métodos de envío de la tienda (paso Envío), no uno propio.
 */
@Component({
  selector: 'app-pos-scheduled-order-picker',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent, NonProducibleNoticeComponent],
  template: `
    @if (service.enabled()) {
      @switch (section()) {
        @case ('toggle') {
          <section class="rounded-2xl border border-border bg-surface p-3 mb-3">
            <div class="flex items-center gap-3">
              <span
                class="h-10 w-10 shrink-0 inline-flex items-center justify-center rounded-xl border border-primary/25 bg-primary/10 text-primary"
                aria-hidden="true"
              >
                <app-icon name="calendar-clock" [size]="18"></app-icon>
              </span>
              <div class="min-w-0 flex-1">
                <p id="pos-scheduled-toggle-label" class="text-sm font-semibold text-text-primary">
                  Pedido programado
                </p>
                <p id="pos-scheduled-toggle-desc" class="text-xs text-text-secondary">
                  Entrega en otro día u hora, con un cliente.
                </p>
              </div>
              <button
                type="button"
                role="switch"
                class="relative h-6 w-11 shrink-0 rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20"
                [class]="switchClasses()"
                [attr.aria-checked]="service.active()"
                aria-labelledby="pos-scheduled-toggle-label"
                aria-describedby="pos-scheduled-toggle-desc"
                (click)="toggle(!service.active())"
              >
                <span
                  class="absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-surface shadow-2xs transition-transform"
                  [class.translate-x-5]="service.active()"
                ></span>
              </button>
            </div>
            @if (service.active()) {
              <div class="mt-3 flex flex-wrap items-center justify-between gap-2">
                <p class="text-xs text-text-secondary">
                  Elige el cliente, el día y la franja. El método de entrega es uno de los envíos de la tienda.
                </p>
                <button
                  type="button"
                  class="h-8 px-2.5 inline-flex items-center gap-1 rounded-xl border border-error/25 bg-error/10 text-error text-xs font-semibold hover:bg-error/15 active:scale-95 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-error/20"
                  (click)="toggle(false)"
                >
                  <app-icon name="x" [size]="12"></app-icon>
                  Quitar programación
                </button>
              </div>
            }
          </section>
        }

        @case ('slot') {
          @if (service.active()) {
            <section class="rounded-2xl border border-border bg-surface p-3 mt-3 space-y-4">
              <p class="flex items-center gap-2 text-sm font-semibold text-text-primary">
                <app-icon name="calendar-clock" [size]="16"></app-icon>
                Fecha y hora de entrega
              </p>

              @if (!hasCustomer()) {
                <p
                  class="flex items-start gap-2 rounded-xl border px-3 py-2 text-xs font-semibold"
                  [class]="customerHintClasses()"
                  [attr.role]="service.showValidation() ? 'alert' : 'status'"
                >
                  <app-icon name="user" [size]="14"></app-icon>
                  <span>Con Cliente: el pedido programado necesita un cliente para saber a quién entregar.</span>
                </p>
              }

              <div>
                <p id="pos-scheduled-day-label" class="text-xs font-semibold text-text-secondary mb-2">
                  1. Día
                </p>
                @if (service.loading()) {
                  <p class="text-xs text-text-secondary" role="status">Cargando disponibilidad...</p>
                } @else if (!service.days().length) {
                  <p class="text-xs text-text-secondary">Sin días disponibles.</p>
                } @else {
                  <div
                    class="flex gap-2 overflow-x-auto pb-1"
                    role="radiogroup"
                    aria-labelledby="pos-scheduled-day-label"
                  >
                    @for (d of service.days(); track d.date) {
                      @let st = dayState(d);
                      <button
                        type="button"
                        role="radio"
                        class="shrink-0 min-w-20 px-2 py-2 rounded-xl border text-center transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20"
                        [class]="dayClasses(d, st)"
                        [disabled]="st.disabled"
                        [attr.aria-checked]="service.selectedDate() === d.date"
                        [attr.aria-label]="dayAria(d, st)"
                        (click)="service.selectDay(d.date)"
                      >
                        <span class="block text-xs font-semibold uppercase">{{ weekday(d.date) }}</span>
                        <span class="block text-sm font-bold">{{ dayNumber(d.date) }}</span>
                        <span class="block text-xs">{{ st.reason ?? month(d.date) }}</span>
                      </button>
                    }
                  </div>
                }
              </div>

              @if (service.selectedDay(); as day) {
                @if (dayState(day).disabled) {
                  <p class="text-xs text-text-secondary">
                    {{ dayState(day).reason }}: ese día no recibe pedidos programados.
                  </p>
                } @else {
                  <div>
                    <p id="pos-scheduled-slot-label" class="text-xs font-semibold text-text-secondary mb-2">
                      2. Franja
                    </p>
                    <div
                      class="grid grid-cols-2 sm:grid-cols-3 gap-2"
                      role="radiogroup"
                      aria-labelledby="pos-scheduled-slot-label"
                    >
                      @for (s of day.slots; track s.start) {
                        <button
                          type="button"
                          role="radio"
                          class="min-h-12 px-3 py-2 rounded-xl border text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20"
                          [class]="slotClasses(s)"
                          [disabled]="!isSlotSelectable(s)"
                          [attr.aria-checked]="service.selectedStart() === s.start"
                          (click)="service.selectSlot(s)"
                        >
                          <span class="block text-sm font-semibold">
                            {{ s.local_start }}–{{ s.local_end }}
                          </span>
                          <span class="block text-xs">{{ slotNote(s) }}</span>
                        </button>
                      }
                    </div>
                  </div>
                }
              }

              @if (summaryText(false); as text) {
                <div
                  class="flex items-start gap-2 rounded-xl border border-primary/25 bg-primary/10 px-3 py-2 text-sm font-semibold text-primary-on-tint"
                  role="status"
                >
                  <app-icon name="calendar-clock" [size]="16"></app-icon>
                  <span>Entrega: {{ text }}</span>
                </div>
              }

              <!-- QUI-999: non-blocking notice for non-producible lines. -->
              @for (line of nonProducibleLines(); track line.id) {
                <app-non-producible-notice
                  [productId]="line.productId"
                  [productName]="line.name"
                  [productType]="line.productType"
                ></app-non-producible-notice>
              }

              @if (service.loadError()) {
                <p class="text-xs text-error" role="alert">{{ service.loadError() }}</p>
              }
              @if (service.showValidation() && !service.hasSlot()) {
                <p class="text-xs text-error" role="alert">
                  Elige el día y la franja de entrega para continuar.
                </p>
              }
            </section>
          }
        }

        @case ('summary') {
          @if (service.active()) {
            <section
              class="mb-3 flex items-start gap-2 rounded-2xl border border-primary/25 bg-primary/10 p-3"
              role="status"
            >
              <app-icon name="calendar-clock" [size]="16" class="text-primary"></app-icon>
              <div class="min-w-0">
                @if (summaryText(true); as text) {
                  <p class="text-sm font-semibold text-primary-on-tint">Entrega: {{ text }}</p>
                  <p class="text-xs text-text-secondary">
                    Elige abajo uno de los métodos de envío de la tienda. El despacho se hace luego desde la orden.
                  </p>
                } @else {
                  <p class="text-sm font-semibold text-text-primary">Falta elegir el día y la franja de entrega.</p>
                }
              </div>
            </section>
          }
        }
      }
    }
  `,
})
export class PosScheduledOrderPickerComponent {
  protected readonly service = inject(PosScheduledOrderService);

  readonly section = input<ScheduledPickerSection>('toggle');
  /** Nombre del método de envío elegido en el paso Envío (para el resumen). */
  readonly methodName = input<string | null>(null);
  /** Hay un cliente en la venta (el pedido programado lo exige). */
  readonly hasCustomer = input(true);

  /** Cart lines (restaurant stores only; the checkout passes `[]` elsewhere). */
  readonly cartItems = input<readonly CartItem[]>([]);

  /** Physical / prepared lines that are not producible (QUI-999 notice). */
  protected readonly nonProducibleLines = computed(() =>
    this.cartItems()
      .filter(
        (i) =>
          i.itemType !== 'custom' &&
          !i.booking &&
          i.product.product_type !== 'service' &&
          !isProducibleProduct(i.product),
      )
      .map((i) => ({
        id: i.id,
        productId: Number(i.product.id),
        name: i.product.name,
        productType: i.product.product_type ?? null,
      })),
  );

  /** Fecha local a partir de YYYY-MM-DD, sin pasar por UTC (sin desfase de día). */
  private localDate(date: string): Date {
    const [y, m, d] = date.split('-').map(Number);
    return new Date(y, m - 1, d);
  }

  protected weekday(date: string): string {
    return this.localDate(date).toLocaleDateString('es-CO', { weekday: 'short' }).replace('.', '');
  }

  protected dayNumber(date: string): string {
    return String(this.localDate(date).getDate());
  }

  protected month(date: string): string {
    return this.localDate(date).toLocaleDateString('es-CO', { month: 'short' }).replace('.', '');
  }

  /** "mar 12 nov": día legible para el resumen. */
  private dayLong(date: string): string {
    return `${this.weekday(date)} ${this.dayNumber(date)} ${this.month(date)}`;
  }

  /**
   * Un día se puede elegir si la tienda lo recibe y le queda al menos una franja
   * libre. El motivo se muestra bajo el día y se lee en voz alta.
   */
  protected dayState(d: FulfillmentDay): DayState {
    if (d.blocked_reason === 'day_blocked') {
      return { disabled: true, reason: d.exception_reason?.trim() || 'Cerrado' };
    }
    if (!d.slots.length) return { disabled: true, reason: 'Sin franjas' };
    if (d.slots.some((s) => this.isSlotSelectable(s))) return { disabled: false, reason: null };
    const reasons = new Set(d.slots.map((s) => s.blocked_reason));
    if ([...reasons].every((r) => r === 'slot_full' || r === 'day_full')) {
      return { disabled: true, reason: 'Sin cupo' };
    }
    if (reasons.size === 1 && reasons.has('lead_time')) return { disabled: true, reason: 'Muy pronto' };
    if (reasons.size === 1 && reasons.has('too_far')) return { disabled: true, reason: 'Muy lejos' };
    return { disabled: true, reason: 'No disponible' };
  }

  protected dayClasses(d: FulfillmentDay, st: DayState): string {
    if (st.disabled) {
      return 'border-border bg-text-secondary/5 text-text-secondary opacity-50 cursor-not-allowed';
    }
    return this.service.selectedDate() === d.date
      ? 'border-primary bg-primary/10 text-primary-on-tint ring-2 ring-primary/20'
      : 'border-border bg-surface text-text-primary hover:border-primary hover:bg-primary/5 active:scale-95';
  }

  protected dayAria(d: FulfillmentDay, st: DayState): string {
    const label = this.dayLong(d.date);
    return st.disabled ? `${label}, no disponible: ${st.reason}` : label;
  }

  protected switchClasses(): string {
    return this.service.active()
      ? 'bg-primary border-primary'
      : 'bg-text-secondary/10 border-border';
  }

  protected customerHintClasses(): string {
    return this.service.showValidation()
      ? 'border-error/25 bg-error/10 text-error'
      : 'border-primary/25 bg-primary/10 text-primary-on-tint';
  }

  protected isSlotSelectable(s: FulfillmentSlot): boolean {
    return s.available && !s.blocked_reason;
  }

  protected slotClasses(s: FulfillmentSlot): string {
    if (!this.isSlotSelectable(s)) {
      return 'border-border bg-text-secondary/5 text-text-secondary opacity-50 cursor-not-allowed';
    }
    return this.service.selectedStart() === s.start
      ? 'border-primary bg-primary/10 text-primary-on-tint ring-2 ring-primary/20'
      : 'border-border bg-surface text-text-primary hover:border-primary hover:bg-primary/5 active:scale-95';
  }

  /** Línea secundaria de la franja: motivo si no se puede elegir, cupo si sí. */
  protected slotNote(s: FulfillmentSlot): string {
    if (s.blocked_reason) return SLOT_REASON_LABELS[s.blocked_reason];
    if (!s.available) return 'No disponible';
    const left = s.capacity - s.taken;
    return left > 0 ? (left === 1 ? 'Queda 1 cupo' : `Quedan ${left} cupos`) : 'Disponible';
  }

  /** "{día} · {franja} · {método}"; vacío mientras no haya día y franja. */
  protected summaryText(withMethodHint: boolean): string {
    const day = this.service.selectedDay();
    const slot = day?.slots.find((s) => s.start === this.service.selectedStart());
    if (!day || !slot) return '';
    const parts = [this.dayLong(day.date), `${slot.local_start}–${slot.local_end}`];
    const method = this.methodName();
    if (method) parts.push(method);
    else if (withMethodHint) parts.push('método por elegir');
    return parts.join(' · ');
  }

  protected toggle(checked: boolean): void {
    if (checked) this.service.activate();
    else this.service.reset();
  }
}
