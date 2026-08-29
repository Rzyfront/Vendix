import { Component, computed, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  PrintFormatDefinition,
  PrintStylesDefinition,
} from '../../../../../../../core/models/print-formats.model';
import { IconComponent } from '../../../../../../../shared/components/icon/icon.component';

/**
 * [print-editor-dsk P5.7] — Styles panel.
 *
 * Edits `definition.styles` — font family (preset + free text), font size
 * 6..24 pt, primary color (hex), header alignment, show_borders and
 * compact_mode toggles.
 */
const FONT_FAMILIES: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'system-ui, sans-serif', label: 'Sistema' },
  { value: 'Inter, sans-serif', label: 'Inter' },
  { value: 'Helvetica, Arial, sans-serif', label: 'Helvetica' },
  { value: 'Georgia, serif', label: 'Georgia' },
  { value: '"Courier New", monospace', label: 'Courier' },
];

@Component({
  selector: 'app-print-styles-panel',
  standalone: true,
  imports: [CommonModule, FormsModule, IconComponent],
  template: `
    <section class="vendix-subpanel">
      <h4 class="text-xs font-bold uppercase tracking-wider text-text-secondary mb-2">
        Estilos
      </h4>

      <div class="space-y-3">
        <!-- Font family -->
        <div>
          <label class="block text-[11px] font-medium text-text-secondary mb-1">
            Familia tipográfica
          </label>
          <select
            [ngModel]="fontFamilyPreset()"
            (ngModelChange)="setFontFamilyPreset($event)"
            class="w-full px-2 py-1 bg-surface-secondary border border-border rounded text-xs text-text-primary focus:border-primary-500 focus:outline-none mb-1"
          >
            @for (f of fontFamilies; track f.value) {
              <option [value]="f.value">{{ f.label }}</option>
            }
            <option value="__custom__">Personalizado…</option>
          </select>
          @if (isCustomFont()) {
            <input
              type="text"
              [ngModel]="styles().font_family ?? ''"
              (ngModelChange)="updateFontFamily($event)"
              placeholder="CSS font-family"
              class="w-full px-2 py-1 bg-surface-secondary border border-border rounded text-xs font-mono text-text-primary focus:border-primary-500 focus:outline-none"
            />
          }
        </div>

        <!-- Font size -->
        <div>
          <div class="flex items-center justify-between mb-1">
            <label class="block text-[11px] font-medium text-text-secondary">
              Tamaño base (pt)
            </label>
            <span class="text-[10px] font-mono text-text-tertiary">
              {{ styles().font_size_base_pt ?? 9 }} pt
            </span>
          </div>
          <div class="flex items-center gap-2">
            <input
              type="range"
              min="6"
              max="24"
              step="1"
              [ngModel]="styles().font_size_base_pt ?? 9"
              (ngModelChange)="updateFontSize($event)"
              class="flex-1"
            />
            <input
              type="number"
              min="6"
              max="24"
              [ngModel]="styles().font_size_base_pt ?? 9"
              (ngModelChange)="updateFontSize($event)"
              class="w-14 px-1.5 py-1 bg-surface-secondary border border-border rounded text-xs text-right text-text-primary focus:border-primary-500 focus:outline-none"
            />
          </div>
        </div>

        <!-- Primary color -->
        <div>
          <label class="block text-[11px] font-medium text-text-secondary mb-1">
            Color principal
          </label>
          <div class="flex items-center gap-2">
            <input
              type="color"
              [ngModel]="styles().primary_color ?? '#111827'"
              (ngModelChange)="updatePrimaryColor($event)"
              class="w-8 h-8 rounded border border-border bg-surface-secondary cursor-pointer p-0.5"
            />
            <input
              type="text"
              [ngModel]="styles().primary_color ?? '#111827'"
              (ngModelChange)="updatePrimaryColor($event)"
              class="flex-1 px-2 py-1 bg-surface-secondary border border-border rounded text-xs font-mono text-text-primary focus:border-primary-500 focus:outline-none uppercase"
            />
          </div>
        </div>

        <!-- Header alignment -->
        <div>
          <label class="block text-[11px] font-medium text-text-secondary mb-1">
            Alineación del encabezado
          </label>
          <div class="flex items-center bg-surface-secondary rounded-lg border border-border p-0.5">
            <button
              type="button"
              (click)="updateAlignment('left')"
              [class.bg-primary-600]="styles().header_alignment === 'left'"
              [class.text-white]="styles().header_alignment === 'left'"
              [class.text-text-secondary]="styles().header_alignment !== 'left'"
              class="flex-1 py-1 rounded text-xs transition flex items-center justify-center gap-1"
              title="Izquierda"
            >
              <app-icon name="align-left" [size]="12"></app-icon>
            </button>
            <button
              type="button"
              (click)="updateAlignment('center')"
              [class.bg-primary-600]="styles().header_alignment === 'center' || !styles().header_alignment"
              [class.text-white]="styles().header_alignment === 'center' || !styles().header_alignment"
              [class.text-text-secondary]="styles().header_alignment === 'left' || styles().header_alignment === 'right'"
              class="flex-1 py-1 rounded text-xs transition flex items-center justify-center gap-1"
              title="Centro"
            >
              <app-icon name="align-center" [size]="12"></app-icon>
            </button>
            <button
              type="button"
              (click)="updateAlignment('right')"
              [class.bg-primary-600]="styles().header_alignment === 'right'"
              [class.text-white]="styles().header_alignment === 'right'"
              [class.text-text-secondary]="styles().header_alignment !== 'right'"
              class="flex-1 py-1 rounded text-xs transition flex items-center justify-center gap-1"
              title="Derecha"
            >
              <app-icon name="align-right" [size]="12"></app-icon>
            </button>
          </div>
        </div>

        <!-- Toggles -->
        <div class="space-y-2">
          <label class="flex items-center justify-between gap-2 p-2 rounded-lg bg-surface-secondary border border-border">
            <span class="text-xs text-text-primary">Mostrar bordes</span>
            <input
              type="checkbox"
              [checked]="styles().show_borders ?? false"
              (change)="toggleBorders($event)"
              class="rounded border-border text-primary-600 focus:ring-primary-500 w-4 h-4"
            />
          </label>
          <label class="flex items-center justify-between gap-2 p-2 rounded-lg bg-surface-secondary border border-border">
            <span class="text-xs text-text-primary">Modo compacto</span>
            <input
              type="checkbox"
              [checked]="styles().compact_mode ?? false"
              (change)="toggleCompact($event)"
              class="rounded border-border text-primary-600 focus:ring-primary-500 w-4 h-4"
            />
          </label>
        </div>
      </div>
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
export class PrintStylesPanelComponent {
  readonly definition = input.required<PrintFormatDefinition>();
  readonly definitionChanged = output<PrintFormatDefinition>();

  readonly fontFamilies = FONT_FAMILIES;

  readonly styles = computed<PrintStylesDefinition>(() => {
    return this.definition().styles ?? {};
  });

  readonly fontFamilyPreset = computed<string>(() => {
    const ff = this.styles().font_family ?? '';
    const hit = FONT_FAMILIES.find((f) => f.value === ff);
    return hit ? hit.value : '__custom__';
  });

  readonly isCustomFont = computed<boolean>(() => {
    return this.fontFamilyPreset() === '__custom__';
  });

  emit(next: PrintFormatDefinition): void {
    this.definitionChanged.emit(next);
  }

  private withStyles(patch: Partial<PrintStylesDefinition>): void {
    const next: PrintStylesDefinition = { ...this.styles(), ...patch };
    this.emit({ ...this.definition(), styles: next });
  }

  setFontFamilyPreset(value: string): void {
    if (value === '__custom__') {
      // Keep the current custom value; if none, seed with system-ui.
      const cur = this.styles().font_family;
      this.withStyles({ font_family: cur && !FONT_FAMILIES.find((f) => f.value === cur) ? cur : 'system-ui, sans-serif' });
      return;
    }
    this.withStyles({ font_family: value });
  }

  updateFontFamily(value: string): void {
    this.withStyles({ font_family: value });
  }

  updateFontSize(value: number): void {
    const pt = Math.max(6, Math.min(24, Math.round(Number(value) || 9)));
    this.withStyles({ font_size_base_pt: pt });
  }

  updatePrimaryColor(color: string): void {
    this.withStyles({ primary_color: color });
  }

  updateAlignment(alignment: 'left' | 'center' | 'right'): void {
    this.withStyles({ header_alignment: alignment });
  }

  toggleBorders(event: Event): void {
    const show_borders = (event.target as HTMLInputElement).checked;
    this.withStyles({ show_borders });
  }

  toggleCompact(event: Event): void {
    const compact_mode = (event.target as HTMLInputElement).checked;
    this.withStyles({ compact_mode });
  }
}