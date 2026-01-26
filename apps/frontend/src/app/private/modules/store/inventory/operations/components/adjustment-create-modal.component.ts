import {
  Component,
  Input,
  Output,
  EventEmitter,
  OnInit,
  OnChanges,
  SimpleChanges,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import {
  FormBuilder,
  FormGroup,
  Validators,
  ReactiveFormsModule,
} from '@angular/forms';

// Shared Components
import {
  ModalComponent,
  ButtonComponent,
  InputComponent,
  SelectorComponent,
  SelectorOption,
  TextareaComponent,
  IconComponent,
} from '../../../../../../shared/components/index';

// Services
import { InventoryService } from '../../services';

// Interfaces
import {
  CreateAdjustmentDto,
  AdjustmentType,
  StockLevel,
  InventoryBatch,
} from '../../interfaces';

interface LocationStockOption {
  location_id: number;
  location_name: string;
  location_code: string;
  location_type?: string;
  quantity_on_hand: number;
  quantity_available: number;
  quantity_reserved: number;
}

@Component({
  selector: 'app-adjustment-create-modal',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    ModalComponent,
    ButtonComponent,
    InputComponent,
    SelectorComponent,
    TextareaComponent,
    IconComponent,
  ],
  template: `
    <app-modal
      [isOpen]="isOpen"
      [title]="modalTitle"
      size="md"
      (closed)="onCancel()"
      (isOpenChange)="isOpenChange.emit($event)"
      (cancel)="onCancel()"
      [size]="'md'"
      title="Nuevo Ajuste de Inventario"
      subtitle="Registra un ajuste de inventario"
    >
      <!-- Step Indicator -->
      <div class="flex items-center justify-center mb-8 px-4">
        <!-- Step 1 -->
        <div class="flex flex-col items-center gap-2 relative z-10">
          <div
            class="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold transition-all duration-300"
            [class]="
              currentStep === 1
                ? 'bg-primary text-white ring-4 ring-primary/20 shadow-lg scale-110'
                : 'bg-success text-white ring-4 ring-success/20 shadow-md'
            "
          >
            @if (currentStep > 1) {
              <app-icon name="check" [size]="18" class="text-white"></app-icon>
            } @else {
              1
            }
          </div>
          <span
            class="text-xs font-bold uppercase tracking-wider transition-colors duration-300"
            [class]="currentStep >= 1 ? 'text-primary' : 'text-text-muted'"
          >
            Seleccionar
          </span>
        </div>

        <!-- Connection Line -->
        <div class="w-24 h-1 mx-2 relative -top-3">
          <div class="absolute inset-0 bg-gray-200 rounded-full"></div>
          <div
            class="absolute inset-0 bg-success rounded-full transition-all duration-500 ease-out"
            [style.width]="currentStep > 1 ? '100%' : '0%'"
          ></div>
        </div>

        <!-- Step 2 -->
        <div class="flex flex-col items-center gap-2 relative z-10">
          <div
            class="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold transition-all duration-300 border-2"
            [class]="
              currentStep === 2
                ? 'bg-primary border-primary text-white ring-4 ring-primary/20 shadow-lg scale-110'
                : 'bg-white border-gray-300 text-gray-400'
            "
          >
            2
          </div>
          <span
            class="text-xs font-bold uppercase tracking-wider transition-colors duration-300"
            [class]="currentStep === 2 ? 'text-primary' : 'text-text-muted'"
          >
            Registrar
          </span>
        </div>
      </div>

      <!-- STEP 1: Location & Batch Selection -->
      @if (currentStep === 1) {
        <div class="space-y-6">
          <!-- Product Info Header -->
          <div class="p-4 bg-surface-secondary rounded-xl border border-border">
            <div class="flex items-center gap-3">
              <div
                class="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center"
              >
                <app-icon
                  name="package"
                  [size]="20"
                  class="text-primary"
                ></app-icon>
              </div>
              <div>
                <p class="font-semibold text-text-primary">
                  {{ product?.name || 'Producto' }}
                </p>
                <p class="text-sm text-text-secondary">
                  SKU: {{ product?.sku || 'N/A' }}
                </p>
              </div>
            </div>
          </div>

          <!-- Loading State -->
          @if (isLoadingStock) {
            <div class="flex items-center justify-center py-8">
              <div
                class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"
              ></div>
              <span class="ml-3 text-text-secondary">Cargando stock...</span>
            </div>
          }

          <!-- No Stock Available -->
          @if (!isLoadingStock && locationStockOptions.length === 0) {
            <div class="text-center py-8 px-4">
              <div
                class="w-16 h-16 bg-warning/10 rounded-full flex items-center justify-center mx-auto mb-4"
              >
                <app-icon
                  name="alert-circle"
                  [size]="32"
                  class="text-warning"
                ></app-icon>
              </div>
              <h3 class="text-lg font-bold text-text-primary mb-2">
                Sin Stock Registrado
              </h3>
              <p class="text-text-secondary mb-6 max-w-xs mx-auto">
                Este producto no tiene stock registrado en ninguna bodega.
                Primero debes agregar stock mediante una orden de compra.
              </p>
              <app-button
                variant="primary"
                (clicked)="goToPurchase()"
                customClasses="w-full sm:w-auto shadow-lg shadow-primary/20"
              >
                <app-icon
                  name="cart"
                  [size]="18"
                  class="mr-2"
                  slot="icon"
                ></app-icon>
                Ir a Punto de Compra
              </app-button>
            </div>
          }

          <!-- Location Selection (Radio Buttons) -->
          @if (!isLoadingStock && locationStockOptions.length > 0) {
            <div>
              <label class="block text-sm font-medium text-text-secondary mb-3">
                Seleccionar Bodega *
              </label>
              <div class="space-y-2">
                @for (
                  option of locationStockOptions;
                  track option.location_id
                ) {
                  <button
                    type="button"
                    (click)="selectLocation(option)"
                    class="w-full p-4 rounded-xl border-2 transition-all text-left"
                    [class]="
                      selectedLocation?.location_id === option.location_id
                        ? 'border-primary bg-primary/5'
                        : 'border-border hover:border-muted bg-surface'
                    "
                  >
                    <div class="flex items-center justify-between">
                      <div class="flex items-center gap-3">
                        <!-- Radio indicator -->
                        <div
                          class="w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors"
                          [class]="
                            selectedLocation?.location_id === option.location_id
                              ? 'border-primary'
                              : 'border-muted'
                          "
                        >
                          @if (
                            selectedLocation?.location_id === option.location_id
                          ) {
                            <div class="w-3 h-3 rounded-full bg-primary"></div>
                          }
                        </div>
                        <div>
                          <p class="font-medium text-text-primary">
                            {{ option.location_name }}
                          </p>
                          <p class="text-xs text-text-secondary">
                            {{ option.location_code }}
                            @if (option.location_type) {
                              <span
                                class="ml-1 px-1.5 py-0.5 bg-muted/20 rounded text-text-muted"
                              >
                                {{ getLocationTypeLabel(option.location_type) }}
                              </span>
                            }
                          </p>
                        </div>
                      </div>
                      <div class="text-right">
                        <p class="text-lg font-bold text-text-primary">
                          {{ option.quantity_on_hand }}
                        </p>
                        <p class="text-xs text-text-secondary">
                          disponible: {{ option.quantity_available }}
                        </p>
                      </div>
                    </div>
                  </button>
                }
              </div>
            </div>

            <!-- Batch Selection (Optional) -->
            @if (selectedLocation && batchOptions.length > 0) {
              <div>
                <label
                  class="block text-sm font-medium text-text-secondary mb-3"
                >
                  Seleccionar Lote (Opcional)
                </label>
                <div class="space-y-2">
                  <!-- No batch option -->
                  <button
                    type="button"
                    (click)="selectBatch(null)"
                    class="w-full p-3 rounded-xl border-2 transition-all text-left"
                    [class]="
                      selectedBatch === null
                        ? 'border-primary bg-primary/5'
                        : 'border-border hover:border-muted bg-surface'
                    "
                  >
                    <div class="flex items-center gap-3">
                      <div
                        class="w-5 h-5 rounded-full border-2 flex items-center justify-center"
                        [class]="
                          selectedBatch === null
                            ? 'border-primary'
                            : 'border-muted'
                        "
                      >
                        @if (selectedBatch === null) {
                          <div class="w-3 h-3 rounded-full bg-primary"></div>
                        }
                      </div>
                      <span class="text-text-secondary"
                        >Ajustar stock general (sin lote específico)</span
                      >
                    </div>
                  </button>

                  @for (batch of batchOptions; track batch.id) {
                    <button
                      type="button"
                      (click)="selectBatch(batch)"
                      class="w-full p-3 rounded-xl border-2 transition-all text-left"
                      [class]="
                        selectedBatch?.id === batch.id
                          ? 'border-primary bg-primary/5'
                          : 'border-border hover:border-muted bg-surface'
                      "
                    >
                      <div class="flex items-center justify-between">
                        <div class="flex items-center gap-3">
                          <div
                            class="w-5 h-5 rounded-full border-2 flex items-center justify-center"
                            [class]="
                              selectedBatch?.id === batch.id
                                ? 'border-primary'
                                : 'border-muted'
                            "
                          >
                            @if (selectedBatch?.id === batch.id) {
                              <div
                                class="w-3 h-3 rounded-full bg-primary"
                              ></div>
                            }
                          </div>
                          <div>
                            <p class="font-medium text-text-primary">
                              {{ batch.batch_number }}
                            </p>
                            @if (batch.expiration_date) {
                              <p
                                class="text-xs"
                                [class]="
                                  isExpiringSoon(batch.expiration_date)
                                    ? 'text-warning'
                                    : 'text-text-secondary'
                                "
                              >
                                Vence:
                                {{ batch.expiration_date | date: 'dd/MM/yyyy' }}
                                @if (isExpiringSoon(batch.expiration_date)) {
                                  <app-icon
                                    name="alert-triangle"
                                    [size]="12"
                                    class="inline ml-1"
                                  ></app-icon>
                                }
                              </p>
                            }
                          </div>
                        </div>
                        <div class="text-right">
                          <p class="font-bold text-text-primary">
                            {{ getBatchAvailable(batch) }}
                          </p>
                          <p class="text-xs text-text-secondary">unidades</p>
                        </div>
                      </div>
                    </button>
                  }
                </div>
              </div>
            }

            <!-- Loading Batches -->
            @if (isLoadingBatches) {
              <div class="flex items-center justify-center py-4">
                <div
                  class="animate-spin rounded-full h-5 w-5 border-b-2 border-primary"
                ></div>
                <span class="ml-2 text-sm text-text-secondary"
                  >Cargando lotes...</span
                >
              </div>
            }

            <!-- Zero Stock Action (When location is selected but has 0 stock) -->
            @if (selectedLocation && currentQuantity === 0) {
              <div
                class="mt-4 p-4 bg-primary/5 rounded-xl border border-primary/20 flex flex-col items-center text-center"
              >
                <div
                  class="w-10 h-10 bg-primary/10 rounded-full flex items-center justify-center mb-2"
                >
                  <app-icon
                    name="info"
                    [size]="20"
                    class="text-primary"
                  ></app-icon>
                </div>
                <p class="text-sm font-medium text-text-primary mb-1">
                  Sin stock físico en esta ubicación
                </p>
                <p class="text-xs text-text-secondary mb-3">
                  Puedes registrar un ajuste de entrada (ej. conteo inicial) o
                  realizar una compra.
                </p>
                <app-button
                  variant="outline"
                  size="sm"
                  (clicked)="goToPurchase()"
                  customClasses="w-full sm:w-auto"
                >
                  <app-icon
                    name="cart"
                    [size]="14"
                    class="mr-2"
                    slot="icon"
                  ></app-icon>
                  Ir a Punto de Compra
                </app-button>
              </div>
            }
          }
        </div>
      }

      <!-- STEP 2: Adjustment Form -->
      @if (currentStep === 2) {
        <form [formGroup]="form" class="space-y-6">
          <!-- Selected Location/Batch Summary -->
          <div class="p-4 bg-surface-secondary rounded-xl border border-border">
            <div class="flex items-start gap-3">
              <div
                class="w-10 h-10 bg-info/10 rounded-lg flex items-center justify-center flex-shrink-0"
              >
                <app-icon
                  name="map-pin"
                  [size]="20"
                  class="text-info"
                ></app-icon>
              </div>
              <div class="flex-1">
                <p class="font-semibold text-text-primary">
                  {{ selectedLocation?.location_name }}
                </p>
                <p class="text-sm text-text-secondary">{{ product?.name }}</p>
                @if (selectedBatch) {
                  <p class="text-sm text-primary mt-1">
                    <app-icon
                      name="layers"
                      [size]="14"
                      class="inline mr-1"
                    ></app-icon>
                    Lote: {{ selectedBatch.batch_number }}
                  </p>
                }
              </div>
              <button
                type="button"
                (click)="goToStep(1)"
                class="text-sm text-primary hover:underline"
              >
                Cambiar
              </button>
            </div>
          </div>

          <!-- Adjustment Type -->
          <div>
            <label class="block text-sm font-medium text-text-secondary mb-3"
              >Tipo de Ajuste *</label
            >
            <div class="grid grid-cols-3 gap-2">
              @for (type of adjustment_types; track type.value) {
                <button
                  type="button"
                  (click)="selectType(type.value)"
                  [class]="getTypeButtonClasses(type.value)"
                >
                  <app-icon
                    [name]="type.icon"
                    [size]="16"
                    class="mb-1"
                  ></app-icon>
                  <span class="text-xs">{{ type.label }}</span>
                </button>
              }
            </div>
          </div>

          <!-- Quantity -->
          <div class="grid grid-cols-2 gap-4">
            <div>
              <label class="block text-sm font-medium text-text-secondary mb-1"
                >Cantidad Actual</label
              >
              <div
                class="p-3 bg-surface-secondary rounded-xl border border-border"
              >
                <span class="text-2xl font-bold text-text-primary">{{
                  currentQuantity
                }}</span>
                <span class="text-sm text-text-secondary ml-1">unidades</span>
              </div>
            </div>
            <div>
              <label class="block text-sm font-medium text-text-secondary mb-1"
                >Nueva Cantidad *</label
              >
              <app-input
                formControlName="quantity_after"
                type="number"
                [error]="getError('quantity_after')"
              ></app-input>
            </div>
          </div>

          <!-- Quantity Change Preview -->
          @if (
            form.get('quantity_after')?.value !== null &&
            form.get('quantity_after')?.value !== ''
          ) {
            <div
              class="p-3 rounded-xl border"
              [class]="
                quantityDifference > 0
                  ? 'bg-success/5 border-success/30'
                  : quantityDifference < 0
                    ? 'bg-error/5 border-error/30'
                    : 'bg-muted/10 border-border'
              "
            >
              <div class="flex items-center justify-center gap-2">
                @if (quantityDifference !== 0) {
                  <app-icon
                    [name]="
                      quantityDifference > 0 ? 'trending-up' : 'trending-down'
                    "
                    [size]="20"
                    [class]="
                      quantityDifference > 0 ? 'text-success' : 'text-error'
                    "
                  ></app-icon>
                }
                <span
                  class="font-bold"
                  [class]="
                    quantityDifference > 0
                      ? 'text-success'
                      : quantityDifference < 0
                        ? 'text-error'
                        : 'text-text-secondary'
                  "
                >
                  {{ quantityDifference > 0 ? '+' : ''
                  }}{{ quantityDifference }} unidades
                </span>
              </div>
            </div>
          }

          <!-- Reason -->
          <div>
            <label class="block text-sm font-medium text-text-secondary mb-1"
              >Codigo de Razon</label
            >
            <app-selector
              [options]="reason_options"
              formControlName="reason_code"
              placeholder="Seleccionar razon"
            ></app-selector>
          </div>

          <!-- Description -->
          <div>
            <app-textarea
            label="Descripcion"
            formControlName="description"
            [rows]="3"
            placeholder="Describir el motivo del ajuste..."
            [control]="form.get('description')"
          ></app-textarea>

        </div>
      </form>
      }

      <!-- Footer -->
      <div
        slot="footer"
        class="flex justify-between gap-3 px-6 py-4 bg-gray-50 rounded-b-xl"
      >
        <div>
          @if (currentStep === 2) {
            <app-button
              variant="outline"
              type="button"
              (clicked)="goToStep(1)"
              customClasses="!rounded-xl"
            >
              <app-icon name="arrow-left" [size]="16" class="mr-1"></app-icon>
              Atras
            </app-button>
          }
        </div>
        <div class="flex gap-3">
          <app-button
            variant="outline"
            type="button"
            (clicked)="onCancel()"
            customClasses="!rounded-xl font-bold"
          >
            Cancelar
          </app-button>
          @if (currentStep === 1) {
            <app-button
              variant="primary"
              type="button"
              (clicked)="goToStep(2)"
              [disabled]="!selectedLocation"
              customClasses="!rounded-xl font-bold shadow-md shadow-primary-200"
            >
              Continuar
              <app-icon name="arrow-right" [size]="16" class="ml-1"></app-icon>
            </app-button>
          } @else {
            <app-button
              variant="primary"
              type="button"
              (clicked)="onSubmit()"
              [loading]="isSubmitting"
              [disabled]="form.invalid || isSubmitting || !selected_type"
              customClasses="!rounded-xl font-bold shadow-md shadow-primary-200 active:scale-95 transition-all"
            >
              Crear Ajuste
            </app-button>
          }
        </div>
      </div>
    </app-modal>
  `,
})
export class AdjustmentCreateModalComponent implements OnInit, OnChanges {
  @Input() isOpen = false;
  @Input() isSubmitting = false;
  @Input() product: any = null;

  @Output() isOpenChange = new EventEmitter<boolean>();
  @Output() cancel = new EventEmitter<void>();
  @Output() save = new EventEmitter<CreateAdjustmentDto>();

  // Step management
  currentStep = 1;

  // Step 1: Location & Batch selection
  locationStockOptions: LocationStockOption[] = [];
  batchOptions: InventoryBatch[] = [];
  selectedLocation: LocationStockOption | null = null;
  selectedBatch: InventoryBatch | null = null;
  isLoadingStock = false;
  isLoadingBatches = false;

  // Step 2: Form
  form: FormGroup;
  selected_type: AdjustmentType | null = null;
  currentQuantity = 0;

  reason_options: SelectorOption[] = [
    { value: 'INV_COUNT', label: 'Conteo de inventario' },
    { value: 'DAMAGED', label: 'Producto danado' },
    { value: 'EXPIRED', label: 'Producto vencido' },
    { value: 'LOST', label: 'Producto perdido' },
    { value: 'THEFT', label: 'Robo confirmado' },
    { value: 'OTHER', label: 'Otro' },
  ];

  adjustment_types: { label: string; value: AdjustmentType; icon: string }[] = [
    { label: 'Dano', value: 'damage', icon: 'alert-triangle' },
    { label: 'Perdida', value: 'loss', icon: 'x-circle' },
    { label: 'Robo', value: 'theft', icon: 'shield-off' },
    { label: 'Vencido', value: 'expiration', icon: 'clock' },
    { label: 'Conteo', value: 'count_variance', icon: 'hash' },
    { label: 'Correccion', value: 'manual_correction', icon: 'edit-3' },
  ];

  constructor(
    private fb: FormBuilder,
    private inventoryService: InventoryService,
    private router: Router,
  ) {
    this.form = this.createForm();
  }

  goToPurchase(): void {
    if (this.product?.id) {
      this.onCancel(); // Close modal first
      this.router.navigate(['/admin/inventory/pop'], {
        queryParams: { product_id: this.product.id },
      });
    }
  }

  ngOnInit(): void {
    // Load when product is available
    if (this.product && this.isOpen) {
      this.loadStockLevels();
    }
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['isOpen'] && this.isOpen) {
      this.resetModal();
      if (this.product) {
        this.loadStockLevels();
      }
    }
  }

  get modalTitle(): string {
    if (this.currentStep === 1) {
      return 'Seleccionar Ubicacion';
    }
    return 'Registrar Ajuste';
  }

  get quantityDifference(): number {
    const newQty = this.form.get('quantity_after')?.value;
    if (newQty === null || newQty === '' || isNaN(Number(newQty))) {
      return 0;
    }
    return Number(newQty) - this.currentQuantity;
  }

  private createForm(): FormGroup {
    return this.fb.group({
      quantity_after: [null, [Validators.required, Validators.min(0)]],
      reason_code: [''],
      description: [''],
    });
  }

  private resetModal(): void {
    this.currentStep = 1;
    this.locationStockOptions = [];
    this.batchOptions = [];
    this.selectedLocation = null;
    this.selectedBatch = null;
    this.selected_type = null;
    this.currentQuantity = 0;
    this.form.reset();
  }

  loadStockLevels(): void {
    if (!this.product?.id) return;

    this.isLoadingStock = true;
    this.inventoryService.getStockLevelsByProduct(this.product.id).subscribe({
      next: (response) => {
        this.isLoadingStock = false;
        if (response.data) {
          this.locationStockOptions = response.data.map((sl: StockLevel) => ({
            location_id: sl.location_id,
            location_name: sl.location?.name || `Ubicacion ${sl.location_id}`,
            location_code: sl.location?.code || '',
            location_type: sl.location?.type,
            quantity_on_hand: sl.quantity_on_hand,
            quantity_available: sl.quantity_available,
            quantity_reserved: sl.quantity_reserved,
          }));
        }
      },
      error: (err) => {
        this.isLoadingStock = false;
        console.error('Error loading stock levels:', err);
      },
    });
  }

  selectLocation(option: LocationStockOption): void {
    this.selectedLocation = option;
    this.selectedBatch = null; // Reset batch when location changes
    this.currentQuantity = option.quantity_on_hand;
    this.loadBatches(option.location_id);
  }

  loadBatches(locationId: number): void {
    if (!this.product?.id) return;

    this.isLoadingBatches = true;
    this.inventoryService
      .getBatchesByProduct(this.product.id, locationId)
      .subscribe({
        next: (response) => {
          this.isLoadingBatches = false;
          this.batchOptions = response.data || [];
        },
        error: (err) => {
          this.isLoadingBatches = false;
          this.batchOptions = [];
          console.error('Error loading batches:', err);
        },
      });
  }

  selectBatch(batch: InventoryBatch | null): void {
    this.selectedBatch = batch;
    if (batch) {
      this.currentQuantity = this.getBatchAvailable(batch);
    } else if (this.selectedLocation) {
      this.currentQuantity = this.selectedLocation.quantity_on_hand;
    }
  }

  getBatchAvailable(batch: InventoryBatch): number {
    return batch.quantity - batch.quantity_used;
  }

  isExpiringSoon(expirationDate: string): boolean {
    const expDate = new Date(expirationDate);
    const today = new Date();
    const daysUntilExpiry = Math.ceil(
      (expDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24),
    );
    return daysUntilExpiry <= 30 && daysUntilExpiry >= 0;
  }

  getLocationTypeLabel(type: string): string {
    const labels: Record<string, string> = {
      warehouse: 'Bodega',
      store: 'Tienda',
      virtual: 'Virtual',
      transit: 'Transito',
    };
    return labels[type] || type;
  }

  goToStep(step: number): void {
    if (step === 2 && !this.selectedLocation) {
      return;
    }
    this.currentStep = step;
  }

  selectType(type: AdjustmentType): void {
    this.selected_type = type;
  }

  getTypeButtonClasses(type: AdjustmentType): string {
    const base =
      'flex flex-col items-center p-3 rounded-lg border transition-colors';
    if (type === this.selected_type) {
      return `${base} border-primary bg-primary/10 text-primary`;
    }
    return `${base} border-border bg-surface text-text-secondary hover:border-muted hover:bg-muted/10`;
  }

  getError(field: string): string {
    const control = this.form.get(field);
    if (control?.touched && control?.errors) {
      if (control.errors['required']) return 'Este campo es requerido';
      if (control.errors['min']) return 'El valor minimo es 0';
    }
    return '';
  }

  onCancel(): void {
    this.resetModal();
    this.cancel.emit();
  }

  onSubmit(): void {
    if (this.form.valid && this.selected_type && this.selectedLocation) {
      const formValue = this.form.getRawValue();

      const dto: CreateAdjustmentDto = {
        product_id: this.product?.id,
        product_variant_id: undefined,
        location_id: this.selectedLocation.location_id,
        batch_id: this.selectedBatch?.id,
        type: this.selected_type,
        quantity_after: Number(formValue.quantity_after),
        reason_code: formValue.reason_code || undefined,
        description: formValue.description || undefined,
      };

      this.save.emit(dto);
    }
  }
}
