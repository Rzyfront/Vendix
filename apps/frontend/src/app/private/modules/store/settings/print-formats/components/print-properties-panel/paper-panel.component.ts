import { Component, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  PrintFormatDefinition,
  PrintPaperFormat,
} from '../../../../../../../core/models/print-formats.model';
import { PAPER_GEOMETRY } from '../../../../../../../core/lib/page-geometry';
import { IconComponent } from '../../../../../../../shared/components/icon/icon.component';

/** Cast helper — PAPER_GEOMETRY is keyed by a closed set, but the
 *  editor dropdown also exposes `custom`. Unknown keys fall through to
 *  the defaults below. */
function lookupGeometry(format: PrintPaperFormat) {
  return (PAPER_GEOMETRY as Record<string, { width_mm: number; is_roll: boolean; height_mm?: number | null }>)[format];
}

/**
 * [print-editor-dsk P5.2] — Paper panel.
 *
 * Global paper configuration: format, margins per side, orientation and
 * copies. Reads `definition.paper` and emits a fully rebuilt
 * `PrintFormatDefinition` on every change so the parent can route it
 * through history.
 */
@Component({
  selector: 'app-print-paper-panel',
  standalone: true,
  imports: [CommonModule, FormsModule, IconComponent],
  template: `
    <section class="vendix-subpanel">
      <h4 class="text-xs font-bold uppercase tracking-wider text-text-secondary mb-2">
        Papel y Formato
      </h4>

      <div class="space-y-3">
        <!-- Format -->
        <div>
          <label class="block text-[11px] font-medium text-text-secondary mb-1">
            Formato de Papel
          </label>
          <select
            [ngModel]="paper().format"
            (ngModelChange)="setFormat($event)"
            class="w-full px-3 py-2 bg-surface-secondary border border-border rounded-lg text-xs text-text-primary focus:border-primary-500 focus:outline-none"
          >
            <option value="thermal_80">Rollo Térmico 80mm (POS Estándar)</option>
            <option value="thermal_58">Rollo Térmico 58mm (POS Compacto)</option>
            <option value="letter">Carta (8.5" x 11")</option>
            <option value="half_letter">Media Carta (5.5" x 8.5")</option>
            <option value="a4">A4 (210mm x 297mm)</option>
            <option value="custom">Personalizado (mm)</option>
          </select>
          <p class="text-[10px] text-text-tertiary mt-1">
            {{ geometryHint() }}
          </p>
        </div>

        <!-- Custom dimensions -->
        @if (paper().format === 'custom') {
          <div class="grid grid-cols-2 gap-2">
            <label class="block">
              <span class="text-[10px] text-text-tertiary">Ancho (mm)</span>
              <input
                type="number"
                min="58"
                max="600"
                [ngModel]="paper().width_mm"
                (ngModelChange)="setCustomWidth($event)"
                class="w-full px-2 py-1 bg-surface-secondary border border-border rounded text-xs text-text-primary focus:border-primary-500 focus:outline-none"
              />
            </label>
            <label class="block">
              <span class="text-[10px] text-text-tertiary">Alto (mm)</span>
              <input
                type="number"
                min="50"
                max="2000"
                [ngModel]="paper().height_mm ?? 150"
                (ngModelChange)="setCustomHeight($event)"
                class="w-full px-2 py-1 bg-surface-secondary border border-border rounded text-xs text-text-primary focus:border-primary-500 focus:outline-none"
              />
            </label>
          </div>
        }

        <!-- Margins -->
        <div>
          <div class="flex items-center justify-between mb-1">
            <label class="block text-[11px] font-medium text-text-secondary">
              Márgenes (mm)
            </label>
            <button
              type="button"
              (click)="resetMargins()"
              class="text-[10px] text-primary-500 hover:text-primary-400 underline transition"
            >
              restablecer
            </button>
          </div>
          <div class="grid grid-cols-2 gap-2">
            <label class="block">
              <span class="text-[10px] text-text-tertiary">Superior</span>
              <input
                type="number"
                min="0"
                max="50"
                [ngModel]="paper().margin_top_mm ?? paper().margin_mm ?? 0"
                (ngModelChange)="setMargin('top', $event)"
                class="w-full px-2 py-1 bg-surface-secondary border border-border rounded text-xs text-text-primary focus:border-primary-500 focus:outline-none"
              />
            </label>
            <label class="block">
              <span class="text-[10px] text-text-tertiary">Derecho</span>
              <input
                type="number"
                min="0"
                max="50"
                [ngModel]="paper().margin_right_mm ?? paper().margin_mm ?? 0"
                (ngModelChange)="setMargin('right', $event)"
                class="w-full px-2 py-1 bg-surface-secondary border border-border rounded text-xs text-text-primary focus:border-primary-500 focus:outline-none"
              />
            </label>
            <label class="block">
              <span class="text-[10px] text-text-tertiary">Inferior</span>
              <input
                type="number"
                min="0"
                max="50"
                [ngModel]="paper().margin_bottom_mm ?? paper().margin_mm ?? 0"
                (ngModelChange)="setMargin('bottom', $event)"
                class="w-full px-2 py-1 bg-surface-secondary border border-border rounded text-xs text-text-primary focus:border-primary-500 focus:outline-none"
              />
            </label>
            <label class="block">
              <span class="text-[10px] text-text-tertiary">Izquierdo</span>
              <input
                type="number"
                min="0"
                max="50"
                [ngModel]="paper().margin_left_mm ?? paper().margin_mm ?? 0"
                (ngModelChange)="setMargin('left', $event)"
                class="w-full px-2 py-1 bg-surface-secondary border border-border rounded text-xs text-text-primary focus:border-primary-500 focus:outline-none"
              />
            </label>
          </div>
        </div>

        <!-- Orientation -->
        @if (!paper().is_roll) {
          <div>
            <label class="block text-[11px] font-medium text-text-secondary mb-1">
              Orientación
            </label>
            <div class="flex items-center bg-surface-secondary rounded-lg border border-border p-0.5">
              <button
                type="button"
                (click)="setOrientation('portrait')"
                [class.bg-primary-600]="paper().orientation !== 'landscape'"
                [class.text-white]="paper().orientation !== 'landscape'"
                [class.text-text-secondary]="paper().orientation === 'landscape'"
                class="flex-1 py-1 rounded text-xs transition"
              >
                Vertical
              </button>
              <button
                type="button"
                (click)="setOrientation('landscape')"
                [class.bg-primary-600]="paper().orientation === 'landscape'"
                [class.text-white]="paper().orientation === 'landscape'"
                [class.text-text-secondary]="paper().orientation !== 'landscape'"
                class="flex-1 py-1 rounded text-xs transition"
              >
                Horizontal
              </button>
            </div>
          </div>
        }

        <!-- Copies -->
        <div>
          <label class="block text-[11px] font-medium text-text-secondary mb-1">
            Copias por impresión
          </label>
          <div class="flex items-center gap-2">
            <input
              type="number"
              min="0"
              max="10"
              [ngModel]="paper().copies"
              (ngModelChange)="setCopies($event)"
              class="w-20 px-2 py-1 bg-surface-secondary border border-border rounded text-xs text-text-primary focus:border-primary-500 focus:outline-none"
            />
            <span class="text-[10px] text-text-tertiary">0–10</span>
          </div>
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
export class PrintPaperPanelComponent {
  readonly definition = input.required<PrintFormatDefinition>();
  readonly definitionChanged = output<PrintFormatDefinition>();

  paper(): PrintFormatDefinition['paper'] {
    return this.definition().paper;
  }

  geometryHint(): string {
    const p = this.paper();
    if (p.format === 'custom') {
      return 'Dimensiones personalizadas: ancho y alto definidos manualmente (58–600 × 50–2000 mm).';
    }
    const geo = lookupGeometry(p.format);
    if (!geo) return '';
    if (geo.is_roll) {
      return `Rollo continuo de ${geo.width_mm} mm de ancho.`;
    }
    return `${geo.width_mm} × ${geo.height_mm ?? '?'} mm (alto físico).`;
  }

  emit(next: PrintFormatDefinition): void {
    this.definitionChanged.emit(next);
  }

  setFormat(format: PrintPaperFormat): void {
    const geo = lookupGeometry(format);
    const isCustom = format === 'custom';
    const target = geo
      ? { width_mm: geo.width_mm, is_roll: geo.is_roll }
      : isCustom
        ? { width_mm: Math.max(58, this.paper().width_mm || 100), is_roll: false }
        : { width_mm: 80, is_roll: true };

    const paper: PrintFormatDefinition['paper'] = {
      ...this.paper(),
      format,
      width_mm: target.width_mm,
      is_roll: target.is_roll,
    };
    if (isCustom) {
      paper.height_mm = Math.max(50, this.paper().height_mm || 150);
    }
    if (target.is_roll) {
      paper.margin_mm = 0;
      paper.margin_top_mm = 0;
      paper.margin_right_mm = 0;
      paper.margin_bottom_mm = 0;
      paper.margin_left_mm = 0;
    }
    this.emit({ ...this.definition(), paper });
  }

  setCustomWidth(value: number): void {
    const width_mm = Math.max(58, Math.min(600, Number(value) || 58));
    this.emit({ ...this.definition(), paper: { ...this.paper(), width_mm } });
  }

  setCustomHeight(value: number): void {
    const height_mm = Math.max(50, Math.min(2000, Number(value) || 50));
    this.emit({ ...this.definition(), paper: { ...this.paper(), height_mm } });
  }

  /**
   * Writes ONLY the side it receives. `margin_mm` (the uniform margin) is
   * reserved for `resetMargins()` and `setFormat()` — overwriting it here
   * used to mean editing the top margin silently reset the other three,
   * because the backend composer falls back to `margin_mm` uniformly
   * whenever the per-side value it looks for is absent.
   */
  setMargin(side: 'top' | 'right' | 'bottom' | 'left', value: number): void {
    const clamped = Math.max(0, Math.min(50, Number(value) || 0));
    const field = `margin_${side}_mm` as
      | 'margin_top_mm'
      | 'margin_right_mm'
      | 'margin_bottom_mm'
      | 'margin_left_mm';
    const paper: PrintFormatDefinition['paper'] = {
      ...this.paper(),
      [field]: clamped,
    };
    this.emit({ ...this.definition(), paper });
  }

  resetMargins(): void {
    const paper: PrintFormatDefinition['paper'] = {
      ...this.paper(),
      margin_mm: 0,
      margin_top_mm: 0,
      margin_right_mm: 0,
      margin_bottom_mm: 0,
      margin_left_mm: 0,
    };
    this.emit({ ...this.definition(), paper });
  }

  setOrientation(orientation: 'portrait' | 'landscape'): void {
    const paper: PrintFormatDefinition['paper'] = {
      ...this.paper(),
      orientation,
    };
    this.emit({ ...this.definition(), paper });
  }

  setCopies(value: number): void {
    const copies = Math.max(0, Math.min(10, Number(value) || 0));
    const paper: PrintFormatDefinition['paper'] = {
      ...this.paper(),
      copies,
    };
    this.emit({ ...this.definition(), paper });
  }
}