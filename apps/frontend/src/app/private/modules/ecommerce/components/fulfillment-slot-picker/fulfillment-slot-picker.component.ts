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
import { toLocalDateString } from '../../../../../shared/utils/date.util';
import {
  EcommerceScheduledOrdersService,
  FulfillmentDay,
  FulfillmentSlot,
} from '../../services/ecommerce-scheduled-orders.service';

/** Días hacia adelante que se consultan (el servidor admite hasta 62). */
const DAYS_AHEAD = 28;

export interface FulfillmentSlotValue {
  start: string;
  end: string;
}

/**
 * Selector de día y franja de entrega/recogida (pedidos programados).
 * No pinta nada mientras carga, si el agendamiento está apagado
 * (SCHED_DISABLED) o si la carga falla: el checkout queda como siempre.
 */
@Component({
  selector: 'app-fulfillment-slot-picker',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (visible()) {
      <section class="fsp" aria-label="Día y hora del pedido">
        <h3 class="fsp__title">{{ title() }}</h3>
        <p class="fsp__help">
          Opcional. Elige cuándo quieres recibir tu pedido.
        </p>

        <div class="fsp__days" role="listbox" aria-label="Día">
          @for (day of days(); track day.date) {
            <button
              type="button"
              class="fsp__day"
              [class.fsp__day--selected]="selectedDate() === day.date"
              [disabled]="!isDayEnabled(day)"
              [attr.aria-selected]="selectedDate() === day.date"
              (click)="selectDate(day.date)"
            >
              <span class="fsp__day-name">{{ dayName(day.date) }}</span>
              <span class="fsp__day-num">{{ dayNumber(day.date) }}</span>
              @if (day.blocked_reason === 'day_blocked') {
                <span class="fsp__note">Cerrado</span>
              }
            </button>
          }
        </div>

        @if (selectedDay(); as day) {
          <div class="fsp__slots">
            @for (slot of day.slots; track slot.start) {
              <button
                type="button"
                class="fsp__slot"
                [class.fsp__slot--selected]="value() === slot.start"
                [disabled]="!slot.available"
                [attr.aria-pressed]="value() === slot.start"
                (click)="selectSlot(slot)"
              >
                <span>{{ slot.local_start }} - {{ slot.local_end }}</span>
                @if (!slot.available) {
                  <span class="fsp__note">{{ slotNote(slot) }}</span>
                }
              </button>
            }
          </div>
        } @else {
          <p class="fsp__help">Selecciona un día para ver las franjas.</p>
        }
      </section>
    }
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .fsp {
        padding: 1rem;
        margin-bottom: 1rem;
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md);
        background: var(--color-background);
      }
      .fsp__title {
        margin: 0 0 0.25rem;
        font-size: var(--fs-base);
        font-weight: var(--fw-semibold);
        color: var(--color-text-primary);
      }
      .fsp__help {
        margin: 0 0 0.75rem;
        font-size: var(--fs-sm);
        color: var(--color-text-secondary);
      }
      .fsp__days {
        display: flex;
        gap: 0.5rem;
        overflow-x: auto;
        padding-bottom: 0.5rem;
        margin-bottom: 0.75rem;
      }
      .fsp__day,
      .fsp__slot {
        display: inline-flex;
        flex-direction: column;
        align-items: center;
        gap: 0.1rem;
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md);
        background: var(--color-surface, var(--color-background));
        color: var(--color-text-primary);
        font-size: var(--fs-sm);
        cursor: pointer;
        transition: border-color var(--transition-fast);
      }
      .fsp__day {
        min-width: 4rem;
        padding: 0.5rem 0.6rem;
        flex: 0 0 auto;
      }
      .fsp__day-name {
        font-size: var(--fs-xs);
        text-transform: capitalize;
        color: var(--color-text-secondary);
      }
      .fsp__day-num {
        font-weight: var(--fw-semibold);
      }
      .fsp__slots {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(8.5rem, 1fr));
        gap: 0.5rem;
      }
      .fsp__slot {
        padding: 0.55rem 0.6rem;
      }
      .fsp__day--selected,
      .fsp__slot--selected {
        border-color: var(--color-primary);
        background: var(--color-primary-light);
        color: var(--color-primary);
      }
      .fsp__day:disabled,
      .fsp__slot:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
      .fsp__note {
        font-size: var(--fs-xs);
        color: var(--color-text-secondary);
      }
    `,
  ],
})
export class FulfillmentSlotPickerComponent {
  private readonly service = inject(EcommerceScheduledOrdersService);
  private readonly destroyRef = inject(DestroyRef);

  /** Inicio (ISO UTC) de la franja elegida; el padre lo conserva entre pasos. */
  readonly value = input<string | null>(null);
  readonly title = input<string>('Día y hora de entrega');
  readonly slotChange = output<FulfillmentSlotValue | null>();

  readonly days = signal<FulfillmentDay[]>([]);
  readonly selectedDate = signal<string | null>(null);

  /** Solo se muestra si la carga salió bien y hay al menos una franja. */
  readonly visible = computed(() =>
    this.days().some((d) => d.slots.length > 0),
  );

  readonly selectedDay = computed(
    () => this.days().find((d) => d.date === this.selectedDate()) ?? null,
  );

  constructor() {
    const from = new Date();
    const to = new Date();
    to.setDate(to.getDate() + DAYS_AHEAD);
    this.service
      .getAvailability(toLocalDateString(from), toLocalDateString(to))
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((days) => {
        // null = agendamiento apagado o error: el paso queda oculto.
        const list = days ?? [];
        this.days.set(list);
        // Si volvemos al paso con una franja elegida, reabre su día.
        const current = this.value();
        if (current) {
          const day = list.find((d) =>
            d.slots.some((s) => s.start === current),
          );
          if (day) this.selectedDate.set(day.date);
        }
      });
  }

  /** Un día se puede elegir si no está bloqueado y tiene alguna franja libre. */
  isDayEnabled(day: FulfillmentDay): boolean {
    return (
      day.blocked_reason === null && day.slots.some((s) => s.available)
    );
  }

  selectDate(date: string): void {
    this.selectedDate.set(date);
    // Cambiar de día invalida la franja anterior.
    const current = this.value();
    const day = this.days().find((d) => d.date === date);
    if (current && !day?.slots.some((s) => s.start === current)) {
      this.slotChange.emit(null);
    }
  }

  selectSlot(slot: FulfillmentSlot): void {
    if (!slot.available) return;
    // Tocar la franja elegida la desmarca (el agendamiento es opcional).
    if (this.value() === slot.start) {
      this.slotChange.emit(null);
      return;
    }
    this.slotChange.emit({ start: slot.start, end: slot.end });
  }

  slotNote(slot: FulfillmentSlot): string {
    switch (slot.blocked_reason) {
      case 'slot_full':
      case 'day_full':
        return 'Sin cupo';
      case 'lead_time':
        return 'Muy pronto';
      case 'too_far':
        return 'Fuera de rango';
      default:
        return 'No disponible';
    }
  }

  // Fechas "YYYY-MM-DD" de la tienda: se formatean en UTC para no correr el día.
  dayName(date: string): string {
    return new Date(`${date}T00:00:00Z`).toLocaleDateString('es-CO', {
      weekday: 'short',
      timeZone: 'UTC',
    });
  }

  dayNumber(date: string): string {
    return new Date(`${date}T00:00:00Z`).toLocaleDateString('es-CO', {
      day: 'numeric',
      month: 'short',
      timeZone: 'UTC',
    });
  }
}
