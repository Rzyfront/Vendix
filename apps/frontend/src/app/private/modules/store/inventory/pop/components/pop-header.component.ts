import { Component, Output, EventEmitter, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subject, takeUntil } from 'rxjs';

import { SelectorComponent, SelectorOption } from '../../../../../../shared/components/selector/selector.component';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { ButtonComponent } from '../../../../../../shared/components/button/button.component';
import { InputComponent } from '../../../../../../shared/components/input/input.component';

import { PopCartService, ShippingMethod } from '../services/pop-cart.service';
import { PopSupplier, PopLocation } from '../interfaces/pop-cart.interface';

// Local constants
// Force rebuild 2
const SHIPPING_METHOD_LABELS = {
  supplier_transport: 'Transporte Proveedor',
  freight: 'Flete',
  pickup: 'Recolección',
  other: 'Otro',
} as const;

import { SuppliersService } from '../../services/suppliers.service';
import { InventoryService } from '../../services/inventory.service';

/**
 * POP Header Component
 * Displays supplier, warehouse, dates, and shipping method selectors
 */
@Component({
  selector: 'app-pop-header',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    SelectorComponent,
    IconComponent,
    ButtonComponent,
    InputComponent
  ],
  template: `
    <div class="px-6 py-5 bg-surface rounded-t-xl">
      <div class="flex flex-col gap-6">
        
        <!-- Top Row: Title -->
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
            <app-icon name="shopping-bag" [size]="20"></app-icon>
          </div>
          <div class="flex flex-col">
            <h1 class="font-bold text-text-primary text-lg leading-tight">
              Punto de Compra
            </h1>
            <span class="text-xs text-text-secondary font-medium">
              Gestión de Abastecimiento
            </span>
          </div>
        </div>

        <!-- Filters / Inputs Grid -->
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
            
            <!-- 1. Supplier Selector -->
            <div class="flex flex-col gap-1.5 min-w-0">
                <label class="text-xs font-semibold text-text-secondary pl-0.5 flex items-center gap-1">
                    Proveedor <span class="text-destructive">*</span>
                </label>
                <div class="flex gap-2">
                    <app-selector
                        class="flex-1 min-w-0"
                        size="sm"
                        [options]="supplierOptions"
                        [(ngModel)]="selectedSupplierId"
                        (ngModelChange)="onSupplierChange($event)"
                        placeholder="Seleccionar..."
                    ></app-selector>
                    <app-button 
                        variant="outline"
                        size="sm"
                        customClasses="!px-2 flex items-center justify-center"
                        (clicked)="openSupplierModal.emit()"
                        title="Nuevo Proveedor"
                    >
                        <app-icon name="plus" [size]="18" slot="icon"></app-icon>
                    </app-button>
                </div>
            </div>

            <!-- 2. Warehouse Selector -->
             <div class="flex flex-col gap-1.5 min-w-0">
                <label class="text-xs font-semibold text-text-secondary pl-0.5 flex items-center gap-1">
                    Bodega <span class="text-destructive">*</span>
                </label>
                <div class="flex gap-2">
                    <app-selector
                        class="flex-1 min-w-0"
                        size="sm"
                        [options]="locationOptions"
                        [(ngModel)]="selectedLocationId"
                        (ngModelChange)="onLocationChange($event)"
                        placeholder="Seleccionar..."
                    ></app-selector>
                    <app-button 
                        variant="outline"
                        size="sm"
                        customClasses="!px-2 flex items-center justify-center"
                        (clicked)="openWarehouseModal.emit()"
                        title="Nueva Bodega"
                    >
                        <app-icon name="plus" [size]="18" slot="icon"></app-icon>
                    </app-button>
                </div>
            </div>

            <!-- 3. Order Date -->
            <div class="flex flex-col gap-1.5 min-w-0">
                <label class="text-xs font-semibold text-text-secondary pl-0.5">Fecha Orden</label>
                <app-input 
                    type="date"
                    size="sm"
                    [(ngModel)]="orderDate"
                    (ngModelChange)="onOrderDateChange($event)"
                    customWrapperClass="!mt-0"
                ></app-input>
            </div>

            <!-- 4. Delivery Date -->
             <div class="flex flex-col gap-1.5 min-w-0">
                <label class="text-xs font-semibold text-text-secondary pl-0.5">Fecha Entrega</label>
                <app-input 
                    type="date"
                    size="sm"
                    [(ngModel)]="expectedDate"
                    (ngModelChange)="onExpectedDateChange($event)"
                    [min]="minExpectedDate"
                    customWrapperClass="!mt-0"
                ></app-input>
            </div>

             <!-- 5. Shipping Method -->
             <div class="flex flex-col gap-1.5 min-w-0">
                <label class="text-xs font-semibold text-text-secondary pl-0.5">Método Envío</label>
                <div class="h-9">
                  <app-selector
                      class="w-full h-full"
                      size="sm"
                      [options]="shippingMethodOptions"
                      [(ngModel)]="shippingMethod"
                      (ngModelChange)="onShippingMethodChange($event)"
                      placeholder="Elegir método..."
                  ></app-selector>
                </div>
            </div>

        </div>

      </div>
    </div>
  `,
  styles: [`
    :host {
      display: block;
    }
  `],
})
export class PopHeaderComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();

  // Data
  suppliers: PopSupplier[] = [];
  locations: PopLocation[] = [];

  // Selector options
  supplierOptions: SelectorOption[] = [];
  locationOptions: SelectorOption[] = [];
  shippingMethodOptions: SelectorOption[] = [];

  // Selected values
  selectedSupplierId: number | null = null;
  selectedLocationId: number | null = null;
  orderDate: string = '';
  expectedDate: string = '';
  shippingMethod: string = '';

  // Computed
  minExpectedDate: string = '';

  @Output() openSupplierModal = new EventEmitter<void>();
  @Output() openWarehouseModal = new EventEmitter<void>();

  constructor(
    private popCartService: PopCartService,
    private suppliersService: SuppliersService,
    private inventoryService: InventoryService,
  ) { }

  ngOnInit(): void {
    this.loadSuppliers();
    this.loadLocations();
    this.setupShippingMethods();

    // Subscribe to cart state changes to keep selectors in sync
    this.popCartService.cartState$
      .pipe(takeUntil(this.destroy$))
      .subscribe((state) => {
        // Only update if different to avoid loops (though ngModel handles it usually)
        if (state.supplierId !== this.selectedSupplierId) {
          this.selectedSupplierId = state.supplierId;
        }
        if (state.locationId !== this.selectedLocationId) {
          this.selectedLocationId = state.locationId;
        }
        if (state.orderDate) {
          this.orderDate = this.formatDateForInput(state.orderDate);
          this.minExpectedDate = this.orderDate;
        }
        if (state.expectedDate) {
          this.expectedDate = this.formatDateForInput(state.expectedDate);
        }
        if (state.shippingMethod !== this.shippingMethod) {
          this.shippingMethod = state.shippingMethod || '';
        }
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  // ============================================================
  // Data Loading
  // ============================================================

  public refreshSuppliers(): void {
    this.loadSuppliers();
  }

  public refreshLocations(): void {
    this.loadLocations();
  }

  private loadSuppliers(): void {
    this.suppliersService.getSuppliers({ is_active: true })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response) => {
          if (response.success && response.data) {
            this.suppliers = response.data;
            this.supplierOptions = this.suppliers.map((s) => ({
              value: s.id,
              label: s.name,
              description: s.code,
            }));
          }
        },
        error: (error) => {
          console.error('Error loading suppliers:', error);
        },
      });
  }

  private loadLocations(): void {
    this.inventoryService.getLocations({ is_active: true })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response) => {
          if (response.success && response.data) {
            this.locations = response.data;
            this.locationOptions = this.locations.map((l) => ({
              value: l.id,
              label: l.name,
              description: l.code,
            }));

            // Select first if available and none selected (and nothing in service)
            // But be careful not to override service state if it's explicitly null/undefined but intended?
            // Actually, if service state is null, we can default.
            if (this.locations.length > 0 && !this.selectedLocationId && !this.popCartService.currentState.locationId) {
              this.selectedLocationId = this.locations[0].id;
              this.onLocationChange(this.selectedLocationId);
            }
          }
        },
        error: (error) => {
          console.error('Error loading locations:', error);
        }
      });
  }

  private setupShippingMethods(): void {
    this.shippingMethodOptions = Object.entries(SHIPPING_METHOD_LABELS).map(
      ([value, label]) => ({ value, label })
    );
  }

  // initializeFromCart removed as it's now handled by the subscription in ngOnInit

  // ============================================================
  // Event Handlers
  // ============================================================

  onSupplierChange(supplierId: number | null | string): void {
    // If the change comes from the selector (user interaction), update the service.
    // We need to check if it's different to avoid loops with the subscription above?
    // PopCartService.setSupplier does distinct check usually or state update is distinct.
    // Also the subscription check `if (state.supplierId !== this.selectedSupplierId)` handles the incoming loop.
    const id = supplierId ? Number(supplierId) : null;
    this.popCartService.setSupplier(id);
  }

  onLocationChange(locationId: number | null | string): void {
    const id = locationId ? Number(locationId) : null;
    this.popCartService.setLocation(id);
  }

  onOrderDateChange(dateStr: string): void {
    if (dateStr) {
      const date = new Date(dateStr);
      // Prevent loop if date matches
      this.popCartService.setOrderDate(date);
      this.minExpectedDate = dateStr;
    }
  }

  onExpectedDateChange(dateStr: string): void {
    if (dateStr) {
      const date = new Date(dateStr);
      this.popCartService.setExpectedDate(date);
    } else {
      this.popCartService.setExpectedDate(undefined);
    }
  }

  onShippingMethodChange(method: string): void {
    this.popCartService.setShippingMethod(method as ShippingMethod);
  }

  // ============================================================
  // Helpers
  // ============================================================

  private formatDateForInput(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
}
