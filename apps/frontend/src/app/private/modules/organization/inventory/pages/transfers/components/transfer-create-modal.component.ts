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
import { HttpClient } from '@angular/common/http';

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
import { environment } from '../../../../../../../../environments/environment';
import {
  CreateOrgTransferRequest,
  OrgTransfer,
} from '../../../interfaces/org-transfer.interface';

/**
 * Shape returned by `GET /api/organization/inventory/stock-levels` —
 * fields are FLAT (not nested under `products` / `product_variants`).
 * See `OrgStockLevelsService.toFlatRow` in
 * `apps/backend/.../organization/inventory/stock-levels/org-stock-levels.service.ts`.
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

interface TransferItemUI {
  key: string;
  product_id: number;
  product_name: string;
  product_variant_id?: number | null;
  variant_name?: string | null;
  sku?: string | null;
  available_at_origin: number;
  quantity: number;
}

/**
 * Org-level transfer creation modal. Locations are full org-wide (cross-store
 * + central warehouse). Picks products from the origin location stock-levels
 * and lets the user set quantity per row before submitting.
 *
 * Submitting always creates a `pending` transfer (no inline auto-dispatch);
 * the lifecycle (approve → dispatch → complete) is driven from the detail
 * modal once the row exists.
 */
@Component({
  selector: 'app-org-transfer-create-modal',
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
      title="Nueva transferencia"
      subtitle="Mueve stock entre tiendas o desde la bodega central"
      size="md"
      (closed)="onCancel()"
      (isOpenChange)="isOpenChange.emit($event)"
    >
      <div class="space-y-4">
        <!-- Origin -->
        <div>
          <label class="block text-sm font-medium text-text-secondary mb-2">
            Ubicación origen *
          </label>
          <app-selector
            [options]="locations()"
            [ngModel]="fromLocationId()"
            placeholder="Selecciona origen"
            (ngModelChange)="onFromChange($event)"
          />
        </div>

        <!-- Destination -->
        <div>
          <label class="block text-sm font-medium text-text-secondary mb-2">
            Ubicación destino *
          </label>
          <app-selector
            [options]="filteredDestinationOptions()"
            [ngModel]="toLocationId()"
            placeholder="Selecciona destino"
            (ngModelChange)="onToChange($event)"
          />
          @if (sameLocationError()) {
            <p
              class="mt-2 p-2 bg-error/10 rounded-lg text-error text-xs flex items-center gap-2"
            >
              <app-icon name="alert-circle" [size]="14" />
              Origen y destino deben ser diferentes
            </p>
          }
        </div>

        <!-- Expected date / notes -->
        <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label class="block text-sm font-medium text-text-secondary mb-2">
              Fecha esperada
            </label>
            <app-input type="date" [(ngModel)]="expectedDate" />
          </div>
        </div>
        <app-textarea
          label="Notas"
          [(ngModel)]="notes"
          [rows]="2"
          placeholder="Notas opcionales sobre la transferencia..."
        />

        @if (fromLocationId() != null && toLocationId() != null && !sameLocationError()) {
          <!-- Product search -->
          <div>
            <label class="block text-sm font-medium text-text-secondary mb-2">
              Buscar producto en el origen
            </label>
            <app-inputsearch
              size="sm"
              placeholder="Filtra por nombre o SKU..."
              [debounceTime]="200"
              (searchChange)="onProductSearch($event)"
            />
          </div>

          @if (stockError(); as err) {
            <p
              class="p-2 bg-error/10 rounded-lg text-error text-xs flex items-center gap-2"
            >
              <app-icon name="alert-circle" [size]="14" />
              {{ err }}
            </p>
          }
          @if (loadingStock()) {
            <div class="p-4 text-center">
              <div
                class="inline-block animate-spin rounded-full h-6 w-6 border-b-2 border-primary"
              ></div>
              <p class="mt-2 text-xs text-text-secondary">Cargando stock...</p>
            </div>
          } @else if (filteredStock().length > 0) {
            <div
              class="max-h-60 overflow-y-auto border border-border rounded-xl divide-y divide-border"
            >
              @for (row of filteredStock(); track row.id) {
                @let available = row.available_quantity ?? row.quantity ?? 0;
                @let outOfStock = available <= 0;
                @let alreadyAdded = isAlreadyAdded(row);
                <button
                  type="button"
                  class="w-full p-3 text-left hover:bg-primary/5 transition-colors disabled:cursor-not-allowed disabled:hover:bg-transparent"
                  [class.opacity-50]="outOfStock || alreadyAdded"
                  [disabled]="outOfStock || alreadyAdded"
                  [attr.title]="
                    outOfStock
                      ? 'Sin stock disponible en el origen'
                      : alreadyAdded
                        ? 'Ya agregado a la transferencia'
                        : null
                  "
                  (click)="addRow(row)"
                >
                  <div class="flex items-center justify-between gap-3">
                    <div class="min-w-0 flex-1">
                      <p class="text-sm font-medium text-text-primary truncate">
                        {{ row.product_name || ('Producto #' + row.product_id) }}
                        @if (row.variant_name) {
                          <span class="text-text-secondary">
                            ({{ row.variant_name }})
                          </span>
                        }
                      </p>
                      <p class="text-xs text-text-secondary truncate">
                        SKU: {{ row.variant_sku || row.product_sku || '-' }}
                        @if (row.location_name) {
                          <span class="text-text-tertiary">
                            · {{ row.location_name }}
                          </span>
                        }
                      </p>
                      <p class="text-[10px] text-text-tertiary">
                        En mano: {{ row.quantity ?? 0 }} · Reservado:
                        {{ row.reserved_quantity ?? 0 }}
                      </p>
                    </div>
                    <div class="text-right shrink-0">
                      <p
                        class="text-sm font-semibold"
                        [class.text-error]="outOfStock"
                        [class.text-success]="!outOfStock"
                      >
                        {{ available }}
                      </p>
                      <p class="text-[10px] text-text-tertiary">disp.</p>
                    </div>
                  </div>
                </button>
              }
            </div>
          } @else if (productSearch()) {
            <p class="text-xs text-text-secondary">
              Sin resultados para "{{ productSearch() }}" en esta ubicación.
            </p>
          } @else if (stock().length === 0) {
            <p
              class="text-xs text-text-secondary p-3 bg-warning/10 rounded-lg flex items-center gap-2"
            >
              <app-icon name="alert-circle" [size]="14" />
              Esta ubicación no tiene productos con stock registrado.
            </p>
          }

          <!-- Selected items -->
          <div>
            <label class="block text-sm font-medium text-text-secondary mb-2">
              Productos a transferir ({{ items().length }})
            </label>
            @if (items().length === 0) {
              <div
                class="p-6 text-center border border-dashed border-border rounded-xl"
              >
                <app-icon
                  name="package"
                  [size]="32"
                  class="mx-auto mb-2 text-gray-300"
                />
                <p class="text-sm text-text-secondary">
                  Selecciona productos del origen para transferir.
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
                          SKU: {{ item.sku || '-' }} · Disponible:
                          <span class="font-semibold text-text-primary">
                            {{ item.available_at_origin }}
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
                    <div class="flex items-center gap-2">
                      <label
                        class="text-xs text-text-secondary whitespace-nowrap"
                      >
                        Cantidad:
                      </label>
                      <input
                        type="number"
                        [min]="1"
                        [max]="item.available_at_origin"
                        [value]="item.quantity"
                        (input)="updateQuantity(i, $event)"
                        class="w-24 px-3 py-1.5 text-sm border border-border rounded-lg bg-surface focus:border-primary focus:ring-1 focus:ring-primary outline-none"
                      />
                      @if (item.quantity > item.available_at_origin) {
                        <span class="text-xs text-error">
                          Excede stock disponible
                        </span>
                      }
                    </div>
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
            name="repeat"
            [size]="14"
            class="mr-1.5"
            slot="icon"
          />
          Crear pendiente
        </app-button>
      </div>
    </app-modal>
  `,
})
export class OrgTransferCreateModalComponent {
  private readonly http = inject(HttpClient);
  private readonly destroyRef = inject(DestroyRef);

  readonly isOpen = input(false);
  readonly isSubmitting = input(false);
  readonly locations = input<SelectorOption[]>([]);

  readonly isOpenChange = output<boolean>();
  readonly cancel = output<void>();
  readonly save = output<CreateOrgTransferRequest>();
  readonly created = output<OrgTransfer>();

  readonly fromLocationId = signal<number | null>(null);
  readonly toLocationId = signal<number | null>(null);
  readonly stock = signal<StockRow[]>([]);
  readonly loadingStock = signal(false);
  readonly stockError = signal<string | null>(null);
  readonly productSearch = signal('');
  readonly items = signal<TransferItemUI[]>([]);

  expectedDate = '';
  notes = '';

  readonly sameLocationError = computed(
    () =>
      this.fromLocationId() != null &&
      this.fromLocationId() === this.toLocationId(),
  );

  readonly filteredDestinationOptions = computed(() => {
    const from = this.fromLocationId();
    if (from == null) return this.locations();
    return this.locations().filter((l) => l.value !== from);
  });

  readonly filteredStock = computed(() => {
    const term = this.productSearch().trim().toLowerCase();
    const list = this.stock();
    // Sort: in-stock first, then alphabetical by product name. Keeps the
    // useful rows on top regardless of the backend `id` ordering.
    const sorted = [...list].sort((a, b) => {
      const av = Number(a.available_quantity ?? a.quantity ?? 0);
      const bv = Number(b.available_quantity ?? b.quantity ?? 0);
      const ao = av > 0 ? 0 : 1;
      const bo = bv > 0 ? 0 : 1;
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

  /**
   * Returns true if the (product, variant) pair is already part of the
   * transfer items list. Used to disable duplicate selection in the list.
   */
  isAlreadyAdded(row: StockRow): boolean {
    const key = this.rowKey(row);
    return this.items().some((i) => i.key === key);
  }

  private rowKey(row: StockRow | { product_id: number; variant_id?: number | null }): string {
    const variantId =
      'variant_id' in row
        ? row.variant_id
        : (row as StockRow).variant_id ?? null;
    return `${row.product_id}-${variantId ?? 'base'}`;
  }

  readonly canSubmit = computed(
    () =>
      this.fromLocationId() != null &&
      this.toLocationId() != null &&
      this.fromLocationId() !== this.toLocationId() &&
      this.items().length > 0 &&
      this.items().every(
        (i) => i.quantity > 0 && i.quantity <= i.available_at_origin,
      ),
  );

  constructor() {
    effect(() => {
      if (this.isOpen()) this.resetState();
    });
  }

  onFromChange(value: any): void {
    const id = value != null ? +value : null;
    this.fromLocationId.set(id);
    this.items.set([]);
    this.stock.set([]);
    this.productSearch.set('');
    if (id != null) this.loadStockForLocation(id);
  }

  onToChange(value: any): void {
    const id = value != null ? +value : null;
    this.toLocationId.set(id);
  }

  onProductSearch(term: string): void {
    this.productSearch.set(term);
  }

  addRow(row: StockRow): void {
    const key = this.rowKey(row);
    if (this.items().some((i) => i.key === key)) return;
    const available = Number(row.available_quantity ?? row.quantity ?? 0);
    if (available <= 0) return;

    this.items.update((current) => [
      ...current,
      {
        key,
        product_id: row.product_id,
        product_name: row.product_name ?? `Producto #${row.product_id}`,
        product_variant_id: row.variant_id ?? undefined,
        variant_name: row.variant_name ?? null,
        sku: row.variant_sku ?? row.product_sku ?? null,
        available_at_origin: available,
        quantity: 1,
      },
    ]);
  }

  removeRow(index: number): void {
    this.items.update((current) => current.filter((_, i) => i !== index));
  }

  updateQuantity(index: number, event: Event): void {
    const value = +(event.target as HTMLInputElement).value;
    const next = Math.max(1, Number.isFinite(value) ? value : 1);
    this.items.update((current) =>
      current.map((it, i) => (i === index ? { ...it, quantity: next } : it)),
    );
  }

  onSubmit(): void {
    if (!this.canSubmit()) return;
    const dto: CreateOrgTransferRequest = {
      from_location_id: this.fromLocationId()!,
      to_location_id: this.toLocationId()!,
      ...(this.expectedDate ? { expected_date: this.expectedDate } : {}),
      ...(this.notes ? { notes: this.notes } : {}),
      items: this.items().map((it) => ({
        product_id: it.product_id,
        ...(it.product_variant_id != null
          ? { product_variant_id: it.product_variant_id }
          : {}),
        quantity: it.quantity,
      })),
    };
    this.save.emit(dto);
  }

  onCancel(): void {
    this.resetState();
    this.cancel.emit();
  }

  private resetState(): void {
    this.fromLocationId.set(null);
    this.toLocationId.set(null);
    this.stock.set([]);
    this.stockError.set(null);
    this.productSearch.set('');
    this.items.set([]);
    this.expectedDate = '';
    this.notes = '';
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
          // Defense in depth: backend already scopes by org and location, but
          // we re-assert client-side that every row belongs to the requested
          // origin location before showing it for transfer.
          const data = raw.filter((r) => r.location_id === locationId);
          if (data.length !== raw.length) {
            console.warn(
              '[OrgTransferCreate] discarded',
              raw.length - data.length,
              'stock rows whose location_id !=',
              locationId,
            );
          }
          this.stock.set(data);
          this.loadingStock.set(false);
        },
        error: (err) => {
          console.error('[OrgTransferCreate] stock load failed', err);
          this.stock.set([]);
          this.stockError.set(
            'No se pudo cargar el stock de la ubicación origen. Reintenta.',
          );
          this.loadingStock.set(false);
        },
      });
  }
}
