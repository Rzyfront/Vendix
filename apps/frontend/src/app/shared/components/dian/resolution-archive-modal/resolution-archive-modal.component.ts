import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';

import { ModalComponent } from '../../modal/modal.component';
import { ButtonComponent } from '../../button/button.component';
import { isNoteSeriesType } from '../resolutions-in-use.util';

/** Forma mínima de una resolución archivable (los tres carriles la cumplen). */
export interface ArchivableResolution {
  id: number;
  prefix?: string | null;
  resolution_number?: string | null;
  document_type?: string | null;
  is_active: boolean;
  archived_at?: string | null;
}

/** Prefijo de serie: mayúsculas A-Z0-9, máximo 10. */
export function normalizeReplacementPrefix(raw: string): string {
  return (raw ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10);
}

/** Fecha de archivado (timestamp) en hora local, es-CO. */
export function formatArchivedAt(value: string | null | undefined): string {
  if (!value) return '-';
  const date = new Date(value);
  return isNaN(date.getTime()) ? '-' : date.toLocaleDateString('es-CO');
}

/**
 * Modal de confirmación para ARCHIVAR una resolución (las resoluciones DIAN no
 * se borran). Compartido por tienda, organización y plataforma.
 *
 * Se monta con `@if (pending(); as row)`: nace abierto y se destruye al cerrar,
 * así el campo de prefijo siempre arranca vacío. El padre hace la llamada y
 * devuelve `busy`/`errorMessage`; si el backend responde 015 (serie de notas en
 * uso sin reemplazo) el padre pone `requirePrefix` y el campo pasa a ser
 * obligatorio.
 */
@Component({
  selector: 'vendix-resolution-archive-modal',
  standalone: true,
  imports: [ModalComponent, ButtonComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-modal
      [isOpen]="true"
      title="Archivar resolución"
      size="md"
      (cancel)="cancelled.emit()"
    >
      <div class="space-y-3 p-4 text-sm text-text-secondary">
        <p class="text-text-primary font-medium">
          {{ identity() }}
        </p>
        <p>
          La resolución dejará de usarse y quedará como solo lectura. Su prefijo
          no se podrá volver a usar. Las facturas y notas ya emitidas no cambian.
        </p>

        @if (showPrefixField()) {
          <div class="space-y-1">
            <label for="archive-replacement-prefix" class="block text-xs font-medium text-text-primary">
              Prefijo de la serie nueva
              @if (requirePrefix()) {
                <span class="text-error">*</span>
              }
            </label>
            <input
              id="archive-replacement-prefix"
              type="text"
              maxlength="10"
              autocomplete="off"
              class="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm uppercase text-text-primary focus:outline-none focus:ring-2 focus:ring-primary"
              placeholder="Ej: NC2"
              [value]="replacementPrefix()"
              (input)="onPrefixInput($event)"
            />
            <p class="text-xs text-text-secondary">
              {{
                requirePrefix()
                  ? 'Esta es la serie de notas en uso: indica el prefijo de la serie nueva que la reemplazará.'
                  : 'Obligatorio si es la serie de notas en uso.'
              }}
            </p>
          </div>
        }

        @if (errorMessage(); as msg) {
          <p class="rounded-lg bg-error-light px-3 py-2 text-xs text-error" role="alert">
            {{ msg }}
          </p>
        }
      </div>

      <div slot="footer" class="flex items-center justify-end gap-3 border-t border-border bg-surface p-3">
        <app-button variant="outline" [disabled]="busy()" (clicked)="cancelled.emit()">
          Cancelar
        </app-button>
        <app-button
          variant="danger"
          [loading]="busy()"
          [disabled]="busy() || (requirePrefix() && !replacementPrefix())"
          (clicked)="onConfirm()"
        >
          Archivar
        </app-button>
      </div>
    </app-modal>
  `,
})
export class ResolutionArchiveModalComponent {
  readonly resolution = input.required<ArchivableResolution>();
  readonly busy = input(false);
  /** El backend exigió prefijo de reemplazo (INVOICING_RESOLUTION_015). */
  readonly requirePrefix = input(false);
  readonly errorMessage = input<string | null>(null);

  /** Emite el prefijo de reemplazo (undefined si el campo quedó vacío). */
  readonly confirmed = output<string | undefined>();
  readonly cancelled = output<void>();

  readonly replacementPrefix = signal('');

  readonly identity = computed(() => {
    const r = this.resolution();
    return [r.prefix, r.resolution_number].filter(Boolean).join(' · ');
  });

  readonly showPrefixField = computed(() => {
    const r = this.resolution();
    return this.requirePrefix() || (r.is_active && isNoteSeriesType(r.document_type));
  });

  onPrefixInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    const value = normalizeReplacementPrefix(input.value);
    input.value = value;
    this.replacementPrefix.set(value);
  }

  onConfirm(): void {
    if (this.requirePrefix() && !this.replacementPrefix()) return;
    this.confirmed.emit(this.replacementPrefix() || undefined);
  }
}
