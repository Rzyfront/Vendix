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
  InputComponent,
  InputsearchComponent,
  ModalComponent,
  SelectorComponent,
  SelectorOption,
  TextareaComponent,
} from '../../../../../../../shared/components/index';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../../../../../../environments/environment';
import {
  CreateOrgAdjustmentBulkRequest,
  OrgAdjustmentType,
} from '../../../interfaces/org-adjustment.interface';

interface StockRow {
  id: number;
  product_id: number;
  product_variant_id?: number | null;
  quantity: number;
  reserved_quantity?: number;
  available_quantity?: number;
  products?: { id: number; name: string; sku?: string | null } | null;
  product_variants?: { id: number; name?: string | null; sku?: string | null } | null;
  inventory_locations?: { id: number; name: string; code?: string | null; store_id?: number | null } | null;
}

interface AdjustmentItemUI {
  /** Unique key for *ngFor tracking. */
  key: string;
  product_id: number;
  product_name: string;
  product_variant_id?: number | null;
  variant_name?: string | null;
  sku?: string | null;
  current_quantity: number;
  type: OrgAdjustmentType;
  quantity_after: number;
  reason_code?: string;
  description?: string;
}

const TYPE_OPTIONS: SelectorOption[] = [
  { value: 'count_variance', label: 'Conteo (corrige diferencia)' },
  { value: 'manual_correction', label: 'Corrección manual' },
  { value: 'damage', label: 'Daño' },
  { value: 'loss', label: 'Pérdida' },
  { value: 'theft', label: 'Robo' },
  { value: 'expiration', label: 'Vencimiento' },
];

/**
 * Multi-line org-level adjustment creation modal.
 *
 * Selects a location (any org location, including central warehouse), loads
 * stock-levels for that location, and lets the user pick rows + set
 * type/quantity_after/reason. Submits via `POST /adjustments/bulk` so all
 * rows land atomically in the same audit context.
 */
@Component({
  selector: 'app-org-adjustment-form-modal',
  standalone: true,
  imports: [
    FormsModule,
    ModalComponent,
    ButtonComponent,
    IconComponent,
    InputComponent,
    InputsearchComponent,
    SelectorComponent,
    TextareaComponent,
  ],
  template: `
    <app-modal
      [isOpen]="isOpen()"
      title="Nuevo ajuste de inventario"
      subtitle="Registra ajustes de stock para una ubicación de la organización"
      size="md"
      (closed)="onCancel()"
      (isOpenChange)="isOpenChange.emit($event)"
    >
      <div class="space-y-4">
        <!-- Location -->
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
          @if (selectedLocationLabel(); as label) {
            <p class="text-xs text-text-secondary mt-1">{{ label }}</p>
          }
        </div>

        <!-- Auto-approve toggle -->
        <label
          class="flex items-start gap-2 p-3 bg-warning/5 rounded-xl border border-warning/20 cursor-pointer select-none"
        >
          <input
            type="checkbox"
            [(ngModel)]="autoApprove"
            class="mt-0.5 w-4 h-4 rounded border-border text-primary focus:ring-primary"
          />
          <div class="text-xs">
            <p class="font-medium text-text-primary">Aplicar inmediatamente</p>
            <p class="text-text-secondary">
              Si está activo, el ajuste queda aprobado y los movimientos de
              inventario se aplican al guardar. Si no, queda pendiente para
              aprobación.
            </p>
          </div>
        </label>

        <!-- Reason / batch label -->
        <app-textarea
          label="Motivo (se aplica a todos los ajustes)"
          [(ngModel)]="batchReason"
          [rows]="2"
          placeholder="Ej. Conteo cíclico Q1, Inventario físico tienda Norte..."
        />

        @if (selectedLocationId() != null) {
          <!-- Stock search -->
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
                <button
                  type="button"
                  class="w-full p-3 text-left hover:bg-primary/5 transition-colors"
                  (click)="addRow(row)"
                >
                  <div class="flex items-center justify-between">
                    <div>
                      <p class="text-sm font-medium text-text-primary">
                        {{ row.products?.name || 'Producto sin nombre' }}
                        @if (row.product_variants?.name) {
                          <span class="text-text-secondary">
                            ({{ row.product_variants?.name }})
                          </span>
                        }
                      </p>
                      <p class="text-xs text-text-secondary">
                        SKU: {{ row.products?.sku || row.product_variants?.sku || '-' }}
                      </p>
                    </div>
                    <div class="text-right">
                      <p class="text-xs text-text-primary font-semibold">
                        Stock: {{ row.quantity }}
                      </p>
                    </div>
                  </div>
                </button>
              }
            </div>
          } @else if (stockSearchTerm()) {
            <p class="text-xs text-text-secondary">
              Sin resultados para "{{ stockSearchTerm() }}".
            </p>
          }

          <!-- Selected items -->
          <div>
            <label class="block text-sm font-medium text-text-secondary mb-2">
              Ajustes a registrar ({{ items().length }})
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
                  Selecciona productos del listado para crear ajustes.
                </p>
              </div>
            } @else {
              <div class="space-y-2">
                @for (item of items(); track item.key; let i = $index) {
                  <div
                    class="p-3 bg-surface rounded-xl border border-border space-y-2"
                  >
                    <div class="flex items-start justify-between gap-2">
                      <div>
                        <p class="text-sm font-medium text-text-primary">
                          {{ item.product_name }}
                          @if (item.variant_name) {
                            <span class="text-text-secondary">
                              ({{ item.variant_name }})
                            </span>
                          }
                        </p>
                        <p class="text-xs text-text-secondary">
                          SKU: {{ item.sku || '-' }} · Stock actual:
                          <span class="font-semibold text-text-primary">
                            {{ item.current_quantity }}
                          </span>
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

                    <div
                      class="grid grid-cols-1 md:grid-cols-2 gap-2 items-end"
                    >
                      <div>
                        <label
                          class="block text-xs text-text-secondary mb-1"
                        >
                          Tipo
                        </label>
                        <app-selector
                          [options]="typeOptions"
                          [ngModel]="item.type"
                          (ngModelChange)="updateType(i, $event)"
                        />
                      </div>
                      <div>
                        <label
                          class="block text-xs text-text-secondary mb-1"
                        >
                          Stock final
                        </label>
                        <app-input
                          type="number"
                          [min]="0"
                          [ngModel]="item.quantity_after"
                          (ngModelChange)="updateQuantityAfter(i, $event)"
                        />
                      </div>
                    </div>
                    <div>
                      <label
                        class="block text-xs text-text-secondary mb-1"
                      >
                        Descripción (opcional)
                      </label>
                      <app-input
                        type="text"
                        [ngModel]="item.description ?? ''"
                        (ngModelChange)="updateDescription(i, $event)"
                        placeholder="Detalle del ajuste"
                      />
                    </div>
                    <p class="text-xs">
                      Cambio:
                      <span
                        class="font-semibold"
                        [class.text-success]="item.quantity_after > item.current_quantity"
                        [class.text-error]="item.quantity_after < item.current_quantity"
                      >
                        {{ deltaLabel(item) }}
                      </span>
                    </p>
                  </div>
                }
              </div>
            }
          </div>
        }
      </div>

      <div
        slot="footer"
        class="flex justify-end gap-3 px-6 py-4 bg-gray-50 rounded-b-xl"
      >
        <app-button
          variant="outline"
          (clicked)="onCancel()"
          customClasses="!rounded-xl font-bold"
        >
          Cancelar
        </app-button>
        <app-button
          variant="primary"
          [loading]="isSubmitting()"
          [disabled]="!canSubmit()"
          (clicked)="onSubmit()"
          customClasses="!rounded-xl font-bold shadow-md shadow-primary-200"
        >
          <app-icon
            name="check-circle"
            [size]="14"
            class="mr-1.5"
            slot="icon"
          />
          {{ autoApprove ? 'Crear y aplicar' : 'Guardar pendiente' }}
        </app-button>
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

  readonly selectedLocationId = signal<number | null>(null);
  readonly stock = signal<StockRow[]>([]);
  readonly loadingStock = signal(false);
  readonly stockSearchTerm = signal('');
  readonly items = signal<AdjustmentItemUI[]>([]);

  autoApprove = false;
  batchReason = '';
  readonly typeOptions = TYPE_OPTIONS;

  readonly selectedLocationLabel = computed(() => {
    const id = this.selectedLocationId();
    if (id == null) return null;
    return this.locations().find((l) => l.value === id)?.label ?? null;
  });

  readonly filteredStock = computed(() => {
    const term = this.stockSearchTerm().trim().toLowerCase();
    if (!term) return this.stock().slice(0, 10);
    return this.stock()
      .filter((row) => {
        const name = (row.products?.name ?? '').toLowerCase();
        const sku =
          (row.products?.sku ?? '').toLowerCase() +
          ' ' +
          (row.product_variants?.sku ?? '').toLowerCase();
        return name.includes(term) || sku.includes(term);
      })
      .slice(0, 15);
  });

  readonly canSubmit = computed(
    () =>
      this.selectedLocationId() != null &&
      this.items().length > 0 &&
      this.items().every(
        (i) =>
          Number.isFinite(i.quantity_after) &&
          i.quantity_after >= 0 &&
          i.quantity_after !== i.current_quantity,
      ),
  );

  constructor() {
    effect(() => {
      // Reset state when the modal is opened.
      if (this.isOpen()) {
        this.resetState();
      }
    });
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
    const key = `${row.product_id}-${row.product_variant_id ?? 'base'}`;
    if (this.items().some((i) => i.key === key)) return;

    this.items.update((current) => [
      ...current,
      {
        key,
        product_id: row.product_id,
        product_name: row.products?.name ?? `Producto #${row.product_id}`,
        product_variant_id: row.product_variant_id ?? undefined,
        variant_name: row.product_variants?.name ?? null,
        sku: row.products?.sku ?? row.product_variants?.sku ?? null,
        current_quantity: row.quantity,
        type: 'count_variance',
        quantity_after: row.quantity,
        description: '',
      },
    ]);
  }

  removeRow(index: number): void {
    this.items.update((current) => current.filter((_, i) => i !== index));
  }

  updateType(index: number, value: any): void {
    const next = value as OrgAdjustmentType;
    this.items.update((current) =>
      current.map((it, i) => (i === index ? { ...it, type: next } : it)),
    );
  }

  updateQuantityAfter(index: number, value: any): void {
    const next = Math.max(0, Number.isFinite(+value) ? +value : 0);
    this.items.update((current) =>
      current.map((it, i) =>
        i === index ? { ...it, quantity_after: next } : it,
      ),
    );
  }

  updateDescription(index: number, value: string): void {
    this.items.update((current) =>
      current.map((it, i) =>
        i === index ? { ...it, description: value } : it,
      ),
    );
  }

  deltaLabel(item: AdjustmentItemUI): string {
    const delta = item.quantity_after - item.current_quantity;
    if (delta > 0) return `+${delta}`;
    return `${delta}`;
  }

  onSubmit(): void {
    if (!this.canSubmit()) return;
    const locationId = this.selectedLocationId()!;
    const dto: CreateOrgAdjustmentBulkRequest = {
      location_id: locationId,
      auto_approve: this.autoApprove,
      ...(this.batchReason ? { reason: this.batchReason } : {}),
      items: this.items().map((it) => ({
        product_id: it.product_id,
        ...(it.product_variant_id != null
          ? { product_variant_id: it.product_variant_id }
          : {}),
        type: it.type,
        quantity_after: it.quantity_after,
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
    this.selectedLocationId.set(null);
    this.stock.set([]);
    this.stockSearchTerm.set('');
    this.items.set([]);
    this.autoApprove = false;
    this.batchReason = '';
  }

  private loadStockForLocation(locationId: number): void {
    this.loadingStock.set(true);
    this.http
      .get<any>(
        `${environment.apiUrl}/organization/inventory/stock-levels?location_id=${locationId}&limit=200`,
      )
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          const data: StockRow[] = Array.isArray(res?.data) ? res.data : [];
          this.stock.set(data);
          this.loadingStock.set(false);
        },
        error: () => {
          this.stock.set([]);
          this.loadingStock.set(false);
        },
      });
  }
}
