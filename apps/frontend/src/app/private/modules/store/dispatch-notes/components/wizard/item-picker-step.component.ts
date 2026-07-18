import {
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  FormControl,
  FormGroup,
  FormsModule,
  ReactiveFormsModule,
} from '@angular/forms';
import { forkJoin, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import * as XLSX from 'xlsx';

import {
  EmptyStateComponent,
  IconComponent,
  InputComponent,
  InputsearchComponent,
  SelectorComponent,
  TextareaComponent,
  ToastService,
} from '../../../../../../shared/components';
import type { SelectorOption } from '../../../../../../shared/components';
import { CurrencyPipe } from '../../../../../../shared/pipes/currency/currency.pipe';
import { PosProductService, Product } from '../../../pos/services/pos-product.service';
import { LocationsService } from '../../../inventory/services/locations.service';
import type {
  ApiResponse,
  InventoryLocation,
} from '../../../inventory/interfaces';
import { ReceiptScanItem } from '../../interfaces/dispatch-note.interface';
import { DispatchNotesService } from '../../services/dispatch-notes.service';
import {
  DispatchNoteWizardService,
  WizardItem,
} from '../../services/dispatch-note-wizard.service';
import { WizardStepSectionComponent } from './wizard-step-section.component';

/** Item capture mode for the picker step. */
type ImportMode = 'manual' | 'excel' | 'ai';

/**
 * Internal normalized suggestion shared by both the IA and Excel paths. Excel
 * rows produce `matched_product_id = null`; IA rows carry the backend match.
 */
interface ReceiptSuggestion {
  product_name: string;
  sku: string | null;
  quantity: number;
  unit_price: number | null;
  matched_product_id: number | null;
  matched_variant_id: number | null;
  confidence: 'high' | 'low' | 'none';
}

/** A suggested line that still needs a catalog product to be linked. */
interface PendingLink {
  id: string;
  product_name: string;
  sku: string | null;
  quantity: number;
  unit_price: number | null;
  confidence: 'high' | 'low' | 'none';
}

/**
 * Fused "Ítems y bodega" step for the free-picker subtypes (transfer / return /
 * purchase_receipt) — step index 2.
 *
 * Absorbe la lógica de `details-step` (bodega de origen + fecha + notas) dentro
 * del picker de ítems para que, en un solo paso, se elijan los productos y la
 * bodega desde donde salen. `canProceed` (case 2) exige ítems válidos **y**
 * `dispatch_location_id`.
 *
 * Tres modos de captura de ítems:
 *  - **Manual** (always): free product search + add.
 *  - **Excel** (only `purchase_receipt`): client-side `.xlsx/.xls/.csv` parse
 *    with SheetJS; exact-SKU auto-match, the rest go to "por vincular".
 *  - **IA** (only `purchase_receipt`): upload a photo/PDF of the receipt →
 *    backend scan; backend-matched lines are added directly, the rest go to
 *    "por vincular".
 *
 * IA/Excel produce product NAMES; `purchase_receipt` requires `product_id`, so
 * unmatched lines must be resolved to a catalog product (per-row search) before
 * they become `WizardItem`s. Uses `PosProductService.searchProducts` for both
 * the manual search and the per-row resolution.
 *
 * Zoneless puro: signal/computed, sin NgZone/markForCheck.
 */
@Component({
  selector: 'app-dispatch-wizard-item-picker-step',
  standalone: true,
  imports: [
    EmptyStateComponent,
    IconComponent,
    InputComponent,
    InputsearchComponent,
    SelectorComponent,
    TextareaComponent,
    CurrencyPipe,
    FormsModule,
    ReactiveFormsModule,
    WizardStepSectionComponent,
  ],
  template: `
    <div class="space-y-4">
      <!-- ═══ ÍTEMS ═══ -->
      <app-wizard-step-section
        icon="package"
        title="Ítems y bodega"
        subtitle="Agrega los productos a despachar y elige la bodega de origen"
        [dense]="true"
      >
        <!-- Mode selector — Excel/IA only for purchase_receipt (ref R4c) -->
        @if (importEnabled()) {
          <div
            class="flex gap-1 p-1 rounded-lg bg-[var(--color-surface-elevated)] border border-[var(--color-border)]"
          >
            <button
              type="button"
              class="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md text-xs font-semibold
                     transition-colors min-h-[36px]"
              [class]="modeButtonClass('manual')"
              (click)="setMode('manual')"
            >
              <app-icon name="search" [size]="14"></app-icon>
              Manual
            </button>
            <button
              type="button"
              class="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md text-xs font-semibold
                     transition-colors min-h-[36px]"
              [class]="modeButtonClass('excel')"
              (click)="setMode('excel')"
            >
              <app-icon name="file-spreadsheet" [size]="14"></app-icon>
              Excel
            </button>
            <button
              type="button"
              class="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md text-xs font-semibold
                     transition-colors min-h-[36px]"
              [class]="modeButtonClass('ai')"
              (click)="setMode('ai')"
            >
              <app-icon name="sparkles" [size]="14"></app-icon>
              IA
            </button>
          </div>
        }

        <!-- ═══ MANUAL ═══ -->
        @if (effectiveMode() === 'manual') {
          <app-inputsearch
            placeholder="Buscar por nombre, SKU o código de barras..."
            [debounceTime]="300"
            (search)="onSearch($event)"
          ></app-inputsearch>

          @if (searchResults().length > 0) {
            <div
              class="border border-[var(--color-border)] rounded-lg max-h-44 overflow-y-auto bg-[var(--color-surface)]"
            >
              @for (product of searchResults(); track product.id) {
                <button
                  type="button"
                  class="w-full text-left p-2 flex items-center gap-2
                         hover:bg-[var(--color-primary-light)] transition-colors duration-200
                         border-b border-[var(--color-border)] last:border-b-0
                         min-h-[44px]"
                  (click)="addProduct(product)"
                >
                  <div
                    class="w-8 h-8 rounded-md bg-[var(--color-surface-elevated)] flex items-center justify-center shrink-0 overflow-hidden"
                  >
                    @if (product.image_url || product.image) {
                      <img
                        [src]="product.image_url || product.image"
                        [alt]="product.name"
                        class="w-full h-full object-cover"
                      />
                    } @else {
                      <app-icon name="package" [size]="14" color="var(--color-text-muted)"></app-icon>
                    }
                  </div>
                  <div class="flex-1 min-w-0">
                    <p class="font-medium text-sm text-[var(--color-text-primary)] truncate">
                      {{ product.name }}
                    </p>
                    @if (product.sku) {
                      <p class="text-xs text-[var(--color-text-muted)] truncate">
                        SKU: {{ product.sku }}
                      </p>
                    }
                  </div>
                  <span class="text-sm font-semibold text-[var(--color-text-primary)] shrink-0">
                    {{ product.final_price || product.price | currency }}
                  </span>
                  <app-icon name="plus" [size]="14" color="var(--color-primary)" class="shrink-0"></app-icon>
                </button>
              }
            </div>
          }

          @if (loading()) {
            <div class="flex items-center gap-2 py-2">
              <div
                class="w-4 h-4 border-2 border-[var(--color-primary)] border-t-transparent rounded-full animate-spin shrink-0"
              ></div>
              <span class="text-sm text-[var(--color-text-secondary)]">Buscando...</span>
            </div>
          }
        }

        <!-- ═══ EXCEL ═══ -->
        @if (effectiveMode() === 'excel') {
          <input
            #excelInput
            type="file"
            accept=".xlsx,.xls,.csv"
            class="hidden"
            (change)="onExcelSelected($event, excelInput)"
          />
          <button
            type="button"
            class="w-full border-2 border-dashed border-[var(--color-border)] rounded-lg p-5 text-center
                   hover:border-[var(--color-primary)] transition-colors"
            [disabled]="parsing()"
            (click)="excelInput.click()"
          >
            @if (parsing()) {
              <div class="flex flex-col items-center gap-2">
                <div
                  class="w-6 h-6 border-2 border-[var(--color-primary)] border-t-transparent rounded-full animate-spin"
                ></div>
                <span class="text-sm text-[var(--color-text-secondary)]">Procesando archivo...</span>
              </div>
            } @else {
              <app-icon name="file-spreadsheet" [size]="28" color="var(--color-primary)" class="mx-auto"></app-icon>
              <p class="mt-2 text-sm font-medium text-[var(--color-text-primary)]">
                Sube un archivo Excel (.xlsx, .xls, .csv)
              </p>
              <p class="text-xs text-[var(--color-text-muted)] mt-0.5">Haz clic para seleccionar</p>
            }
          </button>
          <div
            class="rounded-lg p-2.5 text-xs leading-relaxed"
            style="background: color-mix(in srgb, var(--color-primary) 5%, var(--color-surface));"
          >
            <p class="font-semibold text-[var(--color-text-secondary)] mb-0.5">Columnas soportadas</p>
            <p class="text-[var(--color-text-muted)]">
              <b>Nombre</b> (nombre / producto / descripción),
              <b>SKU</b> (sku / código / referencia),
              <b>Cantidad</b> (cantidad / qty / unidades),
              <b>Precio</b> (precio / valor / costo).
              La primera fila debe ser el encabezado. Los SKU exactos se vinculan
              automáticamente; el resto queda "por vincular".
            </p>
          </div>
        }

        <!-- ═══ IA ═══ -->
        @if (effectiveMode() === 'ai') {
          <input
            #aiInput
            type="file"
            accept="image/*,application/pdf,.pdf"
            class="hidden"
            (change)="onAiSelected($event, aiInput)"
          />
          <button
            type="button"
            class="w-full border-2 border-dashed border-[var(--color-border)] rounded-lg p-5 text-center
                   hover:border-[var(--color-primary)] transition-colors"
            [disabled]="scanning()"
            (click)="aiInput.click()"
          >
            @if (scanning()) {
              <div class="flex flex-col items-center gap-2">
                <div
                  class="w-6 h-6 border-2 border-[var(--color-primary)] border-t-transparent rounded-full animate-spin"
                ></div>
                <span class="text-sm text-[var(--color-text-secondary)]">Escaneando recibo con IA...</span>
              </div>
            } @else {
              <app-icon name="sparkles" [size]="28" color="var(--color-primary)" class="mx-auto"></app-icon>
              <p class="mt-2 text-sm font-medium text-[var(--color-text-primary)]">
                Sube una foto o PDF del recibo
              </p>
              <p class="text-xs text-[var(--color-text-muted)] mt-0.5">
                La IA detectará los productos y cantidades
              </p>
            }
          </button>
        }

        <!-- Import feedback (detected supplier / warnings) -->
        @if (detectedSupplierName() && effectiveMode() !== 'manual') {
          <div
            class="flex items-center gap-2 rounded-lg p-2 text-xs"
            style="background: color-mix(in srgb, var(--color-success) 8%, var(--color-surface));"
          >
            <app-icon name="building-2" [size]="14" color="var(--color-success)"></app-icon>
            <span class="text-[var(--color-text-secondary)]">
              Proveedor detectado: <b class="text-[var(--color-text-primary)]">{{ detectedSupplierName() }}</b>
            </span>
          </div>
        }
        @if (importWarnings().length > 0) {
          <div
            class="rounded-lg p-2 text-xs"
            style="background: color-mix(in srgb, var(--color-warning) 10%, var(--color-surface));"
          >
            <div class="flex items-center gap-1.5 font-semibold text-[var(--color-warning)] mb-1">
              <app-icon name="alert-triangle" [size]="13"></app-icon>
              Avisos ({{ importWarnings().length }})
            </div>
            <ul class="list-disc list-inside space-y-0.5 max-h-24 overflow-y-auto text-[var(--color-text-muted)]">
              @for (w of importWarnings(); track w) {
                <li>{{ w }}</li>
              }
            </ul>
          </div>
        }

        <!-- ═══ POR VINCULAR ═══ -->
        @if (pendingLinks().length > 0) {
          <div>
            <p class="text-xs font-semibold uppercase tracking-wider text-[var(--color-warning)] mb-1.5">
              Por vincular ({{ pendingLinks().length }})
            </p>
            <div class="space-y-2 max-h-72 overflow-y-auto">
              @for (link of pendingLinks(); track link.id) {
                <div
                  class="border rounded-lg p-2 bg-[var(--color-surface)]"
                  style="border-color: color-mix(in srgb, var(--color-warning) 40%, var(--color-border));"
                >
                  <div class="flex items-start gap-2 mb-1.5">
                    <div class="flex-1 min-w-0">
                      <p class="font-medium text-sm text-[var(--color-text-primary)] truncate">
                        {{ link.product_name }}
                      </p>
                      <p class="text-xs text-[var(--color-text-muted)] truncate">
                        @if (link.sku) { SKU: {{ link.sku }} · }
                        Cant: {{ link.quantity }}
                        @if (link.unit_price !== null) { · {{ link.unit_price | currency }} }
                      </p>
                    </div>
                    <span
                      class="shrink-0 text-xs font-semibold px-1.5 py-0.5 rounded-full"
                      [class]="confidenceBadgeClass(link.confidence)"
                    >
                      {{ confidenceLabel(link.confidence) }}
                    </span>
                    <button
                      type="button"
                      class="p-1 rounded-md text-[var(--color-text-muted)] hover:text-[var(--color-danger)] hover:bg-[var(--color-danger)]/10 transition-colors shrink-0"
                      (click)="discardLink(link.id)"
                      aria-label="Descartar línea"
                    >
                      <app-icon name="x" [size]="13"></app-icon>
                    </button>
                  </div>

                  <app-inputsearch
                    placeholder="Buscar producto para vincular..."
                    [debounceTime]="300"
                    (search)="onLinkSearch(link.id, $event)"
                  ></app-inputsearch>

                  @if (linkSearching()[link.id]) {
                    <div class="flex items-center gap-2 py-1.5">
                      <div
                        class="w-3.5 h-3.5 border-2 border-[var(--color-primary)] border-t-transparent rounded-full animate-spin shrink-0"
                      ></div>
                      <span class="text-xs text-[var(--color-text-muted)]">Buscando...</span>
                    </div>
                  }

                  @if (linkResults()[link.id]?.length) {
                    <div
                      class="mt-1 border border-[var(--color-border)] rounded-md max-h-36 overflow-y-auto bg-[var(--color-surface)]"
                    >
                      @for (product of linkResults()[link.id]; track product.id) {
                        <button
                          type="button"
                          class="w-full text-left p-1.5 flex items-center gap-2
                                 hover:bg-[var(--color-primary-light)] transition-colors
                                 border-b border-[var(--color-border)] last:border-b-0 min-h-[40px]"
                          (click)="linkProduct(link, product)"
                        >
                          <div class="flex-1 min-w-0">
                            <p class="text-xs font-medium text-[var(--color-text-primary)] truncate">
                              {{ product.name }}
                            </p>
                            @if (product.sku) {
                              <p class="text-xs text-[var(--color-text-muted)] truncate">
                                SKU: {{ product.sku }}
                              </p>
                            }
                          </div>
                          <app-icon name="link" [size]="13" color="var(--color-primary)" class="shrink-0"></app-icon>
                        </button>
                      }
                    </div>
                  }
                </div>
              }
            </div>
          </div>
        }

        <!-- ═══ ITEMS SELECCIONADOS ═══ -->
        @if (items().length > 0) {
          <div>
            <p class="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)] mb-1.5">
              Productos seleccionados ({{ items().length }})
            </p>

            <div class="space-y-1.5 max-h-60 overflow-y-auto">
              @for (item of items(); track trackByItem(item, $index); let i = $index) {
                <div
                  class="border border-[var(--color-border)] rounded-lg p-2 bg-[var(--color-surface)]"
                >
                  <div class="flex items-center gap-2">
                    <div
                      class="w-8 h-8 rounded-md bg-[var(--color-surface-elevated)] flex items-center justify-center shrink-0 overflow-hidden"
                    >
                      @if (item.product_image_url) {
                        <img
                          [src]="item.product_image_url"
                          [alt]="item.product_name"
                          class="w-full h-full object-cover"
                        />
                      } @else {
                        <app-icon name="package" [size]="14" color="var(--color-text-muted)"></app-icon>
                      }
                    </div>

                    <div class="flex-1 min-w-0">
                      <p class="font-medium text-sm text-[var(--color-text-primary)] truncate">
                        {{ item.product_name }}
                      </p>
                      @if (item.product_sku) {
                        <p class="text-xs text-[var(--color-text-muted)] truncate">
                          {{ item.product_sku }}
                        </p>
                      }
                    </div>

                    <!-- Quantity -->
                    <app-input
                      type="number"
                      size="sm"
                      [min]="1"
                      [ngModel]="item.dispatched_quantity"
                      (ngModelChange)="onQtyChange(i, $event)"
                      customClasses="w-16"
                    ></app-input>

                    <!-- Line total -->
                    <span class="text-sm font-semibold text-[var(--color-text-primary)] shrink-0 min-w-[60px] text-right">
                      {{ item.unit_price * item.dispatched_quantity | currency }}
                    </span>

                    <!-- Remove -->
                    <button
                      type="button"
                      class="p-1.5 rounded-md text-[var(--color-text-muted)] hover:text-[var(--color-danger)] hover:bg-[var(--color-danger)]/10 transition-colors shrink-0"
                      (click)="removeItem(i)"
                      aria-label="Eliminar producto"
                    >
                      <app-icon name="x" [size]="14"></app-icon>
                    </button>
                  </div>
                </div>
              }
            </div>

            <!-- Totals -->
            <div
              class="rounded-lg mt-2 p-2.5 space-y-1"
              style="background: color-mix(in srgb, var(--color-primary) 6%, var(--color-surface));"
            >
              <div class="flex justify-between text-xs">
                <span class="text-[var(--color-text-secondary)]">Subtotal</span>
                <span class="text-[var(--color-text-primary)]">
                  {{ wizardService.totals().subtotal | currency }}
                </span>
              </div>
              @if (wizardService.totals().tax > 0) {
                <div class="flex justify-between text-xs">
                  <span class="text-[var(--color-text-secondary)]">Impuestos</span>
                  <span class="text-[var(--color-text-primary)]">
                    {{ wizardService.totals().tax | currency }}
                  </span>
                </div>
              }
              <div class="flex justify-between text-sm font-bold pt-1 border-t border-[var(--color-primary)]/15">
                <span class="text-[var(--color-text-primary)]">Total</span>
                <span class="text-[var(--color-primary)]">
                  {{ wizardService.totals().grandTotal | currency }}
                </span>
              </div>
            </div>
          </div>
        } @else if (
          !loading() &&
          !parsing() &&
          !scanning() &&
          searchResults().length === 0 &&
          pendingLinks().length === 0
        ) {
          <app-empty-state
            icon="package"
            title="Sin productos"
            [description]="emptyStateDescription()"
          ></app-empty-state>
        }
      </app-wizard-step-section>

      <!-- ═══ BODEGA + ENTREGA ═══ -->
      <app-wizard-step-section
        icon="warehouse"
        title="Bodega de origen"
        subtitle="Desde qué bodega salen los ítems y cuándo se entregan"
        [dense]="true"
      >
        <form [formGroup]="detailsForm" class="space-y-3">
          <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
            <app-selector
              label="Bodega de despacho"
              formControlName="dispatch_location_id"
              placeholder="Selecciona bodega..."
              [options]="locationOptions()"
              [required]="true"
            ></app-selector>

            <app-input
              type="date"
              label="Fecha acordada de entrega"
              formControlName="agreed_delivery_date"
            ></app-input>
          </div>

          @if (notesExpanded()) {
            <div class="space-y-2">
              <button
                type="button"
                class="inline-flex items-center gap-1.5 text-xs font-medium
                       text-[var(--color-text-secondary)] hover:text-[var(--color-primary)] transition-colors"
                (click)="notesExpanded.set(false)"
              >
                <app-icon name="sticky-note" [size]="14"></app-icon>
                Notas
                <app-icon name="chevron-up" [size]="14"></app-icon>
              </button>
              <app-textarea
                label="Notas"
                formControlName="notes"
                placeholder="Notas visibles en la remisión..."
                [rows]="2"
              ></app-textarea>
              <app-textarea
                label="Notas internas"
                formControlName="internal_notes"
                placeholder="Notas internas, solo visibles para el equipo..."
                [rows]="2"
              ></app-textarea>
            </div>
          } @else {
            <button
              type="button"
              class="inline-flex items-center gap-1.5 text-xs font-medium
                     text-[var(--color-text-secondary)] hover:text-[var(--color-primary)] transition-colors"
              (click)="notesExpanded.set(true)"
            >
              <app-icon name="sticky-note" [size]="14"></app-icon>
              Agregar notas
              <app-icon name="chevron-down" [size]="14"></app-icon>
            </button>
          }
        </form>
      </app-wizard-step-section>
    </div>
  `,
})
export class ItemPickerStepComponent {
  readonly wizardService = inject(DispatchNoteWizardService);
  private readonly productService = inject(PosProductService);
  private readonly dispatchService = inject(DispatchNotesService);
  private readonly locationsService = inject(LocationsService);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  // --- Manual search state ---
  readonly searchResults = signal<Product[]>([]);
  readonly loading = signal(false);

  // --- Mode state (Excel/IA only for purchase_receipt) ---
  readonly mode = signal<ImportMode>('manual');
  readonly importEnabled = computed(
    () => this.wizardService.subtype() === 'purchase_receipt',
  );
  readonly effectiveMode = computed<ImportMode>(() =>
    this.importEnabled() ? this.mode() : 'manual',
  );

  // --- Import state ---
  readonly parsing = signal(false);
  readonly scanning = signal(false);
  readonly detectedSupplierName = signal<string | null>(null);
  readonly importWarnings = signal<string[]>([]);

  // --- "Por vincular" state ---
  readonly pendingLinks = signal<PendingLink[]>([]);
  readonly linkResults = signal<Record<string, Product[]>>({});
  readonly linkSearching = signal<Record<string, boolean>>({});

  readonly items = computed(() => this.wizardService.items());

  // --- Bodega / fecha / notas (fusionado desde details-step) ---
  readonly locationOptions = signal<SelectorOption[]>([]);
  readonly notesExpanded = signal<boolean>(
    !!(
      this.wizardService.details().notes ||
      this.wizardService.details().internal_notes
    ),
  );
  readonly detailsForm = new FormGroup({
    agreed_delivery_date: new FormControl<string>('', { nonNullable: true }),
    dispatch_location_id: new FormControl<number | null>(null),
    notes: new FormControl<string>('', { nonNullable: true }),
    internal_notes: new FormControl<string>('', { nonNullable: true }),
  });

  private linkCounter = 0;

  /** Flexible header aliases (normalized, lowercase) → suggestion field. */
  private readonly EXCEL_HEADER_ALIASES: Record<
    'product_name' | 'sku' | 'quantity' | 'unit_price',
    string[]
  > = {
    product_name: [
      'nombre',
      'producto',
      'product',
      'name',
      'descripcion',
      'descripción',
      'item',
      'articulo',
      'artículo',
      'detalle',
    ],
    sku: ['sku', 'codigo', 'código', 'code', 'referencia', 'ref', 'cod'],
    quantity: ['cantidad', 'qty', 'cant', 'quantity', 'unidades', 'und', 'uds'],
    unit_price: [
      'precio',
      'precio unitario',
      'precio_unitario',
      'unit_price',
      'price',
      'valor',
      'valor unitario',
      'costo',
      'vr unitario',
      'vr_unitario',
    ],
  };

  constructor() {
    this.seedDetailsForm();
    this.loadLocations();
    this.syncFormToService();
  }

  // ==========================================================================
  // Mode selector
  // ==========================================================================

  setMode(mode: ImportMode): void {
    this.mode.set(mode);
  }

  modeButtonClass(mode: ImportMode): string {
    return this.effectiveMode() === mode
      ? 'bg-[var(--color-primary)] text-white shadow-sm'
      : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-primary-light)]';
  }

  emptyStateDescription(): string {
    switch (this.effectiveMode()) {
      case 'excel':
        return 'Sube un archivo Excel para importar los productos del recibo.';
      case 'ai':
        return 'Sube una foto o PDF del recibo para detectar los productos.';
      default:
        return 'Busca y selecciona los productos a despachar.';
    }
  }

  // ==========================================================================
  // Bodega / fecha / notas (fusionado desde details-step)
  // ==========================================================================

  private seedDetailsForm(): void {
    const d = this.wizardService.details();
    this.detailsForm.patchValue(
      {
        agreed_delivery_date: d.agreed_delivery_date ?? '',
        dispatch_location_id: d.dispatch_location_id ?? null,
        notes: d.notes ?? '',
        internal_notes: d.internal_notes ?? '',
      },
      { emitEvent: false },
    );
  }

  private loadLocations(): void {
    this.locationsService
      .getLocations({ is_active: true })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response: ApiResponse<InventoryLocation[]>) => {
          const locations = response.data ?? [];
          this.locationOptions.set(
            locations.map((loc) => ({
              value: loc.id,
              label: loc.name,
              description: loc.code || undefined,
            })),
          );
        },
        error: () => this.locationOptions.set([]),
      });
  }

  private syncFormToService(): void {
    this.detailsForm.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((values) => {
        const locId = values.dispatch_location_id ?? undefined;
        const selected = this.locationOptions().find((o) => o.value === locId);
        this.wizardService.setDetails({
          agreed_delivery_date: values.agreed_delivery_date || undefined,
          dispatch_location_id: locId,
          dispatch_location_name: selected?.label || undefined,
          notes: values.notes || undefined,
          internal_notes: values.internal_notes || undefined,
        });
      });
  }

  // ==========================================================================
  // Manual search (unchanged)
  // ==========================================================================

  onSearch(query: string): void {
    if (!query || !query.trim()) {
      this.searchResults.set([]);
      return;
    }
    this.loading.set(true);
    this.productService
      .searchProducts({ search: query.trim(), include_stock: true }, 1, 10)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result: any) => {
          this.searchResults.set(result.products || []);
          this.loading.set(false);
        },
        error: () => {
          this.searchResults.set([]);
          this.loading.set(false);
        },
      });
  }

  addProduct(product: Product): void {
    const price = Number(product.final_price || product.price) || 0;

    // Avoid duplicate adds (same product_id + variant_id).
    const variantId = product.product_variants?.[0]?.id;
    if (this.itemExists(Number(product.id), variantId)) return;

    // Calculate tax from product tax assignments.
    let taxRate = 0;
    if (product.tax_assignments?.length) {
      for (const assignment of product.tax_assignments) {
        const rates = assignment.tax_categories?.tax_rates || [];
        for (const rate of rates) {
          taxRate += Number(rate.rate) || 0;
        }
      }
    }
    const taxAmount = price * (taxRate / 100);

    const item: WizardItem = {
      product_id: Number(product.id),
      product_name: product.name,
      product_sku: product.sku,
      product_image_url: product.image_url || product.image,
      product_variant_id: variantId,
      requires_serial_numbers: !!product.requires_serial_numbers,
      ordered_quantity: 1,
      pending_quantity: 9999,
      dispatched_quantity: 1,
      unit_price: price,
      discount_amount: 0,
      tax_amount: taxAmount,
    };

    this.wizardService.addItem(item);
    this.searchResults.set([]);
  }

  onQtyChange(index: number, value: number | string | null): void {
    const n = typeof value === 'string' ? parseInt(value, 10) : (value ?? 0);
    this.wizardService.updateFreeItemQuantity(index, isNaN(n) ? 0 : n);
  }

  removeItem(index: number): void {
    this.wizardService.removeItem(index);
  }

  trackByItem(item: WizardItem, index: number): string {
    return `${item.product_id}-${item.product_variant_id ?? 'none'}-${index}`;
  }

  // ==========================================================================
  // IA — receipt scan
  // ==========================================================================

  onAiSelected(event: Event, input: HTMLInputElement): void {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;

    this.scanning.set(true);
    this.dispatchService
      .scanReceipt(file)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          this.scanning.set(false);
          this.detectedSupplierName.set(result.supplier_name ?? null);
          this.importWarnings.set(result.warnings ?? []);
          const suggestions = (result.items ?? []).map(
            (it: ReceiptScanItem): ReceiptSuggestion => ({
              product_name: it.product_name,
              sku: it.sku,
              quantity: it.quantity,
              unit_price: it.unit_price,
              matched_product_id: it.matched_product_id,
              matched_variant_id: it.matched_variant_id,
              confidence: it.match_confidence,
            }),
          );
          // IA carries backend matches; unmatched go straight to "por vincular".
          this.ingest(suggestions, { autoMatchBySku: false });
          const total = suggestions.length;
          if (total === 0) {
            this.toast.warning('El recibo no arrojó líneas de producto.');
          } else {
            this.toast.success(`Recibo escaneado: ${total} línea(s) detectada(s).`);
          }
        },
        error: (err) => {
          this.scanning.set(false);
          this.toast.error(err?.message || 'No se pudo escanear el recibo.');
        },
      });
  }

  // ==========================================================================
  // Excel — client-side parse (SheetJS)
  // ==========================================================================

  onExcelSelected(event: Event, input: HTMLInputElement): void {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;

    const ext = '.' + (file.name.split('.').pop()?.toLowerCase() ?? '');
    if (!['.xlsx', '.xls', '.csv'].includes(ext)) {
      this.toast.error('Selecciona un archivo .xlsx, .xls o .csv válido.');
      return;
    }

    this.parsing.set(true);
    const reader = new FileReader();
    reader.onload = (e: any) => {
      try {
        const wb: XLSX.WorkBook = XLSX.read(e.target.result, { type: 'binary' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(ws, { header: 1 }) as any[][];
        this.parsing.set(false);

        if (!rows || rows.length < 2) {
          this.toast.error('El archivo debe tener encabezados y al menos una fila.');
          return;
        }

        const headerMap = this.mapExcelHeaders(rows[0] as any[]);
        if (headerMap.product_name === undefined) {
          this.toast.error('No se encontró una columna de nombre/producto.');
          return;
        }

        const suggestions: ReceiptSuggestion[] = [];
        const warnings: string[] = [];
        for (let i = 1; i < rows.length; i++) {
          const row = rows[i] as any[];
          if (!row || row.length === 0) continue;
          const name = this.cell(row, headerMap.product_name);
          if (!name) continue;
          const qty = this.toNumber(this.cell(row, headerMap.quantity));
          const price = this.toNumber(this.cell(row, headerMap.unit_price));
          if (qty === null || qty <= 0) {
            warnings.push(`Fila ${i + 1}: "${name}" sin cantidad válida (se usa 1).`);
          }
          suggestions.push({
            product_name: name,
            sku: this.cell(row, headerMap.sku) || null,
            quantity: qty !== null && qty > 0 ? qty : 1,
            unit_price: price,
            matched_product_id: null,
            matched_variant_id: null,
            confidence: 'none',
          });
        }

        if (suggestions.length === 0) {
          this.toast.warning('No se encontraron filas con productos.');
          return;
        }

        this.detectedSupplierName.set(null);
        this.importWarnings.set(warnings);
        // Excel has no backend match → auto-match by exact SKU, rest to "por vincular".
        this.ingest(suggestions, { autoMatchBySku: true });
        this.toast.success(`Excel procesado: ${suggestions.length} línea(s).`);
      } catch {
        this.parsing.set(false);
        this.toast.error('No se pudo leer el archivo Excel.');
      }
    };
    reader.onerror = () => {
      this.parsing.set(false);
      this.toast.error('Error al leer el archivo.');
    };
    reader.readAsBinaryString(file);
  }

  private mapExcelHeaders(rawHeaders: any[]): Partial<
    Record<'product_name' | 'sku' | 'quantity' | 'unit_price', number>
  > {
    const map: Partial<
      Record<'product_name' | 'sku' | 'quantity' | 'unit_price', number>
    > = {};
    rawHeaders.forEach((h, index) => {
      if (h === undefined || h === null) return;
      const normalized = String(h).trim().toLowerCase();
      (Object.keys(this.EXCEL_HEADER_ALIASES) as Array<keyof typeof this.EXCEL_HEADER_ALIASES>).forEach(
        (field) => {
          if (map[field] !== undefined) return;
          const aliases = this.EXCEL_HEADER_ALIASES[field];
          if (aliases.includes(normalized) || aliases.some((a) => normalized.includes(a))) {
            map[field] = index;
          }
        },
      );
    });
    return map;
  }

  private cell(row: any[], index: number | undefined): string {
    if (index === undefined) return '';
    const v = row[index];
    return v === undefined || v === null ? '' : String(v).trim();
  }

  private toNumber(raw: string): number | null {
    if (!raw) return null;
    // Strip currency symbols / thousand separators, tolerate comma decimals.
    const cleaned = raw.replace(/[^0-9.,-]/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.');
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  }

  // ==========================================================================
  // Resolution flow (shared by IA + Excel)
  // ==========================================================================

  private ingest(
    suggestions: ReceiptSuggestion[],
    opts: { autoMatchBySku: boolean },
  ): void {
    const unmatched: ReceiptSuggestion[] = [];
    for (const s of suggestions) {
      if (s.matched_product_id != null) {
        this.addSuggestionDirect(s);
      } else {
        unmatched.push(s);
      }
    }

    if (!opts.autoMatchBySku) {
      this.queuePending(unmatched);
      return;
    }

    const withSku = unmatched.filter((s) => !!s.sku && !!s.sku.trim());
    const withoutSku = unmatched.filter((s) => !(s.sku && s.sku.trim()));

    if (withSku.length === 0) {
      this.queuePending(withoutSku);
      return;
    }

    forkJoin(
      withSku.map((s) =>
        this.runSearch(s.sku!.trim()).pipe(map((products) => ({ s, products }))),
      ),
    )
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((results) => {
        const stillPending = [...withoutSku];
        for (const { s, products } of results) {
          const exact = products.find(
            (p) => (p.sku || '').trim().toLowerCase() === s.sku!.trim().toLowerCase(),
          );
          if (exact && !this.itemExists(Number(exact.id), exact.product_variants?.[0]?.id)) {
            this.wizardService.addItem(this.itemFromProduct(exact, s.quantity, s.unit_price));
          } else if (exact) {
            // exact match but already added — skip.
          } else {
            stillPending.push(s);
          }
        }
        this.queuePending(stillPending);
      });
  }

  /** Add a suggestion that already carries a backend `matched_product_id`. */
  private addSuggestionDirect(s: ReceiptSuggestion): void {
    const productId = s.matched_product_id!;
    const variantId = s.matched_variant_id ?? undefined;
    if (this.itemExists(productId, variantId)) return;
    const qty = s.quantity > 0 ? s.quantity : 1;
    const price = s.unit_price != null && s.unit_price >= 0 ? s.unit_price : 0;
    this.wizardService.addItem({
      product_id: productId,
      product_name: s.product_name,
      product_sku: s.sku ?? undefined,
      product_variant_id: variantId,
      requires_serial_numbers: false,
      ordered_quantity: qty,
      pending_quantity: 9999,
      dispatched_quantity: qty,
      unit_price: price,
      discount_amount: 0,
      tax_amount: 0,
    });
  }

  /** Push suggestions to the "por vincular" list and prefill their searches. */
  private queuePending(suggestions: ReceiptSuggestion[]): void {
    if (suggestions.length === 0) return;
    const links: PendingLink[] = suggestions.map((s) => ({
      id: `lnk-${++this.linkCounter}`,
      product_name: s.product_name,
      sku: s.sku,
      quantity: s.quantity > 0 ? s.quantity : 1,
      unit_price: s.unit_price,
      confidence: s.confidence,
    }));
    this.pendingLinks.update((cur) => [...cur, ...links]);
    // Prefill each row with a best-effort search (sku first, then name).
    for (const link of links) {
      this.prefillLink(link);
    }
  }

  private prefillLink(link: PendingLink): void {
    const query = (link.sku && link.sku.trim()) || link.product_name;
    if (!query) return;
    this.setLinkSearching(link.id, true);
    this.runSearch(query)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((products) => {
        this.setLinkResults(link.id, products);
        this.setLinkSearching(link.id, false);
      });
  }

  onLinkSearch(id: string, query: string): void {
    if (!query || !query.trim()) {
      this.setLinkResults(id, []);
      return;
    }
    this.setLinkSearching(id, true);
    this.runSearch(query.trim())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((products) => {
        this.setLinkResults(id, products);
        this.setLinkSearching(id, false);
      });
  }

  /** Resolve a pending line to a chosen catalog product → WizardItem. */
  linkProduct(link: PendingLink, product: Product): void {
    const variantId = product.product_variants?.[0]?.id;
    if (!this.itemExists(Number(product.id), variantId)) {
      this.wizardService.addItem(
        this.itemFromProduct(product, link.quantity, link.unit_price, link.sku),
      );
    }
    this.discardLink(link.id);
  }

  discardLink(id: string): void {
    this.pendingLinks.update((cur) => cur.filter((l) => l.id !== id));
    this.linkResults.update((cur) => {
      const next = { ...cur };
      delete next[id];
      return next;
    });
    this.linkSearching.update((cur) => {
      const next = { ...cur };
      delete next[id];
      return next;
    });
  }

  // ==========================================================================
  // Helpers
  // ==========================================================================

  private runSearch(query: string) {
    return this.productService
      .searchProducts({ search: query, include_stock: true }, 1, 8)
      .pipe(
        map((result: any) => (result?.products ?? []) as Product[]),
        catchError(() => of([] as Product[])),
      );
  }

  private itemFromProduct(
    product: Product,
    quantity: number,
    unitPrice: number | null,
    skuFallback?: string | null,
  ): WizardItem {
    const variantId = product.product_variants?.[0]?.id;
    const qty = quantity > 0 ? quantity : 1;
    const price =
      unitPrice != null && unitPrice >= 0
        ? unitPrice
        : Number(product.final_price || product.price) || 0;
    return {
      product_id: Number(product.id),
      product_name: product.name,
      product_sku: product.sku || skuFallback || undefined,
      product_image_url: product.image_url || product.image,
      product_variant_id: variantId,
      requires_serial_numbers: !!product.requires_serial_numbers,
      ordered_quantity: qty,
      pending_quantity: 9999,
      dispatched_quantity: qty,
      unit_price: price,
      discount_amount: 0,
      tax_amount: 0,
    };
  }

  private itemExists(productId: number, variantId?: number): boolean {
    return this.wizardService
      .items()
      .some((i) => i.product_id === productId && i.product_variant_id === variantId);
  }

  private setLinkResults(id: string, products: Product[]): void {
    this.linkResults.update((cur) => ({ ...cur, [id]: products }));
  }

  private setLinkSearching(id: string, value: boolean): void {
    this.linkSearching.update((cur) => ({ ...cur, [id]: value }));
  }

  confidenceLabel(c: 'high' | 'low' | 'none'): string {
    return c === 'high' ? 'Alta' : c === 'low' ? 'Baja' : 'Sin match';
  }

  confidenceBadgeClass(c: 'high' | 'low' | 'none'): string {
    if (c === 'high') {
      return 'bg-[color-mix(in_srgb,var(--color-success)_18%,transparent)] text-[var(--color-success)]';
    }
    if (c === 'low') {
      return 'bg-[color-mix(in_srgb,var(--color-warning)_18%,transparent)] text-[var(--color-warning)]';
    }
    return 'bg-[var(--color-surface-elevated)] text-[var(--color-text-muted)]';
  }
}
