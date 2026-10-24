import { Component, computed, inject, input, output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  PrintFormatDefinition,
  PrintPaperFormat,
  PrintFormatType,
} from '../../../../../../../core/models/print-formats.model';
import { PAPER_GEOMETRY } from '../../../../../../../core/lib/page-geometry';
import { resolvePrintGeometry } from '../../../../../../../core/lib/print-geometry';
import { IconComponent } from '../../../../../../../shared/components/icon/icon.component';
import { ButtonComponent } from '../../../../../../../shared/components/button/button.component';
import { DocumentPrintService } from '../../../../../../../shared/services/print/document-print.service';
import {
  CALIBRATION_MAX_PRINTABLE_MM,
  CalibrationRollFormat,
  buildCalibrationBodyHtml,
} from './paper-calibration';

/** Opciones de "Ancho imprimible" por rollo; la primera es la recomendada. */
const PRINTABLE_OPTIONS: Record<string, readonly { mm: number; label: string }[]> = {
  thermal_80: [
    { mm: 72, label: '72 mm (recomendado)' },
    { mm: 64, label: '64 mm (impresoras de 512 puntos)' },
    { mm: 76, label: '76 mm' },
  ],
  thermal_58: [
    { mm: 48, label: '48 mm (recomendado)' },
    { mm: 52, label: '52 mm' },
  ],
};

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
  imports: [CommonModule, FormsModule, IconComponent, ButtonComponent],
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

        <!-- Ancho imprimible (solo rollo) -->
        @if (printableOptions().length) {
          <div>
            <label
              for="print-format-printable-width"
              class="block text-[11px] font-medium text-text-secondary mb-1"
            >
              Ancho imprimible de la impresora
            </label>
            <select
              id="print-format-printable-width"
              [ngModel]="selectedPrintableMm()"
              (ngModelChange)="setPrintableWidth($event)"
              class="w-full px-3 py-2 bg-surface-secondary border border-border rounded-lg text-xs text-text-primary focus:border-primary-500 focus:outline-none"
            >
              @for (opt of printableOptions(); track opt.mm) {
                <option [ngValue]="opt.mm">{{ opt.label }}</option>
              }
            </select>
            <p class="text-[10px] text-text-tertiary mt-1">
              Es lo que el cabezal imprime de verdad; el papel de {{ geometry().paper_width_mm }} mm
              deja una franja sin imprimir a cada lado.
            </p>
            <div class="mt-2">
              <app-button
                variant="outline"
                size="sm"
                [disabled]="isCalibrating()"
                (clicked)="printCalibration()"
              >
                <app-icon slot="icon" name="printer" [size]="14"></app-icon>
                Imprimir ticket de calibración
              </app-button>
              @if (calibrationError(); as err) {
                <p class="flex items-center gap-1 text-[10px] text-text-secondary mt-1" role="alert">
                  <app-icon name="alert-circle" [size]="12"></app-icon>
                  {{ err }}
                </p>
              }
            </div>
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
                [attr.min]="minMarginMm()"
                max="50"
                [ngModel]="paper().margin_top_mm ?? paper().margin_mm ?? defaultMarginMm()"
                (ngModelChange)="setMargin('top', $event)"
                class="w-full px-2 py-1 bg-surface-secondary border border-border rounded text-xs text-text-primary focus:border-primary-500 focus:outline-none"
              />
            </label>
            @if (isRoll()) {
              <div class="block">
                <span class="text-[10px] text-text-tertiary">Margen lateral efectivo</span>
                <div
                  class="w-full px-2 py-1 bg-surface-secondary border border-border rounded text-xs text-text-secondary"
                  aria-readonly="true"
                >
                  {{ geometry().margins.left }} mm
                </div>
              </div>
            } @else {
              <label class="block">
                <span class="text-[10px] text-text-tertiary">Derecho</span>
                <input
                  type="number"
                  [attr.min]="minMarginMm()"
                  max="50"
                  [ngModel]="paper().margin_right_mm ?? paper().margin_mm ?? defaultMarginMm()"
                  (ngModelChange)="setMargin('right', $event)"
                  class="w-full px-2 py-1 bg-surface-secondary border border-border rounded text-xs text-text-primary focus:border-primary-500 focus:outline-none"
                />
              </label>
            }
            <label class="block">
              <span class="text-[10px] text-text-tertiary">Inferior</span>
              <input
                type="number"
                [attr.min]="minMarginMm()"
                max="50"
                [ngModel]="paper().margin_bottom_mm ?? paper().margin_mm ?? defaultMarginMm()"
                (ngModelChange)="setMargin('bottom', $event)"
                class="w-full px-2 py-1 bg-surface-secondary border border-border rounded text-xs text-text-primary focus:border-primary-500 focus:outline-none"
              />
            </label>
            @if (!isRoll()) {
              <label class="block">
                <span class="text-[10px] text-text-tertiary">Izquierdo</span>
                <input
                  type="number"
                  [attr.min]="minMarginMm()"
                  max="50"
                  [ngModel]="paper().margin_left_mm ?? paper().margin_mm ?? defaultMarginMm()"
                  (ngModelChange)="setMargin('left', $event)"
                  class="w-full px-2 py-1 bg-surface-secondary border border-border rounded text-xs text-text-primary focus:border-primary-500 focus:outline-none"
                />
              </label>
            }
          </div>
          @if (isRoll()) {
            <p class="text-[10px] text-text-tertiary mt-1">
              Mínimo {{ minLateralMm() }} mm a cada lado por el ancho imprimible
              ({{ geometry().printable_width_mm }} mm).
            </p>
          } @else {
            <p class="text-[10px] text-text-tertiary mt-1">Mínimo 5 mm por lado.</p>
          }
        </div>

        <!-- Orientation -->
        @if (!isRoll()) {
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
              step="1"
              id="print-format-copies"
              name="copies"
              aria-label="Copias por impresión"
              [ngModel]="paper().copies"
              (ngModelChange)="setCopies($event)"
              class="w-20 px-2 py-1 bg-surface-secondary border border-border rounded text-xs text-text-primary focus:border-primary-500 focus:outline-none"
            />
            <span class="text-[10px] text-text-tertiary">0–10 (0 = default 1)</span>
          </div>
        </div>

        <!-- Auto-impresión -->
        <div class="pt-2 border-t border-border/50">
          <div class="flex items-center justify-between">
            <div>
              <label class="block text-[11px] font-medium text-text-primary">
                Auto-impresión
              </label>
              <p class="text-[10px] text-text-tertiary">
                {{ autoPrintDescription() }}
              </p>
            </div>
            <input
              id="print-format-auto-print"
              type="checkbox"
              [disabled]="!supportsAutoPrint()"
              [attr.aria-label]="autoPrintDescription()"
              [ngModel]="paper().auto_print !== false"
              (ngModelChange)="setAutoPrint($event)"
              class="w-4 h-4 rounded text-primary-600 bg-surface-secondary border-border focus:ring-primary-500 cursor-pointer"
            />
          </div>
          @if (formatType() === 'dispatch_ticket') {
            <div class="mt-3 space-y-1">
              <div class="flex items-start gap-2">
                <input
                  id="print-format-auto-print-after-pos-sale"
                  type="checkbox"
                  [disabled]="paper().auto_print === false"
                  [ngModel]="paper().auto_print_after_pos_sale === true"
                  (ngModelChange)="setAutoPrintAfterPosSale($event)"
                  aria-describedby="print-format-auto-print-after-pos-sale-description print-format-auto-print-after-pos-sale-note"
                  class="mt-0.5 w-4 h-4 rounded text-primary-600 bg-surface-secondary border-border focus:ring-primary-500 cursor-pointer"
                />
                <label
                  for="print-format-auto-print-after-pos-sale"
                  class="text-[11px] font-medium text-text-primary"
                >
                  Imprimir después de cada venta POS pagada
                </label>
              </div>
              <p
                id="print-format-auto-print-after-pos-sale-description"
                class="pl-6 text-[10px] text-text-tertiary"
              >
                Incluye mostrador, recogida, domicilios y mesas. Requiere pago completo; no imprime abonos ni pagos pendientes.
              </p>
              <p
                id="print-format-auto-print-after-pos-sale-note"
                class="pl-6 text-[10px] text-text-tertiary"
              >
                Desactivarla conserva el flujo habitual de despacho y no cambia la impresión postventa.
              </p>
            </div>
          }
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
  readonly formatType = input<PrintFormatType | null>(null);
  readonly definitionChanged = output<PrintFormatDefinition>();

  private readonly printService = inject(DocumentPrintService);

  /** Geometría efectiva (kernel) del borrador: única fuente de mínimos. */
  readonly geometry = computed(() => resolvePrintGeometry(this.definition().paper));
  readonly isRoll = computed(() => this.geometry().is_roll);
  /** Margen lateral mínimo físico en rollo: (papel − imprimible) / 2. */
  readonly minLateralMm = computed(() => {
    const g = this.geometry();
    return Math.ceil(((g.paper_width_mm - g.printable_width_mm) / 2) * 100 - 1e-9) / 100;
  });
  readonly minMarginMm = computed(() => (this.isRoll() ? 0 : 5));
  readonly defaultMarginMm = computed(() => (this.isRoll() ? 1.5 : 10));

  readonly printableOptions = computed<readonly { mm: number; label: string }[]>(() => {
    const g = this.geometry();
    if (!g.is_roll) return [];
    const base = PRINTABLE_OPTIONS[g.format] ?? [];
    if (!base.length) return [];
    return base.some((o) => o.mm === g.printable_width_mm)
      ? base
      : [...base, { mm: g.printable_width_mm, label: `${g.printable_width_mm} mm (personalizado)` }];
  });
  readonly selectedPrintableMm = computed(() => this.geometry().printable_width_mm);

  readonly isCalibrating = signal(false);
  readonly calibrationError = signal<string | null>(null);

  supportsAutoPrint(): boolean {
    return ['pos_sale_ticket', 'pos_electronic_invoice', 'dispatch_ticket', 'kitchen_ticket']
      .includes(this.formatType() ?? '');
  }

  autoPrintDescription(): string {
    switch (this.formatType()) {
      case 'pos_sale_ticket':
        return 'Se imprime tras una venta POS pagada.';
      case 'pos_electronic_invoice':
        return 'Se imprime tras una venta POS pagada cuando la factura electrónica se emite.';
      case 'dispatch_ticket':
        return 'Se imprime al completar un despacho elegible; imprimir tras ventas POS pagadas es opcional para este formato.';
      case 'kitchen_ticket':
        return 'Se imprime en cocina física después de enviar el pedido.';
      default:
        return 'Solo impresión manual: este formato no tiene un disparador automático.';
    }
  }

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
    // Cambiar de papel nunca escribe márgenes: se borran y rige el default
    // efectivo del kernel (rollo: 1,5 mm + mínimo lateral; hoja: 10 mm).
    // El ancho imprimible guardado pertenece al rollo anterior.
    this.clearMargins(paper);
    delete paper.printable_width_mm;
    if (target.is_roll) {
      delete paper.orientation;
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
    const clamped = Math.max(this.minMarginMm(), Math.min(50, Number(value) || 0));
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

  /** Borra los márgenes del borrador: el kernel aplica el default efectivo. */
  private clearMargins(paper: PrintFormatDefinition['paper']): void {
    delete paper.margin_mm;
    delete paper.margin_top_mm;
    delete paper.margin_right_mm;
    delete paper.margin_bottom_mm;
    delete paper.margin_left_mm;
  }

  resetMargins(): void {
    const paper: PrintFormatDefinition['paper'] = { ...this.paper() };
    this.clearMargins(paper);
    this.emit({ ...this.definition(), paper });
  }

  /** Elige el ancho imprimible; el recomendado se guarda como "sin dato". */
  setPrintableWidth(value: number): void {
    const g = this.geometry();
    if (!g.is_roll) return;
    const mm = Number(value);
    if (!Number.isFinite(mm)) return;
    const recommended = (PRINTABLE_OPTIONS[g.format] ?? [])[0]?.mm;
    const paper: PrintFormatDefinition['paper'] = { ...this.paper() };
    if (mm === recommended) {
      delete paper.printable_width_mm;
    } else {
      paper.printable_width_mm = mm;
    }
    this.emit({ ...this.definition(), paper });
  }

  /**
   * Imprime la regla de calibración (HTML local, sin backend). El override pide
   * el ancho imprimible máximo para que la regla abarque la banda más ancha
   * posible; `DocumentPrintService` lo acota con el kernel.
   */
  async printCalibration(): Promise<void> {
    const g = this.geometry();
    if (!g.is_roll || this.isCalibrating()) return;
    const format: CalibrationRollFormat = g.format === 'thermal_58' ? 'thermal_58' : 'thermal_80';
    this.calibrationError.set(null);
    this.isCalibrating.set(true);
    try {
      await this.printService.print({
        document: 'pos_ticket',
        body: buildCalibrationBodyHtml(format),
        title: 'Ticket de calibración',
        trigger: 'explicit',
        overrides: {
          format,
          printableWidthMm: CALIBRATION_MAX_PRINTABLE_MM[format],
          marginMm: 0,
        },
      });
    } catch {
      this.calibrationError.set('No se pudo abrir la impresión del ticket de calibración.');
    } finally {
      this.isCalibrating.set(false);
    }
  }

  setOrientation(orientation: 'portrait' | 'landscape'): void {
    const paper: PrintFormatDefinition['paper'] = {
      ...this.paper(),
      orientation,
    };
    this.emit({ ...this.definition(), paper });
  }

  setCopies(value: number): void {
    const copies = Math.trunc(Math.max(0, Math.min(10, Number(value) || 0)));
    const paper: PrintFormatDefinition['paper'] = {
      ...this.paper(),
      copies,
    };
    this.emit({ ...this.definition(), paper });
  }

  setAutoPrint(auto_print: boolean): void {
    if (!this.supportsAutoPrint()) return;
    const paper: PrintFormatDefinition['paper'] = {
      ...this.paper(),
      auto_print,
    };
    this.emit({ ...this.definition(), paper });
  }

  setAutoPrintAfterPosSale(auto_print_after_pos_sale: boolean): void {
    if (this.formatType() !== 'dispatch_ticket') return;
    const paper: PrintFormatDefinition['paper'] = {
      ...this.paper(),
      auto_print_after_pos_sale,
    };
    this.emit({ ...this.definition(), paper });
  }
}
