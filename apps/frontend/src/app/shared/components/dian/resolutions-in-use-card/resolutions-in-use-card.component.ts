import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';

import { ButtonComponent } from '../../button/button.component';
import { IconComponent } from '../../icon/icon.component';
import { formatDateOnlyUTC } from '../../../utils/date.util';
import { requirementsFor, type FiscalDocumentType } from '../fiscal-document-requirements';
import type { ResolutionInUse, ResolutionsInUseResponse } from '../resolutions-in-use.util';

const CARD_DOCUMENT_TYPES: readonly FiscalDocumentType[] = [
  'sales_invoice',
  'credit_note',
  'debit_note',
];

const isNote = (type: FiscalDocumentType): boolean =>
  type === 'credit_note' || type === 'debit_note';

interface InUseRow {
  readonly document_type: FiscalDocumentType;
  readonly label: string;
  readonly item: ResolutionInUse | null;
  readonly headline: string;
  readonly detail: string;
  readonly note: string;
  readonly warn: boolean;
  /** Nota sin serie real: ofrece «Crear serie» si el host lo habilita. */
  readonly creatable: boolean;
}

/**
 * Tarjeta «Numeración vigente»: la serie que el generador de consecutivos toma
 * hoy para factura, nota crédito y nota débito. Compartida por los cuatro
 * carriles (tienda, organización, plataforma, consola de tenants).
 */
@Component({
  selector: 'app-resolutions-in-use-card',
  standalone: true,
  imports: [ButtonComponent, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section
      class="rounded-xl border border-border bg-surface px-3 py-3 md:px-4"
      aria-label="Numeración vigente"
    >
      <h3 class="mb-2 flex items-center gap-2 text-sm font-semibold text-text-primary">
        <app-icon name="hash" [size]="16"></app-icon>
        Numeración vigente
      </h3>

      @if (loading() && !data()) {
        <p class="text-xs text-text-secondary">Cargando numeración...</p>
      } @else if (data()) {
        <ul class="divide-y divide-border">
          @for (row of rows(); track row.document_type) {
            <li class="flex flex-col gap-0.5 py-2 md:flex-row md:items-center md:gap-4">
              <span class="w-36 shrink-0 text-xs font-medium text-text-secondary">
                {{ row.label }}
              </span>
              <div class="min-w-0 flex-1">
                <p
                  class="text-sm font-semibold"
                  [class.text-warning]="row.warn"
                  [class.text-text-primary]="!row.warn"
                >
                  @if (row.warn) {
                    <app-icon name="alert-triangle" [size]="14" class="mr-1 inline-block"></app-icon>
                  }
                  {{ row.headline }}
                </p>
                @if (row.detail) {
                  <p class="text-[11px] text-text-secondary">{{ row.detail }}</p>
                }
                @if (row.note) {
                  <p class="text-[11px] text-text-secondary">{{ row.note }}</p>
                }
              </div>
              @if (canCreateSeries() && row.creatable) {
                <app-button
                  class="mt-1 self-start md:mt-0"
                  type="button"
                  size="sm"
                  variant="outline"
                  (clicked)="createSeries.emit(row.document_type)"
                >
                  <app-icon slot="icon" name="plus" [size]="14"></app-icon>
                  Crear serie
                </app-button>
              }
            </li>
          }
        </ul>
      }
    </section>
  `,
})
export class ResolutionsInUseCardComponent {
  readonly data = input<ResolutionsInUseResponse | null>(null);
  readonly loading = input<boolean>(false);
  /** Muestra «Crear serie» en las notas sin serie real. Falso por defecto. */
  readonly canCreateSeries = input<boolean>(false);
  readonly createSeries = output<FiscalDocumentType>();

  readonly rows = computed<InUseRow[]>(() => {
    const items = this.data()?.items ?? [];
    return CARD_DOCUMENT_TYPES.map((type) => {
      const item = items.find((i) => i.document_type === type) ?? null;
      const label = requirementsFor(type).label;

      if (!item || item.source === 'none') {
        return {
          document_type: type,
          label,
          item,
          headline: 'Sin resolución vigente',
          detail: '',
          note: '',
          warn: true,
          creatable: isNote(type),
        };
      }

      if (item.source === 'internal_series_projected') {
        return {
          document_type: type,
          label,
          item,
          headline: `${item.prefix ?? ''} · Siguiente: ${item.next_number ?? ''}`.trim(),
          detail: 'Serie interna — se crea sola en la primera nota',
          note: '',
          warn: false,
          creatable: isNote(type),
        };
      }

      const details: string[] = [];
      // Serie interna dormida: el generador la reactiva en la próxima nota.
      const dormant = item.is_internal_series && item.active_count === 0;
      if (item.resolution_number) details.push(`Resolución ${item.resolution_number}`);
      if (item.valid_to) details.push(`vigente hasta ${formatDateOnlyUTC(item.valid_to)}`);

      return {
        document_type: type,
        label,
        item,
        headline: `${item.prefix ?? ''} · Siguiente: ${item.next_number ?? ''}`.trim(),
        detail: dormant
          ? 'Serie interna inactiva — se reactivará en la próxima nota'
          : details.join(' · '),
        note:
          type === 'sales_invoice' && item.active_count > 1
            ? `Hay ${item.active_count} resoluciones activas; el sistema usa esta`
            : '',
        warn: false,
        creatable: false,
      };
    });
  });
}
