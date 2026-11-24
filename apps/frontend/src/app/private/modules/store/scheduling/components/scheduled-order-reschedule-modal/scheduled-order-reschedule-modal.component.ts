import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  ButtonComponent,
  ModalComponent,
  SpinnerComponent,
  ToastService,
} from '../../../../../../shared/components';
import { extractApiErrorMessage } from '../../../../../../core/utils/api-error-handler';
import { StoreSettingsFacade } from '../../../../../../core/store/store-settings/store-settings.facade';
import { storeToday } from '../../../../../../shared/utils/date.util';
import { ScheduledOrdersApiService } from '../../../scheduled-orders/services/scheduled-orders-api.service';
import {
  FulfillmentDay,
  FulfillmentSlot,
} from '../../../scheduled-orders/interfaces/scheduled-order.interface';
import { addDays, dayMonth, weekdayShort } from '../../../scheduled-orders/utils/ymd.util';
import { SchedulingEvent } from '../../interfaces/scheduling.interface';

/** Días que ofrece el selector a partir de hoy. */
const WINDOW_DAYS = 14;

/**
 * Reprogramar un pedido programado eligiendo otra franja disponible. Lee la
 * disponibilidad y reprograma con los endpoints de Pedidos programados (mismas
 * reglas de cupo y horario que el arrastre de la agenda de pedidos).
 */
@Component({
  selector: 'app-scheduled-order-reschedule-modal',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ModalComponent, ButtonComponent, SpinnerComponent],
  template: `
    <app-modal
      [isOpen]="true"
      (isOpenChange)="!$event && closed.emit()"
      [title]="'Reprogramar pedido ' + event().reference"
      subtitle="Elige el día y la franja de entrega"
      size="md"
      [fullScreenOnMobile]="true"
    >
      @if (loading()) {
        <div class="flex justify-center py-10"><app-spinner /></div>
      } @else {
        <div class="flex flex-col gap-4">
          <div class="flex gap-2 overflow-x-auto pb-1" role="listbox" aria-label="Día">
            @for (day of days(); track day.date) {
              <button
                type="button"
                role="option"
                class="flex min-w-16 flex-col items-center rounded-xl border px-3 py-2 text-xs font-semibold"
                [class]="pickClass(day.date === selectedDate(), !hasFreeSlot(day))"
                [attr.aria-selected]="day.date === selectedDate()"
                (click)="selectDate(day.date)"
              >
                <span class="capitalize">{{ weekday(day.date) }}</span>
                <span class="text-sm font-bold">{{ dayLabel(day.date) }}</span>
              </button>
            }
          </div>

          @if (selectedDay(); as day) {
            @if (day.blocked_reason) {
              <p class="text-sm text-text-secondary">
                Día cerrado{{ day.exception_reason ? ': ' + day.exception_reason : '' }}.
              </p>
            } @else if (!day.slots.length) {
              <p class="text-sm text-text-secondary">No hay franjas configuradas este día.</p>
            } @else {
              <div class="grid grid-cols-2 gap-2 sm:grid-cols-3">
                @for (slot of day.slots; track slot.start) {
                  <button
                    type="button"
                    class="rounded-xl border px-3 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-40"
                    [class]="pickClass(slot.start === selectedSlot()?.start, false)"
                    [disabled]="!slot.available"
                    [attr.aria-pressed]="slot.start === selectedSlot()?.start"
                    (click)="selectedSlot.set(slot)"
                  >
                    {{ slot.local_start }}–{{ slot.local_end }}
                    <span class="block text-xs font-normal text-text-secondary">
                      {{ slot.available ? slot.capacity - slot.taken + ' cupos' : 'Sin cupo' }}
                    </span>
                  </button>
                }
              </div>
            }
          }
        </div>
      }

      <div slot="footer" class="flex justify-end gap-2">
        <app-button variant="outline" (clicked)="closed.emit()">Cancelar</app-button>
        <app-button
          variant="primary"
          [disabled]="!selectedSlot() || saving()"
          [loading]="saving()"
          (clicked)="save()"
        >
          Reprogramar
        </app-button>
      </div>
    </app-modal>
  `,
})
export class ScheduledOrderRescheduleModalComponent {
  private readonly api = inject(ScheduledOrdersApiService);
  private readonly settings = inject(StoreSettingsFacade);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  readonly event = input.required<SchedulingEvent>();
  readonly closed = output<void>();
  readonly rescheduled = output<void>();

  readonly days = signal<FulfillmentDay[]>([]);
  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly selectedDate = signal<string | null>(null);
  readonly selectedSlot = signal<FulfillmentSlot | null>(null);
  readonly selectedDay = computed(
    () => this.days().find((day) => day.date === this.selectedDate()) ?? null,
  );

  constructor() {
    const today = storeToday(this.settings.timezone());
    this.api
      .getAvailability(today, addDays(today, WINDOW_DAYS - 1))
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (days) => {
          this.days.set(days);
          const first = days.find((day) => this.hasFreeSlot(day)) ?? days[0];
          this.selectedDate.set(first?.date ?? null);
          this.loading.set(false);
        },
        error: (err) => {
          this.loading.set(false);
          this.toast.error(extractApiErrorMessage(err) || 'No se pudo leer la disponibilidad');
        },
      });
  }

  /** Clases del botón elegido / sin elegir (tinte de marca, tokens). */
  pickClass(selected: boolean, muted: boolean): string {
    const tone = selected
      ? 'border-primary/25 bg-primary/10 text-primary-on-tint'
      : 'border-border bg-surface text-text-primary';
    return muted ? `${tone} opacity-50` : tone;
  }

  hasFreeSlot(day: FulfillmentDay): boolean {
    return !day.blocked_reason && day.slots.some((slot) => slot.available);
  }

  selectDate(date: string): void {
    this.selectedDate.set(date);
    this.selectedSlot.set(null);
  }

  weekday(ymd: string): string {
    return weekdayShort(ymd);
  }

  dayLabel(ymd: string): string {
    return dayMonth(ymd);
  }

  save(): void {
    const slot = this.selectedSlot();
    if (!slot || this.saving()) return;
    this.saving.set(true);
    this.api
      .reschedule(this.event().source_id, slot.start, slot.end)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.saving.set(false);
          this.toast.success('Pedido reprogramado');
          this.rescheduled.emit();
        },
        error: (err) => {
          this.saving.set(false);
          this.toast.error(extractApiErrorMessage(err));
        },
      });
  }
}
