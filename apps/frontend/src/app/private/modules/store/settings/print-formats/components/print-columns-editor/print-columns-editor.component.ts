import { Component, inject, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IconComponent } from '../../../../../../../shared/components/icon/icon.component';
import { PrintFormatsFacade } from '../../services/print-formats.facade';
import { PrintColumnDefinition } from '../../../../../../../core/models/print-formats.model';

@Component({
  selector: 'app-print-columns-editor',
  standalone: true,
  imports: [CommonModule, FormsModule, IconComponent],
  template: `
    <div class="space-y-4">
      <div class="flex items-center justify-between pb-2 border-b border-border">
        <div>
          <h3 class="text-sm font-semibold text-text-primary">Columnas de la Tabla de Ítems</h3>
          <p class="text-xs text-text-secondary">Ajusta los anchos, alineaciones y títulos de cada columna para aprovechar el espacio.</p>
        </div>
        <div class="text-xs font-mono" [class.text-emerald-500]="totalWidth() === 100" [class.text-amber-500]="totalWidth() !== 100">
          Ancho Total: {{ totalWidth() }}%
        </div>
      </div>

      <div class="space-y-2.5">
        @for (col of columns(); track col.id; let idx = $index) {
          <div class="p-3 rounded-xl border flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3"
               [class.bg-surface]="col.enabled"
               [class.border-border]="col.enabled"
               [class.bg-surface-secondary]="!col.enabled"
               [class.opacity-50]="!col.enabled"
          >
            <div class="flex items-center gap-2">
              <input
                type="checkbox"
                [checked]="col.enabled"
                (change)="toggleColumn(col.id, $event)"
                class="rounded border-border text-primary-600 focus:ring-primary-500 w-4 h-4"
              />
              <div>
                <input
                  type="text"
                  [ngModel]="col.label"
                  (ngModelChange)="updateLabel(col.id, $event)"
                  [disabled]="!col.enabled"
                  class="px-2 py-1 bg-surface-secondary border border-border rounded text-xs text-text-primary focus:border-primary-500 focus:outline-none w-32 font-medium"
                />
                <span class="text-[10px] text-text-secondary font-mono block mt-0.5">{{ col.key }}</span>
              </div>
            </div>

            <div class="flex items-center gap-3 w-full sm:w-auto justify-end">
              <!-- Width slider / input -->
              <div class="flex items-center gap-1.5">
                <span class="text-[11px] text-text-secondary">Ancho:</span>
                <input
                  type="number"
                  min="5"
                  max="100"
                  [ngModel]="col.width_percent"
                  (ngModelChange)="updateWidth(col.id, $event)"
                  [disabled]="!col.enabled"
                  class="w-14 px-1.5 py-1 bg-surface-secondary border border-border rounded text-xs text-right text-text-primary focus:border-primary-500 focus:outline-none"
                />
                <span class="text-xs text-text-secondary">%</span>
              </div>

              <!-- Alignment selector -->
              <div class="flex items-center bg-surface-secondary rounded-lg border border-border p-0.5">
                <button
                  type="button"
                  (click)="updateAlign(col.id, 'left')"
                  [class.bg-primary-600]="col.align === 'left'"
                  [class.text-white]="col.align === 'left'"
                  [class.text-text-secondary]="col.align !== 'left'"
                  class="p-1 rounded text-xs transition"
                  title="Alinear a la izquierda"
                >
                  <app-icon name="align-left" [size]="12"></app-icon>
                </button>
                <button
                  type="button"
                  (click)="updateAlign(col.id, 'center')"
                  [class.bg-primary-600]="col.align === 'center'"
                  [class.text-white]="col.align === 'center'"
                  [class.text-text-secondary]="col.align !== 'center'"
                  class="p-1 rounded text-xs transition"
                  title="Centrar"
                >
                  <app-icon name="align-center" [size]="12"></app-icon>
                </button>
                <button
                  type="button"
                  (click)="updateAlign(col.id, 'right')"
                  [class.bg-primary-600]="col.align === 'right'"
                  [class.text-white]="col.align === 'right'"
                  [class.text-text-secondary]="col.align !== 'right'"
                  class="p-1 rounded text-xs transition"
                  title="Alinear a la derecha"
                >
                  <app-icon name="align-right" [size]="12"></app-icon>
                </button>
              </div>
            </div>
          </div>
        }
      </div>
    </div>
  `,
})
export class PrintColumnsEditorComponent {
  readonly facade = inject(PrintFormatsFacade);

  readonly columns = computed<PrintColumnDefinition[]>(() => {
    const draft = this.facade.draftDefinition();
    return draft?.columns || [];
  });

  readonly totalWidth = computed<number>(() => {
    return this.columns()
      .filter((c) => c.enabled)
      .reduce((sum, c) => sum + (Number(c.width_percent) || 0), 0);
  });

  toggleColumn(columnId: string, event: Event): void {
    const enabled = (event.target as HTMLInputElement).checked;
    this.facade.updateDraftDefinition((def) => {
      const c = def.columns?.find((item) => item.id === columnId);
      if (c) c.enabled = enabled;
      return def;
    });
  }

  updateLabel(columnId: string, newLabel: string): void {
    this.facade.updateDraftDefinition((def) => {
      const c = def.columns?.find((item) => item.id === columnId);
      if (c) c.label = newLabel;
      return def;
    });
  }

  updateWidth(columnId: string, newWidth: number): void {
    this.facade.updateDraftDefinition((def) => {
      const c = def.columns?.find((item) => item.id === columnId);
      if (c) c.width_percent = Math.max(5, Math.min(100, Number(newWidth) || 10));
      return def;
    });
  }

  updateAlign(columnId: string, align: 'left' | 'center' | 'right'): void {
    this.facade.updateDraftDefinition((def) => {
      const c = def.columns?.find((item) => item.id === columnId);
      if (c) c.align = align;
      return def;
    });
  }
}
