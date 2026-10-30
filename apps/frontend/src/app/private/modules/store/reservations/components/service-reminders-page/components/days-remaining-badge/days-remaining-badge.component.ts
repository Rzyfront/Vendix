import { Component, computed, input } from '@angular/core';
import { BadgeComponent, BadgeVariant } from '../../../../../../../../shared/components/badge/badge.component';
import { RecurrenceStatus } from '../../service-registry.interfaces';

export interface DaysRemainingView {
  text: string;
  variant: BadgeVariant;
}

/** Texto + color de la cuenta regresiva (reutilizado por la tabla y las cards móviles). */
export function describeDaysRemaining(
  status: RecurrenceStatus,
  daysRemaining: number | null,
  reminderStatus?: string | null,
): DaysRemainingView {
  if (status === 'none' || daysRemaining == null) return { text: 'No recurrente', variant: 'neutral' };
  if (status === 'superseded') return { text: 'Ya repetido', variant: 'neutral' };
  if (reminderStatus === 'dismissed') return { text: 'Descartado', variant: 'neutral' };
  if (daysRemaining < 0) {
    const n = Math.abs(daysRemaining);
    return { text: `Vencido hace ${n} ${n === 1 ? 'día' : 'días'}`, variant: 'error' };
  }
  if (daysRemaining === 0) return { text: 'Vence hoy', variant: 'error' };
  if (daysRemaining <= 3) return { text: `Quedan ${daysRemaining} ${daysRemaining === 1 ? 'día' : 'días'}`, variant: 'warning' };
  return { text: `Quedan ${daysRemaining} días`, variant: 'success' };
}

/**
 * Badge de cuenta regresiva para servicios recurrentes:
 * "Quedan 12 días" (verde), "Quedan 2 días" (amarillo), "Vence hoy" / "Vencido hace 4 días" (rojo).
 */
@Component({
  selector: 'app-days-remaining-badge',
  standalone: true,
  imports: [BadgeComponent],
  // En una sola línea: un estado partido en dos descuadra la fila de la tabla.
  template: `<span class="inline-flex whitespace-nowrap"><app-badge [variant]="view().variant" size="sm">{{ view().text }}</app-badge></span>`,
})
export class DaysRemainingBadgeComponent {
  readonly status = input.required<RecurrenceStatus>();
  readonly daysRemaining = input<number | null>(null);
  readonly reminderStatus = input<string | null | undefined>(null);

  readonly view = computed(() => describeDaysRemaining(this.status(), this.daysRemaining(), this.reminderStatus()));
}
