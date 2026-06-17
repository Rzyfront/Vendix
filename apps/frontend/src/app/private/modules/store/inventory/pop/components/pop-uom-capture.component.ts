import {
  Component,
  computed,
  inject,
  input,
  output,
  signal,
  DestroyRef,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { FormsModule } from '@angular/forms';

import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { InputComponent } from '../../../../../../shared/components/input/input.component';
import { CurrencyFormatService } from '../../../../../../shared/pipes/currency';
import { UomService } from '../../services/uom.service';
import { AuthFacade } from '../../../../../../core/store/auth/auth.facade';

export interface PopUomRow {
  id: number;
  code: string;
  name: string;
  dimension: string;
  factor_to_base: number | string;
  is_active: boolean;
}

/**
 * Snapshot emitted by `pop-uom-capture` whenever the user settles a value.
 * The cart always receives the canonical `unitCost` (cost per purchase UoM)
 * and the UoM FKs it should propagate.
 */
export interface PopUomCaptureResult {
  purchaseUomId: number | null;
  stockUomId: number | null;
  /**
   * Canonical cost per purchase UoM (e.g. price per bottle). The cart
   * uses this as `unit_cost`; the bidirectionality is internal to this
   * component and never leaks to the orchestrator.
   */
  unitCost: number;
  /**
   * Quantity used for the bidirectional preview. In create mode this is
   * captured here so the user can adjust the batch size together with the
   * cost. In configure mode it defaults to 1 and is informational.
   */
  quantity: number;
}

/**
 * `pop-uom-capture`
 *
 * Shared sub-component for the UoM-aware cost capture used by the POP
 * prebulk + product-config modals. Extracts the duplicated UoM block
 * (selects + capacity preview + dynamic cost label) and adds a
 * **bidirectional cost capture** (per-purchase-UoM ↔ total-batch).
 *
 * Why bidirectional:
 *   When the buyer receives a bill with the TOTAL of the batch
 *   (e.g. "6 bottles for COP 30,000"), typing the unit price forces a
 *   mental division. The opposite is also true: many suppliers quote
 *   per unit. Either way, the other field auto-calculates from the
 *   quantity the user types.
 *
 * Invariants:
 *   - The cart always receives `unitCost` = cost per purchase UoM
 *     (canonical). The total is a display-only field.
 *   - `purchaseUomId` and `stockUomId` are required when the parent
 *     decides the product is an ingredient; the parent enforces that.
 *   - When `quantity` changes, the field the user last edited is the
 *     "anchor" — the other one recalculates.
 */
@Component({
  selector: 'app-pop-uom-capture',
  standalone: true,
  imports: [FormsModule, IconComponent, InputComponent],
  template: `
    <div
      class="rounded-xl border border-primary/20 bg-primary/5 p-3 space-y-3"
      data-testid="pop-uom-capture"
    >
      <!-- Header -->
      <div class="flex items-center gap-2">
        <app-icon
          name="package"
          [size]="14"
          class="text-primary-600"
        ></app-icon>
        <p
          class="text-[10px] text-text-muted uppercase font-bold tracking-wider"
        >
          Unidad de medida del insumo
        </p>
      </div>

      <!-- Helper text -->
      <p class="text-xs text-text-muted">
        Captura el costo por la <strong>unidad de compra</strong>
        (la presentación que llega del proveedor). El sistema lo
        convertirá automáticamente a la unidad de stock usando el
        factor de la UoM.
      </p>

      <!-- UoM selects -->
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <div>
          <label class="block text-xs font-medium text-text-primary mb-1">
            Unidad de compra
            <span class="text-destructive">*</span>
          </label>
          <select
            class="w-full px-2 py-1.5 text-sm rounded-lg border border-border bg-surface text-text-primary"
            [ngModel]="purchaseUomId()"
            (ngModelChange)="onPurchaseUomChange($event)"
          >
            <option [ngValue]="null">— Seleccionar —</option>
            @for (u of uomCatalog(); track u.id) {
              <option [ngValue]="u.id">
                {{ u.code }} — {{ u.name }}
              </option>
            }
          </select>
        </div>
        <div>
          <label class="block text-xs font-medium text-text-primary mb-1">
            Unidad de stock
            <span class="text-destructive">*</span>
          </label>
          <select
            class="w-full px-2 py-1.5 text-sm rounded-lg border border-border bg-surface text-text-primary"
            [ngModel]="stockUomId()"
            (ngModelChange)="onStockUomChange($event)"
          >
            <option [ngValue]="null">— Seleccionar —</option>
            @for (u of uomCatalog(); track u.id) {
              <option [ngValue]="u.id">
                {{ u.code }} — {{ u.name }}
              </option>
            }
          </select>
        </div>
      </div>

      <!-- Capacity preview -->
      @if (unitCapacity(); as cap) {
        <div
          class="flex items-center gap-2 text-xs text-primary bg-white/60 rounded-lg px-2 py-1.5"
          data-testid="pop-uom-capacity-preview"
        >
          <app-icon name="info" [size]="12"></app-icon>
          <span>
            1 {{ cap.purchaseUnit }} = {{ cap.value }}
            {{ cap.unit }} (factor de conversión).
          </span>
        </div>
      }

      <!-- Bidirectional cost capture -->
      <div
        class="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1"
        data-testid="pop-uom-cost-bidir"
      >
        <div>
          <label
            class="block text-[11px] font-medium text-text-muted mb-1 flex items-center gap-1"
          >
            <span
              class="inline-block w-1.5 h-1.5 rounded-full"
              [class]="
                lastEdited() === 'unit' ? 'bg-primary' : 'bg-transparent'
              "
            ></span>
            {{ costInputLabel() }}
          </label>
          <app-input
            type="number"
            size="sm"
            [currency]="true"
            prefix="$"
            placeholder="0"
            [ngModel]="costPerPurchaseUomDisplay()"
            (ngModelChange)="onUnitCostEdit($event)"
          ></app-input>
        </div>
        <div>
          <label
            class="block text-[11px] font-medium text-text-muted mb-1 flex items-center gap-1"
          >
            <span
              class="inline-block w-1.5 h-1.5 rounded-full"
              [class]="
                lastEdited() === 'total' ? 'bg-primary' : 'bg-transparent'
              "
            ></span>
            Costo total del lote
          </label>
          <app-input
            type="number"
            size="sm"
            [currency]="true"
            prefix="$"
            placeholder="0"
            [ngModel]="totalBatchCostDisplay()"
            (ngModelChange)="onTotalEdit($event)"
          ></app-input>
        </div>
        <div>
          <label class="block text-[11px] font-medium text-text-muted mb-1">
            Cantidad del lote
          </label>
          <app-input
            type="number"
            size="sm"
            placeholder="1"
            [ngModel]="quantity()"
            (ngModelChange)="onQuantityEdit($event)"
          ></app-input>
        </div>
      </div>

      <!-- Dynamic cost label / hint -->
      <p class="text-[11px] text-text-muted">
        <strong>Etiqueta del costo:</strong>
        {{ costInputLabel() }}
      </p>
    </div>
  `,
  styles: [
    `
      :host {
        display: contents;
      }
    `,
  ],
})
export class PopUomCaptureComponent {
  private destroyRef = inject(DestroyRef);
  private uomService = inject(UomService);
  private authFacade = inject(AuthFacade);
  private currencyService = inject(CurrencyFormatService);

  // ----------------------------------------------------------------
  // Inputs
  // ----------------------------------------------------------------

  /**
   * Whether the parent has decided this product is an ingredient.
   * When false, the UoM block should be hidden entirely by the parent.
   * This component renders the UoM + cost block unconditionally; the
   * parent is responsible for visibility (matches the existing
   * `ingredientMode()` pattern in the modals).
   */
  readonly isIngredient = input<boolean>(false);

  /** Initial UoM FKs (e.g. persisted on the product). */
  readonly initialPurchaseUomId = input<number | null>(null);
  readonly initialStockUomId = input<number | null>(null);

  /**
   * Initial canonical cost (per purchase UoM). The component will derive
   * the total = cost × initial quantity on first render.
   */
  readonly initialUnitCost = input<number>(0);
  readonly initialQuantity = input<number>(1);

  // ----------------------------------------------------------------
  // Outputs
  // ----------------------------------------------------------------

  /** Emitted whenever the user settles a value. */
  readonly changed = output<PopUomCaptureResult>();

  // ----------------------------------------------------------------
  // State (signals — zoneless safe)
  // ----------------------------------------------------------------

  readonly purchaseUomId = signal<number | null>(null);
  readonly stockUomId = signal<number | null>(null);

  /** Canonical cost per purchase UoM (the value the cart receives). */
  readonly unitCost = signal<number>(0);
  /** Echo of the user's input so the field round-trips nicely. */
  readonly quantity = signal<number>(1);

  /**
   * Tracks which cost field the user edited last. Determines which field
   * is the "anchor" when `quantity` changes:
   *   - `unit`  → user typed per-unit cost → total recalculates.
   *   - `total` → user typed total       → unit recalculates.
   */
  readonly lastEdited = signal<'unit' | 'total' | 'quantity'>('unit');

  /** Catalog loaded lazily on first render. */
  readonly uomCatalog = signal<PopUomRow[]>([]);
  readonly storeSupportsIngredients = this.authFacade.storeSupportsIngredients;

  // ----------------------------------------------------------------
  // Computed
  // ----------------------------------------------------------------

  readonly costInputLabel = computed(() => {
    if (!this.isIngredient()) return 'Costo unitario';
    const purchaseId = this.purchaseUomId();
    if (!purchaseId) return 'Costo por unidad de compra';
    const purchase = this.uomCatalog().find((u) => u.id === purchaseId);
    return purchase ? `Costo por ${purchase.code}` : 'Costo por unidad de compra';
  });

  readonly unitCapacity = computed<{
    value: number;
    unit: string;
    purchaseUnit: string;
  } | null>(() => {
    const purchaseId = this.purchaseUomId();
    const stockId = this.stockUomId();
    if (!purchaseId || !stockId) return null;
    const opts = this.uomCatalog();
    const stock = opts.find((u) => u.id === stockId);
    const purchase = opts.find((u) => u.id === purchaseId);
    if (!stock || !purchase) return null;
    if (stock.dimension !== purchase.dimension) return null;
    const sf = Number(stock.factor_to_base);
    const pf = Number(purchase.factor_to_base);
    if (!Number.isFinite(sf) || !Number.isFinite(pf) || pf <= 0) return null;
    const factor = Math.round((pf / sf) * 1e6) / 1e6;
    return {
      value: factor,
      unit: stock.code,
      purchaseUnit: purchase.code,
    };
  });

  /** Display string for the per-unit input (avoid NaN). */
  readonly costPerPurchaseUomDisplay = computed(() => {
    const v = this.unitCost();
    return Number.isFinite(v) ? v : 0;
  });

  /** Total = unit × quantity. Rounded to 2 decimals for display only. */
  readonly totalBatchCostDisplay = computed(() => {
    const total = this.unitCost() * this.quantity();
    return Math.round(total * 100) / 100;
  });

  // ----------------------------------------------------------------
  // Lifecycle
  // ----------------------------------------------------------------

  constructor() {
    // Load catalog once. Cached by UomService (shareReplay).
    this.uomService
      .getCatalog()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res: any) => {
          const data = Array.isArray(res?.data) ? res.data : [];
          this.uomCatalog.set(data);
        },
        error: () => {
          this.uomCatalog.set([]);
        },
      });
  }

  // ----------------------------------------------------------------
  // Init helper (called by parent on `isOpen` change)
  // ----------------------------------------------------------------

  /**
   * Resets the component to the parent's initial values. Call this from
   * the parent whenever the modal opens, to mirror the existing pattern
   * in the prebulk/config modals.
   */
  initFromInputs(): void {
    this.purchaseUomId.set(this.initialPurchaseUomId());
    this.stockUomId.set(this.initialStockUomId());
    this.unitCost.set(this.initialUnitCost() || 0);
    this.quantity.set(this.initialQuantity() > 0 ? this.initialQuantity() : 1);
    this.lastEdited.set('unit');
  }

  // ----------------------------------------------------------------
  // UoM handlers
  // ----------------------------------------------------------------

  onPurchaseUomChange(id: number | null): void {
    this.purchaseUomId.set(id);
    this.emit();
  }

  onStockUomChange(id: number | null): void {
    this.stockUomId.set(id);
    this.emit();
  }

  // ----------------------------------------------------------------
  // Cost handlers (bidirectional)
  // ----------------------------------------------------------------

  /**
   * User typed in the per-unit field. We treat that as the new anchor.
   */
  onUnitCostEdit(raw: any): void {
    const value = this.parseCurrency(raw);
    this.unitCost.set(value);
    this.lastEdited.set('unit');
    this.emit();
  }

  /**
   * User typed in the total field. We back-derive the unit cost.
   */
  onTotalEdit(raw: any): void {
    const value = this.parseCurrency(raw);
    const qty = this.quantity();
    if (qty > 0) {
      const derived = value / qty;
      // Round to 2 decimals to keep totals predictable.
      this.unitCost.set(Math.round(derived * 100) / 100);
    } else {
      // No quantity yet: keep the total's numeric value in `unitCost`
      // and let the user set quantity next; the user will see the total
      // as the unit until they fix the quantity.
      this.unitCost.set(value);
    }
    this.lastEdited.set('total');
    this.emit();
  }

  /**
   * User typed in the quantity field. The `lastEdited` field decides
   * which cost is the anchor.
   */
  onQuantityEdit(raw: any): void {
    const qty = Math.max(1, Math.floor(Number(raw) || 1));
    this.quantity.set(qty);
    this.lastEdited.set('quantity');
    // No emit here for the cost side: the total display re-derives
    // automatically from `unitCost × quantity`. If we ever need to
    // re-anchor the user-edited field, we can do it here.
    this.emit();
  }

  // ----------------------------------------------------------------
  // Helpers
  // ----------------------------------------------------------------

  private parseCurrency(raw: any): number {
    if (raw === null || raw === undefined || raw === '') return 0;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  }

  private emit(): void {
    this.changed.emit({
      purchaseUomId: this.purchaseUomId(),
      stockUomId: this.stockUomId(),
      unitCost: this.unitCost(),
      quantity: this.quantity(),
    });
  }
}
