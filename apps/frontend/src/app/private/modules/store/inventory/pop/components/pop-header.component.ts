import {
  Component,
  Output,
  EventEmitter,
  OnInit,
  OnDestroy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subject, takeUntil } from 'rxjs';

import {
  SelectorComponent,
  SelectorOption,
} from '../../../../../../shared/components/selector/selector.component';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { ButtonComponent } from '../../../../../../shared/components/button/button.component';
import { InputComponent } from '../../../../../../shared/components/input/input.component';
import { BadgeComponent } from '../../../../../../shared/components/badge/badge.component';
import { TooltipComponent } from '../../../../../../shared/components/tooltip/tooltip.component';

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
    InputComponent,
    BadgeComponent,
    TooltipComponent,
  ],
  template: `
    <div class="px-4 lg:px-6 py-4 lg:py-5 bg-surface rounded-t-xl">
      <div class="flex flex-col gap-4 lg:gap-6">
        <!-- Top Row: Title + Mobile Settings Toggle -->
        <div class="flex items-center justify-between gap-3">
          <div class="flex items-center gap-3">
            <div
              class="w-10 h-10 lg:w-12 lg:h-12 rounded-xl bg-primary/10 flex items-center justify-center"
            >
              <app-icon
                name="shopping-bag"
                [size]="20"
                class="text-primary lg:hidden"
              ></app-icon>
              <app-icon
                name="shopping-bag"
                [size]="24"
                class="text-primary hidden lg:block"
              ></app-icon>
            </div>
            <div class="flex flex-col">
              <h1 class="font-bold text-text-primary text-base lg:text-lg leading-none flex items-center gap-2">
                <span class="hidden sm:inline">Vendix</span> POP
                <app-badge variant="primary" class="text-xs">Compra</app-badge>
              </h1>
              <span class="text-xs text-text-secondary font-medium hidden sm:block">
                Punto de Compra
              </span>
            </div>
          </div>

          <!-- Mobile Settings Toggle -->
          <button
            class="lg:hidden flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-surface hover:bg-muted transition-colors"
            (click)="toggleMobileSettings()"
          >
            <app-icon [name]="showMobileSettings ? 'chevron-up' : 'settings'" [size]="18"></app-icon>
            <span class="text-xs font-medium">{{ showMobileSettings ? 'Ocultar' : 'Ajustes' }}</span>
          </button>
        </div>

        <!-- Mobile: Quick Summary Badges (when settings collapsed) -->
        <div
          class="lg:hidden flex items-center gap-1.5 overflow-x-auto pb-1 -mx-1 px-1"
          *ngIf="!showMobileSettings && (selectedSupplierId || selectedLocationId || expectedDate)"
        >
          <!-- Proveedor Badge -->
          <div
            *ngIf="getSupplierName()"
            class="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full bg-primary/10 text-primary shrink-0"
          >
            <app-icon name="truck" [size]="14"></app-icon>
            <span class="text-xs font-medium truncate max-w-[80px]">{{ getSupplierName() }}</span>
          </div>

          <!-- Arrow -->
          <app-icon
            *ngIf="getSupplierName() && getLocationName()"
            name="chevron-right"
            [size]="14"
            class="text-text-muted shrink-0"
          ></app-icon>

          <!-- Bodega Badge -->
          <div
            *ngIf="getLocationName()"
            class="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full bg-emerald-500/10 text-emerald-600 shrink-0"
          >
            <app-icon name="warehouse" [size]="14"></app-icon>
            <span class="text-xs font-medium truncate max-w-[80px]">{{ getLocationName() }}</span>
          </div>

          <!-- Arrow -->
          <app-icon
            *ngIf="getLocationName() && expectedDate"
            name="chevron-right"
            [size]="14"
            class="text-text-muted shrink-0"
          ></app-icon>

          <!-- Fecha Entrega Badge -->
          <div
            *ngIf="expectedDate"
            class="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full bg-amber-500/10 text-amber-600 shrink-0"
          >
            <app-icon name="calendar" [size]="14"></app-icon>
            <span class="text-xs font-medium">{{ formatDateShort(expectedDate) }}</span>
          </div>
        </div>

        <!-- Desktop: Full Filters Grid (always visible) -->
        <div class="hidden lg:grid lg:grid-cols-5 gap-4">
          <!-- 1+2. Supplier + Warehouse (wrapped for flash warning) -->
          <div class="col-span-2 grid grid-cols-2 gap-4 relative rounded-lg"
               [class.config-flash-warning]="showConfigWarning">
            <app-tooltip
              position="top"
              color="warning"
              size="sm"
              [visible]="showConfigWarning"
              class="!absolute left-1/2 -translate-x-1/2 top-0 z-10"
            >Selecciona proveedor y bodega</app-tooltip>

            <!-- 1. Supplier Selector -->
            <div class="flex flex-col gap-1.5 min-w-0">
              <label
                class="text-xs font-semibold text-text-secondary pl-0.5 flex items-center gap-1"
              >
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
                <div class="relative"
                     (mouseenter)="hoveredTooltip = 'supplier'"
                     (mouseleave)="hoveredTooltip = null">
                  <app-button
                    variant="outline"
                    size="sm"
                    customClasses="!px-2 flex items-center justify-center"
                    (clicked)="openSupplierModal.emit()"
                  >
                    <app-icon name="plus" [size]="18" slot="icon"></app-icon>
                  </app-button>
                  <app-tooltip position="top" size="sm" [visible]="hoveredTooltip === 'supplier'"
                    class="!absolute left-1/2 -translate-x-1/2 bottom-full z-10">
                    Nuevo Proveedor
                  </app-tooltip>
                </div>
              </div>
            </div>

            <!-- 2. Warehouse Selector -->
            <div class="flex flex-col gap-1.5 min-w-0">
              <label
                class="text-xs font-semibold text-text-secondary pl-0.5 flex items-center gap-1"
              >
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
                <div class="relative"
                     (mouseenter)="hoveredTooltip = 'warehouse'"
                     (mouseleave)="hoveredTooltip = null">
                  <app-button
                    variant="outline"
                    size="sm"
                    customClasses="!px-2 flex items-center justify-center"
                    (clicked)="openWarehouseModal.emit()"
                  >
                    <app-icon name="plus" [size]="18" slot="icon"></app-icon>
                  </app-button>
                  <app-tooltip position="top" size="sm" [visible]="hoveredTooltip === 'warehouse'"
                    class="!absolute left-1/2 -translate-x-1/2 bottom-full z-10">
                    Nueva Bodega
                  </app-tooltip>
                </div>
              </div>
            </div>
          </div>

          <!-- 3. Order Date -->
          <div class="flex flex-col gap-1.5 min-w-0">
            <label class="text-xs font-semibold text-text-secondary pl-0.5"
              >Fecha Orden</label
            >
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
            <label class="text-xs font-semibold text-text-secondary pl-0.5"
              >Fecha Entrega</label
            >
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
            <label class="text-xs font-semibold text-text-secondary pl-0.5"
              >Método Envío</label
            >
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

        <!-- Mobile: Collapsible Settings -->
        <div class="lg:hidden" *ngIf="showMobileSettings">
          <!-- Row 1: Supplier + Warehouse -->
          <div class="grid grid-cols-2 gap-3 mb-3 relative rounded-lg"
               [class.config-flash-warning]="showConfigWarning">
            <app-tooltip
              position="top"
              color="warning"
              size="sm"
              [visible]="showConfigWarning"
              class="!absolute left-1/2 -translate-x-1/2 top-0 z-10"
            >Selecciona proveedor y bodega</app-tooltip>
            <div class="flex flex-col gap-1.5 min-w-0">
              <label class="text-xs font-semibold text-text-secondary pl-0.5 flex items-center gap-1">
                Proveedor <span class="text-destructive">*</span>
              </label>
              <div class="flex gap-1">
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
                >
                  <app-icon name="plus" [size]="16" slot="icon"></app-icon>
                </app-button>
              </div>
            </div>
            <div class="flex flex-col gap-1.5 min-w-0">
              <label class="text-xs font-semibold text-text-secondary pl-0.5 flex items-center gap-1">
                Bodega <span class="text-destructive">*</span>
              </label>
              <div class="flex gap-1">
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
                >
                  <app-icon name="plus" [size]="16" slot="icon"></app-icon>
                </app-button>
              </div>
            </div>
          </div>

          <!-- Row 2: Dates -->
          <div class="grid grid-cols-2 gap-3 mb-3">
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
          </div>

          <!-- Row 3: Shipping Method -->
          <div class="flex flex-col gap-1.5 min-w-0">
            <label class="text-xs font-semibold text-text-secondary pl-0.5">Método Envío</label>
            <app-selector
              class="w-full"
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
  `,
  styles: [
    `
      :host {
        display: block;
      }

      @keyframes configFlashWarning {
        0%   { box-shadow: 0 0 0 0 rgba(245, 158, 11, 0);   border-color: transparent; }
        15%  { box-shadow: 0 0 0 4px rgba(245, 158, 11, 0.4); border-color: #f59e0b; }
        30%  { box-shadow: 0 0 0 0 rgba(245, 158, 11, 0);   border-color: transparent; }
        55%  { box-shadow: 0 0 0 4px rgba(245, 158, 11, 0.4); border-color: #f59e0b; }
        70%  { box-shadow: 0 0 0 0 rgba(245, 158, 11, 0);   border-color: transparent; }
        100% { box-shadow: 0 0 0 0 rgba(245, 158, 11, 0);   border-color: transparent; }
      }

      .config-flash-warning {
        animation: configFlashWarning 1.2s ease-out;
        border: 2px solid transparent;
      }
    `,
  ],
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

  // Mobile state
  showMobileSettings = false;

  // Tooltip hover state
  hoveredTooltip: string | null = null;

  // Config warning flash
  showConfigWarning = false;
  private configWarningTimeout: any;

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
    if (this.configWarningTimeout) {
      clearTimeout(this.configWarningTimeout);
    }
  }

  /**
   * Flash the supplier+warehouse section with an amber warning animation.
   * Uses setTimeout(0) to force animation restart on rapid re-triggers.
   */
  flashConfigWarning(): void {
    // Turn off first to allow re-trigger
    this.showConfigWarning = false;
    if (this.configWarningTimeout) {
      clearTimeout(this.configWarningTimeout);
    }
    setTimeout(() => {
      this.showConfigWarning = true;
      this.configWarningTimeout = setTimeout(() => {
        this.showConfigWarning = false;
      }, 3000);
    }, 0);
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
    this.suppliersService
      .getSuppliers({ is_active: true })
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
    this.inventoryService
      .getLocations({ is_active: true })
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
            if (
              this.locations.length > 0 &&
              !this.selectedLocationId &&
              !this.popCartService.currentState.locationId
            ) {
              this.selectedLocationId = this.locations[0].id;
              this.onLocationChange(this.selectedLocationId);
            }
          }
        },
        error: (error) => {
          console.error('Error loading locations:', error);
        },
      });
  }

  private setupShippingMethods(): void {
    this.shippingMethodOptions = Object.entries(SHIPPING_METHOD_LABELS).map(
      ([value, label]) => ({ value, label }),
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

  formatDateShort(dateStr: string): string {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    return date.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit' });
  }

  // ============================================================
  // Mobile Helpers
  // ============================================================

  toggleMobileSettings(): void {
    this.showMobileSettings = !this.showMobileSettings;
  }

  getSupplierName(): string {
    if (!this.selectedSupplierId) return '';
    const supplier = this.suppliers.find(s => s.id === this.selectedSupplierId);
    return supplier?.name || '';
  }

  getLocationName(): string {
    if (!this.selectedLocationId) return '';
    const location = this.locations.find(l => l.id === this.selectedLocationId);
    return location?.name || '';
  }
}
