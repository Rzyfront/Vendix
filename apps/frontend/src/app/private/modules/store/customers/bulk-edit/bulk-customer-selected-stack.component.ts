/**
 * Stack de clientes seleccionados (columna derecha del módulo).
 *
 * Componente de presentación: no conoce el backend ni la selección completa,
 * solo recibe las fichas ya resueltas y emite quitar/limpiar. La página es la
 * dueña del `Set` de ids.
 *
 * Se separa del panel de resultados por la misma razón que en el masivo de
 * productos: la selección sobrevive a cambiar de página, así que necesita un
 * sitio propio donde el operador vea SIEMPRE qué va a editar, incluso cuando
 * esas filas ya no están en la tabla.
 */

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
} from '../../../../../shared/components/index';

export interface BulkCustomerSelectedEntry {
  id: number;
  name: string;
  document: string | null;
  /** `false` mientras no se conoce la ficha (id huérfano del filtro). */
  hydrated: boolean;
}

@Component({
  selector: 'app-bulk-customer-selected-stack',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ButtonComponent, IconComponent],
  template: `
    <div class="rounded-xl border border-border bg-surface">
      <header
        class="flex items-center justify-between gap-2 border-b border-border px-3 py-2.5"
      >
        <div class="min-w-0">
          <h3 class="text-xs font-bold uppercase tracking-wide text-text-primary">
            Seleccionados
          </h3>
          <p class="text-[10px] text-text-secondary" role="status">
            {{ entries().length }}
            {{ entries().length === 1 ? 'cliente' : 'clientes' }} en la edición
          </p>
        </div>

        @if (entries().length > 0) {
          <app-button variant="ghost" size="xsm" (clicked)="clearRequested.emit()">
            <app-icon slot="icon" name="x" [size]="13" />
            Limpiar
          </app-button>
        }
      </header>

      @if (entries().length === 0) {
        <p class="px-3 py-6 text-center text-[11px] leading-tight text-text-secondary">
          Todavía no hay clientes seleccionados. Búscalos a la izquierda y marca
          los que quieras editar en lote.
        </p>
      } @else {
        <ul class="max-h-64 overflow-y-auto divide-y divide-border lg:max-h-[28rem]">
          @for (entry of entries(); track entry.id) {
            <li class="flex items-center gap-2 px-3 py-1.5">
              <span
                class="min-w-0 flex-1 truncate text-[11px] text-text-primary"
                [class.italic]="!entry.hydrated"
                [class.text-text-secondary]="!entry.hydrated"
              >
                {{ entry.name }}
                @if (entry.document) {
                  <span class="text-text-secondary">· {{ entry.document }}</span>
                }
              </span>

              <button
                type="button"
                class="shrink-0 rounded p-1 text-text-secondary transition-colors hover:bg-gray-100 hover:text-error"
                [attr.aria-label]="'Quitar a ' + entry.name + ' de la selección'"
                (click)="removeRequested.emit(entry.id)"
              >
                <app-icon name="x" [size]="12" />
              </button>
            </li>
          }
        </ul>

        @if (hasPending()) {
          <p class="border-t border-border px-3 py-1.5 text-[10px] text-text-secondary">
            Los nombres en cursiva todavía se están cargando; los ids ya están
            seleccionados y se editarán igual.
          </p>
        }
      }
    </div>
  `,
})
export class BulkCustomerSelectedStackComponent {
  readonly entries = input<readonly BulkCustomerSelectedEntry[]>([]);
  readonly removeRequested = output<number>();
  readonly clearRequested = output<void>();

  readonly hasPending = computed<boolean>(() =>
    this.entries().some((entry) => !entry.hydrated),
  );
}
