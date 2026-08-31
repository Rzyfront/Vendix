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
          <h3 class="text-sm font-bold text-text-primary">Columnas de la Tabla de Productos</h3>
          <p class="text-xs text-text-secondary">
            Ajusta los anchos porcentuales, alineaciones y nombres de encabezado de cada columna.
          </p>
        </div>
        <div
          class="text-xs font-mono px-2 py-0.5 rounded-full font-bold"
          [class.bg-emerald-500/10]="totalWidth() === 100"
          [class.text-emerald-500]="totalWidth() === 100"
          [class.bg-amber-500/10]="totalWidth() !== 100"
          [class.text-amber-500]="totalWidth() !== 100"
        >
          Ancho Total: {{ totalWidth() }}%
        </div>
      </div>

      <div class="space-y-2.5">
        @for (col of columns(); track col.id || col.key || idx; let idx = $index) {
          <div
            class="p-3 rounded-xl border flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 transition"
            [class.bg-surface]="col.enabled"
            [class.border-border]="col.enabled"
            [class.bg-surface-secondary]="!col.enabled"
            [class.opacity-50]="!col.enabled"
          >
            <!-- Checkbox & Label input -->
            <div class="flex items-center gap-2.5 min-w-0">
              <input
                type="checkbox"
                [checked]="col.enabled"
                (change)="toggleColumn(col.id, $event)"
                class="rounded border-border text-primary-600 focus:ring-primary-500 w-4 h-4 cursor-pointer"
              />
              <div class="min-w-0">
                <input
                  type="text"
                  [ngModel]="col.label"
                  (ngModelChange)="updateLabel(col.id, $event)"
                  [disabled]="!col.enabled"
                  placeholder="Título columna"
                  class="px-2 py-1 bg-surface-secondary border border-border rounded text-xs text-text-primary focus:border-primary-500 focus:outline-none w-36 font-semibold"
                />
                <span class="text-[10px] text-text-tertiary font-mono block mt-0.5">{{ col.key }}</span>
              </div>
            </div>

            <!-- Controls (Width & Alignment) -->
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
                  class="w-14 px-1.5 py-1 bg-surface-secondary border border-border rounded text-xs text-right font-mono text-text-primary focus:border-primary-500 focus:outline-none"
                />
                <span class="text-xs text-text-secondary">%</span>
              </div>

              <!-- Alignment selector -->
              <div class="flex items-center bg-surface-secondary rounded-lg border border-border p-0.5">
                <button
                  type="button"
                  (click)="updateAlign(col.id, 'left')"
                  [class.bg-primary-500]="col.align === 'left'"
                  [class.text-white]="col.align === 'left'"
                  [class.text-text-secondary]="col.align !== 'left'"
                  class="p-1 rounded text-xs transition cursor-pointer"
                  title="Alinear a la izquierda"
                >
                  <app-icon name="align-left" [size]="12"></app-icon>
                </button>
                <button
                  type="button"
                  (click)="updateAlign(col.id, 'center')"
                  [class.bg-primary-500]="col.align === 'center'"
                  [class.text-white]="col.align === 'center'"
                  [class.text-text-secondary]="col.align !== 'center'"
                  class="p-1 rounded text-xs transition cursor-pointer"
                  title="Centrar"
                >
                  <app-icon name="align-center" [size]="12"></app-icon>
                </button>
                <button
                  type="button"
                  (click)="updateAlign(col.id, 'right')"
                  [class.bg-primary-500]="col.align === 'right'"
                  [class.text-white]="col.align === 'right'"
                  [class.text-text-secondary]="col.align !== 'right'"
                  class="p-1 rounded text-xs transition cursor-pointer"
                  title="Alinear a la derecha"
                >
                  <app-icon name="align-right" [size]="12"></app-icon>
                </button>
              </div>
            </div>
          </div>
        }
      </div>
      <!-- Item Detail Level Configuration (Step D.2) -->
      <div class="p-3.5 rounded-xl border border-border bg-surface-secondary/50 space-y-2.5">
        <div class="flex items-center gap-2 pb-1.5 border-b border-border">
          <app-icon name="list-tree" [size]="14" class="text-primary-500"></app-icon>
          <h4 class="text-xs font-bold text-text-primary uppercase tracking-wider">
            Nivel de Detalle de Ítems (Líneas)
          </h4>
        </div>
        <p class="text-[11px] text-text-secondary leading-relaxed">
          Selecciona qué detalles adicionales se imprimen debajo del nombre de cada producto.
        </p>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
          <label class="flex items-center gap-2 p-2 rounded-lg border border-border bg-surface hover:bg-surface-hover cursor-pointer transition">
            <input
              type="checkbox"
              [checked]="itemSection()?.show_sku !== false"
              (change)="toggleItemDetail('show_sku', $event)"
              class="rounded border-border text-primary-600 focus:ring-primary-500 w-4 h-4 cursor-pointer"
            />
            <span class="text-text-primary font-medium">Mostrar SKU</span>
          </label>

          <label class="flex items-center gap-2 p-2 rounded-lg border border-border bg-surface hover:bg-surface-hover cursor-pointer transition">
            <input
              type="checkbox"
              [checked]="itemSection()?.show_variant_attributes !== false"
              (change)="toggleItemDetail('show_variant_attributes', $event)"
              class="rounded border-border text-primary-600 focus:ring-primary-500 w-4 h-4 cursor-pointer"
            />
            <span class="text-text-primary font-medium">Mostrar Variantes</span>
          </label>

          <label class="flex items-center gap-2 p-2 rounded-lg border border-border bg-surface hover:bg-surface-hover cursor-pointer transition">
            <input
              type="checkbox"
              [checked]="itemSection()?.show_notes !== false"
              (change)="toggleItemDetail('show_notes', $event)"
              class="rounded border-border text-primary-600 focus:ring-primary-500 w-4 h-4 cursor-pointer"
            />
            <span class="text-text-primary font-medium">Mostrar Notas</span>
          </label>

          <label class="flex items-center gap-2 p-2 rounded-lg border border-border bg-surface hover:bg-surface-hover cursor-pointer transition">
            <input
              type="checkbox"
              [checked]="itemSection()?.show_item_discounts !== false"
              (change)="toggleItemDetail('show_item_discounts', $event)"
              class="rounded border-border text-primary-600 focus:ring-primary-500 w-4 h-4 cursor-pointer"
            />
            <span class="text-text-primary font-medium">Mostrar Descuento</span>
          </label>

          <label class="flex items-center gap-2 p-2 rounded-lg border border-border bg-surface hover:bg-surface-hover cursor-pointer transition">
            <input
              type="checkbox"
              [checked]="itemSection()?.show_item_taxes !== false"
              (change)="toggleItemDetail('show_item_taxes', $event)"
              class="rounded border-border text-primary-600 focus:ring-primary-500 w-4 h-4 cursor-pointer"
            />
            <span class="text-text-primary font-medium">Mostrar IVA / Impuesto</span>
          </label>
        </div>
      </div>

      <!-- Auto-balance columns button -->
      @if (totalWidth() !== 100) {
        <button
          type="button"
          (click)="autoBalanceColumns()"
          class="w-full py-2 px-3 rounded-lg border border-primary-500/30 bg-primary-500/10 text-primary-500 hover:bg-primary-500/20 text-xs font-semibold flex items-center justify-center gap-1.5 transition cursor-pointer"
        >
          <app-icon name="scale" [size]="13"></app-icon>
          <span>Balancear anchos automáticamente al 100%</span>
        </button>
      }
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }
    `,
  ],
})
export class PrintColumnsEditorComponent {
  readonly facade = inject(PrintFormatsFacade);

  readonly columns = computed<PrintColumnDefinition[]>(() => {
    const draft = this.facade.draftDefinition();
    return draft?.columns || [];
  });

  readonly itemSection = computed(() => {
    const draft = this.facade.draftDefinition();
    return draft?.sections?.find((s) => s.type === 'items_table' || s.type === 'kitchen_items') || null;
  });

  readonly totalWidth = computed<number>(() => {
    return this.columns()
      .filter((c) => c.enabled)
      .reduce((sum, c) => sum + (c.width_percent || 0), 0);
  });

  toggleColumn(columnId: string, event: Event): void {
    const enabled = (event.target as HTMLInputElement).checked;
    this.facade.updateDraftDefinition((def) => {
      const col = def.columns?.find((c) => c.id === columnId);
      if (col) col.enabled = enabled;
      return def;
    });
  }

  updateLabel(columnId: string, label: string): void {
    this.facade.updateDraftDefinition((def) => {
      const col = def.columns?.find((c) => c.id === columnId);
      if (col) col.label = label;
      return def;
    });
  }

  updateWidth(columnId: string, width_percent: number): void {
    this.facade.updateDraftDefinition((def) => {
      const col = def.columns?.find((c) => c.id === columnId);
      if (col) col.width_percent = Math.max(5, Math.min(100, Number(width_percent) || 10));
      return def;
    });
  }

  updateAlign(columnId: string, align: 'left' | 'center' | 'right'): void {
    this.facade.updateDraftDefinition((def) => {
      const col = def.columns?.find((c) => c.id === columnId);
      if (col) col.align = align;
      return def;
    });
  }

  toggleItemDetail(key: 'show_sku' | 'show_variant_attributes' | 'show_notes' | 'show_item_discounts' | 'show_item_taxes', event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    this.facade.updateDraftDefinition((def) => {
      const sec = def.sections?.find((s) => s.type === 'items_table' || s.type === 'kitchen_items');
      if (sec) {
        (sec as any)[key] = checked;
      }
      return def;
    });
  }

  autoBalanceColumns(): void {
    this.facade.updateDraftDefinition((def) => {
      if (!def.columns || def.columns.length === 0) return def;
      const active = def.columns.filter((c) => c.enabled);
      if (active.length === 0) return def;
      const baseWidth = Math.floor(100 / active.length);
      const remainder = 100 - baseWidth * active.length;
      active.forEach((c, idx) => {
        c.width_percent = baseWidth + (idx === 0 ? remainder : 0);
      });
      return def;
    });
  }
}
