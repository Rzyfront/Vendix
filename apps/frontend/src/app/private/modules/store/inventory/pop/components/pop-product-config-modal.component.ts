import {
  Component,
  input,
  output,
  signal,
  computed,
  effect,
  inject,
  viewChild,
  DestroyRef,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import {
  FormBuilder,
  FormGroup,
  FormsModule,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { ModalComponent } from '../../../../../../shared/components/modal/modal.component';
import {
  ScrollableTabsComponent,
  ScrollableTab,
} from '../../../../../../shared/components/scrollable-tabs/scrollable-tabs.component';
import { SettingToggleComponent } from '../../../../../../shared/components/setting-toggle/setting-toggle.component';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { ButtonComponent } from '../../../../../../shared/components/button/button.component';
import { InputComponent } from '../../../../../../shared/components/input/input.component';
import { TextareaComponent } from '../../../../../../shared/components/textarea/textarea.component';
import { CurrencyFormatService } from '../../../../../../shared/pipes/currency';
import { ProductsService } from '../../../products/services/products.service';
import { UomService } from '../../services/uom.service';
import { AuthFacade } from '../../../../../../core/store/auth/auth.facade';
import { ToastService } from '../../../../../../shared/components/toast/toast.service';
import { StoreSettingsFacade } from '../../../../../../core/store/store-settings/store-settings.facade';
import {
  PopProduct,
  PopProductVariant,
  LotInfo,
  PopProductConfigResult,
  PopProductModalResult,
  PreBulkData,
} from '../interfaces/pop-cart.interface';
import {
  PopUomCaptureComponent,
  PopUomCaptureResult,
} from './pop-uom-capture.component';

// Re-export for backward compatibility with consumers that imported the
// type from the modal file. The canonical declaration now lives in
// `interfaces/pop-cart.interface.ts` so the discriminated union
// `PopProductModalResult` can reference it.
export type { PopProductConfigResult };

@Component({
  selector: 'app-pop-product-config-modal',
  standalone: true,
  imports: [
    FormsModule,
    ReactiveFormsModule,
    ModalComponent,
    ScrollableTabsComponent,
    SettingToggleComponent,
    IconComponent,
    ButtonComponent,
    InputComponent,
    TextareaComponent,
    PopUomCaptureComponent,
  ],
  template: `
    <app-modal
      [isOpen]="isOpen()"
      title="Configurar producto"
      [subtitle]="product()?.name"
      size="md"
      (closed)="onClose()"
      (cancel)="onClose()"
    >
      <!-- Tabs -->
      <div class="flex flex-col gap-4">
        <app-scrollable-tabs
          [tabs]="tabItems()"
          [activeTab]="activeTab()"
          size="sm"
          (tabChange)="activeTab.set($event)"
        ></app-scrollable-tabs>

        <!-- Tab: General -->
        @if (activeTab() === 'general') {
          <div class="flex flex-col gap-4">
            <!-- Product info card (configure mode only) -->
            @if (configureMode()) {
              <div
                class="flex items-center gap-3 p-3 rounded-xl bg-muted/30 border border-border/50"
              >
                <div
                  class="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0"
                >
                  <app-icon
                    name="package"
                    [size]="20"
                    class="text-primary"
                  ></app-icon>
                </div>
                <div class="flex-1 min-w-0">
                  <p class="text-sm font-medium text-text-primary truncate">
                    {{ product()?.name }}
                  </p>
                  <div class="flex items-center gap-3 mt-0.5">
                    @if (product()?.code) {
                      <span class="text-xs text-muted font-mono"
                        >SKU: {{ product()?.code }}</span
                      >
                    }
                    <span class="text-xs font-semibold text-text-primary">
                      Costo:
                      {{
                        formatCurrency(
                          +(product()?.cost || product()?.cost_price || 0)
                        )
                      }}
                    </span>
                  </div>
                </div>
              </div>
            }

            <!-- Identity form (create mode only) -->
            @if (createMode()) {
              <form
                [formGroup]="identityForm"
                class="rounded-xl border border-border/50 bg-muted/20 p-3 space-y-3"
                data-testid="pop-create-identity"
              >
                <p
                  class="text-[10px] text-muted uppercase font-bold tracking-wider"
                >
                  Identidad del producto
                </p>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div class="md:col-span-2">
                    <app-input
                      label="Nombre del Producto"
                      formControlName="name"
                      placeholder="Ej: Material genérico"
                      [required]="true"
                    ></app-input>
                  </div>
                  <app-input
                    label="SKU / Código"
                    formControlName="code"
                    placeholder="Ej: MAN-001"
                    [required]="true"
                  ></app-input>
                  <app-input
                    label="Descripción corta"
                    formControlName="description"
                    placeholder="Opcional"
                  ></app-input>
                </div>

                <!-- Retail vs ingredient classification (only when the
                     store supports ingredients; mirrors prebulk-modal) -->
                @if (storeSupportsIngredients()) {
                  <div class="pt-1">
                    <app-setting-toggle
                      label="Es un insumo"
                      description="Marca este producto como insumo para recetas. Dejará de venderse directamente y se medirá por unidades de compra y stock."
                      [ngModel]="isIngredient()"
                      (changed)="onIngredientToggle($event)"
                    ></app-setting-toggle>
                  </div>
                }

                <!-- Retail: precio venta + costo + cantidad en el form.
                     Insumo: costo y cantidad los captura el bloque
                     app-pop-uom-capture (bidireccional), para no duplicar
                     ni desincronizar la cantidad del lote. -->
                @if (!isIngredient()) {
                  <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <app-input
                      label="Precio de Venta"
                      [currency]="true"
                      formControlName="basePrice"
                      prefix="$"
                      placeholder="0.00"
                      tooltipText="Opcional: precio de referencia para ventas"
                    ></app-input>
                    <app-input
                      label="Costo unitario"
                      [currency]="true"
                      formControlName="unitCost"
                      prefix="$"
                      placeholder="0.00"
                      [required]="true"
                    ></app-input>
                  </div>

                  <div class="md:max-w-[14rem]">
                    <app-input
                      label="Cantidad"
                      type="number"
                      formControlName="quantity"
                      placeholder="1"
                      [required]="true"
                    ></app-input>
                  </div>
                  <app-textarea
                    label="Notas"
                    formControlName="notes"
                    placeholder="Notas adicionales..."
                    [rows]="2"
                  ></app-textarea>
                } @else {
                  <app-textarea
                    label="Notas"
                    formControlName="notes"
                    placeholder="Notas adicionales..."
                    [rows]="1"
                  ></app-textarea>
                }
              </form>
            }

            <!-- Sale UoM selector. Excluyente con la captura de consumo:
                 se muestra solo para producto retail (no insumo) en ambos
                 modos. Insumo → bloque app-pop-uom-capture (abajo). -->
            @if (!ingredientMode()) {
              <div>
                <label class="block text-sm font-medium text-text-primary mb-2"
                  >Unidad de medida</label
                >
                <div class="flex gap-2">
                  <button
                    class="flex-1 px-3 py-2 rounded-lg border text-sm font-medium transition-all"
                    [class]="
                      selectedPricingType() === 'unit'
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-border bg-surface text-text-secondary hover:border-primary/50'
                    "
                    (click)="selectedPricingType.set('unit')"
                  >
                    Unidad
                  </button>
                  <button
                    class="flex-1 px-3 py-2 rounded-lg border text-sm font-medium transition-all"
                    [class]="
                      selectedPricingType() === 'weight'
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-border bg-surface text-text-secondary hover:border-primary/50'
                    "
                    (click)="selectedPricingType.set('weight')"
                  >
                    Peso (kg)
                  </button>
                </div>
              </div>
            }

            <!-- Fase 3+5: UoM-aware cost capture (shared sub-component, bidirectional). -->
            @if (ingredientMode()) {
              <app-pop-uom-capture
                [isIngredient]="true"
                [initialPurchaseUomId]="purchaseUomId()"
                [initialStockUomId]="stockUomId()"
                [initialUnitCost]="initialUnitCost()"
                [initialQuantity]="configureMode() ? 1 : createQuantity()"
                (changed)="onUomCaptureChanged($event)"
              ></app-pop-uom-capture>
            }

            <!-- Toggles (variants only in configure mode) -->
            <div
              class="grid grid-cols-1 gap-3"
              [class.md:grid-cols-2]="configureMode()"
            >
              @if (configureMode()) {
                <app-setting-toggle
                  label="Gestionar variantes"
                  [description]="
                    productHasVariants
                      ? 'Seleccionar variantes del producto para la orden'
                      : 'Crear variantes para este producto'
                  "
                  [ngModel]="hasVariantsToggle()"
                  (changed)="hasVariantsToggle.set($event)"
                ></app-setting-toggle>
              }

              <app-setting-toggle
                label="Gestionar lote"
                description="Asignar número de lote y fechas de fabricación/vencimiento"
                [ngModel]="requiresLotToggle()"
                (changed)="requiresLotToggle.set($event)"
                [class.md:col-span-2]="!configureMode()"
              ></app-setting-toggle>
            </div>
          </div>
        }

        <!-- Tab: Variantes -->
        @if (activeTab() === 'variants' && configureMode()) {
          @if (isCreatingVariants()) {
            <!-- Variant Creation Mode -->
            <div class="flex flex-col gap-3">
              <!-- Quick Attribute Buttons -->
              <div class="flex flex-wrap gap-2">
                <button
                  type="button"
                  (click)="addQuickAttribute('Color')"
                  class="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg border border-dashed border-primary/30 text-primary bg-primary/5 hover:bg-primary/10 transition-colors"
                >
                  <app-icon name="plus" [size]="12"></app-icon> Color
                </button>
                <button
                  type="button"
                  (click)="addQuickAttribute('Talla')"
                  class="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg border border-dashed border-primary/30 text-primary bg-primary/5 hover:bg-primary/10 transition-colors"
                >
                  <app-icon name="plus" [size]="12"></app-icon> Talla
                </button>
                <button
                  type="button"
                  (click)="addQuickAttribute('Material')"
                  class="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg border border-dashed border-primary/30 text-primary bg-primary/5 hover:bg-primary/10 transition-colors"
                >
                  <app-icon name="plus" [size]="12"></app-icon> Material
                </button>
                <button
                  type="button"
                  (click)="addAttribute()"
                  class="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg border border-dashed border-border text-text-secondary bg-muted/30 hover:bg-muted/50 transition-colors"
                >
                  <app-icon name="plus" [size]="12"></app-icon> Personalizado
                </button>
              </div>

              <!-- Attribute Editor -->
              @for (attr of variantAttributes; track $index) {
                <div class="p-3 bg-muted/20 rounded-xl border border-border/50">
                  <div class="flex items-start gap-2">
                    <div class="flex-1">
                      <app-input
                        type="text"
                        size="sm"
                        [(ngModel)]="attr.name"
                        placeholder="Nombre (ej: Color)"
                        (inputBlur)="generateNewVariants()"
                      ></app-input>
                    </div>
                    <button
                      (click)="removeAttribute(variantAttributes.indexOf(attr))"
                      class="p-1.5 text-destructive/70 hover:text-destructive transition-colors"
                    >
                      <app-icon name="trash-2" [size]="16"></app-icon>
                    </button>
                  </div>
                  <div class="mt-2">
                    <div
                      class="flex flex-wrap gap-1.5 px-2.5 py-1.5 bg-surface rounded-lg border border-border min-h-[34px] focus-within:ring-1 focus-within:ring-primary focus-within:border-primary transition-colors"
                    >
                      @for (val of attr.values; track $index) {
                        <span
                          class="inline-flex items-center px-2 py-0.5 rounded bg-primary/10 text-primary border border-primary/20 text-xs font-medium"
                        >
                          {{ val }}
                          <button
                            type="button"
                            (click)="
                              removeAttributeValue(
                                variantAttributes.indexOf(attr),
                                $index
                              )
                            "
                            class="ml-1 text-primary/70 hover:text-primary"
                          >
                            &times;
                          </button>
                        </span>
                      }
                      <input
                        type="text"
                        class="flex-1 border-none p-0 text-sm focus:ring-0 focus:outline-none min-w-[80px] bg-transparent text-text-primary placeholder:text-muted"
                        [placeholder]="
                          attr.values.length === 0
                            ? 'Escribe y presiona Enter'
                            : 'Agregar...'
                        "
                        (keydown.enter)="
                          $event.preventDefault();
                          addAttributeValue(
                            variantAttributes.indexOf(attr),
                            $event
                          )
                        "
                        (blur)="
                          addAttributeValue(
                            variantAttributes.indexOf(attr),
                            $event
                          )
                        "
                      />
                    </div>
                  </div>
                </div>
              }

              <!-- Preview + Generate -->
              @if (previewVariantCount > 0) {
                <div
                  class="flex items-center justify-between p-2.5 bg-primary/5 border border-primary/15 rounded-xl"
                >
                  <div class="flex items-center gap-2">
                    <app-icon
                      name="layers"
                      [size]="16"
                      class="text-primary"
                    ></app-icon>
                    <span class="text-xs font-medium text-primary">
                      Se generarán
                      <strong>{{ previewVariantCount }}</strong> variantes
                    </span>
                  </div>
                  <button
                    (click)="generateNewVariants()"
                    class="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg bg-primary text-[var(--color-text-on-primary)] hover:bg-primary/90 transition-colors"
                  >
                    <app-icon name="zap" [size]="12"></app-icon> Generar
                  </button>
                </div>
              }

              <!-- Generated Variants List -->
              @if (generatedVariants.length > 0) {
                <div class="flex flex-col gap-1.5">
                  <span class="text-xs font-medium text-muted px-1">
                    {{ generatedVariants.length }} variantes generadas
                  </span>
                  @for (variant of generatedVariants; track $index) {
                    <div
                      class="flex items-center gap-3 p-2.5 rounded-xl border border-border/50 bg-surface"
                    >
                      <div
                        class="w-8 h-8 rounded-lg bg-primary/10 flex-shrink-0 flex items-center justify-center"
                      >
                        <app-icon
                          name="layers"
                          [size]="14"
                          class="text-primary"
                        ></app-icon>
                      </div>
                      <div class="flex-1 min-w-0">
                        <p
                          class="font-medium text-xs text-text-primary truncate"
                        >
                          {{ variant.name }}
                        </p>
                        <p class="text-[10px] text-muted font-mono">
                          {{ variant.sku }}
                        </p>
                      </div>
                      <div class="flex-shrink-0 w-24">
                        <app-input
                          type="number"
                          size="sm"
                          [currency]="true"
                          prefix="$"
                          min="0"
                          [(ngModel)]="variant.cost_price"
                        ></app-input>
                      </div>
                    </div>
                  }
                </div>
              }

              @if (variantAttributes.length === 0) {
                <p class="text-sm text-muted text-center py-4">
                  Agrega atributos para crear variantes del producto.
                </p>
              }
            </div>
          } @else {
            <!-- Existing Variant Selection Mode -->
            <div class="flex flex-col gap-2">
              @if (!isEditing()) {
                <div class="flex items-center justify-between px-1 pb-1">
                  <span class="text-xs text-muted">
                    {{ selectedVariantIds.size }} de
                    {{ product()?.product_variants?.length }} seleccionadas
                  </span>
                  <button
                    class="text-xs font-medium text-primary hover:text-primary/80 transition-colors"
                    (click)="toggleSelectAllVariants()"
                  >
                    {{
                      allVariantsSelected
                        ? 'Deseleccionar todas'
                        : 'Seleccionar todas'
                    }}
                  </button>
                </div>
              }

              @for (variant of product()?.product_variants; track variant.id) {
                <button
                  class="w-full flex items-center gap-3 p-3 rounded-xl border transition-all text-left"
                  [class]="
                    isVariantSelected(variant.id)
                      ? 'border-primary bg-primary/5 ring-1 ring-primary'
                      : 'border-border hover:border-primary hover:bg-primary/5 cursor-pointer active:scale-[0.98]'
                  "
                  (click)="onToggleVariant(variant)"
                >
                  <div
                    class="w-5 h-5 rounded flex-shrink-0 flex items-center justify-center border transition-all"
                    [class]="
                      isVariantSelected(variant.id)
                        ? 'bg-primary border-primary'
                        : 'border-border bg-surface'
                    "
                    [class.rounded-full]="isEditing()"
                    [class.rounded-md]="!isEditing()"
                  >
                    @if (isVariantSelected(variant.id)) {
                      <app-icon
                        name="check"
                        [size]="12"
                        class="text-[var(--color-text-on-primary)]"
                      ></app-icon>
                    }
                  </div>

                  <div
                    class="w-10 h-10 rounded-lg bg-muted/50 flex-shrink-0 flex items-center justify-center"
                  >
                    <app-icon
                      name="layers"
                      [size]="18"
                      class="text-muted"
                    ></app-icon>
                  </div>
                  <div class="flex-1 min-w-0">
                    <p class="font-medium text-sm text-text-primary truncate">
                      {{ getVariantLabel(variant) }}
                    </p>
                    <p class="text-xs text-muted font-mono mt-0.5">
                      SKU: {{ variant.sku }}
                    </p>
                  </div>
                  <div class="flex flex-col items-end flex-shrink-0">
                    @if (variant.cost_price) {
                      <span class="font-bold text-sm text-text-primary">
                        {{ formatCurrency(+variant.cost_price) }}
                      </span>
                    }
                    @if (variant.stock_quantity !== undefined) {
                      <span
                        class="text-xs mt-0.5"
                        [class]="
                          isVariantLowStock(variant)
                            ? 'text-warning'
                            : 'text-muted'
                        "
                      >
                        {{ variant.stock_quantity }} disp.
                      </span>
                    }
                  </div>
                </button>
              }

              @if (!product()?.product_variants?.length) {
                <p class="text-sm text-muted text-center py-4">
                  Este producto no tiene variantes configuradas.
                </p>
              }
            </div>
          }
        }

        <!-- Tab: Lote -->
        @if (activeTab() === 'lot') {
          <div class="space-y-4">
            <div>
              <label class="block text-sm font-medium text-text-primary mb-1.5">
                Número de lote
              </label>
              <app-input
                type="text"
                size="sm"
                placeholder="Ej: LOTE-2026-001"
                [(ngModel)]="lotBatchNumber"
              ></app-input>
            </div>

            <div class="grid grid-cols-2 gap-3">
              <div>
                <label
                  class="block text-sm font-medium text-text-primary mb-1.5"
                >
                  Fecha de fabricación
                </label>
                <app-input
                  type="date"
                  size="sm"
                  [(ngModel)]="lotManufacturingDate"
                ></app-input>
              </div>
              <div>
                <label
                  class="block text-sm font-medium text-text-primary mb-1.5"
                >
                  Fecha de vencimiento
                </label>
                <app-input
                  type="date"
                  size="sm"
                  [(ngModel)]="lotExpirationDate"
                ></app-input>
              </div>
            </div>

            <p class="text-xs text-muted">
              Estos datos se enviarán al proveedor con la orden de compra.
            </p>
          </div>
        }
      </div>

      <!-- Footer -->
      <div slot="footer" class="flex items-center justify-end gap-3">
        <app-button variant="outline" size="sm" (clicked)="onClose()">
          Cancelar
        </app-button>
        <app-button
          variant="primary"
          size="sm"
          (clicked)="onConfirm()"
          [disabled]="!canConfirm()"
        >
          {{ confirmLabel }}
        </app-button>
      </div>
    </app-modal>
  `,
  styles: [
    `
      :host {
        display: contents;
      }
    `,
  ],
})
export class PopProductConfigModalComponent {
  private destroyRef = inject(DestroyRef);
  private fb = inject(FormBuilder);
  readonly isOpen = input(false);
  readonly product = input<PopProduct | null>(null);
  readonly initialVariant = input<PopProductVariant | null>(null);
  readonly initialLotInfo = input<LotInfo | null>(null);
  readonly initialPricingType = input<'unit' | 'weight'>('unit');
  readonly isEditing = input(false);

  /**
   * Unified-modal mode (Fase 5).
   * - 'configure' (default): existing flow — configures a catalog product.
   * - 'create': absorbs the prebulk flow — captures identity + cost + qty
   *   + (optional) UoM and emits a `prebulkData` payload.
   */
  readonly mode = input<'create' | 'configure'>('configure');

  /**
   * F3 IVA lifecycle (factura escaneada): costo unitario NETO sugerido para
   * pre-llenar el campo de costo en create mode. El scanner ya aplastó el
   * bruto a neto (`MatchedLineItem.unit_cost_net`); aquí solo se muestra.
   * `null` (default) => se usa el flujo normal (form / product cost).
   */
  readonly suggestedUnitCostNet = input<number | null>(null);
  /**
   * F3 IVA lifecycle (factura escaneada): tax_category sugerida por match de
   * tasa (`MatchedLineItem.suggested_tax_category_id`). Cuando está presente
   * se propaga a `prebulkData.tax_category_ids` en create mode para que el
   * producto/orden quede con el impuesto correcto. `null` => sin sugerencia.
   */
  readonly suggestedTaxCategoryId = input<number | null>(null);

  readonly confirmed = output<PopProductModalResult>();
  readonly closed = output<void>();

  /** Convenience flags derived from `mode()`. */
  readonly createMode = computed(() => this.mode() === 'create');
  readonly configureMode = computed(() => this.mode() === 'configure');

  // ----------------------------------------------------------------
  // Create-mode state (Fase 5)
  // ----------------------------------------------------------------

  /**
   * Reactive identity + pricing form for create mode. Mirrors the fields
   * from the prebulk-modal so the emitted `prebulkData` is a 1:1 map.
   */
  readonly identityForm: FormGroup = this.fb.group({
    name: ['', [Validators.required, Validators.maxLength(255)]],
    code: ['', [Validators.required, Validators.maxLength(64)]],
    description: [''],
    quantity: [1, [Validators.required, Validators.min(1)]],
    unitCost: [0, [Validators.required, Validators.min(0)]],
    basePrice: [0, [Validators.min(0)]],
    notes: [''],
  });

  /** Create-mode ingredient classification (mirrors prebulk). */
  readonly isIngredient = signal(false);
  readonly isSellable = signal(true);
  /** Live create quantity (read from the form, kept in sync). */
  readonly createQuantity = signal<number>(1);
  /**
   * Initial unit cost shown in `pop-uom-capture` (configure mode).
   * F3 IVA lifecycle: cuando viene de factura escaneada prefiere el NETO
   * sugerido (`suggestedUnitCostNet`) sobre el costo del producto.
   */
  readonly initialUnitCost = computed(() => {
    const suggestedNet = this.suggestedUnitCostNet();
    if (suggestedNet != null && Number.isFinite(suggestedNet) && suggestedNet > 0) {
      return suggestedNet;
    }
    const p: any = this.product();
    return Number(p?.cost || p?.cost_price || 0);
  });

  // Tab state
  activeTab = signal<string>('general');
  hasVariantsToggle = signal(false);
  requiresLotToggle = signal(false);
  selectedPricingType = signal<'unit' | 'weight'>('unit');

  // Multi-variant selection (for adding new items)
  selectedVariantIds = new Set<number>();

  // Lot fields
  lotBatchNumber = '';
  lotManufacturingDate = '';
  lotExpirationDate = '';

  // Variant creation mode
  isCreatingVariants = computed(
    () => this.hasVariantsToggle() && !this.productHasVariants,
  );
  variantAttributes: { name: string; values: string[] }[] = [];
  generatedVariants: {
    name: string;
    sku: string;
    cost_price: number;
    attributes: Record<string, string>;
  }[] = [];
  creatingVariants = signal(false);

  private productsService = inject(ProductsService);
  /**
   * Fase 3: UoM catalog for the unit-aware cost capture. The service is
   * cached internally (shareReplay), so we can call `.getCatalog()`
   * multiple times without re-fetching.
   */
  private uomService = inject(UomService);
  /**
   * Fase 3: capability resolver. Used to decide whether the modal can
   * show the ingredient cost-capture UI at all.
   */
  private authFacade = inject(AuthFacade);
  /**
   * Fase 3: store capability flag (computed). When false, the modal
   * always behaves as `retail` regardless of the product's
   * `is_ingredient` flag.
   */
  readonly storeSupportsIngredients = this.authFacade.storeSupportsIngredients;
  /**
   * Fase 3: UoM catalog. Loaded on first modal open via a cached HTTP
   * call. We store the rows for the unit-aware UI; the service handles
   * caching across modal instances.
   */
  protected readonly uomCatalog = signal<Array<{
    id: number;
    code: string;
    name: string;
    dimension: string;
    factor_to_base: number | string;
    is_active: boolean;
  }>>([]);
  /**
   * Fase 3: per-modal UoM selection. Defaults are derived from the
   * product (if it has stock_uom_id/purchase_uom_id) and stay editable
   * when the product is a pure ingredient.
   */
  readonly purchaseUomId = signal<number | null>(null);
  readonly stockUomId = signal<number | null>(null);
  /**
   * Costo por unidad de compra y cantidad capturados por
   * `<app-pop-uom-capture>`. En configure mode antes se descartaban → el
   * costo del insumo tecleado se perdía al confirmar. Cuando están presentes,
   * `onConfirm` los usa como fuente de verdad del `unit_cost`/`quantity` de la
   * línea del carrito (fallback: costo del producto / 1).
   */
  readonly capturedUnitCost = signal<number | null>(null);
  readonly capturedQuantity = signal<number | null>(null);
  /**
   * F1 (contenido por envase): factor manual envase→stock capturado por
   * `<app-pop-uom-capture>` en el caso count→masa/volumen. `null` = sin capturar
   * / no aplica. `onConfirm` lo propaga (a `prebulkData` en create, a
   * `PopProductConfigResult` en configure) y `pop.component` lo mapea al
   * `purchase_to_stock_factor` del item de la orden.
   */
  readonly capturedContentPerPackage = signal<number | null>(null);
  /**
   * Fase 3: is the product we are configuring a pure ingredient?
   * `is_ingredient && !is_sellable`. Used to switch the modal to the
   * unit-aware cost-capture mode.
   */
  readonly isPureIngredient = computed(() => {
    const p: any = this.product();
    if (!p) return false;
    if (!p.is_ingredient) return false;
    // F3 (hardening): antes se asumía `is_sellable=true` cuando llegaba
    // undefined/null y eso OCULTABA la captura de insumo (bug). Ahora solo un
    // producto EXPLÍCITAMENTE vendible (`is_sellable === true`, p.ej. agua dual)
    // se trata como no-insumo; un insumo con `is_sellable` sin normalizar
    // (undefined/null) muestra la captura y permite Confirmar. Retail
    // (`is_ingredient` falsy) sigue oculto — sin regresión.
    return p.is_sellable !== true;
  });
  /**
   * Effective ingredient mode — drives the venta/consumo UoM switch.
   * Requires store capability, then:
   *   - create mode: the "Es un insumo" toggle governs (no product yet).
   *   - configure mode: derived from the existing product (pure ingredient).
   * Fase 5: without the create-mode branch the UoM-capture block never
   * showed when creating an ingredient (product() is null → false).
   */
  readonly ingredientMode = computed(() => {
    if (!this.storeSupportsIngredients()) return false;
    if (this.createMode()) return this.isIngredient();
    return this.isPureIngredient();
  });
  /**
   * F1: ¿la selección de UoM exige teclear el contenido por envase? Verdadero
   * cuando la compra es un envase (dimensión `count`) y el stock es
   * masa/volumen — el catálogo no puede derivar el factor. Espeja la lógica de
   * `pop-uom-capture.needsManualContent` para gatear `canConfirm` en create.
   */
  readonly needsManualContentPerPackage = computed<boolean>(() => {
    const purchaseId = this.purchaseUomId();
    const stockId = this.stockUomId();
    if (!purchaseId || !stockId) return false;
    const opts = this.uomCatalog();
    const purchase = opts.find((u) => u.id === purchaseId);
    const stock = opts.find((u) => u.id === stockId);
    if (!purchase || !stock) return false;
    return (
      purchase.dimension === 'count' &&
      (stock.dimension === 'mass' || stock.dimension === 'volume')
    );
  });
  /**
   * Fase 3: live preview of the purchase→stock factor the backend will
   * compute on receive(). Mirrors `unitCapacity` from the product form
   * and the backend `derivePurchaseToStockFactor`. Null when the user
   * has not picked both UoMs, or they belong to different dimensions.
   */
  readonly unitCapacity = computed<{
    value: number;
    unit: string;
    purchaseUnit: string;
  } | null>(() => {
    const purchaseId = this.purchaseUomId();
    const stockId = this.stockUomId();
    if (!purchaseId || !stockId) return null;
    const opts = this.uomCatalog();
    const stock = opts.find((u) => u.id === stockId);
    const purchase = opts.find((u) => u.id === purchaseId);
    if (!stock || !purchase) return null;
    if (stock.dimension !== purchase.dimension) return null;
    const sf = Number(stock.factor_to_base);
    const pf = Number(purchase.factor_to_base);
    if (!Number.isFinite(sf) || !Number.isFinite(pf) || pf <= 0) return null;
    const factor = Math.round((pf / sf) * 1e6) / 1e6;
    return {
      value: factor,
      unit: stock.code,
      purchaseUnit: purchase.code,
    };
  });
  /**
   * Fase 3: dynamic label for the cost input. Retail mode keeps the
   * existing text ("Costo unitario"). Ingredient mode shows the actual
   * presentation ("Costo por L", "Costo por kg") so the user knows
   * whether they are typing the per-bottle or per-ml price.
   */
  readonly costInputLabel = computed(() => {
    if (!this.ingredientMode()) return 'Costo unitario';
    const purchaseId = this.purchaseUomId();
    if (!purchaseId) return 'Costo por unidad de compra';
    const purchase = this.uomCatalog().find((u) => u.id === purchaseId);
    return purchase ? `Costo por ${purchase.code}` : 'Costo por unidad de compra';
  });
  private toastService = inject(ToastService);
  private storeSettingsFacade = inject(StoreSettingsFacade);
  private currencyService: CurrencyFormatService;

  tabItems = computed<ScrollableTab[]>(() => {
    const tabs: ScrollableTab[] = [
      { id: 'general', label: 'General', icon: 'settings' },
    ];
    if (this.hasVariantsToggle())
      tabs.push({ id: 'variants', label: 'Variantes', icon: 'layers' });
    if (this.requiresLotToggle())
      tabs.push({ id: 'lot', label: 'Lote', icon: 'package' });
    return tabs;
  });

  constructor(currencyService: CurrencyFormatService) {
    this.currencyService = currencyService;

    // Redirect to 'general' if the active tab was removed
    effect(() => {
      const tabs = this.tabItems();
      const current = this.activeTab();
      if (!tabs.find((t) => t.id === current)) {
        this.activeTab.set('general');
      }
    });

    effect(() => {
      if (this.isOpen()) {
        this.resetState();
        this.loadUoMCatalog();
        this.initializeIngredientUoMDefaults();
      }
    });

    // Seed the shared UoM-capture sub-component from its inputs once it is
    // rendered (it only exists under `@if (ingredientMode())`). Mirrors the
    // "init on open" pattern the inline block used to have. In create mode
    // this resets to empty (new product); in configure mode it reflects the
    // product's persisted UoMs resolved by initializeIngredientUoMDefaults().
    effect(() => {
      const cap = this.uomCapture();
      if (this.isOpen() && cap) {
        cap.initFromInputs();
      }
    });
  }

  /** Shared UoM-capture instance (present only in ingredient mode). */
  private readonly uomCapture = viewChild(PopUomCaptureComponent);

  /**
   * Fase 3: load the UoM catalog once per modal open. The service caches
   * results internally (shareReplay), so this is a no-op after the first
   * call. Errors are non-fatal: the modal falls back to retail-style
   * capture and shows a toast.
   */
  private loadUoMCatalog(): void {
    this.uomService
      .getCatalog()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res: any) => {
          const data = Array.isArray(res?.data) ? res.data : [];
          this.uomCatalog.set(data);
          // Re-resolve defaults once the catalog is in.
          this.initializeIngredientUoMDefaults();
        },
        error: () => {
          // Non-fatal: retail mode still works.
          this.uomCatalog.set([]);
        },
      });
  }

  /**
   * Fase 3: when the product is a pure ingredient, default the modal's
   * UoM selection from the product itself (purchase_uom_id, stock_uom_id
   * persisted at product create time). User can still change them in
   * this modal; the preview updates live.
   */
  private initializeIngredientUoMDefaults(): void {
    // Limpiar el costo/cantidad capturados de un producto/sesión previa.
    this.capturedUnitCost.set(null);
    this.capturedQuantity.set(null);
    // F1: limpiar el contenido por envase capturado.
    this.capturedContentPerPackage.set(null);
    const p: any = this.product();
    if (!p) return;
    if (!this.isPureIngredient() || !this.storeSupportsIngredients()) {
      // Not in ingredient mode: clear the UoM FKs so the cart line stays
      // neutral and the PO will be `retail` by default.
      this.purchaseUomId.set(null);
      this.stockUomId.set(null);
      return;
    }
    // Prefer product-defined UoMs; fall back to first UoM in catalog.
    const catalog = this.uomCatalog();
    const stockId =
      p.stock_uom_id ??
      (catalog.length > 0
        ? catalog.find((u: any) => u.dimension === 'volume' || u.dimension === 'mass')?.id ?? catalog[0]?.id ?? null
        : null);
    const purchaseId =
      p.purchase_uom_id ??
      (catalog.length > 0
        ? catalog.find((u: any) => u.id === stockId)?.id ?? stockId
        : null);
    this.stockUomId.set(stockId ?? null);
    this.purchaseUomId.set(purchaseId ?? null);
  }

  get productHasVariants(): boolean {
    return !!this.product()?.product_variants?.length;
  }

  get allVariantsSelected(): boolean {
    return (
      !!this.product()?.product_variants?.length &&
      this.selectedVariantIds.size ===
        (this.product()?.product_variants?.length ?? 0)
    );
  }

  get confirmLabel(): string {
    if (this.creatingVariants()) return 'Creando...';
    if (this.isCreatingVariants() && this.generatedVariants.length > 0) {
      return `Crear ${this.generatedVariants.length} variantes`;
    }
    if (
      !this.isEditing() &&
      this.hasVariantsToggle() &&
      this.selectedVariantIds.size > 1
    ) {
      return `Agregar ${this.selectedVariantIds.size} variantes`;
    }
    return 'Confirmar';
  }

  getVariantLabel(variant: PopProductVariant): string {
    if (variant.name) return variant.name;
    if (variant.attributes) {
      const attrs = variant.attributes;
      return (
        Object.values(attrs)
          .filter((v) => typeof v === 'string' || typeof v === 'number')
          .join(' / ') || variant.sku
      );
    }
    return variant.sku;
  }

  formatCurrency(amount: number): string {
    return this.currencyService.format(amount || 0);
  }

  isVariantLowStock(variant: PopProductVariant): boolean {
    const stock = Number(variant.stock_quantity ?? 0);
    return stock > 0 && stock <= this.getProductLowStockThreshold();
  }

  private getProductLowStockThreshold(): number {
    const product = this.product();
    const productThreshold = [product?.reorder_point, product?.min_stock_level]
      .map((value) => Number(value))
      .find((value) => Number.isFinite(value) && value > 0);

    if (productThreshold !== undefined) {
      return productThreshold;
    }

    const apiThreshold = Number(product?.low_stock_threshold);
    if (Number.isFinite(apiThreshold) && apiThreshold >= 0) {
      return apiThreshold;
    }

    const configuredThreshold = Number(
      this.storeSettingsFacade.settings()?.inventory?.low_stock_threshold,
    );
    return Number.isFinite(configuredThreshold) && configuredThreshold >= 0
      ? configuredThreshold
      : 10;
  }

  isVariantSelected(variantId: number): boolean {
    return this.selectedVariantIds.has(variantId);
  }

  onToggleVariant(variant: PopProductVariant): void {
    if (this.isEditing()) {
      // Single-select when editing an existing cart item
      this.selectedVariantIds.clear();
      this.selectedVariantIds.add(variant.id);
    } else {
      // Multi-select when adding new
      if (this.selectedVariantIds.has(variant.id)) {
        this.selectedVariantIds.delete(variant.id);
      } else {
        this.selectedVariantIds.add(variant.id);
      }
    }
    // Trigger change detection by reassigning the Set
    this.selectedVariantIds = new Set(this.selectedVariantIds);
  }

  toggleSelectAllVariants(): void {
    if (this.allVariantsSelected) {
      this.selectedVariantIds = new Set();
    } else {
      this.selectedVariantIds = new Set(
        this.product()?.product_variants?.map((v) => v.id) || [],
      );
    }
  }

  /**
   * Called by `<app-pop-uom-capture>` whenever the user settles a value.
   * In configure mode the UoM FKs are read directly from the parent's
   * signals (mirroring the previous inline block); in create mode the
   * component also writes `unitCost` back into the identity form so the
   * "Costo unitario" input and the UoM-capture block stay in sync.
   */
  onUomCaptureChanged(result: PopUomCaptureResult): void {
    this.purchaseUomId.set(result.purchaseUomId);
    this.stockUomId.set(result.stockUomId);
    // Capturar costo/cantidad en AMBOS modos: configure mode ya no descarta el
    // costo del insumo (bug: se perdía). Create mode además espeja el form.
    this.capturedUnitCost.set(result.unitCost);
    this.capturedQuantity.set(result.quantity);
    // F1: contenido por envase (solo válido en count→masa/volumen; 0 = no aplica).
    this.capturedContentPerPackage.set(
      result.contentPerPackage >= 1 ? result.contentPerPackage : null,
    );
    if (this.createMode()) {
      // The sub-component is the source of truth for ingredient cost AND
      // batch quantity (bidirectional capture). Keep the identity form in
      // sync so onConfirm reads the canonical unit_cost and quantity even
      // though the inputs are hidden for ingredients.
      this.identityForm.patchValue(
        { unitCost: result.unitCost, quantity: result.quantity },
        { emitEvent: false },
      );
    }
  }

  /**
   * Soft exclusivity: turning the ingredient flag on marks the product as
   * non-sellable; turning it off restores sellable and clears the UoM
   * selection so a retail product never carries stale FKs. Mirrors the
   * prebulk-modal behavior.
   */
  onIngredientToggle(value: boolean): void {
    this.isIngredient.set(value);
    this.isSellable.set(!value);
    if (!value) {
      this.purchaseUomId.set(null);
      this.stockUomId.set(null);
    }
  }

  canConfirm(): boolean {
    if (this.creatingVariants()) return false;
    if (this.createMode()) {
      // Create mode: identity form must be valid; if ingredient, both UoMs
      // are mandatory. Variant management is hidden in create mode.
      if (this.identityForm.invalid) return false;
      if (this.isIngredient()) {
        if (this.purchaseUomId() == null || this.stockUomId() == null) {
          return false;
        }
        // F1: en el caso count→masa/volumen el factor NO se puede derivar del
        // catálogo, así que el contenido por envase es obligatorio. En el resto
        // de casos no se exige (el backend deriva por UoM).
        if (
          this.needsManualContentPerPackage() &&
          !((this.capturedContentPerPackage() ?? 0) >= 1)
        ) {
          return false;
        }
        return true;
      }
      return true;
    }
    if (this.isCreatingVariants()) {
      return this.generatedVariants.length > 0;
    }
    if (this.hasVariantsToggle() && this.selectedVariantIds.size === 0)
      return false;
    return true;
  }

  /**
   * F1: contenido por envase validado (entero ≥1) o `undefined` cuando no
   * aplica. Reutilizado por todas las ramas de `onConfirm`.
   */
  private resolvedContentPerPackage(): number | undefined {
    const c = this.capturedContentPerPackage();
    return c != null && c >= 1 ? Math.round(c) : undefined;
  }

  onConfirm(): void {
    if (!this.canConfirm()) return;

    // ----------------------------------------------------------------
    // CREATE mode (Fase 5) — absorbs the prebulk-modal flow.
    // ----------------------------------------------------------------
    if (this.createMode()) {
      this.identityForm.markAllAsTouched();
      const v = this.identityForm.value;
      const ingredient = this.isIngredient();

      // F3 IVA lifecycle: propaga el impuesto sugerido por el scanner (por
      // match de tasa) al producto nuevo. Solo cuando hay sugerencia (>0);
      // en el flujo manual queda undefined y el backend no asigna impuestos.
      const suggestedTaxId = this.suggestedTaxCategoryId();
      const taxCategoryIds =
        suggestedTaxId != null && suggestedTaxId > 0
          ? [suggestedTaxId]
          : undefined;

      const prebulkData: PreBulkData = {
        name: v.name,
        code: v.code,
        description: v.description || undefined,
        base_price: Number(v.basePrice) || 0,
        is_ingredient: ingredient,
        is_sellable: this.isSellable(),
        // UoM FKs only travel for ingredients; retail stays null.
        purchase_uom_id: ingredient ? this.purchaseUomId() : null,
        stock_uom_id: ingredient ? this.stockUomId() : null,
        // F1: contenido por envase (solo insumo, caso count→masa/volumen).
        // Viaja dentro de prebulkData porque el carrito copia `prebulk_data`
        // completo; `pop.component` lo mapea a `purchase_to_stock_factor`.
        contentPerPackage: ingredient
          ? this.resolvedContentPerPackage()
          : undefined,
        // F3: impuesto sugerido (neto ya aplastado en unitCost del form).
        tax_category_ids: taxCategoryIds,
      };

      this.confirmed.emit({
        mode: 'create',
        prebulkData,
        quantity: Number(v.quantity),
        unit_cost: Number(v.unitCost),
        notes: v.notes || undefined,
      });
      this.closed.emit();
      return;
    }

    // ----------------------------------------------------------------
    // CONFIGURE mode — original flow (variants / lot / UoM).
    // ----------------------------------------------------------------

    // Creating new variants mode
    if (
      this.isCreatingVariants() &&
      this.generatedVariants.length > 0 &&
      this.product()?.id
    ) {
      this.creatingVariants.set(true);
      const productId = this.product()!.id;

      const createRequests = this.generatedVariants.map((v) =>
        this.productsService
          .createProductVariant(productId, {
            sku: v.sku,
            name: v.name,
            cost_price: v.cost_price,
            attributes: v.attributes,
            stock_quantity: 0,
          })
          .pipe(catchError(() => of(null))),
      );

      forkJoin(createRequests)
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (results) => {
            const createdVariants = results
              .filter((r): r is any => r !== null)
              .map((r) => ({
                id: r.id,
                name: r.name,
                sku: r.sku,
                cost_price: r.cost_price ? Number(r.cost_price) : undefined,
                stock_quantity: r.stock_quantity || 0,
                attributes: r.attributes,
              }));

            if (createdVariants.length === 0) {
              this.creatingVariants.set(false);
              this.toastService.error('No se pudieron crear las variantes');
              return;
            }

            const failedCount =
              this.generatedVariants.length - createdVariants.length;
            if (failedCount > 0) {
              this.toastService.warning(
                `Se crearon ${createdVariants.length} variantes, ${failedCount} fallaron`,
              );
            }

            // Update local product reference
            const currentProduct = this.product();
            if (currentProduct) {
              currentProduct.product_variants = createdVariants;
            }

            const lotInfo = this.buildLotInfo();
            const pricingType = this.selectedPricingType();

            this.confirmed.emit({
              mode: 'configure',
              variants: createdVariants,
              quantity: this.capturedQuantity() ?? 1,
              unit_cost:
                this.capturedUnitCost() ??
                Number(this.product()?.cost || this.product()?.cost_price || 0),
              pricing_type: pricingType,
              lot_info: lotInfo,
              purchase_uom_id: this.purchaseUomId(),
              stock_uom_id: this.stockUomId(),
              contentPerPackage: this.resolvedContentPerPackage(),
            });

            this.creatingVariants.set(false);
            this.closed.emit();
          },
          error: () => {
            this.creatingVariants.set(false);
            this.toastService.error('Error al crear variantes');
          },
        });
      return;
    }

    // Existing flow for selecting existing variants
    const lotInfo = this.buildLotInfo();
    const pricingType = this.selectedPricingType();

    if (this.hasVariantsToggle() && this.product()?.product_variants) {
      const selectedVariants = (this.product()?.product_variants ?? []).filter(
        (v) => this.selectedVariantIds.has(v.id),
      );

      if (this.isEditing()) {
        const variant = selectedVariants[0];
        this.confirmed.emit({
          mode: 'configure',
          variant,
          quantity: this.capturedQuantity() ?? 1,
          unit_cost:
            this.capturedUnitCost() ??
            (variant?.cost_price
              ? Number(variant.cost_price)
              : Number(this.product()?.cost || this.product()?.cost_price || 0)),
          pricing_type: pricingType,
          lot_info: lotInfo,
          purchase_uom_id: this.purchaseUomId(),
          stock_uom_id: this.stockUomId(),
          contentPerPackage: this.resolvedContentPerPackage(),
        });
      } else {
        this.confirmed.emit({
          mode: 'configure',
          variants: selectedVariants,
          quantity: this.capturedQuantity() ?? 1,
          unit_cost:
            this.capturedUnitCost() ??
            Number(this.product()?.cost || this.product()?.cost_price || 0),
          pricing_type: pricingType,
          lot_info: lotInfo,
          purchase_uom_id: this.purchaseUomId(),
          stock_uom_id: this.stockUomId(),
          contentPerPackage: this.resolvedContentPerPackage(),
        });
      }
    } else {
      this.confirmed.emit({
        mode: 'configure',
        quantity: this.capturedQuantity() ?? 1,
        unit_cost:
          this.capturedUnitCost() ??
          Number(this.product()?.cost || this.product()?.cost_price || 0),
        pricing_type: pricingType,
        lot_info: lotInfo,
        purchase_uom_id: this.purchaseUomId(),
        stock_uom_id: this.stockUomId(),
        contentPerPackage: this.resolvedContentPerPackage(),
      });
    }

    this.closed.emit();
  }

  // --- Variant creation methods ---

  addQuickAttribute(name: string): void {
    if (
      this.variantAttributes.some(
        (a) => a.name.toLowerCase() === name.toLowerCase(),
      )
    )
      return;
    this.variantAttributes.push({ name, values: [] });
  }

  addAttribute(): void {
    this.variantAttributes.push({ name: '', values: [] });
  }

  removeAttribute(index: number): void {
    this.variantAttributes.splice(index, 1);
    this.generateNewVariants();
  }

  addAttributeValue(attrIndex: number, event: any): void {
    const value = event.target.value.trim();
    if (value && !this.variantAttributes[attrIndex].values.includes(value)) {
      this.variantAttributes[attrIndex].values.push(value);
      this.generateNewVariants();
    }
    event.target.value = '';
  }

  removeAttributeValue(attrIndex: number, valueIndex: number): void {
    this.variantAttributes[attrIndex].values.splice(valueIndex, 1);
    this.generateNewVariants();
  }

  generateNewVariants(): void {
    const validAttributes = this.variantAttributes.filter(
      (attr) => attr.name && attr.values.length > 0,
    );
    if (validAttributes.length === 0) {
      this.generatedVariants = [];
      return;
    }

    const combinations = this.cartesian(validAttributes.map((a) => a.values));
    const baseCost = Number(
      this.product()?.cost || this.product()?.cost_price || 0,
    );
    const baseSku = this.product()?.code || '';

    this.generatedVariants = combinations.map((combo) => {
      const attributes: Record<string, string> = {};
      let nameSuffix = '';
      let skuSuffix = '';

      validAttributes.forEach((attr, index) => {
        const value = combo[index];
        attributes[attr.name] = value;
        nameSuffix += ` ${value}`;
        skuSuffix += `-${value.toUpperCase().substring(0, 3)}`;
      });

      const existing = this.generatedVariants.find(
        (v) => JSON.stringify(v.attributes) === JSON.stringify(attributes),
      );
      if (existing) return existing;

      return {
        name: `${this.product()?.name || 'Product'}${nameSuffix}`,
        sku: baseSku ? `${baseSku}${skuSuffix}` : `VAR${skuSuffix}`,
        cost_price: baseCost,
        attributes,
      };
    });
  }

  get previewVariantCount(): number {
    const validAttributes = this.variantAttributes.filter(
      (attr) => attr.name && attr.values.length > 0,
    );
    if (validAttributes.length === 0) return 0;
    return validAttributes.reduce((acc, attr) => acc * attr.values.length, 1);
  }

  private cartesian(args: any[][]): any[][] {
    const r: any[][] = [];
    const max = args.length - 1;
    function helper(arr: any[], i: number) {
      for (let j = 0, l = args[i].length; j < l; j++) {
        const a = arr.slice(0);
        a.push(args[i][j]);
        if (i === max) r.push(a);
        else helper(a, i + 1);
      }
    }
    if (args.length > 0) helper([], 0);
    return r;
  }

  onClose(): void {
    this.closed.emit();
  }

  private buildLotInfo(): LotInfo | undefined {
    if (!this.requiresLotToggle()) return undefined;
    if (
      !this.lotBatchNumber &&
      !this.lotManufacturingDate &&
      !this.lotExpirationDate
    )
      return undefined;

    return {
      batch_number: this.lotBatchNumber || undefined,
      manufacturing_date: this.lotManufacturingDate
        ? new Date(this.lotManufacturingDate)
        : undefined,
      expiration_date: this.lotExpirationDate
        ? new Date(this.lotExpirationDate)
        : undefined,
    };
  }

  private resetState(): void {
    this.activeTab.set('general');

    // Reset create-mode state on every open so each create starts clean.
    // F3 IVA lifecycle: cuando viene de una factura escaneada, pre-llena el
    // costo con el NETO sugerido (ya aplastado por el scanner). Fuera de ese
    // flujo `suggestedUnitCostNet()` es null y el costo arranca en 0.
    const suggestedNet = this.suggestedUnitCostNet();
    this.identityForm.reset({
      name: '',
      code: '',
      description: '',
      quantity: 1,
      unitCost:
        suggestedNet != null && Number.isFinite(suggestedNet) && suggestedNet > 0
          ? suggestedNet
          : 0,
      basePrice: 0,
      notes: '',
    });
    this.isIngredient.set(false);
    this.isSellable.set(true);
    this.createQuantity.set(1);

    // Pre-fill pricing type
    this.selectedPricingType.set(
      this.initialPricingType() || this.product()?.pricing_type || 'unit',
    );

    // Pre-fill variant toggle and selection
    if (this.initialVariant()) {
      this.hasVariantsToggle.set(true);
      this.selectedVariantIds = new Set([this.initialVariant()!.id]);
    } else if (this.productHasVariants) {
      this.hasVariantsToggle.set(true);
      this.selectedVariantIds = new Set();
    } else {
      this.hasVariantsToggle.set(false);
      this.selectedVariantIds = new Set();
    }

    // Pre-fill lot toggle and fields
    const lotInfo = this.initialLotInfo();
    if (lotInfo) {
      this.requiresLotToggle.set(true);
      this.lotBatchNumber = lotInfo.batch_number || '';
      this.lotManufacturingDate = lotInfo.manufacturing_date
        ? new Date(lotInfo.manufacturing_date).toISOString().split('T')[0]
        : '';
      this.lotExpirationDate = lotInfo.expiration_date
        ? new Date(lotInfo.expiration_date).toISOString().split('T')[0]
        : '';
    } else if (this.product()?.requires_batch_tracking) {
      this.requiresLotToggle.set(true);
      this.lotBatchNumber = '';
      this.lotManufacturingDate = '';
      this.lotExpirationDate = '';
    } else {
      this.requiresLotToggle.set(false);
      this.lotBatchNumber = '';
      this.lotManufacturingDate = '';
      this.lotExpirationDate = '';
    }

    // Reset variant creation state
    this.variantAttributes = [];
    this.generatedVariants = [];
    this.creatingVariants.set(false);
  }
}
