import {
  Component,
  computed,
  output,
  signal,
  inject,
  DestroyRef,
} from "@angular/core";
import { takeUntilDestroyed } from "@angular/core/rxjs-interop";
import { Observable, of } from "rxjs";
import { catchError, map, tap } from "rxjs/operators";

import { SelectorOption } from "../../../../../../shared/components/selector/selector.component";
import { IconComponent } from "../../../../../../shared/components/icon/icon.component";
import { BadgeComponent } from "../../../../../../shared/components/badge/badge.component";

import { PopOrderConfigModalComponent } from "./pop-order-config-modal.component";
import { PopOrderConfigCardComponent } from "./pop-order-config-card.component";
import { PopOrderConfigDropdownComponent } from "./pop-order-config-dropdown.component";

import { PopCartService, ShippingMethod } from "../services/pop-cart.service";
import { PopSupplier, PopLocation } from "../interfaces/pop-cart.interface";

// Local constants
const SHIPPING_METHOD_LABELS = {
  supplier_transport: "Transporte Proveedor",
  freight: "Flete",
  pickup: "Recolección",
  other: "Otro",
} as const;

import { SuppliersService } from "../../services/suppliers.service";
import { InventoryService } from "../../services/inventory.service";

/**
 * POP Header Component
 *
 * Muestra el título del POP y la configuración de la orden de compra
 * (proveedor, bodega, fechas, método de envío) siguiendo el patrón POS
 * caja/cliente: un botón (sin configurar) que abre un modal, y una vez
 * configurada una mini-card compacta (desktop ≥ xl) o un dropdown (< xl).
 *
 * Este componente sigue siendo el dueño de la data (suppliers/locations),
 * el quick-create y la sincronización con `PopCartService`; los tres
 * sub-componentes de configuración son presentacionales.
 */
@Component({
  selector: "app-pop-header",
  standalone: true,
  imports: [
    IconComponent,
    BadgeComponent,
    PopOrderConfigModalComponent,
    PopOrderConfigCardComponent,
    PopOrderConfigDropdownComponent,
  ],
  template: `
    <div class="px-4 lg:px-6 py-4 lg:py-5 bg-surface rounded-t-xl">
      <!-- Single row: Title (left) + purchase config (right) -->
      <div class="flex items-center justify-between gap-3">
        <!-- Title -->
        <div class="flex items-center gap-3 min-w-0">
          <div
            class="w-10 h-10 lg:w-12 lg:h-12 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0"
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
          <div class="flex flex-col min-w-0">
            <h1
              class="font-bold text-text-primary text-base lg:text-lg leading-none flex items-center gap-2"
            >
              <span class="hidden sm:inline">Vendix</span> POP
              <app-badge variant="primary" class="text-xs">Compra</app-badge>
            </h1>
            <span
              class="text-xs text-text-secondary font-medium hidden sm:block"
            >
              Punto de Compra
            </span>
          </div>
        </div>

        <!-- Purchase config: desktop mini-card / button (>= xl) -->
        <div class="hidden xl:flex flex-shrink-0">
          <app-pop-order-config-card
            [isConfigured]="isConfigured()"
            [supplierName]="getSupplierName()"
            [locationName]="getLocationName()"
            [orderDateLabel]="orderDateLabel()"
            [expectedDateLabel]="expectedDateLabel()"
            [shippingLabel]="shippingLabel()"
            (edit)="openConfigModal()"
          ></app-pop-order-config-card>
        </div>

        <!-- Purchase config: mobile/tablet dropdown / button (< xl) -->
        <div class="flex xl:hidden flex-shrink-0">
          <app-pop-order-config-dropdown
            [isConfigured]="isConfigured()"
            [supplierName]="getSupplierName()"
            [locationName]="getLocationName()"
            [orderDateLabel]="orderDateLabel()"
            [expectedDateLabel]="expectedDateLabel()"
            [shippingLabel]="shippingLabel()"
            (edit)="openConfigModal()"
          ></app-pop-order-config-dropdown>
        </div>
      </div>
    </div>

    <!-- Purchase config modal (proveedor / bodega / fechas / envío) -->
    <app-pop-order-config-modal
      [(isOpen)]="configModalOpen"
      [supplierOptions]="supplierOptions()"
      [locationOptions]="locationOptions()"
      [shippingMethodOptions]="shippingMethodOptions()"
      [selectedSupplierId]="selectedSupplierId()"
      [selectedLocationId]="selectedLocationId()"
      [orderDate]="orderDate()"
      [expectedDate]="expectedDate()"
      [shippingMethod]="shippingMethod()"
      [minExpectedDate]="minExpectedDate()"
      (supplierChange)="onSupplierChange($event)"
      (locationChange)="onLocationChange($event)"
      (orderDateChange)="onOrderDateChange($event)"
      (expectedDateChange)="onExpectedDateChange($event)"
      (shippingMethodChange)="onShippingMethodChange($event)"
      (openSupplierModal)="openSupplierModal.emit()"
      (openWarehouseModal)="openWarehouseModal.emit()"
    ></app-pop-order-config-modal>
  `,
  styles: [
    `
      :host {
        display: block;
      }
    `,
  ],
})
export class PopHeaderComponent {
  private popCartService = inject(PopCartService);
  private suppliersService = inject(SuppliersService);
  private inventoryService = inject(InventoryService);
  private destroyRef = inject(DestroyRef);

  // Data
  readonly suppliers = signal<PopSupplier[]>([]);
  readonly locations = signal<PopLocation[]>([]);

  // Selector options
  readonly supplierOptions = signal<SelectorOption[]>([]);
  readonly locationOptions = signal<SelectorOption[]>([]);
  readonly shippingMethodOptions = signal<SelectorOption[]>([]);

  // Selected values
  readonly selectedSupplierId = signal<number | null>(null);
  readonly selectedLocationId = signal<number | null>(null);
  readonly orderDate = signal("");
  readonly expectedDate = signal("");
  readonly shippingMethod = signal("");
  readonly minExpectedDate = signal("");

  // Config modal visibility (button/mini-card/dropdown → modal).
  readonly configModalOpen = signal(false);

  /** Configurada = proveedor + bodega elegidos (fechas/envío tienen default). */
  readonly isConfigured = computed(
    () => !!this.selectedSupplierId() && !!this.selectedLocationId(),
  );

  /** Etiqueta legible del método de envío para la mini-card / dropdown. */
  readonly shippingLabel = computed(() => {
    const m = this.shippingMethod();
    return m
      ? (SHIPPING_METHOD_LABELS[m as keyof typeof SHIPPING_METHOD_LABELS] ?? m)
      : "";
  });

  /** Fecha de orden formateada (dd/mm) para el resumen. */
  readonly orderDateLabel = computed(() =>
    this.formatDateShort(this.orderDate()),
  );

  /** Fecha de entrega formateada (dd/mm) para el resumen. */
  readonly expectedDateLabel = computed(() =>
    this.formatDateShort(this.expectedDate()),
  );

  readonly openSupplierModal = output<void>();
  readonly openWarehouseModal = output<void>();

  constructor() {
    this.loadSuppliers().subscribe();
    this.loadLocations().subscribe();
    this.setupShippingMethods();

    this.popCartService.cartState$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((state) => {
        if (state.supplierId !== this.selectedSupplierId()) {
          this.selectedSupplierId.set(state.supplierId);
        }
        if (state.locationId !== this.selectedLocationId()) {
          this.selectedLocationId.set(state.locationId);
        }
        if (state.orderDate) {
          const formatted = this.formatDateForInput(state.orderDate);
          this.orderDate.set(formatted);
          this.minExpectedDate.set(formatted);
        }
        if (state.expectedDate) {
          this.expectedDate.set(this.formatDateForInput(state.expectedDate));
        }
        if (state.shippingMethod !== this.shippingMethod()) {
          this.shippingMethod.set(state.shippingMethod || "");
        }
      });
  }

  // ============================================================
  // Config modal (gate: crear/recibir sin configurar lo abre)
  // ============================================================

  /** Abre el modal de configuración (proveedor/bodega/fechas/envío). */
  openConfigModal(): void {
    this.configModalOpen.set(true);
  }

  /** Cierra el modal de configuración. */
  closeConfigModal(): void {
    this.configModalOpen.set(false);
  }

  // ============================================================
  // Data Loading
  // ============================================================

  /**
   * Refresh suppliers list. Returns an Observable that emits once the options
   * signal has been updated so callers can chain actions safely (e.g. selecting
   * a newly created supplier without racing the HTTP response).
   */
  public refreshSuppliers(): Observable<void> {
    return this.loadSuppliers();
  }

  /**
   * Refresh locations list. Returns an Observable that emits once the options
   * signal has been updated so callers can chain actions safely (e.g. selecting
   * a newly created warehouse without racing the HTTP response).
   */
  public refreshLocations(): Observable<void> {
    return this.loadLocations();
  }

  /**
   * Add a newly created supplier in-memory to the selector options.
   * Avoids re-fetching the whole list (which could trigger races with the cart state).
   */
  public addSupplier(supplier: { id: number; name: string; code?: string }): void {
    const current = this.suppliers();
    if (!current.some((s) => s.id === supplier.id)) {
      this.suppliers.set([...current, supplier as PopSupplier]);
      this.supplierOptions.set(this.suppliers().map((s) => ({
        value: s.id,
        label: s.name,
        description: s.code,
      })));
    }
  }

  /**
   * Add a newly created location in-memory to the selector options.
   * Avoids re-fetching the whole list (which could trigger races with the cart state).
   */
  public addLocation(location: { id: number; name: string; code?: string }): void {
    const current = this.locations();
    if (!current.some((l) => l.id === location.id)) {
      this.locations.set([...current, location as PopLocation]);
      this.locationOptions.set(this.locations().map((l) => ({
        value: l.id,
        label: l.name,
        description: l.code,
      })));
    }
  }

  private loadSuppliers(): Observable<void> {
    return this.suppliersService
      .getSuppliers({ is_active: true })
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        tap((response) => {
          if (response.success && response.data) {
            this.suppliers.set(response.data);
            this.supplierOptions.set(this.suppliers().map((s) => ({
              value: s.id,
              label: s.name,
              description: s.code,
            })));
          }
        }),
        map(() => void 0),
        catchError((error) => {
          console.error("Error loading suppliers:", error);
          return of(void 0);
        }),
      );
  }

  private loadLocations(): Observable<void> {
    return this.inventoryService
      .getLocations({ is_active: true })
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        tap((response) => {
          if (response.success && response.data) {
            this.locations.set(response.data);
            this.locationOptions.set(this.locations().map((l) => ({
              value: l.id,
              label: l.name,
              description: l.code,
            })));

            if (
              this.locations().length > 0 &&
              !this.selectedLocationId() &&
              !this.popCartService.currentState.locationId
            ) {
              this.selectedLocationId.set(this.locations()[0].id);
              this.onLocationChange(this.selectedLocationId());
            }
          }
        }),
        map(() => void 0),
        catchError((error) => {
          console.error("Error loading locations:", error);
          return of(void 0);
        }),
      );
  }

  private setupShippingMethods(): void {
    this.shippingMethodOptions.set(Object.entries(SHIPPING_METHOD_LABELS).map(
      ([value, label]) => ({ value, label }),
    ));
  }

  // ============================================================
  // Event Handlers
  // ============================================================

  onSupplierChange(supplierId: number | null | string): void {
    const id = supplierId ? Number(supplierId) : null;
    this.popCartService.setSupplier(id);
  }

  onLocationChange(locationId: number | null | string): void {
    const id = locationId ? Number(locationId) : null;
    this.popCartService.setLocation(id);
  }

  onOrderDateChange(dateStr: string): void {
    if (dateStr) {
      const [year, month, day] = dateStr.split("-").map(Number);
      const date = new Date(year, month - 1, day);
      this.popCartService.setOrderDate(date);
      this.minExpectedDate.set(dateStr);
    }
  }

  onExpectedDateChange(dateStr: string): void {
    if (dateStr) {
      const [year, month, day] = dateStr.split("-").map(Number);
      const date = new Date(year, month - 1, day);
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
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  formatDateShort(dateStr: string): string {
    if (!dateStr) return "";
    const [year, month, day] = dateStr.split("-").map(Number);
    const date = new Date(year, month - 1, day);
    return date.toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit" });
  }

  getSupplierName(): string {
    if (!this.selectedSupplierId()) return "";
    const supplier = this.suppliers().find(s => s.id === this.selectedSupplierId());
    return supplier?.name || "";
  }

  getLocationName(): string {
    if (!this.selectedLocationId()) return "";
    const location = this.locations().find(l => l.id === this.selectedLocationId());
    return location?.name || "";
  }
}
