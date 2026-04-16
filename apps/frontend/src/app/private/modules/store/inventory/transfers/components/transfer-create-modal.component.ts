import {
  Component,
  inject,
  input,
  output,
  effect,
  viewChild,
} from '@angular/core';

import { FormsModule } from '@angular/forms';

import {
  ModalComponent,
  ButtonComponent,
  InputComponent,
  SelectorComponent,
  SelectorOption,
  TextareaComponent,
  IconComponent,
  StepsLineComponent,
  StepsLineItem,
  InputsearchComponent,
} from '../../../../../../shared/components/index';

import { CreateTransferRequest, LocationStock, TransferableProduct } from '../interfaces';
import { TransfersService } from '../services/transfers.service';

interface TransferItem {
  product_id: number;
  product_name: string;
  sku?: string;
  quantity: number;
  stock_at_origin: LocationStock;
  stock_at_destination: LocationStock;
}

@Component({
  selector: 'app-transfer-create-modal',
  standalone: true,
  imports: [
    FormsModule,
    ModalComponent,
    ButtonComponent,
    InputComponent,
    SelectorComponent,
    TextareaComponent,
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
      subtitle="Mover productos entre ubicaciones"
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

      <!-- STEP 1: Locations -->
      @if (currentStep === 1) {
        <div class="space-y-6">
          <div>
            <label class="block text-sm font-medium text-text-secondary mb-2">Ubicacion Origen *</label>
            <app-selector
              [options]="locationOptions"
              [ngModel]="selectedFromLocation"
              placeholder="Seleccionar origen"
              (ngModelChange)="onFromLocationChange($event)"
            ></app-selector>
          </div>

          <div>
            <label class="block text-sm font-medium text-text-secondary mb-2">Ubicacion Destino *</label>
            <app-selector
              [options]="filteredToLocations"
              [ngModel]="selectedToLocation"
              placeholder="Seleccionar destino"
              (ngModelChange)="onToLocationChange($event)"
            ></app-selector>
          </div>

          @if (selectedFromLocation && selectedToLocation && selectedFromLocation === selectedToLocation) {
            <div class="p-3 bg-error/10 rounded-xl border border-error/30 text-sm text-error flex items-center gap-2">
              <app-icon name="alert-circle" [size]="16"></app-icon>
              Las ubicaciones de origen y destino deben ser diferentes
            </div>
          }

          <div>
            <label class="block text-sm font-medium text-text-secondary mb-2">Fecha Esperada</label>
            <app-input
              type="date"
              [(ngModel)]="expectedDate"
            ></app-input>
          </div>

          <app-textarea
            label="Notas"
            [(ngModel)]="notes"
            [rows]="3"
            placeholder="Notas opcionales sobre la transferencia..."
          ></app-textarea>
        </div>
      }

      <!-- STEP 2: Products -->
      @if (currentStep === 2) {
        <div class="space-y-4">
          <!-- Location Summary -->
          <div class="p-3 bg-surface-secondary rounded-xl border border-border flex items-center gap-3">
            <app-icon name="map-pin" [size]="18" class="text-primary"></app-icon>
            <span class="text-sm font-medium text-text-primary">
              {{ getLocationName(selectedFromLocation) }}
            </span>
            <app-icon name="arrow-right" [size]="16" class="text-text-secondary"></app-icon>
            <span class="text-sm font-medium text-text-primary">
              {{ getLocationName(selectedToLocation) }}
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
          @if (productSearchResults.length > 0) {
            <div class="max-h-48 overflow-y-auto border border-border rounded-xl divide-y divide-border">
              @for (product of productSearchResults; track product.id) {
                <button
                  type="button"
                  class="w-full p-3 text-left hover:bg-primary/5 transition-colors"
                  [class.opacity-50]="product.stock_at_origin.quantity_available === 0"
                  (click)="addProduct(product)"
                >
                  <div class="flex items-center justify-between">
                    <div>
                      <p class="text-sm font-medium text-text-primary">{{ product.name }}</p>
                      <p class="text-xs text-text-secondary">SKU: {{ product.sku || 'N/A' }}</p>
                    </div>
                    <div class="text-right">
                      <p class="text-xs font-medium" [class.text-error]="product.stock_at_origin.quantity_available === 0" [class.text-text-primary]="product.stock_at_origin.quantity_available > 0">
                        Origen: {{ product.stock_at_origin.quantity_available }}
                      </p>
                      <p class="text-xs text-text-secondary">
                        Destino: {{ product.stock_at_destination.quantity_available }}
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
              Productos a Transferir ({{ transferItems.length }})
            </label>

            @if (transferItems.length === 0) {
              <div class="p-6 text-center border border-dashed border-border rounded-xl">
                <app-icon name="package" [size]="32" class="mx-auto mb-2 text-gray-300"></app-icon>
                <p class="text-sm text-text-secondary">Busca y agrega productos para transferir</p>
              </div>
            }

            @for (item of transferItems; track item.product_id; let i = $index) {
              <div class="p-3 bg-surface rounded-xl border border-border mb-2">
                <div class="flex items-center justify-between mb-2">
                  <div>
                    <p class="text-sm font-medium text-text-primary">{{ item.product_name }}</p>
                    <p class="text-xs text-text-secondary">
                      Origen: {{ item.stock_at_origin.quantity_available }} disponibles
                      <span class="mx-1">|</span>
                      Destino: {{ item.stock_at_destination.quantity_available }}
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
                <div class="flex items-center gap-2">
                  <label class="text-xs text-text-secondary whitespace-nowrap">Cantidad:</label>
                  <input
                    type="number"
                    [min]="1"
                    [max]="item.stock_at_origin.quantity_available"
                    [value]="item.quantity"
                    (input)="updateQuantity(i, $event)"
                    class="w-24 px-3 py-1.5 text-sm border border-border rounded-lg bg-surface focus:border-primary focus:ring-1 focus:ring-primary outline-none"
                  />
                  @if (item.quantity > item.stock_at_origin.quantity_available) {
                    <span class="text-xs text-error">Excede el stock disponible</span>
                  }
                </div>
              </div>
            }
          </div>
        </div>
      }

      <!-- STEP 3: Summary with Inventory Projection -->
      @if (currentStep === 3) {
        <div class="space-y-4">
          <!-- Location & meta info -->
          <div class="p-4 bg-surface-secondary rounded-xl border border-border space-y-3">
            <div class="flex items-center gap-3">
              <app-icon name="map-pin" [size]="18" class="text-info"></app-icon>
              <div>
                <p class="text-xs text-text-secondary">Origen</p>
                <p class="text-sm font-medium text-text-primary">{{ getLocationName(selectedFromLocation) }}</p>
              </div>
            </div>
            <div class="flex items-center gap-3">
              <app-icon name="map-pin" [size]="18" class="text-success"></app-icon>
              <div>
                <p class="text-xs text-text-secondary">Destino</p>
                <p class="text-sm font-medium text-text-primary">{{ getLocationName(selectedToLocation) }}</p>
              </div>
            </div>
            @if (expectedDate) {
              <div class="flex items-center gap-3">
                <app-icon name="calendar" [size]="18" class="text-warning"></app-icon>
                <div>
                  <p class="text-xs text-text-secondary">Fecha Esperada</p>
                  <p class="text-sm font-medium text-text-primary">{{ expectedDate }}</p>
                </div>
              </div>
            }
            @if (notes) {
              <div class="flex items-center gap-3">
                <app-icon name="file-text" [size]="18" class="text-text-secondary"></app-icon>
                <div>
                  <p class="text-xs text-text-secondary">Notas</p>
                  <p class="text-sm text-text-primary">{{ notes }}</p>
                </div>
              </div>
            }
          </div>

          <!-- Inventory Projection Table -->
          <div>
            <h4 class="text-sm font-medium text-text-secondary mb-2">
              Proyeccion de Inventario ({{ transferItems.length }})
            </h4>
            <div class="border border-border rounded-xl overflow-hidden">
              <!-- Table Header -->
              <div class="grid grid-cols-[1fr_60px_1fr_1fr] gap-0 bg-surface-secondary text-xs font-medium text-text-secondary border-b border-border">
                <div class="px-3 py-2">Producto</div>
                <div class="px-3 py-2 text-center">Cant.</div>
                <div class="px-3 py-2 text-center">Origen</div>
                <div class="px-3 py-2 text-center">Destino</div>
              </div>
              <!-- Table Body -->
              @for (item of transferItems; track item.product_id) {
                <div class="grid grid-cols-[1fr_60px_1fr_1fr] gap-0 border-b border-border last:border-b-0 items-center">
                  <!-- Product -->
                  <div class="px-3 py-2.5">
                    <p class="text-sm font-medium text-text-primary truncate">{{ item.product_name }}</p>
                    @if (item.sku) {
                      <p class="text-xs text-text-secondary">{{ item.sku }}</p>
                    }
                  </div>
                  <!-- Quantity -->
                  <div class="px-3 py-2.5 text-center">
                    <span class="text-sm font-bold text-text-primary">{{ item.quantity }}</span>
                  </div>
                  <!-- Origin Projection -->
                  <div class="px-3 py-2.5 text-center">
                    <div class="flex items-center justify-center gap-1 text-xs">
                      <span class="text-text-secondary">{{ item.stock_at_origin.quantity_available }}</span>
                      <app-icon name="arrow-right" [size]="12" class="text-text-secondary"></app-icon>
                      <span
                        class="font-bold"
                        [class.text-error]="getOriginAfter(item) < 0"
                        [class.text-warning]="getOriginAfter(item) >= 0 && getOriginAfter(item) <= 5"
                        [class.text-text-primary]="getOriginAfter(item) > 5"
                      >{{ getOriginAfter(item) }}</span>
                    </div>
                  </div>
                  <!-- Destination Projection -->
                  <div class="px-3 py-2.5 text-center">
                    <div class="flex items-center justify-center gap-1 text-xs">
                      <span class="text-text-secondary">{{ item.stock_at_destination.quantity_available }}</span>
                      <app-icon name="arrow-right" [size]="12" class="text-text-secondary"></app-icon>
                      <span class="font-bold text-success">{{ getDestinationAfter(item) }}</span>
                    </div>
                  </div>
                </div>
              }
            </div>
          </div>

          <!-- Negative Stock Warning -->
          @if (hasNegativeProjection()) {
            <div class="p-3 bg-error/10 rounded-xl border border-error/30 text-sm text-error flex items-center gap-2">
              <app-icon name="alert-triangle" [size]="16"></app-icon>
              Algunos productos quedaran con stock negativo en origen. Revisa las cantidades.
            </div>
          }

          <!-- Total -->
          <div class="p-3 bg-primary/5 rounded-xl border border-primary/20 text-center">
            <p class="text-sm text-text-secondary">Total de unidades a transferir</p>
            <p class="text-2xl font-bold text-primary">{{ getTotalQuantity() }}</p>
          </div>

          <!-- Confirmation checkbox -->
          <label class="flex items-start gap-3 p-3 bg-warning/5 rounded-xl border border-warning/20 cursor-pointer select-none">
            <input
              type="checkbox"
              [(ngModel)]="confirmCreate"
              class="mt-0.5 w-4 h-4 rounded border-border text-primary focus:ring-primary"
            />
            <div>
              <p class="text-sm font-medium text-text-primary">Confirmar creacion de transferencia</p>
              <p class="text-xs text-text-secondary mt-0.5">
                Al aprobar y completar esta transferencia, se aplicaran los movimientos de inventario
                restando stock del origen y sumando al destino.
              </p>
            </div>
          </label>
        </div>
      }

      <!-- Footer -->
      <div
        slot="footer"
        class="flex justify-between gap-3 px-6 py-4 bg-gray-50 rounded-b-xl"
      >
        <div>
          @if (currentStep > 1) {
            <app-button variant="outline" type="button" (clicked)="goToStep(currentStep - 1)" customClasses="!rounded-xl">
              <app-icon name="arrow-left" [size]="14" class="mr-1.5" slot="icon"></app-icon>
              Atras
            </app-button>
          }
        </div>
        <div class="flex gap-3">
          <app-button variant="outline" type="button" (clicked)="onCancel()" customClasses="!rounded-xl font-bold !text-error !border-error hover:!bg-error/5">
            Cancelar
          </app-button>
          @if (currentStep < 3) {
            <app-button
              variant="primary"
              type="button"
              (clicked)="goToStep(currentStep + 1)"
              [disabled]="!canAdvance()"
              customClasses="!rounded-xl font-bold shadow-md shadow-primary-200"
            >
              Continuar
              <app-icon name="arrow-right" [size]="14" class="ml-1.5" slot="icon"></app-icon>
            </app-button>
          } @else {
            <app-button
              variant="outline"
              type="button"
              (clicked)="onSubmitDraft()"
              [loading]="isSubmitting()"
              [disabled]="isSubmitting() || hasNegativeProjection()"
              customClasses="!rounded-xl font-bold"
            >
              <app-icon name="file-text" [size]="14" class="mr-1.5" slot="icon"></app-icon>
              Guardar Borrador
            </app-button>
            <app-button
              variant="primary"
              type="button"
              (clicked)="onSubmitAndComplete()"
              [loading]="isSubmitting()"
              [disabled]="isSubmitting() || hasNegativeProjection() || !confirmCreate"
              customClasses="!rounded-xl font-bold shadow-md shadow-primary-200 active:scale-95 transition-all"
            >
              <app-icon name="check-circle" [size]="14" class="mr-1.5" slot="icon"></app-icon>
              Crear y Aplicar
            </app-button>
          }
        </div>
      </div>
    </app-modal>
  `,
})
export class TransferCreateModalComponent {
  private transfersService = inject(TransfersService);

  readonly isOpen = input(false);
  readonly isSubmitting = input(false);
  readonly locations = input<SelectorOption[]>([]);

  readonly isOpenChange = output<boolean>();
  readonly cancel = output<void>();
  readonly save = output<CreateTransferRequest>();
  readonly saveAndComplete = output<CreateTransferRequest>();

  currentStep = 1;
  steps: StepsLineItem[] = [
    { label: 'UBICACIONES', completed: false },
    { label: 'PRODUCTOS', completed: false },
    { label: 'CONFIRMAR', completed: false },
  ];

  // Step 1
  selectedFromLocation: number | null = null;
  selectedToLocation: number | null = null;
  expectedDate = '';
  notes = '';

  // Step 2
  readonly productSearchRef = viewChild<InputsearchComponent>('productSearch');
  productSearchResults: TransferableProduct[] = [];
  confirmCreate = false;
  transferItems: TransferItem[] = [];

  get locationOptions(): SelectorOption[] {
    return this.locations();
  }

  get filteredToLocations(): SelectorOption[] {
    if (!this.selectedFromLocation) return this.locations();
    return this.locations().filter(l => l.value !== this.selectedFromLocation);
  }

  get modalTitle(): string {
    if (this.currentStep === 1) return 'Ubicaciones';
    if (this.currentStep === 2) return 'Agregar Productos';
    return 'Confirmar Transferencia';
  }

  constructor() {
    effect(() => {
      if (this.isOpen()) {
        this.resetModal();
      }
    });
  }

  onFromLocationChange(value: any): void {
    this.selectedFromLocation = value ? +value : null;
    this.transferItems = [];
    this.productSearchResults = [];
  }

  onToLocationChange(value: any): void {
    this.selectedToLocation = value ? +value : null;
    this.transferItems = [];
    this.productSearchResults = [];
  }

  searchProducts(term: string): void {
    if (!term || term.length < 2 || !this.selectedFromLocation || !this.selectedToLocation) {
      this.productSearchResults = [];
      return;
    }

    this.transfersService.searchTransferableProducts(
      term,
      this.selectedFromLocation,
      this.selectedToLocation,
    ).subscribe({
      next: (products) => {
        this.productSearchResults = products.filter(
          (p) => !this.transferItems.some(ti => ti.product_id === p.id),
        );
      },
      error: () => { this.productSearchResults = []; },
    });
  }

  addProduct(product: TransferableProduct): void {
    if (this.transferItems.some(ti => ti.product_id === product.id)) return;

    this.transferItems = [
      ...this.transferItems,
      {
        product_id: product.id,
        product_name: product.name,
        sku: product.sku ?? undefined,
        quantity: 1,
        stock_at_origin: product.stock_at_origin,
        stock_at_destination: product.stock_at_destination,
      },
    ];
    this.productSearchResults = [];
    this.productSearchRef()?.clearInput();
  }

  removeItem(index: number): void {
    this.transferItems = this.transferItems.filter((_, i) => i !== index);
  }

  updateQuantity(index: number, event: Event): void {
    const value = +(event.target as HTMLInputElement).value;
    this.transferItems = this.transferItems.map((item, i) =>
      i === index ? { ...item, quantity: Math.max(1, value) } : item,
    );
  }

  getLocationName(id: number | null): string {
    if (!id) return '-';
    return this.locations().find(l => l.value === id)?.label || '-';
  }

  getTotalQuantity(): number {
    return this.transferItems.reduce((sum, item) => sum + item.quantity, 0);
  }

  getOriginAfter(item: TransferItem): number {
    return item.stock_at_origin.quantity_available - item.quantity;
  }

  getDestinationAfter(item: TransferItem): number {
    return item.stock_at_destination.quantity_available + item.quantity;
  }

  hasNegativeProjection(): boolean {
    return this.transferItems.some(i => i.stock_at_origin.quantity_available - i.quantity < 0);
  }

  canAdvance(): boolean {
    if (this.currentStep === 1) {
      return !!(this.selectedFromLocation && this.selectedToLocation && this.selectedFromLocation !== this.selectedToLocation);
    }
    if (this.currentStep === 2) {
      return this.transferItems.length > 0
        && this.transferItems.every(i => i.quantity > 0)
        && this.transferItems.every(i => i.quantity <= i.stock_at_origin.quantity_available);
    }
    return true;
  }

  goToStep(step: number): void {
    if (step > this.currentStep && !this.canAdvance()) return;
    this.currentStep = step;
    this.steps = this.steps.map((s, i) => ({
      ...s,
      completed: i < step - 1,
    }));
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

  private buildDto(): CreateTransferRequest | null {
    if (!this.selectedFromLocation || !this.selectedToLocation || this.transferItems.length === 0) return null;
    if (this.hasNegativeProjection()) return null;

    return {
      from_location_id: this.selectedFromLocation,
      to_location_id: this.selectedToLocation,
      ...(this.expectedDate && { expected_date: this.expectedDate }),
      ...(this.notes && { notes: this.notes }),
      items: this.transferItems.map(item => ({
        product_id: item.product_id,
        quantity: item.quantity,
      })),
    };
  }

  private resetModal(): void {
    this.currentStep = 1;
    this.steps = [
      { label: 'UBICACIONES', completed: false },
      { label: 'PRODUCTOS', completed: false },
      { label: 'CONFIRMAR', completed: false },
    ];
    this.selectedFromLocation = null;
    this.selectedToLocation = null;
    this.expectedDate = '';
    this.notes = '';
    this.productSearchResults = [];
    this.transferItems = [];
    this.confirmCreate = false;
    this.productSearchRef()?.clearInput();
  }
}
