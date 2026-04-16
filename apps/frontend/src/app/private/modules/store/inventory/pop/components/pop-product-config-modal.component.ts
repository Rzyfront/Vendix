import {
  Component,
  input,
  output,
  signal,
  computed,
  effect,
  inject,
} from '@angular/core';

import { FormsModule } from '@angular/forms';
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
import { CurrencyFormatService } from '../../../../../../shared/pipes/currency';
import { ProductsService } from '../../../products/services/products.service';
import { ToastService } from '../../../../../../shared/components/toast/toast.service';
import {
  PopProduct,
  PopProductVariant,
  LotInfo,
} from '../interfaces/pop-cart.interface';

export interface PopProductConfigResult {
  variant?: PopProductVariant | null;
  variants?: PopProductVariant[];
  lot_info?: LotInfo;
  quantity: number;
  unit_cost: number;
  pricing_type?: 'unit' | 'weight';
}

@Component({
  selector: 'app-pop-product-config-modal',
  standalone: true,
  imports: [
    FormsModule,
    ModalComponent,
    ScrollableTabsComponent,
    SettingToggleComponent,
    IconComponent,
    ButtonComponent,
    InputComponent
],
  template: `
    <app-modal
      [isOpen]="isOpen()"
      title="Configurar producto"
      [subtitle]="product()?.name"
      size="sm"
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
            <!-- Product info card -->
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
                    <span class="text-xs text-text-muted font-mono"
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

            <!-- Pricing type selector -->
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

            <!-- Toggles -->
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

            <app-setting-toggle
              label="Gestionar lote"
              description="Asignar número de lote y fechas de fabricación/vencimiento"
              [ngModel]="requiresLotToggle()"
              (changed)="requiresLotToggle.set($event)"
            ></app-setting-toggle>
          </div>
        }

        <!-- Tab: Variantes -->
        @if (activeTab() === 'variants') {
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
                      <input
                        type="text"
                        [(ngModel)]="attr.name"
                        placeholder="Nombre (ej: Color)"
                        (blur)="generateNewVariants()"
                        class="w-full px-2.5 py-1.5 text-sm rounded-lg border border-border bg-surface text-text-primary placeholder:text-text-muted focus:ring-1 focus:ring-primary focus:border-primary outline-none"
                      />
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
                        class="flex-1 border-none p-0 text-sm focus:ring-0 focus:outline-none min-w-[80px] bg-transparent text-text-primary placeholder:text-text-muted"
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
                    class="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg bg-primary text-white hover:bg-primary/90 transition-colors"
                  >
                    <app-icon name="zap" [size]="12"></app-icon> Generar
                  </button>
                </div>
              }

              <!-- Generated Variants List -->
              @if (generatedVariants.length > 0) {
                <div class="flex flex-col gap-1.5">
                  <span class="text-xs font-medium text-text-muted px-1">
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
                        <p class="text-[10px] text-text-muted font-mono">
                          {{ variant.sku }}
                        </p>
                      </div>
                      <div class="flex-shrink-0">
                        <input
                          type="number"
                          [(ngModel)]="variant.cost_price"
                          min="0"
                          step="0.01"
                          class="w-20 px-2 py-1 text-xs text-right rounded-lg border border-border bg-surface text-text-primary focus:ring-1 focus:ring-primary focus:border-primary outline-none"
                        />
                      </div>
                    </div>
                  }
                </div>
              }

              @if (variantAttributes.length === 0) {
                <p class="text-sm text-text-muted text-center py-4">
                  Agrega atributos para crear variantes del producto.
                </p>
              }
            </div>
          } @else {
            <!-- Existing Variant Selection Mode -->
            <div class="flex flex-col gap-2">
              @if (!isEditing()) {
                <div class="flex items-center justify-between px-1 pb-1">
                  <span class="text-xs text-text-muted">
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
                        class="text-white"
                      ></app-icon>
                    }
                  </div>

                  <div
                    class="w-10 h-10 rounded-lg bg-muted/50 flex-shrink-0 flex items-center justify-center"
                  >
                    <app-icon
                      name="layers"
                      [size]="18"
                      class="text-text-muted"
                    ></app-icon>
                  </div>
                  <div class="flex-1 min-w-0">
                    <p class="font-medium text-sm text-text-primary truncate">
                      {{ getVariantLabel(variant) }}
                    </p>
                    <p class="text-xs text-text-muted font-mono mt-0.5">
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
                          variant.stock_quantity <= 5
                            ? 'text-warning'
                            : 'text-text-muted'
                        "
                      >
                        {{ variant.stock_quantity }} disp.
                      </span>
                    }
                  </div>
                </button>
              }

              @if (!product()?.product_variants?.length) {
                <p class="text-sm text-text-muted text-center py-4">
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

            <p class="text-xs text-text-muted">
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
  readonly isOpen = input(false);
  readonly product = input<PopProduct | null>(null);
  readonly initialVariant = input<PopProductVariant | null>(null);
  readonly initialLotInfo = input<LotInfo | null>(null);
  readonly initialPricingType = input<'unit' | 'weight'>('unit');
  readonly isEditing = input(false);
  readonly confirmed = output<PopProductConfigResult>();
  readonly closed = output<void>();

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
  private toastService = inject(ToastService);
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
      }
    });
  }

  get productHasVariants(): boolean {
    return !!this.product()?.product_variants?.length;
  }

  get allVariantsSelected(): boolean {
    return (
      !!this.product()?.product_variants?.length &&
      this.selectedVariantIds.size === (this.product()?.product_variants?.length ?? 0)
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

  canConfirm(): boolean {
    if (this.creatingVariants()) return false;
    if (this.isCreatingVariants()) {
      return this.generatedVariants.length > 0;
    }
    if (this.hasVariantsToggle() && this.selectedVariantIds.size === 0)
      return false;
    return true;
  }

  onConfirm(): void {
    if (!this.canConfirm()) return;

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

      forkJoin(createRequests).subscribe({
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
            variants: createdVariants,
            quantity: 1,
            unit_cost: Number(
              this.product()?.cost || this.product()?.cost_price || 0,
            ),
            pricing_type: pricingType,
            lot_info: lotInfo,
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
      const selectedVariants = (this.product()?.product_variants ?? []).filter((v) =>
        this.selectedVariantIds.has(v.id),
      );

      if (this.isEditing()) {
        const variant = selectedVariants[0];
        this.confirmed.emit({
          variant,
          quantity: 1,
          unit_cost: variant?.cost_price
            ? Number(variant.cost_price)
            : Number(this.product()?.cost || this.product()?.cost_price || 0),
          pricing_type: pricingType,
          lot_info: lotInfo,
        });
      } else {
        this.confirmed.emit({
          variants: selectedVariants,
          quantity: 1,
          unit_cost: Number(
            this.product()?.cost || this.product()?.cost_price || 0,
          ),
          pricing_type: pricingType,
          lot_info: lotInfo,
        });
      }
    } else {
      this.confirmed.emit({
        quantity: 1,
        unit_cost: Number(this.product()?.cost || this.product()?.cost_price || 0),
        pricing_type: pricingType,
        lot_info: lotInfo,
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
        ? new Date(lotInfo.manufacturing_date)
            .toISOString()
            .split('T')[0]
        : '';
      this.lotExpirationDate = lotInfo.expiration_date
        ? new Date(lotInfo.expiration_date)
            .toISOString()
            .split('T')[0]
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
