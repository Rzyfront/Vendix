import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  FulfillmentDay,
  FulfillmentSlot,
  PosScheduledOrderService,
  ScheduledFulfillmentType,
} from '../../services/pos-scheduled-order.service';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';

const MAX_RANGE_DAYS = 62;

const FULFILLMENT_LABELS: Record<ScheduledFulfillmentType, string> = {
  pickup: 'Recogida en tienda',
  delivery: 'Domicilio',
};

/** YYYY-MM-DD en hora local (sin pasar por UTC). */
function toLocalDateString(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

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
      <section class="rounded-xl border border-border bg-surface p-3 mb-3">
        <label class="flex items-center gap-2 cursor-pointer select-none">
          <input
            type="checkbox"
            class="h-4 w-4 accent-primary"
            [checked]="active()"
            (change)="toggle($any($event.target).checked)"
          />
          <app-icon name="calendar-clock" [size]="16"></app-icon>
          <span class="text-sm font-semibold text-text-primary">Pedido programado</span>
        </label>

        @if (active()) {
          <div class="mt-3 space-y-3">
            <div>
              <p class="text-xs font-semibold text-text-secondary mb-1">Tipo de entrega</p>
              <div class="flex gap-2 flex-wrap">
                @for (t of service.fulfillmentTypes(); track t) {
                  <button
                    type="button"
                    class="px-3 py-1.5 rounded-lg border text-xs font-semibold"
                    [class.bg-primary]="fulfillmentType() === t"
                    [class.text-white]="fulfillmentType() === t"
                    [class.border-border]="fulfillmentType() !== t"
                    [attr.aria-pressed]="fulfillmentType() === t"
                    (click)="selectFulfillment(t)"
                  >
                    {{ labelFor(t) }}
                  </button>
                }
              </div>
            </div>

            <div>
              <p class="text-xs font-semibold text-text-secondary mb-1">Día</p>
              @if (loading()) {
                <p class="text-xs text-text-secondary">Cargando disponibilidad...</p>
              } @else if (!days().length) {
                <p class="text-xs text-text-secondary">Sin días disponibles.</p>
              } @else {
                <div class="flex gap-2 overflow-x-auto pb-1">
                  @for (d of days(); track d.date) {
                    <button
                      type="button"
                      class="shrink-0 px-3 py-1.5 rounded-lg border text-xs font-semibold disabled:opacity-40 disabled:cursor-not-allowed"
                      [class.bg-primary]="selectedDate() === d.date"
                      [class.text-white]="selectedDate() === d.date"
                      [class.border-border]="selectedDate() !== d.date"
                      [disabled]="d.blocked_reason === 'day_blocked'"
                      [attr.title]="d.blocked_reason === 'day_blocked' ? dayBlockedMessage : null"
                      (click)="selectDay(d.date)"
                    >
                      {{ dayLabel(d.date) }}
                    </button>
                  }
                </div>
              }
            </div>

            @if (selectedDay(); as day) {
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
                        [class.bg-primary]="selectedStart() === s.start"
                        [class.text-white]="selectedStart() === s.start"
                        [class.border-border]="selectedStart() !== s.start"
                        [disabled]="!isSlotSelectable(s)"
                        [attr.aria-pressed]="selectedStart() === s.start"
                        (click)="selectSlot(s)"
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

            @if (loadError()) {
              <p class="text-xs text-red-600">{{ loadError() }}</p>
            }
          </div>
        }
      </section>
    }
  `,
})
export class PosScheduledOrderPickerComponent {
  protected readonly service = inject(PosScheduledOrderService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly dayBlockedMessage = 'La tienda no recibe pedidos para ese día.';

  protected readonly active = signal(false);
  protected readonly loading = signal(false);
  protected readonly loadError = signal<string | null>(null);
  protected readonly days = signal<FulfillmentDay[]>([]);
  protected readonly selectedDate = signal<string | null>(null);
  protected readonly selectedStart = signal<string | null>(null);
  protected readonly fulfillmentType = signal<ScheduledFulfillmentType | null>(null);

  protected readonly selectedDay = computed(
    () => this.days().find((d) => d.date === this.selectedDate()) ?? null,
  );

  constructor() {
    // Si el servicio limpia la elección (venta completada/cancelada), se reinicia el UI.
    effect(() => {
      const schedule = this.service.schedule();
      untracked(() => {
        if (!schedule && this.active()) this.resetLocal();
      });
    });
  }

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
    this.active.set(checked);
    if (!checked) {
      this.resetLocal();
      this.service.clear();
      return;
    }
    this.fulfillmentType.set(this.service.fulfillmentTypes()[0] ?? 'pickup');
    this.loadAvailability();
  }

  protected selectFulfillment(t: ScheduledFulfillmentType): void {
    this.fulfillmentType.set(t);
    this.syncSchedule();
  }

  protected selectDay(date: string): void {
    this.selectedDate.set(date);
    this.selectedStart.set(null);
    this.service.clear();
  }

  protected selectSlot(s: FulfillmentSlot): void {
    if (!this.isSlotSelectable(s)) return;
    this.selectedStart.set(s.start);
    this.syncSchedule();
  }

  private syncSchedule(): void {
    const slot = this.selectedDay()?.slots.find((s) => s.start === this.selectedStart());
    const type = this.fulfillmentType();
    if (!slot || !type) {
      this.service.clear();
      return;
    }
    this.service.setSchedule({ start: slot.start, end: slot.end, fulfillment_type: type });
  }

  private resetLocal(): void {
    this.active.set(false);
    this.days.set([]);
    this.selectedDate.set(null);
    this.selectedStart.set(null);
    this.fulfillmentType.set(null);
    this.loadError.set(null);
  }

  private loadAvailability(): void {
    const ahead = Math.min(this.service.maxDaysAhead(), MAX_RANGE_DAYS - 1);
    const from = new Date();
    const to = new Date();
    to.setDate(to.getDate() + ahead);
    this.loading.set(true);
    this.loadError.set(null);
    this.service
      .getAvailability(toLocalDateString(from), toLocalDateString(to))
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (days) => {
          this.days.set(days);
          this.loading.set(false);
        },
        error: () => {
          this.loading.set(false);
          this.loadError.set('No se pudo cargar la disponibilidad. Intenta de nuevo.');
        },
      });
  }
}
