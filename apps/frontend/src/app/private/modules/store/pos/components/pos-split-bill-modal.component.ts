import {
  Component,
  input,
  output,
  effect,
  untracked,
  inject,
  signal,
  DestroyRef,
  computed,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  FormBuilder,
  FormGroup,
  FormsModule,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import {
  ButtonComponent,
  ModalComponent,
  IconComponent,
  InputComponent,
  SelectorComponent,
} from '../../../../../shared/components';
import type { SelectorOption } from '../../../../../shared/components/selector/selector.component';
import { PosRestaurantIntegrationService } from '../services/pos-restaurant-integration.service';
import { ToastService } from '../../../../../shared/components/toast/toast.service';
import { CurrencyFormatService } from '../../../../../shared/pipes/currency';
import { extractApiErrorMessage } from '../../../../../core/utils/api-error-handler';
import type {
  TableSession,
  SplitResult,
  SplitMode,
  TableSessionOrderItem,
} from '../../restaurant-ops/tables/interfaces';

type SplitMethod = 'items' | 'amount';

interface ItemGroup {
  order_item_ids: number[];
  label: string;
  total: number;
}

@Component({
  selector: 'app-pos-split-bill-modal',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    FormsModule,
    ButtonComponent,
    ModalComponent,
    InputComponent,
    IconComponent,
    SelectorComponent,
  ],
  template: `
    <app-modal
      [isOpen]="isOpen()"
      (isOpenChange)="onModalChange($event)"
      (cancel)="onCancel()"
      [size]="'lg'"
      [showCloseButton]="true"
      title="Dividir cuenta"
      subtitle="Divide la cuenta actual en varias sub-cuentas (operación financiera, no re-descuenta inventario)"
    >
      <div
        slot="header"
        class="w-10 h-10 rounded-[var(--radius-lg)] bg-primary/10 flex items-center justify-center flex-shrink-0"
      >
        <app-icon name="users" [size]="20" class="text-primary"></app-icon>
      </div>

      @if (!session() || !orderItems().length) {
        <div
          class="text-center py-10 text-text-secondary text-sm flex flex-col items-center gap-2"
        >
          <app-icon name="info" [size]="24"></app-icon>
          <span>No hay items para dividir en esta mesa.</span>
        </div>
      } @else {
        <div class="space-y-5">
          <form [formGroup]="form" class="space-y-4">
            <!-- Method -->
            <div>
              <label
                class="block text-sm font-medium text-text-primary mb-1.5"
              >
                Método de división
              </label>
              <div class="method-grid">
                <button
                  type="button"
                  class="method-btn"
                  [class.active]="method() === 'items'"
                  (click)="setMethod('items')"
                >
                  <app-icon name="list" [size]="16"></app-icon>
                  <span>Por items</span>
                </button>
                <button
                  type="button"
                  class="method-btn"
                  [class.active]="method() === 'amount'"
                  (click)="setMethod('amount')"
                >
                  <app-icon name="dollar-sign" [size]="16"></app-icon>
                  <span>Por monto</span>
                </button>
              </div>
            </div>

            @if (method() === 'amount') {
              <div class="grid grid-cols-2 gap-4">
                <app-input
                  formControlName="n_splits"
                  label="N° de cuentas"
                  type="number"
                  [min]="2"
                  [required]="true"
                  placeholder="2"
                ></app-input>
                <div>
                  <label
                    class="block text-sm font-medium text-text-primary mb-1.5"
                  >
                    Modalidad
                  </label>
                  <app-selector
                    [options]="splitModeOptions"
                    [ngModel]="splitMode()"
                    (ngModelChange)="splitMode.set($event)"
                    [ngModelOptions]="{ standalone: true }"
                    placeholder="Igual"
                  ></app-selector>
                </div>
              </div>
              @if (splitMode() === 'equal') {
                <div class="preview-box">
                  <span class="text-xs text-text-secondary">
                    Monto por cuenta (igual)
                  </span>
                  <span class="text-lg font-bold text-text-primary">
                    {{ formatCurrency(perSplit()) }}
                  </span>
                </div>
              } @else {
                <div class="space-y-2">
                  <label
                    class="block text-sm font-medium text-text-primary mb-1.5"
                  >
                    Montos por cuenta (deben sumar
                    {{ formatCurrency(grandTotal()) }})
                  </label>
                  <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    @for (
                      i of customAmountSlots();
                      track i;
                      let idx = $index
                    ) {
                      <app-input
                        [formControlName]="'amount_' + i"
                        label="Cuenta {{ idx + 1 }}"
                        type="number"
                        [currency]="true"
                        [min]="0"
                        placeholder="0"
                      ></app-input>
                    }
                  </div>
                  <div class="preview-box preview-warn">
                    <span class="text-xs">Suma actual</span>
                    <span
                      class="text-sm font-bold"
                      [class.text-destructive]="customSumMismatch()"
                    >
                      {{ formatCurrency(customSum()) }}
                    </span>
                  </div>
                </div>
              }
            } @else {
              <div>
                <label
                  class="block text-sm font-medium text-text-primary mb-1.5"
                >
                  Items del pedido
                </label>
                <div class="items-list">
                  @for (it of orderItems(); track it.id) {
                    <div class="item-row">
                      <div class="item-info">
                        <div class="item-name">
                          {{ it.product_name }}
                        </div>
                        <div class="item-meta">
                          {{ it.quantity }} ×
                          {{ formatCurrency(it.unit_price) }}
                        </div>
                      </div>
                      <div class="item-actions">
                        <select
                          [value]="itemGroupSelection()[it.id] ?? 0"
                          (change)="onAssignItem(it.id, $event)"
                          class="group-select"
                        >
                          <option [value]="0">Sin asignar</option>
                          @for (g of itemGroupsCount(); track g) {
                            <option [value]="g">Cuenta {{ g }}</option>
                          }
                        </select>
                        <span class="item-total">
                          {{ formatCurrency(it.total_price) }}
                        </span>
                      </div>
                    </div>
                  }
                </div>
                <div class="actions-row">
                  <app-button
                    variant="secondary"
                    size="sm"
                    (clicked)="addGroup()"
                  >
                    <app-icon name="plus" [size]="14" slot="icon"></app-icon>
                    Agregar cuenta
                  </app-button>
                  <span class="text-xs text-text-secondary">
                    Cuentas: {{ itemGroupsCount().length }} · Asignados:
                    {{ assignedCount() }} / {{ orderItems().length }}
                  </span>
                </div>
              </div>
            }
          </form>

          <!-- Summary -->
          <div class="summary-box">
            <div class="summary-row">
              <span class="text-xs text-text-secondary">Total actual</span>
              <span class="text-sm font-bold">
                {{ formatCurrency(grandTotal()) }}
              </span>
            </div>
            <div class="summary-row">
              <span class="text-xs text-text-secondary">Sub-cuentas a crear</span>
              <span class="text-sm font-bold">
                {{ previewSubOrders() }}
              </span>
            </div>
          </div>
        </div>
      }

      <div slot="footer" class="flex justify-end gap-2">
        <app-button variant="secondary" size="md" (clicked)="onCancel()">
          Cancelar
        </app-button>
        <app-button
          variant="primary"
          size="md"
          (clicked)="onConfirm()"
          [disabled]="!canConfirm() || submitting()"
        >
          <app-icon name="users" [size]="16" slot="icon"></app-icon>
          @if (submitting()) {
            Dividiendo...
          } @else {
            Dividir cuenta
          }
        </app-button>
      </div>
    </app-modal>
  `,
  styles: [
    `
      .method-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 8px;
      }

      .method-btn {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        padding: 12px;
        border-radius: 12px;
        background: var(--color-surface);
        border: 1px solid var(--color-border);
        font-size: 13px;
        font-weight: 600;
        color: var(--color-text-secondary);
        cursor: pointer;
        transition: all 0.15s ease;
      }

      .method-btn:hover:not(.active) {
        border-color: var(--color-primary);
        color: var(--color-text-primary);
      }

      .method-btn.active {
        background: var(--color-primary);
        color: white;
        border-color: var(--color-primary);
      }

      .items-list {
        max-height: 240px;
        overflow-y: auto;
        border: 1px solid var(--color-border);
        border-radius: 12px;
        background: var(--color-surface);
      }

      .item-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 10px 12px;
        border-bottom: 1px solid var(--color-border);
        gap: 8px;
      }

      .item-row:last-child {
        border-bottom: none;
      }

      .item-info {
        flex: 1;
        min-width: 0;
      }

      .item-name {
        font-size: 13px;
        font-weight: 600;
        color: var(--color-text-primary);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .item-meta {
        font-size: 11px;
        color: var(--color-text-secondary);
      }

      .item-actions {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-shrink: 0;
      }

      .group-select {
        padding: 6px 8px;
        border: 1px solid var(--color-border);
        border-radius: 8px;
        background: var(--color-surface);
        font-size: 12px;
        color: var(--color-text-primary);
        cursor: pointer;
      }

      .item-total {
        font-size: 13px;
        font-weight: 700;
        min-width: 80px;
        text-align: right;
      }

      .actions-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-top: 8px;
      }

      .preview-box {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 10px 12px;
        border-radius: 10px;
        background: var(--color-muted);
        border: 1px solid var(--color-border);
        margin-top: 4px;
      }

      .preview-warn {
        background: rgba(245, 158, 11, 0.08);
        border-color: rgba(245, 158, 11, 0.35);
      }

      .summary-box {
        background: var(--color-muted);
        border: 1px solid var(--color-border);
        border-radius: 12px;
        padding: 12px;
        display: flex;
        flex-direction: column;
        gap: 6px;
      }

      .summary-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
      }
    `,
  ],
})
export class PosSplitBillModalComponent {
  private destroyRef = inject(DestroyRef);
  private fb = inject(FormBuilder);
  private integration = inject(PosRestaurantIntegrationService);
  private toastService = inject(ToastService);
  private currencyService = inject(CurrencyFormatService);

  readonly isOpen = input<boolean>(false);
  readonly isOpenChange = output<boolean>();
  readonly splitCompleted = output<SplitResult>();

  readonly session = signal<TableSession | null>(null);
  readonly method = signal<SplitMethod>('items');
  readonly splitMode = signal<SplitMode>('equal');
  readonly submitting = signal(false);

  // Items-method state
  readonly itemGroupsCount = signal<number[]>([1, 2]);
  readonly itemGroupSelection = signal<Record<number, number>>({});

  readonly form: FormGroup;

  readonly splitModeOptions: SelectorOption[] = [
    { value: 'equal', label: 'Igual' },
    { value: 'custom', label: 'Personalizado' },
  ];

  constructor() {
    this.form = this.fb.group({
      n_splits: [2, [Validators.required, Validators.min(2)]],
    });

    effect(() => {
      if (this.isOpen()) {
        untracked(() => this.loadFromSession());
      }
    });
  }

  private loadFromSession(): void {
    const session = this.integration.currentTableSession();
    this.session.set(session);
    this.method.set('items');
    this.splitMode.set('equal');
    this.itemGroupsCount.set([1, 2]);
    this.itemGroupSelection.set({});
    this.form.reset({ n_splits: 2 });
  }

  readonly orderItems = computed<TableSessionOrderItem[]>(() => {
    const s = this.session();
    const items = s?.order?.order_items ?? [];
    return items.filter((i) => Number(i.inventory_consumed_at_fire) !== 1);
  });

  readonly grandTotal = computed(() => {
    const items = this.orderItems();
    return items.reduce(
      (acc: number, it: TableSessionOrderItem) => acc + Number(it.total_price || 0),
      0,
    );
  });

  readonly perSplit = computed(() => {
    const n = Math.max(1, Number(this.form.value.n_splits) || 1);
    return this.grandTotal() / n;
  });

  readonly customAmountSlots = computed<number[]>(() => {
    const n = Math.max(2, Number(this.form.value.n_splits) || 2);
    return Array.from({ length: n }, (_, i) => i);
  });

  readonly customSum = computed(() => {
    let total = 0;
    for (const i of this.customAmountSlots()) {
      const v = this.form.value['amount_' + i];
      const n = Number(v);
      if (Number.isFinite(n)) total += n;
    }
    return total;
  });



  readonly customSumMismatch = computed(() => {
    if (this.splitMode() !== 'custom') return false;
    return Math.abs(this.customSum() - this.grandTotal()) > 0.01;
  });

  readonly assignedCount = computed(
    () => Object.values(this.itemGroupSelection()).filter((v) => v > 0).length,
  );

  readonly previewSubOrders = computed(() => {
    if (this.method() === 'items') {
      const groups = new Set(
        Object.values(this.itemGroupSelection()).filter((v) => v > 0),
      );
      return groups.size;
    }
    return Math.max(1, Number(this.form.value.n_splits) || 1);
  });

  readonly canConfirm = computed(() => {
    const session = this.session();
    if (!session || !session.order_id) return false;
    if (this.orderItems().length === 0) return false;
    if (this.method() === 'amount') {
      if (this.splitMode() === 'custom' && this.customSumMismatch()) return false;
      const n = Number(this.form.value.n_splits) || 0;
      if (n < 2) return false;
    } else {
      if (this.assignedCount() < this.orderItems().length) return false;
    }
    return true;
  });

  onModalChange(open: boolean): void {
    if (!open) this.isOpenChange.emit(false);
  }

  onCancel(): void {
    this.isOpenChange.emit(false);
  }

  setMethod(m: SplitMethod): void {
    this.method.set(m);
  }

  addGroup(): void {
    const next = this.itemGroupsCount().length + 1;
    this.itemGroupsCount.set([...this.itemGroupsCount(), next]);
  }

  onAssignItem(itemId: number, ev: Event): void {
    const value = Number((ev.target as HTMLSelectElement).value);
    const next = { ...this.itemGroupSelection() };
    if (value === 0) {
      delete next[itemId];
    } else {
      next[itemId] = value;
    }
    this.itemGroupSelection.set(next);
  }

  formatCurrency(amount: number | string): string {
    const n = Number(amount);
    return this.currencyService.format(Number.isFinite(n) ? n : 0);
  }

  onConfirm(): void {
    const session = this.session();
    if (!session?.order_id) return;
    this.submitting.set(true);

    const orderId = session.order_id;
    const obs =
      this.method() === 'items'
        ? this.callSplitByItems(orderId)
        : this.callSplitByAmount(orderId);

    obs.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (result) => {
        this.submitting.set(false);
        this.toastService.success(
          `Cuenta dividida en ${result.sub_orders.length} sub-órdenes`,
        );
        this.splitCompleted.emit(result);
        this.isOpenChange.emit(false);
      },
      error: (err) => {
        this.submitting.set(false);
        this.toastService.error(extractApiErrorMessage(err));
      },
    });
  }

  private callSplitByItems(orderId: number) {
    const selection = this.itemGroupSelection();
    const groupsByIndex: Record<number, number[]> = {};
    for (const [itemIdStr, group] of Object.entries(selection)) {
      if (group === 0) continue;
      const itemId = Number(itemIdStr);
      if (!groupsByIndex[group]) groupsByIndex[group] = [];
      groupsByIndex[group].push(itemId);
    }
    const item_groups = Object.values(groupsByIndex).map((ids) => ({
      order_item_ids: ids,
    }));
    return this.integration.splitByItems(orderId, { item_groups });
  }

  private callSplitByAmount(orderId: number) {
    const n = Math.max(2, Number(this.form.value.n_splits) || 2);
    const mode = this.splitMode();
    if (mode === 'equal') {
      return this.integration.splitByAmount(orderId, 'equal', n);
    }
    const amounts = this.customAmountSlots().map((i) =>
      Number(this.form.value['amount_' + i] || 0),
    );
    return this.integration.splitByAmount(orderId, 'custom', n, amounts);
  }
}
