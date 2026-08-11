import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';

import {
  BadgeComponent,
  IconComponent,
} from '../../../../../../../shared/components';
import {
  DIAN_ENABLEMENT_STATUS_LABELS,
  type DianConfigurationType,
} from '../../../../../../../shared/components/dian';
import { TenantDianConsoleStore } from './tenant-dian-console.store';

/**
 * Selector de habilitación para las vistas que operan sobre UNA configuración
 * (Certificado, Numeración, Set de pruebas).
 *
 * ## Por qué los cuatro ejes se ofrecen siempre
 *
 * Un eje sin configuración se pinta igualmente, marcado «sin configurar» y
 * deshabilitado. Ocultarlo produciría la misma ceguera que el agregado del
 * backend existe para corregir: el documento soporte y el documento equivalente
 * desaparecen del selector, nadie los configura porque no se ven, y soporte
 * acaba creyendo que ese tenant «no los usa».
 *
 * ## Por qué la selección vive en el store y no aquí
 *
 * Es la misma para las tres vistas. Con estado local, saltar de Certificado a
 * Numeración devolvería la selección a facturación en silencio y el operador
 * editaría la numeración de un eje que no es el que estaba mirando.
 */
@Component({
  selector: 'app-tenant-dian-axis-picker',
  standalone: true,
  imports: [BadgeComponent, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex flex-col gap-1.5">
      <p class="text-[11px] font-semibold uppercase tracking-wide text-text-secondary">
        Habilitación
      </p>
      <div
        class="flex flex-wrap gap-2"
        role="tablist"
        aria-label="Habilitación DIAN sobre la que se opera"
      >
        @for (option of options(); track option.type) {
          <button
            type="button"
            role="tab"
            [attr.aria-selected]="option.selected"
            [disabled]="option.disabled"
            [class]="option.classes"
            (click)="select(option.type)"
          >
            <app-icon
              [name]="option.configured ? 'shield-check' : 'circle'"
              [size]="14"
            ></app-icon>
            <span class="truncate">{{ option.label }}</span>
            <app-badge
              [variant]="option.configured ? 'info' : 'neutral'"
              badgeStyle="outline"
              size="xsm"
            >
              {{ option.statusLabel }}
            </app-badge>
          </button>
        }
      </div>

      @if (!selectedConfigured()) {
        <p class="flex items-start gap-1.5 text-[11px] text-text-secondary">
          <app-icon name="info" [size]="12" class="mt-0.5 shrink-0"></app-icon>
          <span>
            Esta habilitación todavía no tiene configuración DIAN. Créala desde
            «Habilitaciones»: sin ella no hay certificado que custodiar, ni
            numeración que registrar, ni set que enviar.
          </span>
        </p>
      }
    </div>
  `,
})
export class TenantDianAxisPickerComponent {
  private readonly store = inject(TenantDianConsoleStore);

  protected readonly selectedConfigured = computed(
    () => this.store.selectedAxis()?.config_id !== null,
  );

  protected readonly options = computed(() =>
    this.store.axes().map((axis) => {
      const configured = axis.config_id !== null;
      const selected = axis.configuration_type === this.store.selectedAxisType();
      return {
        type: axis.configuration_type,
        label: axis.label,
        configured,
        selected,
        // Un eje sin configuración se muestra pero no se elige: llevar a
        // Certificado o Numeración un eje sin `config_id` sólo puede terminar en
        // un formulario que no tiene dónde escribir.
        disabled: !configured,
        statusLabel:
          DIAN_ENABLEMENT_STATUS_LABELS[axis.enablement_status] ??
          axis.enablement_status,
        classes: this.classesFor(selected, configured),
      };
    }),
  );

  protected select(type: DianConfigurationType): void {
    this.store.selectAxis(type);
  }

  private classesFor(selected: boolean, configured: boolean): string {
    const base =
      'flex min-w-0 items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors';
    if (!configured) {
      return `${base} cursor-not-allowed border-dashed border-border bg-background text-text-secondary opacity-70`;
    }
    if (selected) {
      return `${base} border-primary bg-primary-50 text-primary-700`;
    }
    return `${base} border-border bg-background text-text-primary hover:border-primary`;
  }
}
