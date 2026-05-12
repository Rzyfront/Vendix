import {
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';

import {
  ButtonComponent,
  IconComponent,
  InputsearchComponent,
  ModalComponent,
  SelectorComponent,
  SelectorOption,
  StepsLineComponent,
  StepsLineItem,
} from '../../../../../../../shared/components/index';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../../../../../../environments/environment';
import {
  CreateOrgAdjustmentBulkRequest,
  OrgAdjustmentType,
} from '../../../interfaces/org-adjustment.interface';

/**
 * Shape returned by `GET /api/organization/inventory/stock-levels` —
 * fields are FLAT (not nested under `products` / `product_variants`).
 */
interface StockRow {
  id: number;
  product_id: number;
  product_name: string | null;
  product_sku: string | null;
  variant_id: number | null;
  variant_name: string | null;
  variant_sku: string | null;
  location_id: number;
  location_name: string | null;
  store_id: number | null;
  store_name: string | null;
  quantity: number;
  reserved_quantity: number;
  available_quantity: number;
}

interface AdjustmentItemUI {
  key: string;
  product_id: number;
  product_name: string;
  product_variant_id?: number | null;
  variant_name?: string | null;
  sku?: string | null;
  stock_on_hand: number;
  type: OrgAdjustmentType;
  quantity_after: number;
  reason_code?: string;
  description?: string;
}

const TYPE_GRID: { label: string; value: OrgAdjustmentType; icon: string }[] = [
  { label: 'Daño', value: 'damage', icon: 'alert-triangle' },
  { label: 'Pérdida', value: 'loss', icon: 'x-circle' },
  { label: 'Robo', value: 'theft', icon: 'shield-off' },
  { label: 'Vencido', value: 'expiration', icon: 'clock' },
  { label: 'Conteo', value: 'count_variance', icon: 'hash' },
  { label: 'Corrección', value: 'manual_correction', icon: 'edit-3' },
];

const REASON_BY_TYPE: Record<OrgAdjustmentType, string> = {
  damage: 'DAMAGED',
  loss: 'LOST',
  theft: 'THEFT',
  expiration: 'EXPIRED',
  count_variance: 'INV_COUNT',
  manual_correction: 'OTHER',
};

const TYPE_LABELS: Record<OrgAdjustmentType, string> = {
  damage: 'Daño',
  loss: 'Pérdida',
  theft: 'Robo',
  expiration: 'Vencido',
  count_variance: 'Conteo',
  manual_correction: 'Corrección',
};

/**
 * Wizard org-level adjustment creation modal.
 *
 * 3 steps: UBICACIÓN → PRODUCTOS → CONFIRMAR. Mirrors the store-side
 * wizard pattern but emits a single `save` event carrying `auto_approve`
 * (true = aplicar inmediatamente, false = dejar pendiente).
 */
@Component({
  selector: 'app-org-adjustment-form-modal',
  standalone: true,
  imports: [
    FormsModule,
    ModalComponent,
    ButtonComponent,
    IconComponent,
    InputsearchComponent,
    SelectorComponent,
    StepsLineComponent,
  ],
  template: `
    <app-modal
      [isOpen]="isOpen()"
      [title]="modalTitle()"
      [subtitle]="modalSubtitle()"
      size="md"
      (closed)="onCancel()"
      (isOpenChange)="isOpenChange.emit($event)"
    >
      <app-steps-line
        [steps]="steps()"
        [currentStep]="currentStep() - 1"
        size="md"
        primaryColor="var(--color-primary)"
        secondaryColor="var(--color-secondary)"
        class="mb-6 block"
      />

      <!-- STEP 1: Ubicación -->
      @if (isLocationStep()) {
        <div class="space-y-6">
          <div>
            <label class="block text-sm font-medium text-text-secondary mb-2">
              Ubicación *
            </label>
            <app-selector
              [options]="locations()"
              [ngModel]="selectedLocationId()"
              placeholder="Selecciona una ubicación"
              (ngModelChange)="onLocationChange($event)"
            />
          </div>

          @if (selectedLocationId() != null) {
            <div
              class="p-3 bg-primary/5 rounded-xl border border-primary/20 text-center"
            >
              <p class="text-sm text-text-secondary">Ubicación seleccionada</p>
              <p class="text-lg font-bold text-primary">
                {{ selectedLocationLabel() }}
              </p>
            </div>
          }

          @if (loadingStock()) {
            <div class="p-4 text-center">
              <div
                class="inline-block animate-spin rounded-full h-6 w-6 border-b-2 border-primary"
              ></div>
              <p class="mt-2 text-xs text-text-secondary">
                Cargando stock de la ubicación...
              </p>
            </div>
          }

          @if (stockError(); as err) {
            <p
              class="p-2 bg-error/10 rounded-lg text-error text-xs flex items-center gap-2"
            >
              <app-icon name="alert-circle" [size]="14" />
              {{ err }}
            </p>
          }
        </div>
      }

      <!-- STEP 2: Productos -->
      @if (isProductsStep()) {
        <div class="space-y-4">
          <div
            class="p-3 bg-surface-secondary rounded-xl border border-border flex items-center gap-3"
          >
            <app-icon name="map-pin" [size]="18" class="text-primary" />
            <span class="text-sm font-medium text-text-primary">
              {{ selectedLocationLabel() }}
            </span>
            <button
              type="button"
              (click)="goToStep(1)"
              class="ml-auto text-sm text-primary hover:underline"
            >
              Cambiar
            </button>
          </div>

          <div>
            <label class="block text-sm font-medium text-text-secondary mb-2">
              Buscar producto en la ubicación
            </label>
            <app-inputsearch
              size="sm"
              placeholder="Filtra por nombre o SKU..."
              [debounceTime]="200"
              (searchChange)="onProductSearch($event)"
            />
          </div>

          @if (loadingStock()) {
            <div class="p-4 text-center">
              <div
                class="inline-block animate-spin rounded-full h-6 w-6 border-b-2 border-primary"
              ></div>
              <p class="mt-2 text-xs text-text-secondary">Cargando stock...</p>
            </div>
          } @else if (filteredStock().length > 0) {
            <div
              class="max-h-48 overflow-y-auto border border-border rounded-xl divide-y divide-border"
            >
              @for (row of filteredStock(); track row.id) {
                @let alreadyAdded = isAlreadyAdded(row);
                <button
                  type="button"
                  class="w-full p-3 text-left hover:bg-primary/5 transition-colors disabled:cursor-not-allowed disabled:hover:bg-transparent"
                  [class.opacity-50]="alreadyAdded"
                  [disabled]="alreadyAdded"
                  [attr.title]="alreadyAdded ? 'Ya agregado al ajuste' : null"
                  (click)="addRow(row)"
                >
                  <div class="flex items-center justify-between gap-3">
                    <div class="min-w-0 flex-1">
                      <p
                        class="text-sm font-medium text-text-primary truncate"
                      >
                        {{ row.product_name || 'Producto #' + row.product_id }}
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
                      <p class="text-xs font-medium text-text-primary">
                        Stock: {{ row.quantity }}
                      </p>
                      <p class="text-xs text-text-secondary">
                        Disponible: {{ row.available_quantity }}
                      </p>
                    </div>
                  </div>
                </button>
              }
            </div>
          } @else if (stockSearchTerm()) {
            <p class="text-xs text-text-secondary">
              Sin resultados para "{{ stockSearchTerm() }}" en esta ubicación.
            </p>
          } @else if (stock().length === 0) {
            <p
              class="text-xs text-text-secondary p-3 bg-warning/10 rounded-lg flex items-center gap-2"
            >
              <app-icon name="alert-circle" [size]="14" />
              Esta ubicación no tiene productos con stock registrado.
            </p>
          }

          <div>
            <label class="block text-sm font-medium text-text-secondary mb-2">
              Productos a ajustar ({{ items().length }})
            </label>

            @if (items().length === 0) {
              <div
                class="p-6 text-center border border-dashed border-border rounded-xl"
              >
                <app-icon
                  name="clipboard-list"
                  [size]="32"
                  class="mx-auto mb-2 text-gray-300"
                />
                <p class="text-sm text-text-secondary">
                  Busca y agrega productos para ajustar.
                </p>
              </div>
            }

            @for (item of items(); track item.key; let i = $index) {
              <div
                class="p-3 bg-surface rounded-xl border border-border mb-2 space-y-3"
              >
                <div class="flex items-center justify-between">
                  <div class="min-w-0">
                    <p class="text-sm font-medium text-text-primary truncate">
                      {{ item.product_name }}
                      @if (item.variant_name) {
                        <span class="text-text-secondary">
                          ({{ item.variant_name }})
                        </span>
                      }
                    </p>
                    <p class="text-xs text-text-secondary truncate">
                      Stock actual: {{ item.stock_on_hand }}
                      @if (item.sku) {
                        <span class="mx-1">|</span> SKU: {{ item.sku }}
                      }
                    </p>
                  </div>
                  <button
                    type="button"
                    class="text-error hover:text-error/80 transition-colors"
                    (click)="removeRow(i)"
                  >
                    <app-icon name="trash-2" [size]="16" />
                  </button>
                </div>

                <div>
                  <p class="text-xs font-medium text-text-secondary mb-1.5">
                    Tipo *
                  </p>
                  <div class="grid grid-cols-3 gap-1.5">
                    @for (type of adjustmentTypes; track type.value) {
                      <button
                        type="button"
                        (click)="updateType(i, type.value)"
                        class="flex flex-col items-center p-2 rounded-lg border transition-colors text-center"
                        [class]="
                          item.type === type.value
                            ? 'border-primary bg-primary/10 text-primary'
                            : 'border-border bg-surface text-text-secondary hover:border-muted hover:bg-muted/10'
                        "
                      >
                        <app-icon
                          [name]="type.icon"
                          [size]="14"
                          class="mb-0.5"
                        />
                        <span class="text-[10px] leading-tight">
                          {{ type.label }}
                        </span>
                      </button>
                    }
                  </div>
                </div>

                <div class="flex items-center gap-3">
                  <div class="flex-1">
                    <label class="text-xs text-text-secondary">
                      Nueva cantidad *
                    </label>
                    <input
                      type="number"
                      [min]="0"
                      [value]="item.quantity_after"
                      (input)="updateQuantityAfter(i, $event)"
                      class="w-full px-3 py-1.5 text-sm border border-border rounded-lg bg-surface focus:border-primary focus:ring-1 focus:ring-primary outline-none"
                    />
                  </div>
                  <div class="flex items-center gap-1 pt-4">
                    <span class="text-sm text-text-secondary">
                      {{ item.stock_on_hand }}
                    </span>
                    <app-icon
                      name="arrow-right"
                      [size]="14"
                      class="text-text-secondary"
                    />
                    <span
                      class="text-sm font-bold"
                      [class]="
                        deltaOf(item) > 0
                          ? 'text-success'
                          : deltaOf(item) < 0
                            ? 'text-error'
                            : 'text-text-secondary'
                      "
                    >
                      {{ item.quantity_after }}
                    </span>
                    <span
                      class="text-xs ml-1"
                      [class]="
                        deltaOf(item) > 0
                          ? 'text-success'
                          : deltaOf(item) < 0
                            ? 'text-error'
                            : 'text-text-secondary'
                      "
                    >
                      ({{ deltaOf(item) > 0 ? '+' : '' }}{{ deltaOf(item) }})
                    </span>
                  </div>
                </div>

                <div>
                  <input
                    type="text"
                    [value]="item.description ?? ''"
                    (input)="updateDescription(i, $event)"
                    placeholder="Nota adicional (opcional)..."
                    class="w-full px-3 py-1.5 text-xs border border-border rounded-lg bg-surface focus:border-primary focus:ring-1 focus:ring-primary outline-none"
                  />
                </div>
              </div>
            }
          </div>
        </div>
      }

      <!-- STEP 3: Confirmar -->
      @if (isConfirmStep()) {
        <div class="space-y-4">
          <div class="p-4 bg-surface-secondary rounded-xl border border-border">
            <div class="flex items-center gap-3">
              <app-icon name="map-pin" [size]="18" class="text-primary" />
              <div>
                <p class="text-xs text-text-secondary">Ubicación</p>
                <p class="text-sm font-medium text-text-primary">
                  {{ selectedLocationLabel() }}
                </p>
              </div>
            </div>
          </div>

          <!-- Reason / batch label -->
          <div>
            <label class="block text-xs text-text-secondary mb-1">
              Motivo (se aplica a todos los ajustes)
            </label>
            <textarea
              [(ngModel)]="batchReason"
              rows="2"
              placeholder="Ej. Conteo cíclico Q1, Inventario físico bodega central..."
              class="w-full px-3 py-2 text-sm border border-border rounded-lg bg-surface focus:border-primary focus:ring-1 focus:ring-primary outline-none"
            ></textarea>
          </div>

          <div>
            <h4 class="text-sm font-medium text-text-secondary mb-2">
              Proyección de inventario ({{ items().length }})
            </h4>
            <div class="border border-border rounded-xl overflow-hidden">
              <div
                class="grid grid-cols-[1fr_80px_60px_60px_60px] gap-0 bg-surface-secondary text-xs font-medium text-text-secondary border-b border-border"
              >
                <div class="px-3 py-2">Producto</div>
                <div class="px-2 py-2 text-center">Tipo</div>
                <div class="px-2 py-2 text-center">Actual</div>
                <div class="px-2 py-2 text-center">Nueva</div>
                <div class="px-2 py-2 text-center">Cambio</div>
              </div>
              @for (item of items(); track item.key) {
                <div
                  class="grid grid-cols-[1fr_80px_60px_60px_60px] gap-0 border-b border-border last:border-b-0 items-center"
                >
                  <div class="px-3 py-2.5">
                    <p
                      class="text-sm font-medium text-text-primary truncate"
                    >
                      {{ item.product_name }}
                      @if (item.variant_name) {
                        <span class="text-text-secondary">
                          ({{ item.variant_name }})
                        </span>
                      }
                    </p>
                    @if (item.sku) {
                      <p class="text-xs text-text-secondary">{{ item.sku }}</p>
                    }
                  </div>
                  <div class="px-2 py-2.5 text-center">
                    <span
                      class="text-xs px-1.5 py-0.5 rounded bg-muted/20 text-text-secondary"
                    >
                      {{ typeLabel(item.type) }}
                    </span>
                  </div>
                  <div
                    class="px-2 py-2.5 text-center text-sm text-text-secondary"
                  >
                    {{ item.stock_on_hand }}
                  </div>
                  <div
                    class="px-2 py-2.5 text-center text-sm font-bold text-text-primary"
                  >
                    {{ item.quantity_after }}
                  </div>
                  <div class="px-2 py-2.5 text-center">
                    <span
                      class="text-sm font-bold"
                      [class]="
                        deltaOf(item) > 0
                          ? 'text-success'
                          : deltaOf(item) < 0
                            ? 'text-error'
                            : 'text-text-secondary'
                      "
                    >
                      {{ deltaOf(item) > 0 ? '+' : '' }}{{ deltaOf(item) }}
                    </span>
                  </div>
                </div>
              }
            </div>
          </div>

          @if (hasZeroChange()) {
            <div
              class="p-3 bg-warning/10 rounded-xl border border-warning/30 text-sm text-warning flex items-center gap-2"
            >
              <app-icon name="alert-triangle" [size]="16" />
              Algunos items tienen cambio = 0. No se aplicará ningún ajuste para
              esos productos.
            </div>
          }

          @if (hasMissingType()) {
            <div
              class="p-3 bg-error/10 rounded-xl border border-error/30 text-sm text-error flex items-center gap-2"
            >
              <app-icon name="alert-circle" [size]="16" />
              Algunos items no tienen tipo de ajuste seleccionado. Vuelve al
              paso anterior para completarlos.
            </div>
          }

          <div
            class="p-3 bg-primary/5 rounded-xl border border-primary/20 text-center"
          >
            <p class="text-sm text-text-secondary">
              Total de productos a ajustar
            </p>
            <p class="text-2xl font-bold text-primary">{{ items().length }}</p>
          </div>

          <label
            class="flex items-start gap-3 p-3 bg-warning/5 rounded-xl border border-warning/20 cursor-pointer select-none"
          >
            <input
              type="checkbox"
              [(ngModel)]="confirmCreate"
              class="mt-0.5 w-4 h-4 rounded border-border text-primary focus:ring-primary"
            />
            <div>
              <p class="text-sm font-medium text-text-primary">
                Crear y aplicar inmediatamente
              </p>
              <p class="text-xs text-text-secondary mt-0.5">
                Al activarlo, los movimientos de inventario se aplican al
                guardar y no podrán revertirse. Si lo dejas desactivado, el
                ajuste queda pendiente de aprobación.
              </p>
            </div>
          </label>
        </div>
      }

      <div
        slot="footer"
        class="flex flex-col gap-3 px-5 py-4 bg-gray-50 rounded-b-xl"
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
        } @else if (confirmCreate) {
          <app-button
            variant="primary"
            type="button"
            (clicked)="onSubmit(true)"
            [loading]="isSubmitting()"
            [disabled]="isSubmitting() || hasMissingType()"
            customClasses="!rounded-xl font-bold shadow-md shadow-primary-200 active:scale-95 transition-all !w-full !justify-center !py-3.5 !text-base"
          >
            <app-icon
              name="check-circle"
              [size]="18"
              class="mr-2"
              slot="icon"
            />
            Crear y aplicar
          </app-button>
        } @else {
          <app-button
            variant="primary"
            type="button"
            (clicked)="onSubmit(false)"
            [loading]="isSubmitting()"
            [disabled]="isSubmitting() || hasMissingType()"
            customClasses="!rounded-xl font-bold shadow-md shadow-primary-200 active:scale-95 transition-all !w-full !justify-center !py-3.5 !text-base"
          >
            <app-icon name="file-text" [size]="18" class="mr-2" slot="icon" />
            Guardar pendiente
          </app-button>
        }

        <div class="flex items-center justify-center gap-6 py-1">
          @if (currentStep() > 1) {
            <button
              type="button"
              (click)="goToStep(currentStep() - 1)"
              class="text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)] transition-colors p-1"
            >
              <app-icon name="arrow-left" [size]="22" />
            </button>
          }
          <button
            type="button"
            (click)="onCancel()"
            class="text-error hover:text-error/80 transition-colors p-1"
          >
            <app-icon name="x" [size]="22" />
          </button>
          @if (isConfirmStep()) {
            <div class="w-px h-5 bg-[var(--color-border)]"></div>
            @if (confirmCreate) {
              <button
                type="button"
                (click)="onSubmit(false)"
                [disabled]="isSubmitting() || hasMissingType()"
                class="text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)] transition-colors p-1 disabled:opacity-40"
                title="Guardar pendiente"
              >
                <app-icon name="save" [size]="22" />
              </button>
            } @else {
              <button
                type="button"
                (click)="onSubmit(true)"
                [disabled]="isSubmitting() || hasMissingType()"
                class="text-[var(--color-text-tertiary)] transition-colors p-1 disabled:opacity-40"
                title="Crear y aplicar"
              >
                <app-icon name="check-circle" [size]="22" />
              </button>
            }
          }
        </div>
      </div>
    </app-modal>
  `,
})
export class OrgAdjustmentFormModalComponent {
  private readonly http = inject(HttpClient);
  private readonly destroyRef = inject(DestroyRef);

  readonly isOpen = input(false);
  readonly isSubmitting = input(false);
  readonly locations = input<SelectorOption[]>([]);

  readonly isOpenChange = output<boolean>();
  readonly cancel = output<void>();
  readonly save = output<CreateOrgAdjustmentBulkRequest>();

  readonly currentStep = signal(1);
  readonly steps = signal<StepsLineItem[]>([
    { label: 'UBICACIÓN', completed: false },
    { label: 'PRODUCTOS', completed: false },
    { label: 'CONFIRMAR', completed: false },
  ]);

  readonly selectedLocationId = signal<number | null>(null);
  readonly stock = signal<StockRow[]>([]);
  readonly loadingStock = signal(false);
  readonly stockError = signal<string | null>(null);
  readonly stockSearchTerm = signal('');
  readonly items = signal<AdjustmentItemUI[]>([]);

  confirmCreate = false;
  batchReason = '';
  readonly adjustmentTypes = TYPE_GRID;

  readonly isLocationStep = computed(() => this.currentStep() === 1);
  readonly isProductsStep = computed(() => this.currentStep() === 2);
  readonly isConfirmStep = computed(() => this.currentStep() === 3);

  readonly modalTitle = computed(() => {
    if (this.isLocationStep()) return 'Seleccionar ubicación';
    if (this.isProductsStep()) return 'Agregar productos';
    return 'Confirmar ajustes';
  });

  readonly modalSubtitle = computed(() => {
    if (this.isLocationStep()) return 'Elige la ubicación a ajustar';
    if (this.isProductsStep()) return 'Selecciona productos y define el ajuste';
    return 'Revisa y confirma los ajustes';
  });

  readonly selectedLocationLabel = computed(() => {
    const id = this.selectedLocationId();
    if (id == null) return '-';
    return (
      this.locations().find((l) => l.value === id)?.label?.toString() ?? '-'
    );
  });

  readonly filteredStock = computed(() => {
    const term = this.stockSearchTerm().trim().toLowerCase();
    const list = this.stock();
    const sorted = [...list].sort((a, b) => {
      const ao = (a.quantity ?? 0) > 0 ? 0 : 1;
      const bo = (b.quantity ?? 0) > 0 ? 0 : 1;
      if (ao !== bo) return ao - bo;
      return (a.product_name ?? '').localeCompare(b.product_name ?? '');
    });
    if (!term) return sorted.slice(0, 15);
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
      .slice(0, 25);
  });

  constructor() {
    effect(() => {
      if (this.isOpen()) {
        this.resetState();
      }
    });
  }

  isAlreadyAdded(row: StockRow): boolean {
    const key = this.rowKey(row);
    return this.items().some((i) => i.key === key);
  }

  private rowKey(row: {
    product_id: number;
    variant_id?: number | null;
  }): string {
    return `${row.product_id}-${row.variant_id ?? 'base'}`;
  }

  onLocationChange(value: any): void {
    const locationId = value != null ? +value : null;
    this.selectedLocationId.set(locationId);
    this.items.set([]);
    this.stock.set([]);
    this.stockSearchTerm.set('');
    if (locationId != null) {
      this.loadStockForLocation(locationId);
    }
  }

  onProductSearch(term: string): void {
    this.stockSearchTerm.set(term);
  }

  addRow(row: StockRow): void {
    const key = this.rowKey(row);
    if (this.items().some((i) => i.key === key)) return;

    this.items.update((current) => [
      ...current,
      {
        key,
        product_id: row.product_id,
        product_name: row.product_name ?? `Producto #${row.product_id}`,
        product_variant_id: row.variant_id ?? undefined,
        variant_name: row.variant_name ?? null,
        sku: row.variant_sku ?? row.product_sku ?? null,
        stock_on_hand: row.quantity,
        type: 'count_variance',
        quantity_after: row.quantity,
        reason_code: REASON_BY_TYPE.count_variance,
        description: '',
      },
    ]);
    this.stockSearchTerm.set('');
  }

  removeRow(index: number): void {
    this.items.update((current) => current.filter((_, i) => i !== index));
  }

  updateType(index: number, value: OrgAdjustmentType): void {
    this.items.update((current) =>
      current.map((it, i) =>
        i === index
          ? { ...it, type: value, reason_code: REASON_BY_TYPE[value] }
          : it,
      ),
    );
  }

  updateQuantityAfter(index: number, event: Event): void {
    const raw = +(event.target as HTMLInputElement).value;
    const next = Math.max(0, Number.isFinite(raw) ? raw : 0);
    this.items.update((current) =>
      current.map((it, i) =>
        i === index ? { ...it, quantity_after: next } : it,
      ),
    );
  }

  updateDescription(index: number, event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.items.update((current) =>
      current.map((it, i) => (i === index ? { ...it, description: value } : it)),
    );
  }

  deltaOf(item: AdjustmentItemUI): number {
    return item.quantity_after - item.stock_on_hand;
  }

  typeLabel(type: OrgAdjustmentType): string {
    return TYPE_LABELS[type] ?? type;
  }

  hasZeroChange(): boolean {
    return this.items().some((it) => this.deltaOf(it) === 0);
  }

  hasMissingType(): boolean {
    return this.items().some((it) => !it.type);
  }

  canAdvance(): boolean {
    if (this.currentStep() === 1) {
      return this.selectedLocationId() != null && !this.loadingStock();
    }
    if (this.currentStep() === 2) {
      return this.items().length > 0 && !this.hasMissingType();
    }
    return true;
  }

  goToStep(step: number): void {
    if (step > this.currentStep() && !this.canAdvance()) return;
    if (step < 1 || step > 3) return;
    this.currentStep.set(step);
    this.steps.update((arr) =>
      arr.map((s, i) => ({ ...s, completed: i < step - 1 })),
    );
  }

  onSubmit(autoApprove: boolean): void {
    const locationId = this.selectedLocationId();
    if (locationId == null || this.items().length === 0) return;
    if (this.hasMissingType()) return;
    const dto: CreateOrgAdjustmentBulkRequest = {
      location_id: locationId,
      auto_approve: autoApprove,
      ...(this.batchReason ? { reason: this.batchReason } : {}),
      items: this.items().map((it) => ({
        product_id: it.product_id,
        ...(it.product_variant_id != null
          ? { product_variant_id: it.product_variant_id }
          : {}),
        type: it.type,
        quantity_after: it.quantity_after,
        ...(it.reason_code ? { reason_code: it.reason_code } : {}),
        ...(it.description ? { description: it.description } : {}),
      })),
    };
    this.save.emit(dto);
  }

  onCancel(): void {
    this.resetState();
    this.cancel.emit();
  }

  private resetState(): void {
    this.currentStep.set(1);
    this.steps.set([
      { label: 'UBICACIÓN', completed: false },
      { label: 'PRODUCTOS', completed: false },
      { label: 'CONFIRMAR', completed: false },
    ]);
    this.selectedLocationId.set(null);
    this.stock.set([]);
    this.stockError.set(null);
    this.stockSearchTerm.set('');
    this.items.set([]);
    this.confirmCreate = false;
    this.batchReason = '';
  }

  private loadStockForLocation(locationId: number): void {
    this.loadingStock.set(true);
    this.stockError.set(null);
    this.http
      .get<any>(
        `${environment.apiUrl}/organization/inventory/stock-levels?location_id=${locationId}&limit=500`,
      )
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          const raw: StockRow[] = Array.isArray(res?.data) ? res.data : [];
          // Defense in depth: the backend already scopes by org and
          // location, but we re-assert client-side that every row
          // belongs to the requested location.
          const data = raw.filter((r) => r.location_id === locationId);
          if (data.length !== raw.length) {
            console.warn(
              '[OrgAdjustmentForm] discarded',
              raw.length - data.length,
              'stock rows whose location_id !=',
              locationId,
            );
          }
          this.stock.set(data);
          this.loadingStock.set(false);
        },
        error: (err) => {
          console.error('[OrgAdjustmentForm] stock load failed', err);
          this.stock.set([]);
          this.stockError.set(
            'No se pudo cargar el stock de la ubicación. Reintenta.',
          );
          this.loadingStock.set(false);
        },
      });
  }
}
