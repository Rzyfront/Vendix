import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  model,
  output,
  signal,
  untracked,
} from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { Observable, catchError, concat, debounceTime, distinctUntilChanged, map, of, switchMap } from 'rxjs';

import { ModalComponent } from '../../../../../../shared/components/modal/modal.component';
import { ButtonComponent } from '../../../../../../shared/components/button/button.component';
import { InputComponent } from '../../../../../../shared/components/input/input.component';
import {
  SelectorComponent,
  SelectorOption,
} from '../../../../../../shared/components/selector/selector.component';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { CurrencyPipe } from '../../../../../../shared/pipes/currency/currency.pipe';
import { VariableBarcodeFormat } from '../../../../../../core/models/store-settings.interface';
import {
  Product,
  PosProductService,
  ScaleCodeLookupResult,
} from '../../../pos/services/pos-product.service';
import {
  VARIABLE_BARCODE_PRESETS,
  VARIABLE_BARCODE_REASON_LABELS,
  VariableBarcodePresetDef,
  VariableBarcodeSegment,
  analyzeVariableBarcodeOverlaps,
  buildExampleBarcode,
  createFormatFromPreset,
  describeVariableBarcode,
  parsePrefixList,
  positionsLabel,
  resolveVariableBarcode,
  validateVariableBarcodeLayout,
  weightUnitToKg,
} from '../../../../../../shared/utils/variable-barcode.util';
import { VariableBarcodeDiagramComponent } from './variable-barcode-diagram.component';

const MAX_FORMATS = 10;
const MAX_PREFIXES = 20;
/** Etiqueta de ejemplo: producto con código de balanza 1234 que pesa 1,250 kg. */
const EXAMPLE_PRODUCT_CODE = 1234;
const EXAMPLE_WEIGHT_KG = 1.25;

type LayoutField =
  | 'prefix_length'
  | 'product_code_start'
  | 'product_code_length'
  | 'value_start'
  | 'value_length'
  | 'value_decimals'
  | 'value_unit';

interface FormatView {
  format: VariableBarcodeFormat;
  preset: VariableBarcodePresetDef | null;
  /** El diseño ya no coincide con la plantilla de origen. */
  customized: boolean;
  example: string | null;
  exampleSegments: VariableBarcodeSegment[];
  summary: string;
  prefixError: string | null;
  maxWeightError: string | null;
  layoutError: string | null;
  /** Avisos de equivalencia o choque con otros formatos activos. */
  notices: Array<{ tone: 'warning' | 'error'; text: string }>;
}

// `code` ata cada estado al código de balanza consultado, para no mostrar el
// producto del escaneo anterior mientras corre el debounce del siguiente.
type LookupState =
  | { status: 'idle' }
  | { status: 'loading'; code: number }
  | { status: 'error'; code: number }
  | { status: 'done'; code: number; result: ScaleCodeLookupResult };

/**
 * Editor de formatos de etiqueta de balanza (códigos de barras de peso
 * variable). Trabaja sobre una copia y solo emite `save` al confirmar.
 * Las posiciones se guardan en base 0 (contrato con el backend) y la UI
 * las muestra siempre contando desde 1.
 */
@Component({
  selector: 'app-variable-barcode-formats-modal',
  standalone: true,
  imports: [
    FormsModule,
    ModalComponent,
    ButtonComponent,
    InputComponent,
    SelectorComponent,
    IconComponent,
    CurrencyPipe,
    VariableBarcodeDiagramComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-modal
      [isOpen]="isOpen()"
      (isOpenChange)="isOpen.set($event)"
      size="lg"
      [dialog]="true"
      title="Formatos de etiqueta de balanza"
      subtitle="Cómo leer el código de barras que imprime tu balanza etiquetadora"
    >
      <div class="p-2 md:p-4 space-y-5">
        <!-- Cómo se lee una etiqueta -->
        <section class="space-y-2">
          <p class="text-sm text-[var(--color-text-secondary)]">
            La balanza imprime un código de 13 dígitos. Cada formato le dice al POS en qué
            posiciones están el código del producto y el peso. El código de producto es el
            <strong>código de balanza</strong> de la ficha del producto.
          </p>
          <div class="flex flex-wrap gap-3 text-xs text-[var(--color-text-muted)]">
            <span class="legend legend--prefix">Prefijo</span>
            <span class="legend legend--product">Código de producto</span>
            <span class="legend legend--weight">Peso</span>
            <span class="legend legend--check">Dígito de control</span>
          </div>
          <p class="text-xs text-[var(--color-text-muted)]">
            Las posiciones se cuentan desde 1 (el primer dígito es la posición 1).
          </p>
        </section>

        <!-- Plantillas -->
        <section class="space-y-2">
          <h4 class="text-sm font-semibold">Agregar desde plantilla</h4>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-2">
            @for (p of presetViews; track p.def.preset) {
              <div class="rounded-lg border border-[var(--color-border)] p-3 space-y-2">
                <div class="flex items-start justify-between gap-2">
                  <div>
                    <p class="text-sm font-semibold">{{ p.def.label }}</p>
                    <p class="text-xs text-[var(--color-text-secondary)]">{{ p.def.scale_hint }}</p>
                  </div>
                  <app-button
                    variant="outline"
                    size="sm"
                    [disabled]="draft().length >= maxFormats"
                    (clicked)="addFromPreset(p.def.preset)"
                  >
                    Agregar
                  </app-button>
                </div>
                <app-variable-barcode-diagram
                  [segments]="p.segments"
                  [showLabels]="false"
                ></app-variable-barcode-diagram>
                <p class="text-xs text-[var(--color-text-muted)]">
                  Ejemplo: {{ p.example }} → producto {{ exampleCodeText }}, peso
                  <strong class="text-[var(--color-success-700)]">1,250 kg</strong>.
                </p>
                <p class="text-xs text-[var(--color-text-secondary)]">
                  <strong>En la balanza:</strong> {{ p.def.scale_setting }}
                </p>
              </div>
            }
          </div>
          @if (draft().length >= maxFormats) {
            <p class="text-xs text-[var(--color-warning-700)]">
              Llegaste al máximo de {{ maxFormats }} formatos. Elimina uno para agregar otro.
            </p>
          }
        </section>

        <!-- Formatos configurados -->
        <section class="space-y-3">
          <h4 class="text-sm font-semibold">
            Formatos configurados ({{ activeCount() }} activo{{ activeCount() === 1 ? '' : 's' }} de
            {{ draft().length }})
          </h4>

          @if (draft().length === 0) {
            <p class="text-sm text-[var(--color-text-muted)]">
              Aún no hay formatos. Agrega la plantilla que coincide con el tipo de código que
              imprime tu balanza.
            </p>
          }

          @for (v of formatViews(); track v.format.id) {
            <div
              class="rounded-lg border border-[var(--color-border)] p-3 space-y-3"
              [class.opacity-70]="!v.format.enabled"
            >
              <div class="flex items-center justify-between gap-3">
                <label class="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    [checked]="v.format.enabled"
                    (change)="patch(v.format.id, { enabled: $any($event.target).checked })"
                  />
                  {{ v.format.enabled ? 'Activo' : 'Inactivo: el POS no lo usa' }}
                </label>
                <app-button variant="outline-danger" size="sm" (clicked)="remove(v.format.id)">
                  Eliminar
                </app-button>
              </div>

              <p class="text-xs text-[var(--color-text-secondary)]">
                @if (v.preset) {
                  Plantilla {{ v.preset.label }}{{ v.customized ? ' (ajustada a mano)' : '' }}.
                } @else {
                  Formato personalizado.
                }
                {{ v.summary }}
              </p>

              @if (v.exampleSegments.length) {
                <div class="space-y-1">
                  <app-variable-barcode-diagram
                    [segments]="v.exampleSegments"
                  ></app-variable-barcode-diagram>
                  <p class="text-xs text-[var(--color-text-muted)]">
                    Etiqueta de ejemplo {{ v.example }}: producto con código de balanza
                    {{ exampleCodeText }} que pesa 1,250 kg.
                  </p>
                </div>
              }

              @for (n of v.notices; track n.text) {
                <p
                  class="flex items-start gap-1 text-xs font-medium"
                  [class]="
                    n.tone === 'warning'
                      ? 'text-[var(--color-warning-700)]'
                      : 'text-[var(--color-error)]'
                  "
                >
                  <app-icon name="alert-triangle" size="12"></app-icon>
                  {{ n.text }}
                </p>
              }

              <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
                <app-input
                  label="Nombre"
                  [ngModel]="v.format.name"
                  (ngModelChange)="patch(v.format.id, { name: $event })"
                ></app-input>
                <app-input
                  label="Prefijos (separados por coma)"
                  [ngModel]="prefixText()[v.format.id] ?? ''"
                  (ngModelChange)="setPrefixes(v.format.id, $event)"
                  [error]="v.prefixError ?? undefined"
                  [helperText]="
                    'Primeros ' + v.format.prefix_length + ' dígito(s) de la etiqueta, p. ej. ' +
                    (v.format.prefixes[0] ?? '21')
                  "
                ></app-input>
                <app-input
                  label="Peso máximo (kg)"
                  type="number"
                  [ngModel]="maxWeightText()[v.format.id] ?? ''"
                  (ngModelChange)="setMaxWeight(v.format.id, $event)"
                  [error]="v.maxWeightError ?? undefined"
                  helperText="Opcional. Una etiqueta que pese más se rechaza."
                ></app-input>
              </div>

              <!-- Ajuste avanzado -->
              <div class="rounded-md border border-dashed border-[var(--color-border)]">
                <button
                  type="button"
                  class="w-full flex items-center justify-between gap-2 px-3 py-2 text-xs font-semibold text-[var(--color-text-secondary)]"
                  [attr.aria-expanded]="isAdvancedOpen(v.format.id)"
                  (click)="toggleAdvanced(v.format.id)"
                >
                  <span class="flex items-center gap-1">
                    <app-icon name="sliders-horizontal" size="12"></app-icon>
                    Ajuste avanzado (posiciones, largos, decimales y unidad)
                  </span>
                  <app-icon
                    [name]="isAdvancedOpen(v.format.id) ? 'chevron-up' : 'chevron-down'"
                    size="14"
                  ></app-icon>
                </button>
                @if (isAdvancedOpen(v.format.id)) {
                  <div class="px-3 pb-3 space-y-3">
                    <p class="text-xs text-[var(--color-text-muted)]">
                      Cambia esto solo si tu balanza imprime un diseño distinto a la plantilla.
                      @if (v.preset && !v.customized) {
                        Al editar, el formato deja de ser la plantilla y pasa a personalizado.
                      }
                      Las posiciones cuentan desde 1; las posiciones 1 a 12 son datos y la 13 es el
                      dígito de control.
                    </p>
                    <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
                      <app-input
                        label="Largo del prefijo"
                        type="number"
                        [min]="1"
                        [max]="12"
                        [ngModel]="v.format.prefix_length"
                        (ngModelChange)="setLayout(v.format.id, 'prefix_length', $event)"
                      ></app-input>
                      <app-input
                        label="Código: desde posición"
                        type="number"
                        [min]="1"
                        [max]="12"
                        [ngModel]="v.format.product_code_start + 1"
                        (ngModelChange)="setLayout(v.format.id, 'product_code_start', $event)"
                      ></app-input>
                      <app-input
                        label="Código: dígitos"
                        type="number"
                        [min]="1"
                        [max]="12"
                        [ngModel]="v.format.product_code_length"
                        (ngModelChange)="setLayout(v.format.id, 'product_code_length', $event)"
                      ></app-input>
                      <app-input
                        label="Peso: desde posición"
                        type="number"
                        [min]="1"
                        [max]="12"
                        [ngModel]="v.format.value_start + 1"
                        (ngModelChange)="setLayout(v.format.id, 'value_start', $event)"
                      ></app-input>
                      <app-input
                        label="Peso: dígitos"
                        type="number"
                        [min]="1"
                        [max]="12"
                        [ngModel]="v.format.value_length"
                        (ngModelChange)="setLayout(v.format.id, 'value_length', $event)"
                      ></app-input>
                      <app-input
                        label="Peso: decimales"
                        type="number"
                        [min]="0"
                        [max]="12"
                        [ngModel]="v.format.value_decimals"
                        (ngModelChange)="setLayout(v.format.id, 'value_decimals', $event)"
                      ></app-input>
                      <app-selector
                        label="Peso: unidad"
                        [options]="unitOptions"
                        [ngModel]="v.format.value_unit"
                        (ngModelChange)="setLayout(v.format.id, 'value_unit', $event)"
                      ></app-selector>
                    </div>
                    @if (v.layoutError) {
                      <p class="flex items-start gap-1 text-xs font-medium text-[var(--color-error)]">
                        <app-icon name="alert-triangle" size="12"></app-icon>
                        {{ v.layoutError }}
                      </p>
                    }
                  </div>
                }
              </div>
            </div>
          }
        </section>

        <!-- Probador -->
        <section class="rounded-lg border border-[var(--color-border)] p-3 space-y-3">
          <app-input
            label="Probador"
            placeholder="Escanea o pega un código de 13 dígitos"
            [ngModel]="testCode()"
            (ngModelChange)="testCode.set(('' + ($event ?? '')).trim())"
            helperText="Escanea una etiqueta real: se prueba con los formatos activos de arriba, aunque aún no los hayas guardado"
          ></app-input>

          @if (testSegments().length) {
            <app-variable-barcode-diagram [segments]="testSegments()"></app-variable-barcode-diagram>
          }

          @if (testResult(); as r) {
            @if (r.ok) {
              <p class="text-sm font-medium text-[var(--color-success-700)]">
                Formato «{{ r.formatName }}»: código de balanza {{ r.scaleCodeText }} · peso
                {{ r.weightText }} kg
              </p>

              @switch (lookupStatus()) {
                @case ('loading') {
                  <p class="flex items-center gap-1 text-sm text-[var(--color-text-muted)]">
                    <app-icon name="loader-2" size="14" class="animate-spin"></app-icon>
                    Buscando el producto con código de balanza {{ r.scaleCodeText }}…
                  </p>
                }
                @case ('error') {
                  <div class="flex flex-wrap items-center gap-2">
                    <p class="text-sm font-medium text-[var(--color-error)]">
                      No se pudo consultar el producto. Revisa la conexión e intenta de nuevo.
                    </p>
                    <app-button variant="outline" size="sm" (clicked)="retryLookup()">
                      <app-icon slot="icon" name="refresh-cw" size="14"></app-icon>
                      Reintentar
                    </app-button>
                  </div>
                }
                @case ('done') {
                  @if (lookupView(); as lv) {
                    @if (lv.kind === 'found') {
                      <div
                        class="rounded-md border border-[var(--color-success-300)] bg-[var(--color-success-50)] p-3 text-sm space-y-1"
                      >
                        <p class="flex items-center gap-1 font-semibold">
                          <app-icon name="check-circle" size="14"></app-icon>
                          {{ lv.name }}
                        </p>
                        <p>Peso: {{ r.weightText }} kg</p>
                        <p>Precio: {{ lv.price | currency }} {{ lv.priceUnitText }}</p>
                        @if (lv.total !== null) {
                          <p class="font-semibold">Total estimado: {{ lv.total | currency }}</p>
                          <p class="text-xs text-[var(--color-text-muted)]">
                            Estimado con el precio base; en el POS pueden aplicar promociones o
                            tarifas.
                          </p>
                        } @else {
                          <p class="text-xs text-[var(--color-warning-700)]">
                            No se puede estimar el total: la unidad de venta del producto no es de
                            peso. Revísala en la ficha del producto.
                          </p>
                        }
                      </div>
                    } @else {
                      <p class="text-sm font-medium text-[var(--color-error)]">{{ lv.message }}</p>
                    }
                  }
                }
              }
            } @else {
              <p class="text-sm font-medium text-[var(--color-error)]">{{ r.reasonText }}</p>
            }
          }
        </section>
      </div>

      <div slot="footer">
        <div class="flex flex-wrap items-center justify-end gap-3 p-3 bg-gray-50 rounded-b-xl border-t border-border">
          @if (errorCount() > 0) {
            <p class="mr-auto text-xs font-medium text-[var(--color-error)]">
              Corrige {{ errorCount() }} error{{ errorCount() === 1 ? '' : 'es' }} para guardar.
            </p>
          }
          <app-button variant="outline" (clicked)="isOpen.set(false)">Cancelar</app-button>
          <app-button variant="primary" [disabled]="errorCount() > 0" (clicked)="onSave()">
            Guardar formatos
          </app-button>
        </div>
      </div>
    </app-modal>
  `,
  styles: [
    `
      .legend {
        display: inline-flex;
        align-items: center;
        gap: 0.25rem;
      }
      .legend::before {
        content: '';
        width: 0.75rem;
        height: 0.75rem;
        border-radius: 0.1875rem;
        border: 1px solid;
      }
      .legend--prefix::before {
        background: var(--color-info-50);
        border-color: var(--color-info-200);
      }
      .legend--product::before {
        background: var(--color-primary-50);
        border-color: var(--color-primary-100);
      }
      .legend--weight::before {
        background: var(--color-success-50);
        border-color: var(--color-success-300);
      }
      .legend--check::before {
        background: var(--color-surface-muted);
        border-color: var(--color-border);
      }
    `,
  ],
})
export class VariableBarcodeFormatsModalComponent {
  private readonly productService = inject(PosProductService);

  readonly isOpen = model<boolean>(false);
  readonly formats = input<VariableBarcodeFormat[]>([]);
  readonly save = output<VariableBarcodeFormat[]>();

  readonly maxFormats = MAX_FORMATS;
  readonly exampleCodeText = String(EXAMPLE_PRODUCT_CODE);
  readonly unitOptions: SelectorOption[] = [
    { value: 'kg', label: 'Kilogramos (kg)' },
    { value: 'g', label: 'Gramos (g)' },
  ];

  /** Cada plantilla con su etiqueta de ejemplo ya partida por tramos. */
  readonly presetViews = VARIABLE_BARCODE_PRESETS.map((def) => {
    const format = createFormatFromPreset(def.preset);
    const example = buildExampleBarcode(format, EXAMPLE_PRODUCT_CODE, EXAMPLE_WEIGHT_KG) ?? '';
    return { def, example, segments: describeVariableBarcode(format, example) };
  });

  readonly draft = signal<VariableBarcodeFormat[]>([]);
  readonly prefixText = signal<Record<string, string>>({});
  readonly maxWeightText = signal<Record<string, string>>({});
  readonly advancedOpen = signal<ReadonlySet<string>>(new Set());
  readonly testCode = signal('');
  private readonly lookupAttempt = signal(0);

  readonly activeCount = computed(() => this.draft().filter((f) => f.enabled).length);

  readonly formatViews = computed<FormatView[]>(() => {
    const list = this.draft();
    const prefixTexts = this.prefixText();
    const weights = this.maxWeightText();
    const overlaps = analyzeVariableBarcodeOverlaps(list);
    const nameOf = (id: string) => list.find((f) => f.id === id)?.name || 'otro formato';

    return list.map((format) => {
      const preset = VARIABLE_BARCODE_PRESETS.find((p) => p.preset === format.preset) ?? null;
      const layoutError = validateVariableBarcodeLayout(format);
      const example = layoutError
        ? null
        : buildExampleBarcode(format, EXAMPLE_PRODUCT_CODE, EXAMPLE_WEIGHT_KG);

      const notices: FormatView['notices'] = [];
      for (const pair of overlaps.equivalent) {
        if (pair.a !== format.id && pair.b !== format.id) continue;
        const other = nameOf(pair.a === format.id ? pair.b : pair.a);
        notices.push({
          tone: 'warning',
          text: `Equivale a «${other}»: mismo prefijo (${pair.prefixes.join(', ')}) y misma lectura. Dan el mismo resultado; deja activo solo uno.`,
        });
      }
      for (const pair of overlaps.conflicts) {
        if (pair.a !== format.id && pair.b !== format.id) continue;
        const other = nameOf(pair.a === format.id ? pair.b : pair.a);
        notices.push({
          tone: 'error',
          text: `Choca con «${other}»: los dos reconocen el prefijo ${pair.prefixes.join(', ')} pero lo leen distinto. El POS rechazará esas etiquetas como ambiguas; desactiva uno o cambia su prefijo.`,
        });
      }

      return {
        format,
        preset,
        customized: !!preset && !this.matchesPreset(format, preset),
        example,
        exampleSegments: example ? describeVariableBarcode(format, example) : [],
        summary: this.summaryOf(format),
        prefixError: this.prefixErrorOf(format, prefixTexts[format.id] ?? ''),
        maxWeightError: this.maxWeightErrorOf(weights[format.id] ?? ''),
        layoutError,
        notices,
      };
    });
  });

  readonly errorCount = computed(
    () =>
      this.formatViews().reduce(
        (n, v) => n + (v.prefixError ? 1 : 0) + (v.maxWeightError ? 1 : 0) + (v.layoutError ? 1 : 0),
        0,
      ),
  );

  private readonly resolved = computed(() => {
    const code = this.testCode();
    return code ? resolveVariableBarcode(code, this.draft()) : null;
  });

  /** Formato con el que se pinta el código del probador. */
  private readonly testFormat = computed<VariableBarcodeFormat | null>(() => {
    const code = this.testCode();
    const r = this.resolved();
    const active = this.draft().filter((f) => f.enabled);
    if (r?.ok) return active.find((f) => f.id === r.format_id) ?? null;
    // Sin coincidencia exacta se pinta con el formato cuyo prefijo coincide,
    // para que se vea por qué falla (p. ej. el dígito de control).
    return active.find((f) => f.prefixes.some((p) => code.startsWith(p))) ?? active[0] ?? null;
  });

  readonly testSegments = computed(() => {
    const code = this.testCode();
    const format = this.testFormat();
    if (!format || !/^\d{13}$/.test(code)) return [];
    return describeVariableBarcode(format, code);
  });

  readonly testResult = computed<
    | { ok: true; scaleCode: number; scaleCodeText: string; weightKg: number; weightText: string; formatName: string }
    | { ok: false; reasonText: string }
    | null
  >(() => {
    const r = this.resolved();
    if (!r) return null;
    if (!r.ok) return { ok: false, reasonText: VARIABLE_BARCODE_REASON_LABELS[r.reason] };
    const format = this.draft().find((f) => f.id === r.format_id);
    return {
      ok: true,
      scaleCode: r.productCode,
      // Se muestra tal como viene en la etiqueta (con ceros a la izquierda).
      scaleCodeText: String(r.productCode).padStart(format?.product_code_length ?? 0, '0'),
      weightKg: r.weightKg,
      weightText: r.weightKg.toLocaleString('es-CO', {
        minimumFractionDigits: 3,
        maximumFractionDigits: 3,
      }),
      formatName: format?.name ?? '',
    };
  });

  /** Busca el producto por código de balanza cuando el parseo es válido. */
  readonly lookup = toSignal(
    toObservable(
      computed(() => {
        const r = this.testResult();
        return { code: r?.ok ? r.scaleCode : null, attempt: this.lookupAttempt() };
      }),
    ).pipe(
      distinctUntilChanged((a, b) => a.code === b.code && a.attempt === b.attempt),
      debounceTime(250),
      switchMap(({ code }): Observable<LookupState> => {
        if (code === null) return of({ status: 'idle' });
        return concat(
          of<LookupState>({ status: 'loading', code }),
          this.productService.lookupWeightProductByScaleCode(code).pipe(
            map((result): LookupState => ({ status: 'done', code, result })),
            catchError(() => of<LookupState>({ status: 'error', code })),
          ),
        );
      }),
    ),
    { initialValue: { status: 'idle' } as LookupState },
  );

  /** Estado de la búsqueda solo si corresponde al código que se ve ahora. */
  readonly lookupStatus = computed<LookupState['status']>(() => {
    const state = this.lookup();
    const r = this.testResult();
    if (state.status === 'idle' || !r?.ok) return 'idle';
    return state.code === r.scaleCode ? state.status : 'loading';
  });

  readonly lookupView = computed<
    | { kind: 'found'; name: string; price: number; priceUnitText: string; total: number | null }
    | { kind: 'message'; message: string }
    | null
  >(() => {
    const state = this.lookup();
    const r = this.testResult();
    if (state.status !== 'done' || !r?.ok || state.code !== r.scaleCode) return null;
    const code = r.scaleCodeText;
    const result = state.result;
    switch (result.status) {
      case 'not_found':
        return {
          kind: 'message',
          message: `Ningún producto de esta tienda tiene el código de balanza ${code} — asígnalo en la ficha del producto`,
        };
      case 'multiple':
        return {
          kind: 'message',
          message: `${result.count} productos tienen el código de balanza ${code}. Deja solo uno: el POS no sabrá cuál cobrar.`,
        };
      case 'not_weight':
        return {
          kind: 'message',
          message: `«${result.product.name}» tiene el código de balanza ${code} pero no se vende por peso. Cámbialo a venta por peso en su ficha.`,
        };
      case 'found':
        return { kind: 'found', ...this.priceOf(result.product, r.weightKg) };
    }
  });

  constructor() {
    // Al abrir se parte de una copia de los formatos guardados.
    effect(() => {
      if (!this.isOpen()) return;
      const current = this.formats();
      untracked(() => {
        const copy = (current ?? []).map((f) => ({ ...f, prefixes: [...f.prefixes] }));
        this.draft.set(copy);
        this.prefixText.set(Object.fromEntries(copy.map((f) => [f.id, f.prefixes.join(', ')])));
        this.maxWeightText.set(
          Object.fromEntries(copy.map((f) => [f.id, f.max_weight_kg != null ? String(f.max_weight_kg) : ''])),
        );
        this.advancedOpen.set(new Set());
        this.testCode.set('');
      });
    });
  }

  addFromPreset(preset: VariableBarcodePresetDef['preset']): void {
    if (this.draft().length >= MAX_FORMATS) return;
    const created = createFormatFromPreset(preset);
    this.draft.update((list) => [...list, created]);
    this.prefixText.update((m) => ({ ...m, [created.id]: created.prefixes.join(', ') }));
    this.maxWeightText.update((m) => ({ ...m, [created.id]: '' }));
  }

  remove(id: string): void {
    this.draft.update((list) => list.filter((f) => f.id !== id));
  }

  patch(id: string, changes: Partial<VariableBarcodeFormat>): void {
    this.draft.update((list) => list.map((f) => (f.id === id ? { ...f, ...changes } : f)));
  }

  isAdvancedOpen(id: string): boolean {
    return this.advancedOpen().has(id);
  }

  toggleAdvanced(id: string): void {
    this.advancedOpen.update((set) => {
      const next = new Set(set);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  setPrefixes(id: string, raw: string | null): void {
    const text = raw ?? '';
    this.prefixText.update((m) => ({ ...m, [id]: text }));
    const format = this.draft().find((f) => f.id === id);
    if (!format) return;
    // Solo se guardan los válidos; los inválidos se muestran bajo el campo y
    // bloquean el guardado, así que nada se descarta en silencio.
    this.patch(id, { prefixes: parsePrefixList(text, format.prefix_length, MAX_PREFIXES).prefixes });
  }

  setMaxWeight(id: string, raw: unknown): void {
    const text = raw === null || raw === undefined ? '' : String(raw).trim();
    this.maxWeightText.update((m) => ({ ...m, [id]: text }));
    const n = text === '' ? NaN : Number(text.replace(',', '.'));
    if (Number.isFinite(n) && n > 0) {
      this.patch(id, { max_weight_kg: n });
      return;
    }
    // Vacío (sin límite) o inválido: no se guarda límite; si es inválido el
    // error queda visible y el botón Guardar se desactiva.
    this.draft.update((list) =>
      list.map((f) => {
        if (f.id !== id) return f;
        const { max_weight_kg: _omit, ...rest } = f;
        return rest;
      }),
    );
  }

  /**
   * Edita el diseño desde "Ajuste avanzado". Las posiciones llegan en base 1 y
   * se guardan en base 0. Al tocarlo, el formato pasa a `custom`.
   */
  setLayout(id: string, field: LayoutField, raw: unknown): void {
    const format = this.draft().find((f) => f.id === id);
    if (!format) return;
    const changes: Partial<VariableBarcodeFormat> = {};
    if (field === 'value_unit') {
      changes.value_unit = raw === 'g' ? 'g' : 'kg';
    } else {
      const n = raw === null || raw === undefined || raw === '' ? NaN : Number(raw);
      const isStart = field === 'product_code_start' || field === 'value_start';
      changes[field] = isStart ? n - 1 : n;
    }
    const next = { ...format, ...changes };
    const preset = VARIABLE_BARCODE_PRESETS.find((p) => p.preset === format.preset);
    if (preset && !this.matchesPreset(next, preset)) changes.preset = 'custom';
    if (field === 'prefix_length') {
      // Los prefijos se revalidan contra el nuevo largo.
      changes.prefixes = parsePrefixList(
        this.prefixText()[id] ?? '',
        next.prefix_length,
        MAX_PREFIXES,
      ).prefixes;
    }
    this.patch(id, changes);
  }

  retryLookup(): void {
    this.lookupAttempt.update((n) => n + 1);
  }

  onSave(): void {
    if (this.errorCount() > 0) return;
    this.save.emit(
      this.draft().map((f) => ({
        ...f,
        // El backend exige nombre: uno vacío vuelve al genérico.
        name: f.name?.trim() || 'Formato de balanza',
        prefixes: [...f.prefixes],
      })),
    );
    this.isOpen.set(false);
  }

  private matchesPreset(format: VariableBarcodeFormat, preset: VariableBarcodePresetDef): boolean {
    return (
      format.prefix_length === preset.prefix_length &&
      format.product_code_start === preset.product_code_start &&
      format.product_code_length === preset.product_code_length &&
      format.value_start === preset.value_start &&
      format.value_length === preset.value_length &&
      format.value_decimals === preset.value_decimals &&
      format.value_unit === preset.value_unit
    );
  }

  private summaryOf(f: VariableBarcodeFormat): string {
    if (validateVariableBarcodeLayout(f)) return '';
    const unit = f.value_unit === 'g' ? 'gramos' : 'kg';
    return (
      `Prefijo en posiciones ${positionsLabel(0, f.prefix_length)}, ` +
      `código de producto en ${positionsLabel(f.product_code_start, f.product_code_length)}, ` +
      `peso en ${positionsLabel(f.value_start, f.value_length)} ` +
      `(${unit}, ${f.value_decimals} decimal${f.value_decimals === 1 ? '' : 'es'}), ` +
      `dígito de control en 13.`
    );
  }

  private prefixErrorOf(f: VariableBarcodeFormat, text: string): string | null {
    const parsed = parsePrefixList(text, f.prefix_length, MAX_PREFIXES);
    if (parsed.invalid.length) {
      const list = parsed.invalid.map((p) => `«${p}»`).join(', ');
      return `${list} no ${parsed.invalid.length === 1 ? 'es válido' : 'son válidos'}: cada prefijo debe tener exactamente ${f.prefix_length} dígito(s) numéricos.`;
    }
    if (parsed.truncated) return `Máximo ${MAX_PREFIXES} prefijos por formato.`;
    if (!parsed.prefixes.length) {
      return 'Escribe al menos un prefijo: sin prefijo el formato no reconoce ninguna etiqueta.';
    }
    return null;
  }

  private maxWeightErrorOf(text: string): string | null {
    if (text === '') return null;
    const n = Number(text.replace(',', '.'));
    if (Number.isFinite(n) && n > 0) return null;
    return 'Escribe un peso mayor que 0 (p. ej. 15) o déjalo vacío para no limitar.';
  }

  /**
   * Precio por kilo y total estimado. `price` cubre `price_unit_quantity`
   * unidades de la unidad principal de venta; si esa unidad no es de peso no
   * se estima el total.
   */
  private priceOf(
    product: Product,
    weightKg: number,
  ): { name: string; price: number; priceUnitText: string; total: number | null } {
    const price = Number(product.final_price ?? product.price) || 0;
    const qty = Number(product.price_unit_quantity ?? 1) || 1;
    const uom = product.sale_uoms?.find((u) => u.is_principal) ?? null;
    const unitKg = weightUnitToKg(uom?.code ?? null);
    const unitName = uom?.code ?? 'kg';
    const priceUnitText = qty === 1 ? `por ${unitName}` : `por ${qty} ${unitName}`;
    const total = unitKg ? Math.round((price / (qty * unitKg)) * weightKg * 100) / 100 : null;
    return { name: product.name, price, priceUnitText, total };
  }
}
