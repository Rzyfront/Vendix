import {
  Component,
  input,
  output,
  inject,
  effect,
  signal,
  ViewChild,
} from '@angular/core';

import { FormsModule } from '@angular/forms';

import {
  ModalComponent,
  ButtonComponent,
  SelectorComponent,
  SelectorOption,
  IconComponent,
  StepsLineComponent,
  StepsLineItem,
  InputsearchComponent,
} from '../../../../../../shared/components/index';

import { InventoryService } from '../../services';
import {
  AdjustmentType,
  AdjustableProduct,
  AdjustmentItem,
  BatchCreateAdjustmentsRequest,
  PreselectedProduct,
} from '../../interfaces';

@Component({
  selector: 'app-adjustment-create-modal',
  standalone: true,
  imports: [
    FormsModule,
    ModalComponent,
    ButtonComponent,
    SelectorComponent,
    IconComponent,
    StepsLineComponent,
    InputsearchComponent
],
  template: `
    <app-modal
      [isOpen]="isOpen()"
      [title]="modalTitle"
      size="md"
      (closed)="onCancel()"
      (isOpenChange)="isOpenChange.emit($event)"
      subtitle="Registrar ajustes de inventario"
    >
      <!-- Steps -->
      <app-steps-line
        [steps]="steps"
        [currentStep]="currentStep - 1"
        size="md"
        primaryColor="var(--color-primary)"
        secondaryColor="var(--color-secondary)"
        class="mb-6 block"
      ></app-steps-line>

      <!-- STEP 1: Location Selection -->
      @if (isLocationStep) {
        <div class="space-y-6">
          <div>
            <label class="block text-sm font-medium text-text-secondary mb-2">Ubicacion *</label>
            <app-selector
              [options]="locations()"
              [ngModel]="selectedLocation"
              placeholder="Seleccionar ubicacion"
              (ngModelChange)="onLocationChange($event)"
            ></app-selector>
          </div>

          @if (selectedLocation) {
            <div class="p-3 bg-primary/5 rounded-xl border border-primary/20 text-center">
              <p class="text-sm text-text-secondary">Ubicacion seleccionada</p>
              <p class="text-lg font-bold text-primary">{{ getLocationName(selectedLocation) }}</p>
            </div>
          }

          @if (isLoadingPreselectedStock()) {
            <div class="p-4 text-center">
              <div class="inline-block w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin mb-2"></div>
              <p class="text-sm text-text-secondary">Consultando stock del producto...</p>
            </div>
          }
        </div>
      }

      <!-- STEP 2: Products & Adjustments (only without preselection) -->
      @if (isProductsStep) {
        <div class="space-y-4">
          <!-- Location Summary -->
          <div class="p-3 bg-surface-secondary rounded-xl border border-border flex items-center gap-3">
            <app-icon name="map-pin" [size]="18" class="text-primary"></app-icon>
            <span class="text-sm font-medium text-text-primary">
              {{ getLocationName(selectedLocation) }}
            </span>
            <button type="button" (click)="goToStep(1)" class="ml-auto text-sm text-primary hover:underline">Cambiar</button>
          </div>

          <!-- Product Search -->
          <div>
            <label class="block text-sm font-medium text-text-secondary mb-2">Buscar Producto</label>
            <app-inputsearch
              #productSearch
              size="sm"
              placeholder="Buscar por nombre o SKU..."
              [debounceTime]="300"
              (searchChange)="searchProducts($event)"
            ></app-inputsearch>
          </div>

          <!-- Search Results -->
          @if (productSearchResults().length > 0) {
            <div class="max-h-48 overflow-y-auto border border-border rounded-xl divide-y divide-border">
              @for (product of productSearchResults(); track product.id) {
                <button
                  type="button"
                  class="w-full p-3 text-left hover:bg-primary/5 transition-colors"
                  (click)="addProduct(product)"
                >
                  <div class="flex items-center justify-between">
                    <div>
                      <p class="text-sm font-medium text-text-primary">{{ product.name }}</p>
                      <p class="text-xs text-text-secondary">SKU: {{ product.sku || 'N/A' }}</p>
                    </div>
                    <div class="text-right">
                      <p class="text-xs font-medium text-text-primary">
                        Stock: {{ product.stock_at_location.quantity_on_hand }}
                      </p>
                      <p class="text-xs text-text-secondary">
                        Disponible: {{ product.stock_at_location.quantity_available }}
                      </p>
                    </div>
                  </div>
                </button>
              }
            </div>
          }

          <!-- Added Items -->
          <div>
            <label class="block text-sm font-medium text-text-secondary mb-2">
              Productos a Ajustar ({{ adjustmentItems.length }})
            </label>

            @if (adjustmentItems.length === 0) {
              <div class="p-6 text-center border border-dashed border-border rounded-xl">
                <app-icon name="clipboard-list" [size]="32" class="mx-auto mb-2 text-gray-300"></app-icon>
                <p class="text-sm text-text-secondary">Busca y agrega productos para ajustar</p>
              </div>
            }

            @for (item of adjustmentItems; track item.product_id; let i = $index) {
              <div class="p-3 bg-surface rounded-xl border border-border mb-2 space-y-3">
                <!-- Product header -->
                <div class="flex items-center justify-between">
                  <div>
                    <p class="text-sm font-medium text-text-primary">{{ item.product_name }}</p>
                    <p class="text-xs text-text-secondary">
                      Stock actual: {{ item.stock_on_hand }}
                      @if (item.sku) {
                        <span class="mx-1">|</span> SKU: {{ item.sku }}
                      }
                    </p>
                  </div>
                  <button
                    type="button"
                    class="text-error hover:text-error/80 transition-colors"
                    (click)="removeItem(i)"
                  >
                    <app-icon name="trash-2" [size]="16"></app-icon>
                  </button>
                </div>

                <!-- Adjustment Type Grid -->
                <div>
                  <p class="text-xs font-medium text-text-secondary mb-1.5">Tipo *</p>
                  <div class="grid grid-cols-3 gap-1.5">
                    @for (type of adjustmentTypes; track type.value) {
                      <button
                        type="button"
                        (click)="updateItemType(i, type.value)"
                        class="flex flex-col items-center p-2 rounded-lg border transition-colors text-center"
                        [class]="item.type === type.value
                          ? 'border-primary bg-primary/10 text-primary'
                          : 'border-border bg-surface text-text-secondary hover:border-muted hover:bg-muted/10'"
                      >
                        <app-icon [name]="type.icon" [size]="14" class="mb-0.5"></app-icon>
                        <span class="text-[10px] leading-tight">{{ type.label }}</span>
                      </button>
                    }
                  </div>
                </div>

                <!-- Quantity Input + Preview -->
                <div class="flex items-center gap-3">
                  <div class="flex-1">
                    <label class="text-xs text-text-secondary">Nueva Cantidad *</label>
                    <input
                      type="number"
                      [min]="0"
                      [value]="item.quantity_after"
                      (input)="updateItemQuantity(i, $event)"
                      class="w-full px-3 py-1.5 text-sm border border-border rounded-lg bg-surface focus:border-primary focus:ring-1 focus:ring-primary outline-none"
                    />
                  </div>
                  <div class="flex items-center gap-1 pt-4">
                    <span class="text-sm text-text-secondary">{{ item.stock_on_hand }}</span>
                    <app-icon name="arrow-right" [size]="14" class="text-text-secondary"></app-icon>
                    <span
                      class="text-sm font-bold"
                      [class]="getQuantityChange(item) > 0 ? 'text-success' : getQuantityChange(item) < 0 ? 'text-error' : 'text-text-secondary'"
                    >{{ item.quantity_after }}</span>
                    <span
                      class="text-xs ml-1"
                      [class]="getQuantityChange(item) > 0 ? 'text-success' : getQuantityChange(item) < 0 ? 'text-error' : 'text-text-secondary'"
                    >
                      ({{ getQuantityChange(item) > 0 ? '+' : '' }}{{ getQuantityChange(item) }})
                    </span>
                  </div>
                </div>

                <!-- Description -->
                <div>
                  <input
                    type="text"
                    [value]="item.description"
                    (input)="updateItemDescription(i, $event)"
                    placeholder="Nota adicional (opcional)..."
                    class="w-full px-3 py-1.5 text-xs border border-border rounded-lg bg-surface focus:border-primary focus:ring-1 focus:ring-primary outline-none"
                  />
                </div>
              </div>
            }
          </div>
        </div>
      }

      <!-- STEP 3 (or 2 with preselection): Confirm -->
      @if (isConfirmStep) {
        <div class="space-y-4">
          <!-- Location info -->
          <div class="p-4 bg-surface-secondary rounded-xl border border-border">
            <div class="flex items-center gap-3">
              <app-icon name="map-pin" [size]="18" class="text-primary"></app-icon>
              <div>
                <p class="text-xs text-text-secondary">Ubicacion</p>
                <p class="text-sm font-medium text-text-primary">{{ getLocationName(selectedLocation) }}</p>
              </div>
            </div>
          </div>

          <!-- Editable product card (only with preselection) -->
          @if (hasPreselected) {
            @for (item of adjustmentItems; track item.product_id; let i = $index) {
              <div class="p-3 bg-surface rounded-xl border border-border space-y-3">
                <!-- Product header -->
                <div>
                  <p class="text-sm font-medium text-text-primary">{{ item.product_name }}</p>
                  <p class="text-xs text-text-secondary">
                    Stock actual: {{ item.stock_on_hand }}
                    @if (item.sku) {
                      <span class="mx-1">|</span> SKU: {{ item.sku }}
                    }
                  </p>
                </div>

                <!-- Adjustment Type Grid -->
                <div>
                  <p class="text-xs font-medium text-text-secondary mb-1.5">Tipo *</p>
                  <div class="grid grid-cols-3 gap-1.5">
                    @for (type of adjustmentTypes; track type.value) {
                      <button
                        type="button"
                        (click)="updateItemType(i, type.value)"
                        class="flex flex-col items-center p-2 rounded-lg border transition-colors text-center"
                        [class]="item.type === type.value
                          ? 'border-primary bg-primary/10 text-primary'
                          : 'border-border bg-surface text-text-secondary hover:border-muted hover:bg-muted/10'"
                      >
                        <app-icon [name]="type.icon" [size]="14" class="mb-0.5"></app-icon>
                        <span class="text-[10px] leading-tight">{{ type.label }}</span>
                      </button>
                    }
                  </div>
                </div>

                <!-- Quantity Input + Preview -->
                <div class="flex items-center gap-3">
                  <div class="flex-1">
                    <label class="text-xs text-text-secondary">Nueva Cantidad *</label>
                    <input
                      type="number"
                      [min]="0"
                      [value]="item.quantity_after"
                      (input)="updateItemQuantity(i, $event)"
                      class="w-full px-3 py-1.5 text-sm border border-border rounded-lg bg-surface focus:border-primary focus:ring-1 focus:ring-primary outline-none"
                    />
                  </div>
                  <div class="flex items-center gap-1 pt-4">
                    <span class="text-sm text-text-secondary">{{ item.stock_on_hand }}</span>
                    <app-icon name="arrow-right" [size]="14" class="text-text-secondary"></app-icon>
                    <span
                      class="text-sm font-bold"
                      [class]="getQuantityChange(item) > 0 ? 'text-success' : getQuantityChange(item) < 0 ? 'text-error' : 'text-text-secondary'"
                    >{{ item.quantity_after }}</span>
                    <span
                      class="text-xs ml-1"
                      [class]="getQuantityChange(item) > 0 ? 'text-success' : getQuantityChange(item) < 0 ? 'text-error' : 'text-text-secondary'"
                    >
                      ({{ getQuantityChange(item) > 0 ? '+' : '' }}{{ getQuantityChange(item) }})
                    </span>
                  </div>
                </div>

                <!-- Description -->
                <div>
                  <input
                    type="text"
                    [value]="item.description"
                    (input)="updateItemDescription(i, $event)"
                    placeholder="Nota adicional (opcional)..."
                    class="w-full px-3 py-1.5 text-xs border border-border rounded-lg bg-surface focus:border-primary focus:ring-1 focus:ring-primary outline-none"
                  />
                </div>
              </div>
            }
          }

          <!-- Projection Table (only without preselection) -->
          @if (!hasPreselected) {
            <div>
              <h4 class="text-sm font-medium text-text-secondary mb-2">
                Proyeccion de Inventario ({{ adjustmentItems.length }})
              </h4>
              <div class="border border-border rounded-xl overflow-hidden">
                <!-- Header -->
                <div class="grid grid-cols-[1fr_80px_60px_60px_60px] gap-0 bg-surface-secondary text-xs font-medium text-text-secondary border-b border-border">
                  <div class="px-3 py-2">Producto</div>
                  <div class="px-2 py-2 text-center">Tipo</div>
                  <div class="px-2 py-2 text-center">Actual</div>
                  <div class="px-2 py-2 text-center">Nueva</div>
                  <div class="px-2 py-2 text-center">Cambio</div>
                </div>
                <!-- Body -->
                @for (item of adjustmentItems; track item.product_id) {
                  <div class="grid grid-cols-[1fr_80px_60px_60px_60px] gap-0 border-b border-border last:border-b-0 items-center">
                    <div class="px-3 py-2.5">
                      <p class="text-sm font-medium text-text-primary truncate">{{ item.product_name }}</p>
                      @if (item.sku) {
                        <p class="text-xs text-text-secondary">{{ item.sku }}</p>
                      }
                    </div>
                    <div class="px-2 py-2.5 text-center">
                      <span class="text-xs px-1.5 py-0.5 rounded bg-muted/20 text-text-secondary">
                        {{ getTypeLabel(item.type) }}
                      </span>
                    </div>
                    <div class="px-2 py-2.5 text-center text-sm text-text-secondary">
                      {{ item.stock_on_hand }}
                    </div>
                    <div class="px-2 py-2.5 text-center text-sm font-bold text-text-primary">
                      {{ item.quantity_after }}
                    </div>
                    <div class="px-2 py-2.5 text-center">
                      <span
                        class="text-sm font-bold"
                        [class]="getQuantityChange(item) > 0 ? 'text-success' : getQuantityChange(item) < 0 ? 'text-error' : 'text-text-secondary'"
                      >
                        {{ getQuantityChange(item) > 0 ? '+' : '' }}{{ getQuantityChange(item) }}
                      </span>
                    </div>
                  </div>
                }
              </div>
            </div>

            <!-- Warning for zero changes -->
            @if (hasZeroChange()) {
              <div class="p-3 bg-warning/10 rounded-xl border border-warning/30 text-sm text-warning flex items-center gap-2">
                <app-icon name="alert-triangle" [size]="16"></app-icon>
                Algunos items tienen cambio = 0. No se aplicara ningun ajuste para esos productos.
              </div>
            }

            <!-- Warning for missing types -->
            @if (hasMissingType()) {
              <div class="p-3 bg-error/10 rounded-xl border border-error/30 text-sm text-error flex items-center gap-2">
                <app-icon name="alert-circle" [size]="16"></app-icon>
                Algunos items no tienen tipo de ajuste seleccionado. Vuelve al paso anterior para completarlos.
              </div>
            }

            <!-- Total -->
            <div class="p-3 bg-primary/5 rounded-xl border border-primary/20 text-center">
              <p class="text-sm text-text-secondary">Total de productos a ajustar</p>
              <p class="text-2xl font-bold text-primary">{{ adjustmentItems.length }}</p>
            </div>
          }

          <!-- Confirmation checkbox -->
          <label class="flex items-start gap-3 p-3 bg-warning/5 rounded-xl border border-warning/20 cursor-pointer select-none">
            <input
              type="checkbox"
              [(ngModel)]="confirmCreate"
              class="mt-0.5 w-4 h-4 rounded border-border text-primary focus:ring-primary"
            />
            <div>
              <p class="text-sm font-medium text-text-primary">Confirmar creacion de ajustes</p>
              <p class="text-xs text-text-secondary mt-0.5">
                Al crear y aplicar, los movimientos de inventario seran aplicados inmediatamente
                y no podran ser revertidos.
              </p>
            </div>
          </label>
        </div>
      }

      <!-- Footer -->
      <div
        slot="footer"
        class="flex flex-col gap-3 px-5 py-4 bg-gray-50 rounded-b-xl"
      >
        <!-- Primary action (full-width) -->
        @if (!isConfirmStep) {
          <app-button
            variant="primary"
            type="button"
            (clicked)="goToStep(currentStep + 1)"
            [disabled]="!canAdvance()"
            customClasses="!rounded-xl font-bold shadow-md shadow-primary-200 !w-full !justify-center !py-3.5 !text-base"
          >
            Continuar
            <app-icon name="arrow-right" [size]="16" class="ml-2" slot="icon"></app-icon>
          </app-button>
        } @else if (confirmCreate) {
          <app-button
            variant="primary"
            type="button"
            (clicked)="onSubmitAndComplete()"
            [loading]="isSubmitting()"
            [disabled]="isSubmitting() || hasMissingType()"
            customClasses="!rounded-xl font-bold shadow-md shadow-primary-200 active:scale-95 transition-all !w-full !justify-center !py-3.5 !text-base"
          >
            <app-icon name="check-circle" [size]="18" class="mr-2" slot="icon"></app-icon>
            Crear y Aplicar
          </app-button>
        } @else {
          <app-button
            variant="primary"
            type="button"
            (clicked)="onSubmitDraft()"
            [loading]="isSubmitting()"
            [disabled]="isSubmitting() || hasMissingType()"
            customClasses="!rounded-xl font-bold shadow-md shadow-primary-200 active:scale-95 transition-all !w-full !justify-center !py-3.5 !text-base"
          >
            <app-icon name="file-text" [size]="18" class="mr-2" slot="icon"></app-icon>
            Guardar Borrador
          </app-button>
        }

        <!-- Secondary actions (icon-only row) -->
        <div class="flex items-center justify-center gap-6 py-1">
          @if (currentStep > 1) {
            <button
              type="button"
              (click)="goToStep(currentStep - 1)"
              class="text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)] transition-colors p-1"
            >
              <app-icon name="arrow-left" [size]="22"></app-icon>
            </button>
          }
          <button
            type="button"
            (click)="onCancel()"
            class="text-error hover:text-error/80 transition-colors p-1"
          >
            <app-icon name="x" [size]="22"></app-icon>
          </button>
          @if (isConfirmStep) {
            <div class="w-px h-5 bg-[var(--color-border)]"></div>
            @if (confirmCreate) {
              <button
                type="button"
                (click)="onSubmitDraft()"
                [disabled]="isSubmitting() || hasMissingType()"
                class="text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)] transition-colors p-1 disabled:opacity-40"
              >
                <app-icon name="save" [size]="22"></app-icon>
              </button>
            } @else {
              <button
                type="button"
                (click)="onSubmitAndComplete()"
                [disabled]="isSubmitting() || !confirmCreate || hasMissingType()"
                class="text-[var(--color-text-tertiary)] transition-colors p-1 disabled:opacity-40"
              >
                <app-icon name="check-circle" [size]="22"></app-icon>
              </button>
            }
          }
        </div>
      </div>
    </app-modal>
  `,
})
export class AdjustmentCreateModalComponent {
  private inventoryService = inject(InventoryService);

  readonly isOpen = input(false);
  readonly isSubmitting = input(false);
  readonly locations = input<SelectorOption[]>([]);
  readonly preselectedProduct = input<PreselectedProduct | null>(null);

  readonly isOpenChange = output<boolean>();
  readonly cancel = output<void>();
  readonly save = output<BatchCreateAdjustmentsRequest>();
  readonly saveAndComplete = output<BatchCreateAdjustmentsRequest>();

  currentStep = 1;
  steps: StepsLineItem[] = [
    { label: 'UBICACION', completed: false },
    { label: 'PRODUCTOS', completed: false },
    { label: 'CONFIRMAR', completed: false },
  ];

  // Step 1
  selectedLocation: number | null = null;

  // Step 2
  @ViewChild('productSearch') productSearchRef?: InputsearchComponent;
  readonly productSearchResults = signal<AdjustableProduct[]>([]);
  adjustmentItems: AdjustmentItem[] = [];

  // Step 3
  confirmCreate = false;

  // Preselected product loading
  readonly isLoadingPreselectedStock = signal(false);

  adjustmentTypes: { label: string; value: AdjustmentType; icon: string }[] = [
    { label: 'Dano', value: 'damage', icon: 'alert-triangle' },
    { label: 'Perdida', value: 'loss', icon: 'x-circle' },
    { label: 'Robo', value: 'theft', icon: 'shield-off' },
    { label: 'Vencido', value: 'expiration', icon: 'clock' },
    { label: 'Conteo', value: 'count_variance', icon: 'hash' },
    { label: 'Correccion', value: 'manual_correction', icon: 'edit-3' },
  ];

  get hasPreselected(): boolean { return !!this.preselectedProduct(); }

  get isLocationStep(): boolean { return this.currentStep === 1; }
  get isProductsStep(): boolean { return !this.hasPreselected && this.currentStep === 2; }
  get isConfirmStep(): boolean { return this.hasPreselected ? this.currentStep === 2 : this.currentStep === 3; }

  get modalTitle(): string {
    if (this.isLocationStep) return 'Seleccionar Ubicacion';
    if (this.isProductsStep) return 'Agregar Productos';
    return 'Confirmar Ajustes';
  }

  constructor() {
    effect(() => {
      if (this.isOpen()) {
        this.resetModal();
      }
    });
  }

  onLocationChange(value: any): void {
    this.selectedLocation = value ? +value : null;
    this.adjustmentItems = [];
    this.productSearchResults.set([]);
  }

  searchProducts(term: string): void {
    if (!term || term.length < 2 || !this.selectedLocation) {
      this.productSearchResults.set([]);
      return;
    }

    this.inventoryService.searchAdjustableProducts(term, this.selectedLocation).subscribe({
      next: (response) => {
        const products = response.data || [];
        this.productSearchResults.set(
          products.filter((p) => !this.adjustmentItems.some((ai) => ai.product_id === p.id)),
        );
      },
      error: () => {
        this.productSearchResults.set([]);
      },
    });
  }

  addProduct(product: AdjustableProduct): void {
    if (this.adjustmentItems.some((ai) => ai.product_id === product.id)) return;

    this.adjustmentItems = [
      ...this.adjustmentItems,
      {
        product_id: product.id,
        product_name: product.name,
        sku: product.sku ?? undefined,
        stock_on_hand: product.stock_at_location.quantity_on_hand,
        type: 'count_variance' as AdjustmentType,
        quantity_after: product.stock_at_location.quantity_on_hand,
        reason_code: 'INV_COUNT',
        description: '',
      },
    ];
    this.productSearchResults.set([]);
    this.productSearchRef?.clearInput();
  }

  removeItem(index: number): void {
    this.adjustmentItems = this.adjustmentItems.filter((_, i) => i !== index);
  }

  updateItemType(index: number, type: AdjustmentType): void {
    this.adjustmentItems = this.adjustmentItems.map((item, i) =>
      i === index ? { ...item, type, reason_code: this.getReasonCodeFromType(type) } : item,
    );
  }

  updateItemQuantity(index: number, event: Event): void {
    const value = +(event.target as HTMLInputElement).value;
    this.adjustmentItems = this.adjustmentItems.map((item, i) =>
      i === index ? { ...item, quantity_after: Math.max(0, value) } : item,
    );
  }

  updateItemDescription(index: number, event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.adjustmentItems = this.adjustmentItems.map((item, i) =>
      i === index ? { ...item, description: value } : item,
    );
  }

  getLocationName(id: number | null): string {
    if (!id) return '-';
    return this.locations().find((l) => l.value === id)?.label || '-';
  }

  getQuantityChange(item: AdjustmentItem): number {
    return item.quantity_after - item.stock_on_hand;
  }

  hasZeroChange(): boolean {
    return this.adjustmentItems.some((item) => this.getQuantityChange(item) === 0);
  }

  hasMissingType(): boolean {
    return this.adjustmentItems.some((item) => !item.type);
  }

  private getReasonCodeFromType(type: AdjustmentType): string {
    const map: Record<AdjustmentType, string> = {
      damage: 'DAMAGED',
      loss: 'LOST',
      theft: 'THEFT',
      expiration: 'EXPIRED',
      count_variance: 'INV_COUNT',
      manual_correction: 'OTHER',
    };
    return map[type] || '';
  }

  getTypeLabel(type: AdjustmentType): string {
    const labels: Record<AdjustmentType, string> = {
      damage: 'Dano',
      loss: 'Perdida',
      theft: 'Robo',
      expiration: 'Vencido',
      count_variance: 'Conteo',
      manual_correction: 'Correccion',
    };
    return labels[type] || type;
  }

  canAdvance(): boolean {
    if (this.currentStep === 1) {
      return !!this.selectedLocation && !this.isLoadingPreselectedStock();
    }
    if (this.isProductsStep) {
      return this.adjustmentItems.length > 0 && !this.hasMissingType();
    }
    return true;
  }

  goToStep(step: number): void {
    if (step > this.currentStep && !this.canAdvance()) return;

    // When preselected product and moving from location to next step
    if (this.hasPreselected && this.currentStep === 1 && step === 2) {
      this.loadPreselectedProductStock();
      return;
    }

    this.currentStep = step;
    this.steps = this.steps.map((s, i) => ({
      ...s,
      completed: i < step - 1,
    }));
  }

  private loadPreselectedProductStock(): void {
    const product = this.preselectedProduct()!;
    this.isLoadingPreselectedStock.set(true);

    this.inventoryService.searchAdjustableProducts(product.name, this.selectedLocation!).subscribe({
      next: (response) => {
        const products = response.data || [];
        const match = products.find((p) => p.id === product.id);

        if (match) {
          this.adjustmentItems = [];
          this.addProduct(match);
        } else {
          // Product has no stock at this location — add with 0
          this.adjustmentItems = [{
            product_id: product.id,
            product_name: product.name,
            sku: product.sku ?? undefined,
            stock_on_hand: 0,
            type: 'count_variance' as AdjustmentType,
            quantity_after: 0,
            reason_code: 'INV_COUNT',
            description: '',
          }];
        }

        this.isLoadingPreselectedStock.set(false);
        this.currentStep = 2;
        this.steps = this.steps.map((s, i) => ({
          ...s,
          completed: i < 1,
        }));
      },
      error: () => {
        this.isLoadingPreselectedStock.set(false);
        // Fallback: add with 0 stock
        this.adjustmentItems = [{
          product_id: product.id,
          product_name: product.name,
          sku: product.sku ?? undefined,
          stock_on_hand: 0,
          type: 'count_variance' as AdjustmentType,
          quantity_after: 0,
          reason_code: 'INV_COUNT',
          description: '',
        }];
        this.currentStep = 2;
        this.steps = this.steps.map((s, i) => ({
          ...s,
          completed: i < 1,
        }));
      },
    });
  }

  onCancel(): void {
    this.resetModal();
    this.cancel.emit();
  }

  onSubmitDraft(): void {
    const dto = this.buildDto();
    if (!dto) return;
    this.save.emit(dto);
  }

  onSubmitAndComplete(): void {
    const dto = this.buildDto();
    if (!dto) return;
    this.saveAndComplete.emit(dto);
  }

  private buildDto(): BatchCreateAdjustmentsRequest | null {
    if (!this.selectedLocation || this.adjustmentItems.length === 0) return null;
    if (this.hasMissingType()) return null;

    return {
      location_id: this.selectedLocation,
      items: this.adjustmentItems.map((item) => ({
        product_id: item.product_id,
        type: item.type,
        quantity_after: item.quantity_after,
        ...(item.reason_code && { reason_code: item.reason_code }),
        ...(item.description && { description: item.description }),
      })),
    };
  }

  private resetModal(): void {
    this.currentStep = 1;
    this.steps = this.hasPreselected
      ? [
          { label: 'UBICACION', completed: false },
          { label: 'CONFIRMAR', completed: false },
        ]
      : [
          { label: 'UBICACION', completed: false },
          { label: 'PRODUCTOS', completed: false },
          { label: 'CONFIRMAR', completed: false },
        ];
    this.selectedLocation = null;
    this.productSearchResults.set([]);
    this.adjustmentItems = [];
    this.productSearchRef?.clearInput();
    this.confirmCreate = false;
    this.isLoadingPreselectedStock.set(false);
  }
}
