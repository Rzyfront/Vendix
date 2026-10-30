import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import {
  FulfillmentSlot,
  PosScheduledOrderService,
  ScheduledFulfillmentType,
} from '../../services/pos-scheduled-order.service';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';

/**
 * Which part of the scheduled-order picker this instance renders. The checkout
 * splits it across steps: `toggle` (Pedido), `slot` (Cliente: day + slot) and
 * `fulfillment` (Envío: delivery vs pickup). State lives in the service.
 */
export type ScheduledPickerSection = 'toggle' | 'slot' | 'fulfillment';

const FULFILLMENT_LABELS: Record<ScheduledFulfillmentType, string> = {
  pickup: 'Recogida en tienda',
  delivery: 'Domicilio',
};

/**
 * Selector de "Pedido programado" para el checkout del POS. Solo se renderiza
 * con el ajuste `scheduled_orders.enabled` activo; sin él no aparece nada.
 */
@Component({
  selector: 'app-pos-scheduled-order-picker',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  template: `
    @if (service.enabled()) {
      @switch (section()) {
        @case ('toggle') {
          <section class="rounded-xl border border-border bg-surface p-3 mb-3">
            <label class="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                class="h-4 w-4 accent-primary"
                [checked]="service.active()"
                [disabled]="service.required()"
                (change)="toggle($any($event.target).checked)"
              />
              <app-icon name="calendar-clock" [size]="16"></app-icon>
              <span class="text-sm font-semibold text-text-primary">Pedido programado</span>
            </label>
            @if (service.required()) {
              <p class="mt-2 text-xs text-text-secondary">
                Este pedido tiene adiciones: se entrega como pedido programado.
              </p>
            }
            @if (service.active()) {
              <p class="mt-2 text-xs text-text-secondary">
                El método de entrega se elige más adelante.
              </p>
            }
          </section>
        }

        @case ('slot') {
          @if (service.active()) {
            <section class="rounded-xl border border-border bg-surface p-3 mt-3 space-y-3">
              <p class="flex items-center gap-2 text-sm font-semibold text-text-primary">
                <app-icon name="calendar-clock" [size]="16"></app-icon>
                Fecha y hora de entrega
              </p>

              <div>
                <p class="text-xs font-semibold text-text-secondary mb-1">Día</p>
                @if (service.loading()) {
                  <p class="text-xs text-text-secondary">Cargando disponibilidad...</p>
                } @else if (!service.days().length) {
                  <p class="text-xs text-text-secondary">Sin días disponibles.</p>
                } @else {
                  <div class="flex gap-2 overflow-x-auto pb-1">
                    @for (d of service.days(); track d.date) {
                      <button
                        type="button"
                        class="shrink-0 px-3 py-1.5 rounded-lg border text-xs font-semibold disabled:opacity-40 disabled:cursor-not-allowed"
                        [class.bg-primary]="service.selectedDate() === d.date"
                        [class.text-white]="service.selectedDate() === d.date"
                        [class.border-border]="service.selectedDate() !== d.date"
                        [disabled]="d.blocked_reason === 'day_blocked'"
                        [attr.title]="d.blocked_reason === 'day_blocked' ? dayBlockedMessage : null"
                        (click)="service.selectDay(d.date)"
                      >
                        {{ dayLabel(d.date) }}
                      </button>
                    }
                  </div>
                }
              </div>

              @if (service.selectedDay(); as day) {
                @if (day.blocked_reason === 'day_blocked') {
                  <p class="text-xs text-text-secondary">{{ dayBlockedMessage }}</p>
                } @else {
                  <div>
                    <p class="text-xs font-semibold text-text-secondary mb-1">Franja</p>
                    <div class="grid grid-cols-2 sm:grid-cols-3 gap-2">
                      @for (s of day.slots; track s.start) {
                        <button
                          type="button"
                          class="px-2 py-1.5 rounded-lg border text-xs text-left disabled:opacity-40 disabled:cursor-not-allowed"
                          [class.bg-primary]="service.selectedStart() === s.start"
                          [class.text-white]="service.selectedStart() === s.start"
                          [class.border-border]="service.selectedStart() !== s.start"
                          [disabled]="!isSlotSelectable(s)"
                          [attr.aria-pressed]="service.selectedStart() === s.start"
                          (click)="service.selectSlot(s)"
                        >
                          <span class="block font-semibold">
                            {{ s.local_start }}–{{ s.local_end }}
                          </span>
                          <span class="block text-[11px] opacity-80">
                            @if (isFull(s)) {
                              Sin cupo
                            } @else {
                              {{ s.taken }}/{{ s.capacity }}
                            }
                          </span>
                        </button>
                      }
                    </div>
                  </div>
                }
              }

              @if (service.loadError()) {
                <p class="text-xs text-red-600">{{ service.loadError() }}</p>
              }
              @if (service.showValidation() && !service.hasSlot()) {
                <p class="text-xs text-red-600" role="alert">
                  Elige el día y la franja de entrega para continuar.
                </p>
              }
            </section>
          }
        }

        @case ('fulfillment') {
          @if (service.active()) {
            <section class="rounded-xl border border-border bg-surface p-3 mb-3">
              <p class="text-sm font-semibold text-text-primary mb-2">¿Cómo lo recibirá?</p>
              <div class="flex gap-2 flex-wrap">
                @for (t of service.fulfillmentTypes(); track t) {
                  <button
                    type="button"
                    class="px-3 py-1.5 rounded-lg border text-xs font-semibold disabled:opacity-40 disabled:cursor-not-allowed"
                    [class.bg-primary]="service.fulfillmentType() === t"
                    [class.text-white]="service.fulfillmentType() === t"
                    [class.border-border]="service.fulfillmentType() !== t"
                    [attr.aria-pressed]="service.fulfillmentType() === t"
                    [disabled]="t === 'delivery' && deliveryDisabled()"
                    (click)="service.selectFulfillment(t)"
                  >
                    {{ labelFor(t) }}
                  </button>
                }
              </div>
              @if (deliveryDisabled() && service.fulfillmentTypes().includes('delivery')) {
                <p class="mt-2 text-xs text-text-secondary">
                  El domicilio necesita un cliente o un nombre de referencia.
                </p>
              }
              @if (service.showValidation() && !service.fulfillmentType()) {
                <p class="mt-2 text-xs text-red-600" role="alert">
                  Elige cómo recibirá el pedido para continuar.
                </p>
              }
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
  /** Venta anónima: el domicilio no aplica (requiere identidad). */
  readonly deliveryDisabled = input(false);

  protected readonly dayBlockedMessage = 'La tienda no recibe pedidos para ese día.';

  protected labelFor(t: ScheduledFulfillmentType): string {
    return FULFILLMENT_LABELS[t];
  }

  protected dayLabel(date: string): string {
    const [y, m, d] = date.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('es-CO', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    });
  }

  protected isFull(s: FulfillmentSlot): boolean {
    return s.blocked_reason === 'slot_full' || s.blocked_reason === 'day_full';
  }

  protected isSlotSelectable(s: FulfillmentSlot): boolean {
    return s.available && !s.blocked_reason;
  }

  protected toggle(checked: boolean): void {
    if (this.service.required()) return;
    if (checked) this.service.activate();
    else this.service.reset();
  }
}
