import { Component, inject, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { IconComponent } from '../../../../../../../shared/components/icon/icon.component';
import { PrintFormatsFacade } from '../../services/print-formats.facade';
import {
  PrintPaperFormat,
  PrintPaperConfig,
  PrintStylesDefinition,
  PrintLogoBlock,
} from '../../../../../../../core/models/print-formats.model';
import { PAPER_GEOMETRY } from '../../../../../../../core/lib/page-geometry';

@Component({
  selector: 'app-print-styles-editor',
  standalone: true,
  imports: [CommonModule, FormsModule, IconComponent],
  template: `
    <div class="space-y-6">
      <!-- 1. Paper Format & Geometry -->
      <div class="space-y-3 p-4 rounded-xl border border-border bg-surface">
        <div class="flex items-center justify-between pb-2 border-b border-border">
          <div class="flex items-center gap-2">
            <app-icon name="printer" [size]="16" class="text-primary-500"></app-icon>
            <h3 class="text-sm font-bold text-text-primary">Formato de Papel & Dimensiones</h3>
          </div>
          <span class="text-[10px] font-mono px-2 py-0.5 rounded bg-surface-secondary text-text-secondary">
            {{ paper().width_mm }} mm · {{ paper().is_roll ? 'Continuo' : 'Hoja fija' }}
          </span>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <!-- Format Selector -->
          <div>
            <label class="block text-xs font-medium text-text-secondary mb-1">
              Tamaño de Impresión
            </label>
            <select
              [ngModel]="paper().format"
              (ngModelChange)="updatePaperFormat($event)"
              class="w-full px-3 py-2 bg-surface-secondary border border-border rounded-lg text-xs text-text-primary focus:border-primary-500 focus:outline-none cursor-pointer"
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
            <label class="block text-xs font-medium text-text-secondary mb-1">
              Copias por Impresión
            </label>
            <input
              type="number"
              min="1"
              max="10"
              [ngModel]="paper().copies || 1"
              (ngModelChange)="updateCopies($event)"
              class="w-full px-3 py-2 bg-surface-secondary border border-border rounded-lg text-xs text-text-primary focus:border-primary-500 focus:outline-none"
            />
          </div>
        </div>

        <!-- Margins -->
        <div class="pt-2">
          <label class="block text-xs font-medium text-text-secondary mb-1.5">
            Márgenes de Impresión (mm)
          </label>
          <div class="grid grid-cols-4 gap-2">
            <div>
              <span class="text-[10px] text-text-tertiary block mb-0.5">Superior</span>
              <input
                type="number"
                min="0"
                max="40"
                [ngModel]="paper().marginTopMm ?? paper().margin_mm ?? 2"
                (ngModelChange)="updateMarginSide('marginTopMm', $event)"
                class="w-full px-2 py-1 bg-surface-secondary border border-border rounded text-xs text-center text-text-primary focus:border-primary-500 focus:outline-none"
              />
            </div>
            <div>
              <span class="text-[10px] text-text-tertiary block mb-0.5">Derecho</span>
              <input
                type="number"
                min="0"
                max="40"
                [ngModel]="paper().marginRightMm ?? paper().margin_mm ?? 2"
                (ngModelChange)="updateMarginSide('marginRightMm', $event)"
                class="w-full px-2 py-1 bg-surface-secondary border border-border rounded text-xs text-center text-text-primary focus:border-primary-500 focus:outline-none"
              />
            </div>
            <div>
              <span class="text-[10px] text-text-tertiary block mb-0.5">Inferior</span>
              <input
                type="number"
                min="0"
                max="40"
                [ngModel]="paper().marginBottomMm ?? paper().margin_mm ?? 2"
                (ngModelChange)="updateMarginSide('marginBottomMm', $event)"
                class="w-full px-2 py-1 bg-surface-secondary border border-border rounded text-xs text-center text-text-primary focus:border-primary-500 focus:outline-none"
              />
            </div>
            <div>
              <span class="text-[10px] text-text-tertiary block mb-0.5">Izquierdo</span>
              <input
                type="number"
                min="0"
                max="40"
                [ngModel]="paper().marginLeftMm ?? paper().margin_mm ?? 2"
                (ngModelChange)="updateMarginSide('marginLeftMm', $event)"
                class="w-full px-2 py-1 bg-surface-secondary border border-border rounded text-xs text-center text-text-primary focus:border-primary-500 focus:outline-none"
              />
            </div>
          </div>
        </div>
      </div>

      <!-- 2. Typography & Corporate Colors -->
      <div class="space-y-3 p-4 rounded-xl border border-border bg-surface">
        <div class="flex items-center gap-2 pb-2 border-b border-border">
          <app-icon name="type" [size]="16" class="text-primary-500"></app-icon>
          <h3 class="text-sm font-bold text-text-primary">Tipografía & Estilo Visual</h3>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <!-- Font Family -->
          <div>
            <label class="block text-xs font-medium text-text-secondary mb-1">
              Familia Tipográfica
            </label>
            <select
              [ngModel]="styles().font_family || 'Inter, sans-serif'"
              (ngModelChange)="updateFontFamily($event)"
              class="w-full px-3 py-2 bg-surface-secondary border border-border rounded-lg text-xs text-text-primary focus:border-primary-500 focus:outline-none cursor-pointer"
            >
              <option value="Inter, system-ui, sans-serif">Inter (Sans-Serif Moderna)</option>
              <option value="'Courier New', Courier, monospace">Courier (Térmica Monoespaciada)</option>
              <option value="Roboto, sans-serif">Roboto</option>
              <option value="Georgia, serif">Georgia (Elegante Serif)</option>
            </select>
          </div>

          <!-- Base Font Size -->
          <div>
            <div class="flex items-center justify-between mb-1">
              <label class="block text-xs font-medium text-text-secondary">
                Tamaño Base de Fuente
              </label>
              <span class="text-[10px] font-mono text-primary-500 font-bold">
                {{ styles().font_size_base_pt || (paper().is_roll ? 9 : 10) }} pt
              </span>
            </div>
            <input
              type="range"
              min="7"
              max="14"
              step="0.5"
              [ngModel]="styles().font_size_base_pt || (paper().is_roll ? 9 : 10)"
              (ngModelChange)="updateFontSize($event)"
              class="w-full accent-primary-500 cursor-pointer"
            />
          </div>

          <!-- Header Alignment -->
          <div>
            <label class="block text-xs font-medium text-text-secondary mb-1">
              Alineación de Encabezado
            </label>
            <div class="grid grid-cols-3 gap-1">
              @for (align of ['left', 'center', 'right']; track align) {
                <button
                  type="button"
                  (click)="updateHeaderAlignment(align)"
                  [class.bg-primary-500]="(styles().header_alignment || (paper().is_roll ? 'center' : 'left')) === align"
                  [class.text-white]="(styles().header_alignment || (paper().is_roll ? 'center' : 'left')) === align"
                  [class.bg-surface-secondary]="(styles().header_alignment || (paper().is_roll ? 'center' : 'left')) !== align"
                  [class.text-text-secondary]="(styles().header_alignment || (paper().is_roll ? 'center' : 'left')) !== align"
                  class="py-1.5 text-xs font-medium rounded border border-border hover:bg-surface-hover transition cursor-pointer"
                >
                  {{ align === 'left' ? 'Izquierda' : align === 'center' ? 'Centro' : 'Derecha' }}
                </button>
              }
            </div>
          </div>

          <!-- Primary Accent Color -->
          <div>
            <label class="block text-xs font-medium text-text-secondary mb-1">
              Color de Acento / Títulos
            </label>
            <div class="flex items-center gap-2">
              <input
                type="color"
                [ngModel]="styles().primary_color || '#111827'"
                (ngModelChange)="updatePrimaryColor($event)"
                class="w-8 h-8 rounded border border-border cursor-pointer p-0.5 bg-surface-secondary"
              />
              <input
                type="text"
                [ngModel]="styles().primary_color || '#111827'"
                (ngModelChange)="updatePrimaryColor($event)"
                placeholder="#111827"
                class="flex-1 px-3 py-1.5 bg-surface-secondary border border-border rounded-lg text-xs font-mono text-text-primary focus:border-primary-500 focus:outline-none uppercase"
              />
            </div>
          </div>
        </div>
      </div>

      <!-- 3. Logo Settings -->
      <div class="space-y-3 p-4 rounded-xl border border-border bg-surface">
        <div class="flex items-center justify-between pb-2 border-b border-border">
          <div class="flex items-center gap-2">
            <app-icon name="image" [size]="16" class="text-primary-500"></app-icon>
            <h3 class="text-sm font-bold text-text-primary">Logo del Documento</h3>
          </div>
          <span class="text-[10px] font-mono px-2 py-0.5 rounded bg-primary-500/10 text-primary-500">
            {{ logo().url ? 'URL Personalizada' : 'Logo de Tienda' }}
          </span>
        </div>

        <!-- Store Logo Detection Banner -->
        <div class="p-3 rounded-lg bg-surface-secondary border border-border flex items-start gap-2.5">
          <app-icon name="store" [size]="16" class="text-primary-500 shrink-0 mt-0.5"></app-icon>
          <div class="text-xs space-y-1">
            <span class="font-semibold text-text-primary block">Logo Oficial de la Tienda</span>
            <p class="text-[11px] text-text-secondary leading-relaxed">
              Por defecto, el documento imprime automáticamente el logo configurado en los ajustes de tu tienda. Puedes sobreescribirlo a continuación con una imagen personalizada si lo requieres.
            </p>
          </div>
        </div>

        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
          <!-- Custom URL -->
          <div class="sm:col-span-2">
            <label class="block text-xs font-medium text-text-secondary mb-1">
              URL Personalizada del Logo (Opcional)
            </label>
            <input
              type="text"
              [ngModel]="logo().url ?? ''"
              (ngModelChange)="updateLogoUrl($event)"
              placeholder="Dejar vacío para usar el logo oficial de la tienda"
              class="w-full px-3 py-2 bg-surface-secondary border border-border rounded-lg text-xs text-text-primary focus:border-primary-500 focus:outline-none"
            />
          </div>

          <!-- Position -->
          <div>
            <label class="block text-xs font-medium text-text-secondary mb-1">
              Alineación del Logo
            </label>
            <div class="grid grid-cols-4 gap-1">
              @for (pos of ['left', 'center', 'right', 'full']; track pos) {
                <button
                  type="button"
                  (click)="updateLogoPosition(pos)"
                  [class.bg-primary-500]="(logo().position || 'left') === pos"
                  [class.text-white]="(logo().position || 'left') === pos"
                  [class.bg-surface-secondary]="(logo().position || 'left') !== pos"
                  [class.text-text-secondary]="(logo().position || 'left') !== pos"
                  class="py-1.5 text-xs font-medium rounded border border-border hover:bg-surface-hover transition cursor-pointer"
                >
                  {{ pos === 'left' ? 'Izq' : pos === 'center' ? 'Centro' : pos === 'right' ? 'Der' : 'Ancho' }}
                </button>
              }
            </div>
          </div>

          <!-- Size mm -->
          <div>
            <div class="flex items-center justify-between mb-1">
              <label class="block text-xs font-medium text-text-secondary">
                Tamaño del Logo (mm)
              </label>
              <span class="text-[10px] font-mono text-primary-500 font-bold">
                {{ logo().sizeMm || 20 }} mm
              </span>
            </div>
            <input
              type="range"
              min="5"
              max="80"
              step="1"
              [ngModel]="logo().sizeMm || 20"
              (ngModelChange)="updateLogoSize($event)"
              class="w-full accent-primary-500 cursor-pointer"
            />
          </div>

          <!-- Opacity -->
          <div>
            <div class="flex items-center justify-between mb-1">
              <label class="block text-xs font-medium text-text-secondary">
                Opacidad de Impresión
              </label>
              <span class="text-[10px] font-mono text-text-secondary">
                {{ logo().opacity || 100 }}%
              </span>
            </div>
            <input
              type="range"
              min="10"
              max="100"
              step="5"
              [ngModel]="logo().opacity || 100"
              (ngModelChange)="updateLogoOpacity($event)"
              class="w-full accent-primary-500 cursor-pointer"
            />
          </div>
        </div>
      </div>
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
export class PrintStylesEditorComponent {
  readonly facade = inject(PrintFormatsFacade);

  readonly paper = computed<PrintPaperConfig>(() => {
    const draft = this.facade.draftDefinition();
    return (
      draft?.paper || {
        format: 'thermal_80',
        width_mm: 80,
        is_roll: true,
        copies: 1,
        margin_mm: 2,
        marginLeftMm: 2,
        marginRightMm: 2,
        marginTopMm: 2,
        marginBottomMm: 2,
      }
    );
  });

  readonly styles = computed<PrintStylesDefinition>(() => {
    const draft = this.facade.draftDefinition();
    return draft?.styles || {};
  });

  readonly logo = computed<PrintLogoBlock>(() => {
    const draft = this.facade.draftDefinition();
    return draft?.logo || {};
  });

  updatePaperFormat(format: PrintPaperFormat): void {
    const geom = (PAPER_GEOMETRY as Record<string, { width_mm: number; is_roll: boolean; height_mm?: number | null }>)[format];
    this.facade.updateDraftDefinition((def) => {
      def.paper = {
        ...def.paper,
        format,
        width_mm: geom ? geom.width_mm : 80,
        is_roll: geom ? geom.is_roll : true,
      };
      return def;
    });
  }

  updateCopies(copies: number): void {
    this.facade.updateDraftDefinition((def) => {
      def.paper.copies = Math.max(1, Math.min(10, Number(copies) || 1));
      return def;
    });
  }

  updateMarginSide(side: 'marginTopMm' | 'marginRightMm' | 'marginBottomMm' | 'marginLeftMm', value: number): void {
    const num = Math.max(0, Math.min(50, Number(value) || 0));
    this.facade.updateDraftDefinition((def) => {
      def.paper = { ...def.paper, [side]: num };
      return def;
    });
  }

  updateFontFamily(font_family: string): void {
    this.facade.updateDraftDefinition((def) => {
      def.styles = { ...def.styles, font_family };
      return def;
    });
  }

  updateFontSize(val: number): void {
    this.facade.updateDraftDefinition((def) => {
      def.styles = { ...def.styles, font_size_base_pt: Number(val) };
      return def;
    });
  }

  updateHeaderAlignment(header_alignment: string): void {
    this.facade.updateDraftDefinition((def) => {
      def.styles = {
        ...def.styles,
        header_alignment: header_alignment as 'left' | 'center' | 'right',
      };
      return def;
    });
  }

  updatePrimaryColor(primary_color: string): void {
    this.facade.updateDraftDefinition((def) => {
      def.styles = { ...def.styles, primary_color };
      return def;
    });
  }

  updateLogoUrl(url: string): void {
    this.facade.updateDraftDefinition((def) => {
      def.logo = { ...def.logo, url: url.trim() || undefined };
      return def;
    });
  }

  updateLogoPosition(position: string): void {
    this.facade.updateDraftDefinition((def) => {
      def.logo = { ...def.logo, position: position as any };
      return def;
    });
  }

  updateLogoSize(sizeMm: number): void {
    this.facade.updateDraftDefinition((def) => {
      def.logo = { ...def.logo, sizeMm: Math.max(5, Math.min(80, Number(sizeMm) || 20)) };
      return def;
    });
  }

  updateLogoOpacity(opacity: number): void {
    this.facade.updateDraftDefinition((def) => {
      def.logo = { ...def.logo, opacity: Math.max(10, Math.min(100, Number(opacity) || 100)) };
      return def;
    });
  }
}
