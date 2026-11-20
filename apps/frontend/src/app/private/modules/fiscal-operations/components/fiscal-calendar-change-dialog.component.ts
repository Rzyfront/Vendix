import { Component, computed, input, model, output } from '@angular/core';

import { ModalComponent } from '../../../../shared/components/modal/modal.component';
import { ButtonComponent } from '../../../../shared/components/button/button.component';
import { IconComponent } from '../../../../shared/components/icon/icon.component';
import { FiscalCalendarChangePreview } from '../interfaces/fiscal-operations.interface';

/** Nombre en pantalla de cada periodicidad de IVA (art. 600 ET). */
export const VAT_PERIODICITY_LABELS: Record<string, string> = {
  monthly: 'mensual',
  bimonthly: 'bimestral',
  four_monthly: 'cuatrimestral',
};

function periodicityLabel(value: string | null): string {
  return value ? (VAT_PERIODICITY_LABELS[value] ?? value) : 'anterior';
}

/**
 * Diálogo del cambio de periodicidad de IVA (F3).
 *
 * Cuando la persona cambia de bimestral a cuatrimestral (o al revés) ya puede
 * tener recordatorios y obligaciones pendientes del calendario anterior. Antes
 * de guardar le preguntamos si los reemplaza por los del calendario nuevo o si
 * los conserva. Las obligaciones ya presentadas o pagadas nunca se mencionan
 * como afectadas: el backend tampoco las toca.
 *
 * Componente de presentación: no llama al API, solo comunica la decisión.
 */
@Component({
  selector: 'app-fiscal-calendar-change-dialog',
  standalone: true,
  imports: [ModalComponent, ButtonComponent, IconComponent],
  template: `
    <app-modal
      [(isOpen)]="isOpen"
      title="Cambiaste la periodicidad del IVA"
      subtitle="Recordatorios del calendario tributario"
      size="sm"
    >
      <div class="space-y-3 text-sm text-text-primary">
        <p>
          Tenías
          <strong>{{ pendingRemindersText() }}</strong>
          y
          <strong>{{ pendingObligationsText() }}</strong>
          del calendario {{ currentLabel() }}.
        </p>
        <p class="text-text-secondary">
          Si los reemplazas, retiramos esos avisos de la bitácora y las
          obligaciones que aún no habías empezado, y creamos los del calendario
          {{ nextLabel() }}.
        </p>
        <p class="flex items-start gap-2 rounded-lg bg-surface-secondary p-3 text-xs text-text-secondary">
          <app-icon name="shield-check" [size]="14" class="mt-0.5 shrink-0"></app-icon>
          <span>
            Las declaraciones ya presentadas, aprobadas o pagadas no se
            modifican.
          </span>
        </p>
      </div>

      <div class="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <app-button variant="outline" size="sm" (clicked)="decide('keep')">
          Conservar los anteriores
        </app-button>
        <app-button variant="primary" size="sm" (clicked)="decide('replace')">
          Reemplazar por el {{ nextLabel() }}
        </app-button>
      </div>
    </app-modal>
  `,
})
export class FiscalCalendarChangeDialogComponent {
  readonly isOpen = model(false);
  readonly preview = input<FiscalCalendarChangePreview | null>(null);

  /** `replace`: retira lo pendiente del calendario anterior. `keep`: lo conserva. */
  readonly decision = output<'replace' | 'keep'>();

  readonly currentLabel = computed(() =>
    periodicityLabel(this.preview()?.current_periodicity ?? null),
  );
  readonly nextLabel = computed(() =>
    periodicityLabel(this.preview()?.next_periodicity ?? null),
  );
  readonly pendingRemindersText = computed(() => {
    const value = this.preview()?.pending_reminders ?? 0;
    return `${value} ${value === 1 ? 'recordatorio pendiente' : 'recordatorios pendientes'}`;
  });
  readonly pendingObligationsText = computed(() => {
    const value = this.preview()?.pending_obligations ?? 0;
    return `${value} ${value === 1 ? 'obligación sin empezar' : 'obligaciones sin empezar'}`;
  });

  decide(decision: 'replace' | 'keep'): void {
    this.isOpen.set(false);
    this.decision.emit(decision);
  }
}
