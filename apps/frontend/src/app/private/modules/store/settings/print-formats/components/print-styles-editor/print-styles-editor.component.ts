import { Component, inject, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IconComponent } from '../../../../../../../shared/components/icon/icon.component';
import { PrintFormatsFacade } from '../../services/print-formats.facade';
import { PrintPaperFormat } from '../../../../../../../core/models/print-formats.model';

@Component({
  selector: 'app-print-styles-editor',
  standalone: true,
  imports: [CommonModule, FormsModule, IconComponent],
  template: `
    <div class="space-y-6">
      <!-- Paper Settings -->
      <div class="space-y-3">
        <h3 class="text-sm font-semibold text-text-primary">Configuración de Papel</h3>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <!-- Format Selector -->
          <div>
            <label class="block text-xs font-medium text-text-secondary mb-1">Formato de Papel</label>
            <select
              [ngModel]="paper().format"
              (ngModelChange)="updatePaperFormat($event)"
              class="w-full px-3 py-2 bg-surface-secondary border border-border rounded-lg text-xs text-text-primary focus:border-primary-500 focus:outline-none"
            >
              <option value="thermal_80">Rollo Térmico 80mm (POS Estándar)</option>
              <option value="thermal_58">Rollo Térmico 58mm (POS Compacto)</option>
              <option value="letter">Carta (8.5" x 11")</option>
              <option value="half_letter">Media Carta (5.5" x 8.5")</option>
              <option value="a4">A4 (210mm x 297mm)</option>
            </select>
          </div>

          <!-- Copies Count -->
          <div>
            <label class="block text-xs font-medium text-text-secondary mb-1">Copias Predeterminadas</label>
            <input
              type="number"
              min="1"
              max="10"
              [ngModel]="paper().copies"
              (ngModelChange)="updateCopies($event)"
              class="w-full px-3 py-2 bg-surface-secondary border border-border rounded-lg text-xs text-text-primary focus:border-primary-500 focus:outline-none"
            />
          </div>

          <!-- Margin (only for non-roll) -->
          @if (!paper().is_roll) {
            <div>
              <label class="block text-xs font-medium text-text-secondary mb-1">Margen de Hoja (mm)</label>
              <input
                type="number"
                min="0"
                max="50"
                [ngModel]="paper().margin_mm"
                (ngModelChange)="updateMargin($event)"
                class="w-full px-3 py-2 bg-surface-secondary border border-border rounded-lg text-xs text-text-primary focus:border-primary-500 focus:outline-none"
              />
            </div>
          }
        </div>
      </div>

      <!-- Typography and Styles -->
      <div class="space-y-3 pt-4 border-t border-border">
        <h3 class="text-sm font-semibold text-text-primary">Estilo Visual y Tipografía</h3>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <!-- Font Size Base -->
          <div>
            <label class="block text-xs font-medium text-text-secondary mb-1">Tamaño Base de Fuente (pt)</label>
            <input
              type="number"
              min="7"
              max="16"
              [ngModel]="styles().font_size_base_pt || (paper().is_roll ? 9 : 10)"
              (ngModelChange)="updateFontSize($event)"
              class="w-full px-3 py-2 bg-surface-secondary border border-border rounded-lg text-xs text-text-primary focus:border-primary-500 focus:outline-none"
            />
          </div>

          <!-- Header Alignment -->
          <div>
            <label class="block text-xs font-medium text-text-secondary mb-1">Alineación del Encabezado</label>
            <select
              [ngModel]="styles().header_alignment || 'center'"
              (ngModelChange)="updateHeaderAlignment($event)"
              class="w-full px-3 py-2 bg-surface-secondary border border-border rounded-lg text-xs text-text-primary focus:border-primary-500 focus:outline-none"
            >
              <option value="left">Izquierda</option>
              <option value="center">Centrado</option>
              <option value="right">Derecha</option>
            </select>
          </div>

          <!-- Primary Color -->
          <div>
            <label class="block text-xs font-medium text-text-secondary mb-1">Color Principal (Títulos y Totales)</label>
            <div class="flex items-center gap-2">
              <input
                type="color"
                [ngModel]="styles().primary_color || '#111827'"
                (ngModelChange)="updatePrimaryColor($event)"
                class="w-8 h-8 rounded border border-border bg-surface-secondary cursor-pointer p-0.5"
              />
              <input
                type="text"
                [ngModel]="styles().primary_color || '#111827'"
                (ngModelChange)="updatePrimaryColor($event)"
                class="flex-1 px-3 py-2 bg-surface-secondary border border-border rounded-lg text-xs font-mono text-text-primary focus:border-primary-500 focus:outline-none uppercase"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  `,
})
export class PrintStylesEditorComponent {
  readonly facade = inject(PrintFormatsFacade);

  readonly paper = computed(() => {
    const draft = this.facade.draftDefinition();
    return draft?.paper || { format: 'thermal_80', width_mm: 80, is_roll: true, margin_mm: 0, copies: 1 };
  });

  readonly styles = computed(() => {
    const draft = this.facade.draftDefinition();
    return draft?.styles || {};
  });

  updatePaperFormat(format: PrintPaperFormat): void {
    const widthMap: Record<PrintPaperFormat, { width: number; is_roll: boolean }> = {
      thermal_80: { width: 80, is_roll: true },
      thermal_58: { width: 58, is_roll: true },
      letter: { width: 216, is_roll: false },
      half_letter: { width: 140, is_roll: false },
      a4: { width: 210, is_roll: false },
    };

    const target = widthMap[format] || { width: 80, is_roll: true };

    this.facade.updateDraftDefinition((def) => {
      def.paper.format = format;
      def.paper.width_mm = target.width;
      def.paper.is_roll = target.is_roll;
      if (target.is_roll) def.paper.margin_mm = 0;
      return def;
    });
  }

  updateCopies(copies: number): void {
    this.facade.updateDraftDefinition((def) => {
      def.paper.copies = Math.max(1, Number(copies) || 1);
      return def;
    });
  }

  updateMargin(marginMm: number): void {
    this.facade.updateDraftDefinition((def) => {
      def.paper.margin_mm = Math.max(0, Number(marginMm) || 0);
      return def;
    });
  }

  updateFontSize(pt: number): void {
    this.facade.updateDraftDefinition((def) => {
      def.styles = def.styles || {};
      def.styles.font_size_base_pt = Math.max(6, Math.min(20, Number(pt) || 9));
      return def;
    });
  }

  updateHeaderAlignment(align: 'left' | 'center' | 'right'): void {
    this.facade.updateDraftDefinition((def) => {
      def.styles = def.styles || {};
      def.styles.header_alignment = align;
      return def;
    });
  }

  updatePrimaryColor(color: string): void {
    this.facade.updateDraftDefinition((def) => {
      def.styles = def.styles || {};
      def.styles.primary_color = color;
      return def;
    });
  }
}
