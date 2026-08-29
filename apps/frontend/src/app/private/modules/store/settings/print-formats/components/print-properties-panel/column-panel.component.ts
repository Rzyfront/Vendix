import { Component, computed, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  PrintColumnDefinition,
  PrintFormatDefinition,
} from '../../../../../../../core/models/print-formats.model';
import { IconComponent } from '../../../../../../../shared/components/icon/icon.component';

/**
 * [print-editor-dsk P5.4] — Column panel.
 *
 * Edits one selected column: key (token picker from available_tokens,
 * with a typed-text fallback), label, width % slider with sibling
 * redistribution (sum of enabled widths stays at 100), alignment buttons
 * and an enabled toggle.
 */
@Component({
  selector: 'app-print-column-panel',
  standalone: true,
  imports: [CommonModule, FormsModule, IconComponent],
  template: `
    <section class="vendix-subpanel">
      @if (column(); as c) {
        <h4 class="text-xs font-bold uppercase tracking-wider text-text-secondary mb-2">
          Columna
        </h4>

        <div class="space-y-3">
          <!-- Token key -->
          <div>
            <label class="block text-[11px] font-medium text-text-secondary mb-1">
              Token (clave)
            </label>
            <input
              type="text"
              list="available-tokens"
              [ngModel]="c.key"
              (ngModelChange)="updateKey($event)"
              placeholder="ej. items.*.name"
              class="w-full px-2 py-1 bg-surface-secondary border border-border rounded text-xs font-mono text-text-primary focus:border-primary-500 focus:outline-none"
            />
            <datalist id="available-tokens">
              @for (t of tokenSuggestions(); track t.path) {
                <option [value]="t.path">{{ t.token }}</option>
              }
            </datalist>
            <p class="text-[10px] text-text-tertiary mt-1">
              {{ availableTokens().length }} tokens disponibles
            </p>
          </div>

          <!-- Label -->
          <div>
            <label class="block text-[11px] font-medium text-text-secondary mb-1">
              Etiqueta visible
            </label>
            <input
              type="text"
              [ngModel]="c.label"
              (ngModelChange)="updateLabel($event)"
              class="w-full px-2 py-1 bg-surface-secondary border border-border rounded text-xs text-text-primary focus:border-primary-500 focus:outline-none"
            />
          </div>

          <!-- Width slider -->
          <div>
            <div class="flex items-center justify-between mb-1">
              <label class="block text-[11px] font-medium text-text-secondary">
                Ancho (%)
              </label>
              <span class="text-[10px] font-mono text-text-tertiary">
                Σ habilitado: {{ totalEnabledWidth() }}%
              </span>
            </div>
            <div class="flex items-center gap-2">
              <input
                type="range"
                min="5"
                max="100"
                step="1"
                [ngModel]="c.width_percent"
                (ngModelChange)="updateWidth($event)"
                class="flex-1"
              />
              <input
                type="number"
                min="5"
                max="100"
                [ngModel]="c.width_percent"
                (ngModelChange)="updateWidth($event)"
                class="w-14 px-1.5 py-1 bg-surface-secondary border border-border rounded text-xs text-right text-text-primary focus:border-primary-500 focus:outline-none"
              />
              <span class="text-xs text-text-secondary">%</span>
            </div>
          </div>

          <!-- Alignment -->
          <div>
            <label class="block text-[11px] font-medium text-text-secondary mb-1">
              Alineación
            </label>
            <div class="flex items-center bg-surface-secondary rounded-lg border border-border p-0.5">
              <button
                type="button"
                (click)="updateAlign('left')"
                [class.bg-primary-600]="c.align === 'left'"
                [class.text-white]="c.align === 'left'"
                [class.text-text-secondary]="c.align !== 'left'"
                class="flex-1 py-1 rounded text-xs transition flex items-center justify-center gap-1"
                title="Izquierda"
              >
                <app-icon name="align-left" [size]="12"></app-icon>
              </button>
              <button
                type="button"
                (click)="updateAlign('center')"
                [class.bg-primary-600]="c.align === 'center'"
                [class.text-white]="c.align === 'center'"
                [class.text-text-secondary]="c.align !== 'center'"
                class="flex-1 py-1 rounded text-xs transition flex items-center justify-center gap-1"
                title="Centro"
              >
                <app-icon name="align-center" [size]="12"></app-icon>
              </button>
              <button
                type="button"
                (click)="updateAlign('right')"
                [class.bg-primary-600]="c.align === 'right'"
                [class.text-white]="c.align === 'right'"
                [class.text-text-secondary]="c.align !== 'right'"
                class="flex-1 py-1 rounded text-xs transition flex items-center justify-center gap-1"
                title="Derecha"
              >
                <app-icon name="align-right" [size]="12"></app-icon>
              </button>
            </div>
          </div>

          <!-- Format -->
          <div>
            <label class="block text-[11px] font-medium text-text-secondary mb-1">
              Formato
            </label>
            <select
              [ngModel]="c.format ?? 'text'"
              (ngModelChange)="updateFormat($event)"
              class="w-full px-2 py-1 bg-surface-secondary border border-border rounded text-xs text-text-primary focus:border-primary-500 focus:outline-none"
            >
              <option value="text">Texto</option>
              <option value="number">Número</option>
              <option value="currency">Moneda</option>
              <option value="date">Fecha</option>
              <option value="percent">Porcentaje</option>
            </select>
          </div>

          <!-- Enabled -->
          <label class="flex items-center justify-between gap-2 p-2 rounded-lg bg-surface-secondary border border-border">
            <span class="text-xs text-text-primary">Columna visible</span>
            <input
              type="checkbox"
              [checked]="c.enabled"
              (change)="toggleEnabled($event)"
              class="rounded border-border text-primary-600 focus:ring-primary-500 w-4 h-4"
            />
          </label>

          <!-- Actions -->
          <div class="pt-2 border-t border-border flex items-center justify-end">
            <button
              type="button"
              (click)="remove()"
              class="flex items-center gap-1.5 px-2 py-1 text-xs text-red-500 bg-surface-secondary hover:bg-red-500/10 border border-border rounded transition"
              title="Eliminar"
            >
              <app-icon name="trash-2" [size]="12"></app-icon>
              Eliminar
            </button>
          </div>
        </div>
      } @else {
        <p class="text-xs text-text-tertiary">Columna no encontrada.</p>
      }
    </section>
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .vendix-subpanel {
        padding: 0.625rem;
        border: 1px solid var(--color-border, #e5e7eb);
        border-radius: 0.5rem;
        background: var(--color-surface, #ffffff);
      }
    `,
  ],
})
export class PrintColumnPanelComponent {
  readonly definition = input.required<PrintFormatDefinition>();
  readonly columnId = input.required<string>();
  readonly definitionChanged = output<PrintFormatDefinition>();

  readonly column = computed<PrintColumnDefinition | undefined>(() => {
    return (this.definition().columns ?? []).find((c) => c.id === this.columnId());
  });

  readonly availableTokens = computed(() => {
    return (this.definition() as any)?.available_tokens ?? [];
  });

  readonly tokenSuggestions = computed(() => {
    return this.availableTokens() as Array<{ token: string; path: string }>;
  });

  readonly totalEnabledWidth = computed<number>(() => {
    return (this.definition().columns ?? [])
      .filter((c) => c.enabled)
      .reduce((sum, col) => sum + (col.width_percent ?? 0), 0);
  });

  emit(next: PrintFormatDefinition): void {
    this.definitionChanged.emit(next);
  }

  updateKey(key: string): void {
    const id = this.columnId();
    this.emit({
      ...this.definition(),
      columns: (this.definition().columns ?? []).map((c) =>
        c.id === id ? { ...c, key } : c,
      ),
    });
  }

  updateLabel(label: string): void {
    const id = this.columnId();
    this.emit({
      ...this.definition(),
      columns: (this.definition().columns ?? []).map((c) =>
        c.id === id ? { ...c, label } : c,
      ),
    });
  }

  /**
   * Width edit: clamp to [5..100], then redistribute the remainder
   * across the other enabled columns so the total stays at 100.
   */
  updateWidth(value: number): void {
    const id = this.columnId();
    const next = Math.max(5, Math.min(100, Math.round(Number(value) || 5)));
    const cols = (this.definition().columns ?? []).map((c) => ({ ...c }));
    const target = cols.find((c) => c.id === id);
    if (!target) return;

    const oldTarget = target.width_percent ?? 0;
    target.width_percent = next;
    target.enabled = true;

    const others = cols.filter((c) => c.id !== id && c.enabled);
    const remainder = Math.max(0, 100 - next);
    const otherSum = others.reduce((s, c) => s + (c.width_percent ?? 0), 0);
    if (otherSum === 0) {
      // Distribute remainder evenly across others.
      const each = others.length > 0 ? Math.floor(remainder / others.length) : 0;
      let drift = remainder - each * others.length;
      others.forEach((c) => {
        c.width_percent = each + (drift > 0 ? 1 : 0);
        if (drift > 0) drift -= 1;
      });
    } else {
      others.forEach((c) => {
        const share = (c.width_percent ?? 0) / otherSum;
        c.width_percent = Math.max(5, Math.round(share * remainder));
      });
      // round-off drift: clamp last column.
      const sumAfter = cols
        .filter((c) => c.enabled)
        .reduce((s, c) => s + (c.width_percent ?? 0), 0);
      if (sumAfter !== 100 && others.length > 0) {
        const last = others[others.length - 1];
        last.width_percent = Math.max(
          5,
          (last.width_percent ?? 0) + (100 - sumAfter),
        );
      }
    }
    void oldTarget; // (kept for future audit)
    this.emit({ ...this.definition(), columns: cols });
  }

  updateAlign(align: 'left' | 'center' | 'right'): void {
    const id = this.columnId();
    this.emit({
      ...this.definition(),
      columns: (this.definition().columns ?? []).map((c) =>
        c.id === id ? { ...c, align } : c,
      ),
    });
  }

  updateFormat(format: 'text' | 'number' | 'currency' | 'date' | 'percent'): void {
    const id = this.columnId();
    this.emit({
      ...this.definition(),
      columns: (this.definition().columns ?? []).map((c) =>
        c.id === id ? { ...c, format } : c,
      ),
    });
  }

  toggleEnabled(event: Event): void {
    const enabled = (event.target as HTMLInputElement).checked;
    const id = this.columnId();
    this.emit({
      ...this.definition(),
      columns: (this.definition().columns ?? []).map((c) =>
        c.id === id ? { ...c, enabled } : c,
      ),
    });
  }

  remove(): void {
    const id = this.columnId();
    const remaining = (this.definition().columns ?? []).filter(
      (c) => c.id !== id,
    );
    this.emit({ ...this.definition(), columns: remaining });
  }
}