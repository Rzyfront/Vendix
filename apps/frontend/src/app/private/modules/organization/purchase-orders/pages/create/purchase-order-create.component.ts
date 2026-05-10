import {
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router, RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';

import {
  AlertBannerComponent,
  ButtonComponent,
  CardComponent,
  IconComponent,
  InputsearchComponent,
  SelectorComponent,
  SelectorOption,
  StepsLineComponent,
  StepsLineItem,
  ToastService,
} from '../../../../../../shared/components/index';
import { CurrencyPipe } from '../../../../../../shared/pipes/currency/currency.pipe';
import { AuthFacade } from '../../../../../../core/store/auth/auth.facade';
import {
  CreateOrgPurchaseOrderDto,
  OrgPurchaseOrdersService,
} from '../../services/org-purchase-orders.service';
import { OrgInventoryService } from '../../../inventory/services/org-inventory.service';
import { ApiErrorService } from '../../../../../../core/services/api-error.service';
import { PopPreBulkModalComponent } from '../../../../store/inventory/pop/components/pop-prebulk-modal.component';
import { PreBulkData } from '../../../../store/inventory/pop/interfaces/pop-cart.interface';

interface StockOption {
  id: number;
  product_id: number;
  product_name: string | null;
  product_sku: string | null;
  variant_id: number | null;
  variant_name: string | null;
  variant_sku: string | null;
  location_id: number;
  available_quantity: number;
  quantity: number;
}

interface CartLine {
  key: string;
  product_id: number;
  product_variant_id: number | null;
  product_name: string;
  variant_name: string | null;
  sku: string | null;
  quantity: number;
  unit_cost: number;
  // Prebulk: temporary product not in catalog. Backend autocreates on submit.
  is_prebulk?: boolean;
  prebulk_data?: PreBulkData;
}

/**
 * ORG_ADMIN — Wizard de creación de Orden de Compra.
 *
 * Tres pasos: UBICACIÓN+PROVEEDOR → PRODUCTOS → CONFIRMAR.
 * El POST va a `/organization/purchase-orders`; el backend resuelve la
 * tienda destino vía `location_id` y delega al dominio store
 * (`PurchaseOrdersService`) — boundary respetado.
 */
@Component({
  selector: 'vendix-org-purchase-order-create',
  standalone: true,
  imports: [
    RouterModule,
    FormsModule,
    AlertBannerComponent,
    ButtonComponent,
    CardComponent,
    IconComponent,
    InputsearchComponent,
    SelectorComponent,
    StepsLineComponent,
    PopPreBulkModalComponent,
  ],
  providers: [CurrencyPipe],
  template: `
    <div class="w-full p-2 md:p-4 max-w-4xl mx-auto">
      <header
        class="sticky top-0 z-10 bg-background py-2 md:py-4 mb-2 flex items-center gap-2"
      >
        <a
          routerLink="/admin/purchase-orders"
          class="text-sm text-text-secondary hover:underline flex items-center gap-1"
        >
          <app-icon name="arrow-left" [size]="16" />
          Volver
        </a>
        <h1
          class="text-lg md:text-2xl font-semibold text-text-primary ml-2"
        >
          {{ stepTitle() }}
        </h1>
      </header>

      <app-steps-line
        [steps]="steps()"
        [currentStep]="currentStep() - 1"
        size="md"
        primaryColor="var(--color-primary)"
        secondaryColor="var(--color-secondary)"
        class="mb-4 block"
      />

      @if (errorMessage(); as msg) {
        <app-alert-banner
          variant="danger"
          title="No se pudo crear la orden"
          customClasses="mb-3"
        >
          {{ msg }}
        </app-alert-banner>
      }

      <!-- STEP 1: Ubicación + Proveedor + meta -->
      @if (isMetaStep()) {
        <app-card>
          <div class="space-y-4">
            <div>
              <label
                class="block text-sm font-medium text-text-secondary mb-2"
              >
                Ubicación destino *
              </label>
              <app-selector
                [options]="locationOptions()"
                [ngModel]="locationId()"
                placeholder="Selecciona dónde recibir la mercancía"
                (ngModelChange)="onLocationChange($event)"
              />
              @if (selectedLocationLabel(); as label) {
                <p class="text-xs text-text-secondary mt-1">
                  La OC se asociará a la tienda dueña de esta ubicación.
                  {{ label }}
                </p>
              }
            </div>

            <div>
              <label
                class="block text-sm font-medium text-text-secondary mb-2"
              >
                Proveedor *
              </label>
              <app-selector
                [options]="supplierOptions()"
                [ngModel]="supplierId()"
                placeholder="Selecciona un proveedor"
                (ngModelChange)="supplierId.set(asNumber($event))"
              />
            </div>

            <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
              <label class="block">
                <span class="text-text-secondary text-xs">
                  Fecha esperada (opcional)
                </span>
                <input
                  type="date"
                  [(ngModel)]="expectedDate"
                  name="expectedDate"
                  class="mt-1 w-full px-3 py-2 border border-border rounded-lg bg-background text-sm focus:border-primary focus:ring-1 focus:ring-primary outline-none"
                />
              </label>
              <label class="block">
                <span class="text-text-secondary text-xs">
                  Moneda (opcional)
                </span>
                <input
                  type="text"
                  [(ngModel)]="currencyCode"
                  name="currencyCode"
                  maxlength="3"
                  placeholder="COP, USD..."
                  class="mt-1 w-full px-3 py-2 border border-border rounded-lg bg-background text-sm focus:border-primary focus:ring-1 focus:ring-primary outline-none uppercase"
                />
              </label>
            </div>

            <label class="block">
              <span class="text-text-secondary text-xs">
                Notas (opcional)
              </span>
              <textarea
                [(ngModel)]="notes"
                name="notes"
                rows="2"
                placeholder="Detalles del pedido, condiciones de pago, referencias..."
                class="mt-1 w-full px-3 py-2 border border-border rounded-lg bg-background text-sm focus:border-primary focus:ring-1 focus:ring-primary outline-none"
              ></textarea>
            </label>
          </div>
        </app-card>
      }

      <!-- STEP 2: Productos (search + cart) -->
      @if (isProductsStep()) {
        <app-card>
          <div class="space-y-4">
            <div
              class="p-3 bg-surface-secondary rounded-xl border border-border flex items-center gap-3"
            >
              <app-icon name="map-pin" [size]="18" class="text-primary" />
              <div class="min-w-0 flex-1">
                <p class="text-xs text-text-secondary">
                  Recibir en
                </p>
                <p class="text-sm font-medium text-text-primary truncate">
                  {{ selectedLocationLabel() || '—' }}
                </p>
              </div>
              <button
                type="button"
                (click)="goToStep(1)"
                class="text-sm text-primary hover:underline shrink-0"
              >
                Cambiar
              </button>
            </div>

            <div>
              <label
                class="block text-sm font-medium text-text-secondary mb-2"
              >
                Buscar producto
              </label>
              <div class="flex items-center gap-2">
                <app-inputsearch
                  class="flex-1"
                  size="sm"
                  placeholder="Buscar por nombre o SKU..."
                  [debounceTime]="200"
                  (searchChange)="onProductSearch($event)"
                />
                <app-button
                  variant="outline"
                  size="sm"
                  type="button"
                  customClasses="!rounded-xl shrink-0"
                  (clicked)="openPreBulk()"
                  title="Crear y comprar un producto que aún no existe en catálogo"
                >
                  <app-icon name="plus" [size]="14" slot="icon" />
                  Producto nuevo
                </app-button>
              </div>
              <p class="text-[11px] text-text-secondary mt-1">
                ¿Comprando algo que no existe en catálogo? Usa
                <strong>Producto nuevo</strong> — se crea automáticamente al
                guardar la orden.
              </p>
            </div>

            @if (loadingStock()) {
              <div class="p-4 text-center">
                <div
                  class="inline-block animate-spin rounded-full h-6 w-6 border-b-2 border-primary"
                ></div>
                <p class="mt-2 text-xs text-text-secondary">
                  Cargando productos...
                </p>
              </div>
            } @else if (filteredStock().length > 0) {
              <div
                class="max-h-60 overflow-y-auto border border-border rounded-xl divide-y divide-border"
              >
                @for (row of filteredStock(); track row.id) {
                  @let added = isAlreadyAdded(row);
                  <button
                    type="button"
                    class="w-full p-3 text-left hover:bg-primary/5 transition-colors disabled:cursor-not-allowed disabled:hover:bg-transparent"
                    [class.opacity-50]="added"
                    [disabled]="added"
                    [attr.title]="added ? 'Ya agregado a la orden' : null"
                    (click)="addLine(row)"
                  >
                    <div class="flex items-center justify-between gap-3">
                      <div class="min-w-0 flex-1">
                        <p
                          class="text-sm font-medium text-text-primary truncate"
                        >
                          {{
                            row.product_name ||
                              'Producto #' + row.product_id
                          }}
                          @if (row.variant_name) {
                            <span class="text-text-secondary">
                              ({{ row.variant_name }})
                            </span>
                          }
                        </p>
                        <p class="text-xs text-text-secondary truncate">
                          SKU: {{ row.variant_sku || row.product_sku || '-' }}
                        </p>
                      </div>
                      <div class="text-right shrink-0">
                        <p class="text-xs text-text-secondary">
                          Stock actual
                        </p>
                        <p class="text-sm font-semibold text-text-primary">
                          {{ row.quantity }}
                        </p>
                      </div>
                    </div>
                  </button>
                }
              </div>
            } @else if (productSearchTerm()) {
              <p class="text-xs text-text-secondary">
                Sin resultados para "{{ productSearchTerm() }}".
              </p>
            } @else if (stock().length === 0) {
              <p
                class="text-xs text-text-secondary p-3 bg-warning/10 rounded-lg flex items-center gap-2"
              >
                <app-icon name="alert-circle" [size]="14" />
                Esta ubicación no tiene productos con stock-level. Usa
                <strong>Producto nuevo</strong> arriba para abastecer
                inventario nuevo desde esta misma OC.
              </p>
            }

            <!-- Cart -->
            <div>
              <h3
                class="text-sm font-medium text-text-secondary mb-2 flex items-center justify-between"
              >
                <span>Líneas ({{ lines().length }})</span>
                @if (lines().length > 0) {
                  <span class="text-text-primary font-semibold">
                    Total: {{ formatMoney(total()) }}
                  </span>
                }
              </h3>

              @if (lines().length === 0) {
                <div
                  class="p-6 text-center border border-dashed border-border rounded-xl"
                >
                  <app-icon
                    name="shopping-bag"
                    [size]="32"
                    class="mx-auto mb-2 text-gray-300"
                  />
                  <p class="text-sm text-text-secondary">
                    Busca y agrega productos para crear líneas.
                  </p>
                </div>
              } @else {
                <div class="space-y-2">
                  @for (line of lines(); track line.key; let i = $index) {
                    <div
                      class="p-3 bg-surface rounded-xl border border-border space-y-2"
                    >
                      <div class="flex items-start justify-between gap-2">
                        <div class="min-w-0">
                          <p
                            class="text-sm font-medium text-text-primary truncate"
                          >
                            {{ line.product_name }}
                            @if (line.variant_name) {
                              <span class="text-text-secondary">
                                ({{ line.variant_name }})
                              </span>
                            }
                          </p>
                          <p class="text-xs text-text-secondary truncate">
                            SKU: {{ line.sku || '-' }}
                          </p>
                        </div>
                        <button
                          type="button"
                          class="text-error hover:text-error/80 transition-colors"
                          (click)="removeLine(i)"
                          title="Quitar línea"
                        >
                          <app-icon name="trash-2" [size]="16" />
                        </button>
                      </div>

                      <div class="grid grid-cols-3 gap-2 items-end">
                        <div>
                          <label class="text-xs text-text-secondary">
                            Cantidad *
                          </label>
                          <input
                            type="number"
                            min="1"
                            step="1"
                            [value]="line.quantity"
                            (input)="updateQuantity(i, $event)"
                            class="w-full px-2 py-1.5 text-sm border border-border rounded-lg bg-surface focus:border-primary focus:ring-1 focus:ring-primary outline-none"
                          />
                        </div>
                        <div>
                          <label class="text-xs text-text-secondary">
                            Costo unit. *
                          </label>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            [value]="line.unit_cost"
                            (input)="updateUnitCost(i, $event)"
                            class="w-full px-2 py-1.5 text-sm border border-border rounded-lg bg-surface focus:border-primary focus:ring-1 focus:ring-primary outline-none"
                          />
                        </div>
                        <div class="text-right">
                          <p class="text-xs text-text-secondary">Subtotal</p>
                          <p class="text-sm font-semibold text-text-primary">
                            {{ formatMoney(lineSubtotal(line)) }}
                          </p>
                        </div>
                      </div>
                    </div>
                  }
                </div>
              }
            </div>
          </div>
        </app-card>
      }

      <!-- STEP 3: Confirmar -->
      @if (isConfirmStep()) {
        <app-card>
          <div class="space-y-4">
            <div
              class="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm"
            >
              <div
                class="p-3 bg-surface-secondary rounded-xl border border-border"
              >
                <p class="text-xs text-text-secondary">Ubicación destino</p>
                <p class="font-medium text-text-primary truncate">
                  {{ selectedLocationLabel() || '—' }}
                </p>
              </div>
              <div
                class="p-3 bg-surface-secondary rounded-xl border border-border"
              >
                <p class="text-xs text-text-secondary">Proveedor</p>
                <p class="font-medium text-text-primary truncate">
                  {{ selectedSupplierLabel() || '—' }}
                </p>
              </div>
              @if (expectedDate) {
                <div
                  class="p-3 bg-surface-secondary rounded-xl border border-border"
                >
                  <p class="text-xs text-text-secondary">Fecha esperada</p>
                  <p class="font-medium text-text-primary">
                    {{ expectedDate }}
                  </p>
                </div>
              }
              @if (currencyCode) {
                <div
                  class="p-3 bg-surface-secondary rounded-xl border border-border"
                >
                  <p class="text-xs text-text-secondary">Moneda</p>
                  <p class="font-medium text-text-primary">
                    {{ currencyDisplay() }}
                  </p>
                </div>
              }
            </div>

            <div>
              <h3 class="text-sm font-medium text-text-secondary mb-2">
                Resumen de líneas ({{ lines().length }})
              </h3>
              <div class="border border-border rounded-xl overflow-hidden">
                <div
                  class="grid grid-cols-[1fr_70px_90px_90px] gap-0 bg-surface-secondary text-xs font-medium text-text-secondary border-b border-border"
                >
                  <div class="px-3 py-2">Producto</div>
                  <div class="px-2 py-2 text-center">Cant.</div>
                  <div class="px-2 py-2 text-right">Costo</div>
                  <div class="px-2 py-2 text-right">Subtotal</div>
                </div>
                @for (line of lines(); track line.key) {
                  <div
                    class="grid grid-cols-[1fr_70px_90px_90px] gap-0 border-b border-border last:border-b-0 items-center"
                  >
                    <div class="px-3 py-2">
                      <p
                        class="text-sm font-medium text-text-primary truncate"
                      >
                        {{ line.product_name }}
                        @if (line.variant_name) {
                          <span class="text-text-secondary">
                            ({{ line.variant_name }})
                          </span>
                        }
                      </p>
                      @if (line.sku) {
                        <p class="text-xs text-text-secondary">
                          {{ line.sku }}
                        </p>
                      }
                    </div>
                    <div
                      class="px-2 py-2 text-center text-sm text-text-primary"
                    >
                      {{ line.quantity }}
                    </div>
                    <div
                      class="px-2 py-2 text-right text-sm text-text-secondary"
                    >
                      {{ formatMoney(line.unit_cost) }}
                    </div>
                    <div
                      class="px-2 py-2 text-right text-sm font-semibold text-text-primary"
                    >
                      {{ formatMoney(lineSubtotal(line)) }}
                    </div>
                  </div>
                }
              </div>
            </div>

            <div
              class="p-4 bg-primary/5 rounded-xl border border-primary/20 flex items-center justify-between"
            >
              <p class="text-sm text-text-secondary">
                Total estimado de la orden
              </p>
              <p class="text-xl font-bold text-primary">
                {{ formatMoney(total()) }}
              </p>
            </div>

            @if (canRunDirectFlow()) {
              <label
                class="flex items-start gap-3 p-3 bg-warning/5 rounded-xl border border-warning/20 cursor-pointer select-none"
              >
                <input
                  type="checkbox"
                  [ngModel]="receiveImmediately()"
                  name="receiveImmediately"
                  (ngModelChange)="receiveImmediately.set($event === true)"
                  class="mt-0.5 w-4 h-4 rounded border-border text-primary focus:ring-primary"
                />
                <div>
                  <p class="text-sm font-medium text-text-primary">
                    Crear y recibir inmediatamente
                  </p>
                  <p class="text-xs text-text-secondary mt-0.5">
                    Al activarlo, la orden se crea, se aprueba y se recibe
                    completa. El stock, los costos y la contabilidad se
                    ejecutan al guardar.
                  </p>
                </div>
              </label>
            } @else {
              <div
                class="p-3 bg-surface-secondary rounded-xl border border-border flex items-start gap-2"
              >
                <app-icon
                  name="lock"
                  [size]="16"
                  class="text-text-secondary mt-0.5"
                />
                <p class="text-xs text-text-secondary">
                  Para crear y recibir en un solo paso necesitas permisos de
                  aprobación y recepción de órdenes.
                </p>
              </div>
            }

            @if (notes) {
              <div
                class="p-3 bg-surface-secondary rounded-xl border border-border"
              >
                <p class="text-xs text-text-secondary mb-1">Notas</p>
                <p class="text-sm text-text-primary whitespace-pre-line">
                  {{ notes }}
                </p>
              </div>
            }
          </div>
        </app-card>
      }

      <!-- Footer -->
      <div
        class="mt-4 flex flex-col gap-3 px-4 py-3 bg-gray-50 rounded-xl"
      >
        @if (!isConfirmStep()) {
          <app-button
            variant="primary"
            type="button"
            (clicked)="goToStep(currentStep() + 1)"
            [disabled]="!canAdvance()"
            customClasses="!rounded-xl font-bold shadow-md shadow-primary-200 !w-full !justify-center !py-3.5 !text-base"
          >
            Continuar
            <app-icon
              name="arrow-right"
              [size]="16"
              class="ml-2"
              slot="icon"
            />
          </app-button>
        } @else if (receiveImmediately()) {
          <app-button
            variant="primary"
            type="button"
            (clicked)="submit()"
            [loading]="submitting()"
            [disabled]="submitting() || !canSubmit() || !canRunDirectFlow()"
            customClasses="!rounded-xl font-bold shadow-md shadow-primary-200 active:scale-95 transition-all !w-full !justify-center !py-3.5 !text-base"
          >
            <app-icon
              name="package-check"
              [size]="18"
              class="mr-2"
              slot="icon"
            />
            Crear y recibir
          </app-button>
        } @else {
          <app-button
            variant="primary"
            type="button"
            (clicked)="submit()"
            [loading]="submitting()"
            [disabled]="submitting() || !canSubmit()"
            customClasses="!rounded-xl font-bold shadow-md shadow-primary-200 active:scale-95 transition-all !w-full !justify-center !py-3.5 !text-base"
          >
            <app-icon
              name="check-circle"
              [size]="18"
              class="mr-2"
              slot="icon"
            />
            Crear Orden de Compra
          </app-button>
        }

        <div class="flex items-center justify-center gap-6 py-1">
          @if (currentStep() > 1) {
            <button
              type="button"
              (click)="goToStep(currentStep() - 1)"
              class="text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)] transition-colors p-1"
              title="Paso anterior"
            >
              <app-icon name="arrow-left" [size]="22" />
            </button>
          }
          <a
            routerLink="/admin/purchase-orders"
            class="text-error hover:text-error/80 transition-colors p-1"
            title="Cancelar"
          >
            <app-icon name="x" [size]="22" />
          </a>
        </div>
      </div>

      <!-- Prebulk modal — temporary product not in catalog -->
      <app-pop-prebulk-modal
        [(isOpen)]="prebulkOpen"
        (add)="onPreBulkAdd($event)"
        (close)="prebulkOpen.set(false)"
      />
    </div>
  `,
})
export class OrgPurchaseOrderCreateComponent {
  private readonly authFacade = inject(AuthFacade);
  private readonly service = inject(OrgPurchaseOrdersService);
  private readonly inventoryService = inject(OrgInventoryService);
  private readonly errors = inject(ApiErrorService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  private readonly currencyPipe = inject(CurrencyPipe);

  readonly currentStep = signal(1);
  readonly steps = signal<StepsLineItem[]>([
    { label: 'DESTINO', completed: false },
    { label: 'PRODUCTOS', completed: false },
    { label: 'CONFIRMAR', completed: false },
  ]);

  readonly locations = signal<{ id: number; name: string; store_name?: string | null }[]>([]);
  readonly suppliers = signal<{ id: number; name: string }[]>([]);
  readonly stock = signal<StockOption[]>([]);
  readonly lines = signal<CartLine[]>([]);

  readonly locationId = signal<number | null>(null);
  readonly supplierId = signal<number | null>(null);
  expectedDate: string | null = null;
  currencyCode = '';
  notes = '';

  readonly loadingStock = signal(false);
  readonly productSearchTerm = signal('');
  readonly submitting = signal(false);
  readonly errorMessage = signal<string | null>(null);
  readonly prebulkOpen = signal(false);
  readonly receiveImmediately = signal(false);

  readonly isMetaStep = computed(() => this.currentStep() === 1);
  readonly isProductsStep = computed(() => this.currentStep() === 2);
  readonly isConfirmStep = computed(() => this.currentStep() === 3);

  readonly stepTitle = computed(() => {
    if (this.isMetaStep()) return 'Nueva OC · Destino';
    if (this.isProductsStep()) return 'Nueva OC · Productos';
    return 'Nueva OC · Confirmar';
  });

  readonly locationOptions = computed<SelectorOption[]>(() =>
    this.locations().map((l) => ({
      value: l.id,
      label: l.store_name ? `${l.name} — ${l.store_name}` : l.name,
    })),
  );

  readonly supplierOptions = computed<SelectorOption[]>(() =>
    this.suppliers().map((s) => ({ value: s.id, label: s.name })),
  );

  readonly selectedLocationLabel = computed(() => {
    const id = this.locationId();
    if (id == null) return null;
    return (
      this.locationOptions().find((o) => o.value === id)?.label?.toString() ?? null
    );
  });

  readonly selectedSupplierLabel = computed(() => {
    const id = this.supplierId();
    if (id == null) return null;
    return (
      this.supplierOptions().find((o) => o.value === id)?.label?.toString() ?? null
    );
  });

  readonly filteredStock = computed(() => {
    const term = this.productSearchTerm().trim().toLowerCase();
    const list = this.stock();
    const sorted = [...list].sort((a, b) =>
      (a.product_name ?? '').localeCompare(b.product_name ?? ''),
    );
    if (!term) return sorted.slice(0, 25);
    return sorted
      .filter((row) => {
        const haystack = [
          row.product_name,
          row.product_sku,
          row.variant_name,
          row.variant_sku,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return haystack.includes(term);
      })
      .slice(0, 50);
  });

  readonly total = computed(() =>
    this.lines().reduce((sum, l) => sum + l.quantity * l.unit_cost, 0),
  );

  readonly canAdvance = computed(() => {
    if (this.isMetaStep()) {
      return this.locationId() != null && this.supplierId() != null;
    }
    if (this.isProductsStep()) {
      return (
        this.lines().length > 0 &&
        this.lines().every(
          (l) => l.quantity > 0 && Number.isFinite(l.unit_cost) && l.unit_cost >= 0,
        )
      );
    }
    return true;
  });

  readonly canSubmit = computed(
    () =>
      this.locationId() != null &&
      this.supplierId() != null &&
      this.lines().length > 0 &&
      this.lines().every(
        (l) => l.quantity > 0 && Number.isFinite(l.unit_cost) && l.unit_cost >= 0,
      ),
  );

  readonly canRunDirectFlow = computed(
    () =>
      this.authFacade.hasRole('super_admin') ||
      (this.authFacade.hasPermission('store:orders:purchase_orders:approve') &&
        this.authFacade.hasPermission('store:orders:purchase_orders:receive')),
  );

  constructor() {
    this.loadLocations();
    this.loadSuppliers();
  }

  private loadLocations(): void {
    this.inventoryService
      .getLocations({ is_active: true, limit: 200 })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          const data = res?.data ?? [];
          this.locations.set(
            data.map((l: any) => ({
              id: l.id,
              name: l.name,
              store_name: l.store_name ?? null,
            })),
          );
        },
        error: (err) => console.error('[OrgPOCreate] locations load failed', err),
      });
  }

  private loadSuppliers(): void {
    this.inventoryService
      .getSuppliers({ is_active: true, limit: 200 })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          const data = res?.data ?? [];
          this.suppliers.set(
            data.map((s: any) => ({ id: s.id, name: s.name })),
          );
        },
        error: (err) => console.error('[OrgPOCreate] suppliers load failed', err),
      });
  }

  onLocationChange(value: any): void {
    const id = this.asNumber(value);
    this.locationId.set(id);
    this.lines.set([]);
    this.stock.set([]);
    this.productSearchTerm.set('');
    if (id != null) this.loadStockForLocation(id);
  }

  private loadStockForLocation(locationId: number): void {
    this.loadingStock.set(true);
    this.inventoryService
      .getStockLevels({ location_id: locationId, limit: 500 })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res: any) => {
          const raw: any[] = Array.isArray(res?.data) ? res.data : [];
          // Defense in depth: backend already scopes by org and location.
          const data: StockOption[] = raw
            .filter((r) => r.location_id === locationId)
            .map((r) => ({
              id: r.id,
              product_id: r.product_id,
              product_name: r.product_name ?? null,
              product_sku: r.product_sku ?? null,
              variant_id: r.variant_id ?? null,
              variant_name: r.variant_name ?? null,
              variant_sku: r.variant_sku ?? null,
              location_id: r.location_id,
              quantity: Number(r.quantity ?? 0),
              available_quantity: Number(r.available_quantity ?? 0),
            }));
          this.stock.set(data);
          this.loadingStock.set(false);
        },
        error: (err) => {
          console.error('[OrgPOCreate] stock load failed', err);
          this.stock.set([]);
          this.loadingStock.set(false);
        },
      });
  }

  onProductSearch(term: string): void {
    this.productSearchTerm.set(term ?? '');
  }

  isAlreadyAdded(row: StockOption): boolean {
    const key = this.lineKey(row.product_id, row.variant_id);
    return this.lines().some((l) => l.key === key);
  }

  addLine(row: StockOption): void {
    const key = this.lineKey(row.product_id, row.variant_id);
    if (this.lines().some((l) => l.key === key)) return;
    this.lines.update((curr) => [
      ...curr,
      {
        key,
        product_id: row.product_id,
        product_variant_id: row.variant_id ?? null,
        product_name: row.product_name ?? `Producto #${row.product_id}`,
        variant_name: row.variant_name ?? null,
        sku: row.variant_sku ?? row.product_sku ?? null,
        quantity: 1,
        unit_cost: 0,
      },
    ]);
    this.productSearchTerm.set('');
  }

  removeLine(index: number): void {
    this.lines.update((curr) => curr.filter((_, i) => i !== index));
  }

  // ─── Prebulk (productos temporales fuera de catálogo) ────────────────
  openPreBulk(): void {
    if (this.locationId() == null) {
      this.toast.warning(
        'Selecciona primero la ubicación destino para esta OC.',
      );
      return;
    }
    this.prebulkOpen.set(true);
  }

  onPreBulkAdd(payload: {
    prebulkData: PreBulkData;
    quantity: number;
    unit_cost: number;
    notes?: string;
  }): void {
    const sku =
      payload.prebulkData.code?.trim() ||
      `PREBULK-${Date.now().toString(36).toUpperCase()}`;
    const key = `prebulk-${sku}-${this.lines().length}`;
    this.lines.update((curr) => [
      ...curr,
      {
        key,
        product_id: 0,
        product_variant_id: null,
        product_name: payload.prebulkData.name,
        variant_name: null,
        sku,
        quantity: Math.max(1, payload.quantity || 1),
        unit_cost: Math.max(0, payload.unit_cost || 0),
        is_prebulk: true,
        prebulk_data: { ...payload.prebulkData, code: sku },
      },
    ]);
    this.prebulkOpen.set(false);
  }

  updateQuantity(index: number, event: Event): void {
    const raw = +(event.target as HTMLInputElement).value;
    const next = Math.max(1, Number.isFinite(raw) ? Math.floor(raw) : 1);
    this.lines.update((curr) =>
      curr.map((l, i) => (i === index ? { ...l, quantity: next } : l)),
    );
  }

  updateUnitCost(index: number, event: Event): void {
    const raw = +(event.target as HTMLInputElement).value;
    const next = Math.max(0, Number.isFinite(raw) ? raw : 0);
    this.lines.update((curr) =>
      curr.map((l, i) => (i === index ? { ...l, unit_cost: next } : l)),
    );
  }

  lineSubtotal(line: CartLine): number {
    return line.quantity * line.unit_cost;
  }

  goToStep(step: number): void {
    if (step > this.currentStep() && !this.canAdvance()) return;
    if (step < 1 || step > 3) return;
    this.currentStep.set(step);
    this.steps.update((arr) =>
      arr.map((s, i) => ({ ...s, completed: i < step - 1 })),
    );
  }

  submit(): void {
    if (!this.canSubmit()) return;
    const receiveNow = this.receiveImmediately();
    if (receiveNow && !this.canRunDirectFlow()) return;

    this.submitting.set(true);
    this.errorMessage.set(null);

    const dto: CreateOrgPurchaseOrderDto = {
      supplier_id: this.supplierId()!,
      destination_location_id: this.locationId()!,
      ...(this.expectedDate ? { expected_date: this.expectedDate } : {}),
      ...(this.notes ? { notes: this.notes } : {}),
      items: this.lines().map((l) => {
        const base = {
          product_id: l.product_id ?? 0,
          ...(l.product_variant_id != null
            ? { product_variant_id: l.product_variant_id }
            : {}),
          quantity: l.quantity,
          unit_price: l.unit_cost,
        };

        // Prebulk → backend autocreates the catalog row from these fields.
        if (l.is_prebulk && l.prebulk_data) {
          return {
            ...base,
            product_name: l.prebulk_data.name,
            sku: l.prebulk_data.code || l.sku || undefined,
            ...(l.prebulk_data.description
              ? { product_description: l.prebulk_data.description }
              : {}),
            ...(l.prebulk_data.base_price != null
              ? { base_price: l.prebulk_data.base_price }
              : {}),
          };
        }

        return base;
      }),
    };

    const request = receiveNow
      ? this.service.createApproveAndReceive(dto, this.buildReceiveNotes())
      : this.service.create(dto);

    request
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.submitting.set(false);
          this.toast.success(
            receiveNow
              ? 'Orden de compra creada y recibida'
              : 'Orden de compra creada',
          );
          const id = res?.data?.id;
          this.router.navigate(
            id ? ['/admin/purchase-orders', id] : ['/admin/purchase-orders'],
          );
        },
        error: (err) => {
          console.error('[OrgPOCreate] submit failed', err);
          this.submitting.set(false);
          this.errorMessage.set(
            this.errors.humanize(
              err,
              receiveNow
                ? 'No se pudo completar la creación y recepción de la orden.'
                : 'No se pudo crear la orden de compra.',
            ),
          );
        },
      });
  }

  private buildReceiveNotes(): string {
    const base = 'Recepción directa desde creación de orden de compra.';
    return this.notes ? `${base}\n${this.notes}` : base;
  }

  currencyDisplay(): string {
    return (this.currencyCode || '').trim().toUpperCase();
  }

  formatMoney(value: number): string {
    if (!Number.isFinite(value)) return '—';
    return this.currencyPipe.transform(value) ?? `${value}`;
  }

  asNumber(v: any): number | null {
    if (v === null || v === undefined || v === '') return null;
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) ? n : null;
  }

  private lineKey(productId: number, variantId: number | null | undefined): string {
    return `${productId}-${variantId ?? 'base'}`;
  }
}
