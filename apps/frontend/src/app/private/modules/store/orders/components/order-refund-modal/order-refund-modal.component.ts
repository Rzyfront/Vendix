import {
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { NgClass } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ModalComponent } from '../../../../../../shared/components';
import { ButtonComponent } from '../../../../../../shared/components/button/button.component';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { SelectorComponent, SelectorOption } from '../../../../../../shared/components/selector/selector.component';
import { StepsLineComponent, StepsLineItem } from '../../../../../../shared/components/steps-line/steps-line.component';
import { TextareaComponent } from '../../../../../../shared/components/textarea/textarea.component';
import { CurrencyPipe } from '../../../../../../shared/pipes/currency';
import {
  Order,
  OrderItem,
  InventoryAction,
  RefundMethod,
  RefundItemRequest,
  CreateRefundRequest,
  RefundCalculationResult,
} from '../../interfaces/order.interface';
import { StoreOrdersService } from '../../services/store-orders.service';
import { InventoryService } from '../../../inventory/services/inventory.service';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

interface RefundItemState {
  orderItem: OrderItem;
  selected: boolean;
  quantity: number;
  maxQuantity: number;
  alreadyRefunded: number;
  inventoryAction: InventoryAction;
  locationId: number | null;
}

@Component({
  selector: 'app-order-refund-modal',
  standalone: true,
  imports: [
    NgClass,
    FormsModule,
    ModalComponent,
    ButtonComponent,
    IconComponent,
    SelectorComponent,
    StepsLineComponent,
    TextareaComponent,
    CurrencyPipe,
  ],
  template: `
    <app-modal
      [isOpen]="isOpen()"
      (closed)="onModalClosed()"
      title="Procesar Reembolso"
      size="lg"
    >
      <!-- Steps Line -->
      <div class="px-4 pt-3 pb-1 border-b border-border bg-[var(--color-surface)]">
        <app-steps-line
          [steps]="steps"
          [currentStep]="currentStep()"
          size="sm"
        />
      </div>

      <!-- Step Content -->
      <div class="p-4 space-y-4 max-h-[60vh] overflow-y-auto">

        <!-- ═══ STEP 1: Select Items ═══ -->
        @if (currentStep() === 0) {
          <!-- Select All -->
          <div class="flex items-center justify-between">
            <h4 class="text-sm font-bold text-gray-900">Seleccionar items a reembolsar</h4>
            <button
              (click)="toggleSelectAll()"
              class="text-xs font-semibold text-primary hover:text-primary-700 transition-colors"
            >
              {{ allSelected() ? 'Deseleccionar Todo' : 'Seleccionar Todo' }}
            </button>
          </div>

          <!-- Items List -->
          <div class="space-y-2">
            @for (item of refundItems(); track item.orderItem.id) {
              <div
                class="p-3 rounded-xl border transition-all cursor-pointer"
                [ngClass]="{
                  'border-primary bg-primary/5 ring-1 ring-primary/20': item.selected,
                  'border-border bg-[var(--color-surface)] hover:border-gray-300': !item.selected
                }"
                (click)="toggleItem(item.orderItem.id)"
              >
                <div class="flex items-center gap-3">
                  <!-- Checkbox -->
                  <div
                    class="w-5 h-5 rounded-md border-2 flex items-center justify-center flex-shrink-0 transition-all"
                    [ngClass]="{
                      'border-primary bg-primary': item.selected,
                      'border-gray-300': !item.selected
                    }"
                  >
                    @if (item.selected) {
                      <svg class="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3">
                        <polyline points="20 6 9 17 4 12"></polyline>
                      </svg>
                    }
                  </div>

                  <!-- Product Image -->
                  <div class="w-10 h-10 bg-white rounded-lg flex-shrink-0 flex items-center justify-center border border-border overflow-hidden">
                    @if (item.orderItem.products?.image_url) {
                      <img [src]="item.orderItem.products!.image_url" class="w-full h-full object-cover" />
                    } @else {
                      <app-icon name="image" size="16" class="text-gray-300"></app-icon>
                    }
                  </div>

                  <!-- Product Info -->
                  <div class="flex-1 min-w-0">
                    <p class="text-sm font-semibold text-gray-900 truncate">{{ item.orderItem.product_name }}</p>
                    <p class="text-[10px] text-gray-400 font-mono">SKU: {{ item.orderItem.variant_sku || 'N/A' }}</p>
                    @if (item.alreadyRefunded > 0) {
                      <p class="text-[10px] text-orange-600 font-medium mt-0.5">
                        {{ item.alreadyRefunded }} ya reembolsado(s)
                      </p>
                    }
                  </div>

                  <!-- Quantity + Price -->
                  <div class="text-right flex-shrink-0">
                    <p class="text-sm font-bold text-gray-900">{{ item.orderItem.unit_price | currency }}</p>
                    <p class="text-[10px] text-gray-500">x{{ item.orderItem.quantity }} original</p>
                  </div>
                </div>

                <!-- Quantity selector (shown when selected) -->
                @if (item.selected) {
                  <div class="mt-3 pt-3 border-t border-border/50 flex items-center justify-between" (click)="$event.stopPropagation()">
                    <span class="text-xs font-medium text-gray-600">Cantidad a reembolsar:</span>
                    <div class="flex items-center gap-2">
                      <button
                        (click)="decrementQuantity(item.orderItem.id)"
                        class="w-7 h-7 rounded-lg border border-border flex items-center justify-center hover:bg-gray-100 transition-colors"
                        [disabled]="item.quantity <= 1"
                      >
                        <app-icon name="minus" size="14"></app-icon>
                      </button>
                      <span class="w-8 text-center font-bold text-sm">{{ item.quantity }}</span>
                      <button
                        (click)="incrementQuantity(item.orderItem.id)"
                        class="w-7 h-7 rounded-lg border border-border flex items-center justify-center hover:bg-gray-100 transition-colors"
                        [disabled]="item.quantity >= item.maxQuantity"
                      >
                        <app-icon name="plus" size="14"></app-icon>
                      </button>
                      <span class="text-[10px] text-gray-400 ml-1">/ {{ item.maxQuantity }}</span>
                    </div>
                  </div>
                }
              </div>
            }
          </div>

          <!-- Reason -->
          <app-textarea
            label="Razon del reembolso"
            [required]="true"
            [ngModel]="reason()"
            (ngModelChange)="reason.set($event)"
            [rows]="2"
            placeholder="Describe la razon del reembolso..."
          ></app-textarea>
        }

        <!-- ═══ STEP 2: Inventory Actions ═══ -->
        @if (currentStep() === 1) {
          <h4 class="text-sm font-bold text-gray-900">Accion de inventario por item</h4>
          <p class="text-xs text-gray-500 -mt-2">Define que hacer con el producto devuelto.</p>

          <div class="space-y-3">
            @for (item of selectedItems(); track item.orderItem.id) {
              <div class="p-3 rounded-xl border border-border bg-[var(--color-surface)]">
                <div class="flex items-center gap-2 mb-3">
                  <div class="w-8 h-8 bg-white rounded-lg flex-shrink-0 flex items-center justify-center border border-border overflow-hidden">
                    @if (item.orderItem.products?.image_url) {
                      <img [src]="item.orderItem.products!.image_url" class="w-full h-full object-cover" />
                    } @else {
                      <app-icon name="image" size="14" class="text-gray-300"></app-icon>
                    }
                  </div>
                  <div class="min-w-0 flex-1">
                    <p class="text-sm font-semibold text-gray-900 truncate">{{ item.orderItem.product_name }}</p>
                    <p class="text-[10px] text-gray-500">{{ item.quantity }} unidad(es)</p>
                  </div>
                </div>

                <!-- Action buttons -->
                <div class="grid grid-cols-3 gap-1.5">
                  <button
                    (click)="setInventoryAction(item.orderItem.id, 'restock')"
                    class="p-2 rounded-lg border text-center transition-all text-xs font-medium"
                    [ngClass]="{
                      'border-green-400 bg-green-50 text-green-700 ring-1 ring-green-200': item.inventoryAction === 'restock',
                      'border-border hover:bg-gray-50 text-gray-600': item.inventoryAction !== 'restock'
                    }"
                  >
                    <app-icon name="package-check" size="16" class="block mx-auto mb-1"></app-icon>
                    Reabastecer
                  </button>
                  <button
                    (click)="setInventoryAction(item.orderItem.id, 'write_off')"
                    class="p-2 rounded-lg border text-center transition-all text-xs font-medium"
                    [ngClass]="{
                      'border-red-400 bg-red-50 text-red-700 ring-1 ring-red-200': item.inventoryAction === 'write_off',
                      'border-border hover:bg-gray-50 text-gray-600': item.inventoryAction !== 'write_off'
                    }"
                  >
                    <app-icon name="trash-2" size="16" class="block mx-auto mb-1"></app-icon>
                    Dar de baja
                  </button>
                  <button
                    (click)="setInventoryAction(item.orderItem.id, 'no_return')"
                    class="p-2 rounded-lg border text-center transition-all text-xs font-medium"
                    [ngClass]="{
                      'border-gray-400 bg-gray-50 text-gray-700 ring-1 ring-gray-200': item.inventoryAction === 'no_return',
                      'border-border hover:bg-gray-50 text-gray-600': item.inventoryAction !== 'no_return'
                    }"
                  >
                    <app-icon name="x" size="16" class="block mx-auto mb-1"></app-icon>
                    No devolver
                  </button>
                </div>

                <!-- Location selector for restock/write_off -->
                @if (item.inventoryAction === 'restock' || item.inventoryAction === 'write_off') {
                  <div class="mt-2">
                    <app-selector
                      label="Ubicacion destino"
                      placeholder="Seleccionar ubicacion..."
                      size="sm"
                      [options]="locationOptions()"
                      [ngModel]="item.locationId"
                      (ngModelChange)="setLocationId(item.orderItem.id, $event)"
                    ></app-selector>
                  </div>
                }
              </div>
            }
          </div>
        }

        <!-- ═══ STEP 3: Review & Confirm ═══ -->
        @if (currentStep() === 2) {
          @if (isLoadingPreview()) {
            <div class="flex justify-center items-center py-8">
              <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            </div>
          } @else if (preview()) {
            <h4 class="text-sm font-bold text-gray-900">Resumen del reembolso</h4>

            <!-- Items breakdown -->
            <div class="space-y-1.5">
              @for (item of preview()!.items; track item.order_item_id) {
                <div class="flex items-center justify-between p-2 bg-[var(--color-surface)] rounded-lg border border-border">
                  <div class="min-w-0 flex-1">
                    <p class="text-xs font-semibold text-gray-900 truncate">{{ item.product_name }}</p>
                    <p class="text-[10px] text-gray-500">{{ item.quantity }} x {{ item.unit_price | currency }}</p>
                  </div>
                  <div class="text-right flex-shrink-0">
                    <p class="text-sm font-bold text-gray-900">{{ item.refund_amount | currency }}</p>
                    @if (item.tax_amount > 0) {
                      <p class="text-[10px] text-gray-400">Imp: {{ item.tax_amount | currency }}</p>
                    }
                  </div>
                </div>
              }
            </div>

            <!-- Shipping toggle -->
            <div class="flex items-center justify-between p-3 bg-[var(--color-surface)] rounded-xl border border-border">
              <div>
                <p class="text-sm font-medium text-gray-700">Incluir envio proporcional</p>
                <p class="text-[10px] text-gray-400">Envio original: {{ order()?.shipping_cost || 0 | currency }}</p>
              </div>
              <button
                (click)="toggleShipping()"
                class="relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none"
                [ngClass]="includeShipping() ? 'bg-primary' : 'bg-gray-200'"
              >
                <span
                  class="pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out"
                  [ngClass]="includeShipping() ? 'translate-x-5' : 'translate-x-0'"
                ></span>
              </button>
            </div>

            <!-- Refund method -->
            <div>
              <label class="block text-xs font-bold text-gray-700 mb-2">Metodo de reembolso</label>
              <div class="grid grid-cols-2 gap-1.5">
                @for (method of refundMethods; track method.value) {
                  <button
                    (click)="refundMethod.set(method.value)"
                    class="p-2.5 rounded-lg border text-left transition-all"
                    [ngClass]="{
                      'border-primary bg-primary/5 ring-1 ring-primary/20': refundMethod() === method.value,
                      'border-border hover:bg-gray-50': refundMethod() !== method.value
                    }"
                  >
                    <app-icon [name]="method.icon" size="16" class="mb-1"
                      [ngClass]="refundMethod() === method.value ? 'text-primary' : 'text-gray-400'"></app-icon>
                    <p class="text-xs font-semibold" [ngClass]="refundMethod() === method.value ? 'text-primary' : 'text-gray-700'">{{ method.label }}</p>
                  </button>
                }
              </div>
            </div>

            <!-- Notes -->
            <app-textarea
              label="Notas (opcional)"
              [(ngModel)]="notes"
              [rows]="2"
              placeholder="Notas internas sobre el reembolso..."
            ></app-textarea>

            <!-- Totals -->
            <div class="p-4 bg-orange-50 rounded-xl border border-orange-200 space-y-2">
              <div class="flex justify-between text-sm">
                <span class="text-orange-700">Subtotal</span>
                <span class="font-semibold text-orange-900">{{ preview()!.subtotal_refund | currency }}</span>
              </div>
              <div class="flex justify-between text-sm">
                <span class="text-orange-700">Impuestos</span>
                <span class="font-semibold text-orange-900">{{ preview()!.tax_refund | currency }}</span>
              </div>
              @if (preview()!.shipping_refund > 0) {
                <div class="flex justify-between text-sm">
                  <span class="text-orange-700">Envio</span>
                  <span class="font-semibold text-orange-900">{{ preview()!.shipping_refund | currency }}</span>
                </div>
              }
              @if (preview()!.already_refunded > 0) {
                <div class="flex justify-between text-xs pt-1 border-t border-orange-200">
                  <span class="text-orange-500">Ya reembolsado</span>
                  <span class="text-orange-500">{{ preview()!.already_refunded | currency }}</span>
                </div>
              }
              <div class="flex justify-between pt-2 border-t border-orange-300">
                <span class="text-base font-bold text-orange-900">Total Reembolso</span>
                <span class="text-xl font-black text-orange-600 font-mono tracking-tighter">
                  {{ preview()!.total_refund | currency }}
                </span>
              </div>
              @if (preview()!.is_full_refund) {
                <div class="flex items-center gap-1.5 text-xs text-orange-700 font-medium">
                  <app-icon name="alert-circle" size="14"></app-icon>
                  Reembolso total — la orden pasara a estado "reembolsada"
                </div>
              }
            </div>
          }
        }
      </div>

      <!-- Footer -->
      <div slot="footer" class="flex items-center justify-between p-4 border-t border-border">
        <div>
          @if (currentStep() > 0) {
            <app-button variant="outline" (clicked)="prevStep()">
              <app-icon slot="icon" name="arrow-left" size="14"></app-icon>
              Atras
            </app-button>
          }
        </div>

        <div class="flex items-center gap-2">
          <app-button variant="outline" (clicked)="onModalClosed()">Cancelar</app-button>

          @if (currentStep() < 2) {
            <app-button
              variant="primary"
              (clicked)="nextStep()"
              [disabled]="!canAdvance()"
            >
              Siguiente
              <app-icon slot="icon" name="arrow-right" size="14"></app-icon>
            </app-button>
          } @else {
            <app-button
              variant="primary"
              (clicked)="submitRefund()"
              [disabled]="isProcessing() || !preview()"
              customClasses="!bg-orange-600 hover:!bg-orange-700"
            >
              {{ isProcessing() ? 'Procesando...' : 'Procesar Reembolso' }}
            </app-button>
          }
        </div>
      </div>
    </app-modal>
  `,
})
export class OrderRefundModalComponent {
  // ── Signal Inputs ───────────────────────────────────────────
  isOpen = input<boolean>(false);
  order = input<Order | null>(null);

  // ── Signal Outputs ──────────────────────────────────────────
  isOpenChange = output<boolean>();
  closed = output<void>();
  refundSubmitted = output<void>();

  // ── Services ────────────────────────────────────────────────
  private ordersService = inject(StoreOrdersService);
  private inventoryService = inject(InventoryService);
  private destroyRef = inject(DestroyRef);

  // ── State ───────────────────────────────────────────────────
  currentStep = signal(0);
  refundItems = signal<RefundItemState[]>([]);
  reason = signal('');
  notes = '';
  includeShipping = signal(false);
  refundMethod = signal<RefundMethod>('original_payment');
  preview = signal<RefundCalculationResult | null>(null);
  isLoadingPreview = signal(false);
  isProcessing = signal(false);
  locations = signal<{ id: number; name: string; code: string }[]>([]);

  steps: StepsLineItem[] = [
    { label: 'Items' },
    { label: 'Inventario' },
    { label: 'Confirmar' },
  ];

  refundMethods = [
    { value: 'original_payment' as RefundMethod, label: 'Pago original', icon: 'rotate-ccw' },
    { value: 'cash' as RefundMethod, label: 'Efectivo', icon: 'banknote' },
    { value: 'bank_transfer' as RefundMethod, label: 'Transferencia', icon: 'landmark' },
    { value: 'store_credit' as RefundMethod, label: 'Credito tienda', icon: 'wallet' },
  ];

  constructor() {
    effect(() => {
      if (this.isOpen()) {
        this.resetState();
        this.loadLocations();
        this.loadRefundedQuantities();
      }
    });
  }

  // ── Computed ────────────────────────────────────────────────

  readonly selectedItems = computed(() =>
    this.refundItems().filter((i) => i.selected),
  );

  readonly allSelected = computed(() => {
    const items = this.refundItems();
    return items.length > 0 && items.every((i) => i.selected);
  });

  readonly locationOptions = computed<SelectorOption[]>(() =>
    this.locations().map((l) => ({ value: l.id, label: `${l.name} (${l.code})` })),
  );

  readonly canAdvance = computed(() => {
    const step = this.currentStep();
    if (step === 0) {
      return this.selectedItems().length > 0 && this.reason().trim().length >= 3;
    }
    if (step === 1) {
      return this.selectedItems().every((item) => {
        if (item.inventoryAction === 'restock' || item.inventoryAction === 'write_off') {
          return item.locationId !== null;
        }
        return true;
      });
    }
    return true;
  });

  // ── Methods ─────────────────────────────────────────────────

  private loadRefundedQuantities(): void {
    const order = this.order();
    if (!order?.order_items) return;

    const orderId = order.id?.toString();
    if (!orderId) {
      this.initializeItems(new Map());
      return;
    }

    this.ordersService
      .getOrderRefunds(orderId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (refunds) => {
          const refundedMap = new Map<number, number>();
          for (const refund of (Array.isArray(refunds) ? refunds : [])) {
            if (refund.state !== 'completed') continue;
            for (const ri of (refund.refund_items || [])) {
              const current = refundedMap.get(ri.order_item_id) || 0;
              refundedMap.set(ri.order_item_id, current + ri.quantity);
            }
          }
          this.initializeItems(refundedMap);
        },
        error: () => {
          this.initializeItems(new Map());
        },
      });
  }

  private initializeItems(refundedMap: Map<number, number>): void {
    const order = this.order();
    if (!order?.order_items) return;

    const items: RefundItemState[] = order.order_items
      .map((oi) => {
        const alreadyRefunded = refundedMap.get(oi.id) || 0;
        const maxQuantity = oi.quantity - alreadyRefunded;
        return {
          orderItem: oi,
          selected: false,
          quantity: Math.max(maxQuantity, 1),
          maxQuantity,
          alreadyRefunded,
          inventoryAction: 'restock' as InventoryAction,
          locationId: null,
        };
      })
      .filter((item) => item.maxQuantity > 0);

    this.refundItems.set(items);
  }

  private loadLocations(): void {
    this.inventoryService
      .getLocations({ is_active: true })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          const data = res.data || res;
          this.locations.set(
            (Array.isArray(data) ? data : []).map((l: any) => ({
              id: l.id,
              name: l.name,
              code: l.code,
            })),
          );
        },
      });
  }

  toggleItem(orderItemId: number): void {
    this.refundItems.update((items) =>
      items.map((i) =>
        i.orderItem.id === orderItemId ? { ...i, selected: !i.selected } : i,
      ),
    );
  }

  toggleSelectAll(): void {
    const shouldSelect = !this.allSelected();
    this.refundItems.update((items) =>
      items.map((i) => ({ ...i, selected: shouldSelect })),
    );
  }

  incrementQuantity(orderItemId: number): void {
    this.refundItems.update((items) =>
      items.map((i) =>
        i.orderItem.id === orderItemId && i.quantity < i.maxQuantity
          ? { ...i, quantity: i.quantity + 1 }
          : i,
      ),
    );
  }

  decrementQuantity(orderItemId: number): void {
    this.refundItems.update((items) =>
      items.map((i) =>
        i.orderItem.id === orderItemId && i.quantity > 1
          ? { ...i, quantity: i.quantity - 1 }
          : i,
      ),
    );
  }

  setInventoryAction(orderItemId: number, action: InventoryAction): void {
    this.refundItems.update((items) =>
      items.map((i) =>
        i.orderItem.id === orderItemId
          ? { ...i, inventoryAction: action, locationId: action !== 'no_return' ? i.locationId : null }
          : i,
      ),
    );
  }

  setLocationId(orderItemId: number, locationId: number | null): void {
    this.refundItems.update((items) =>
      items.map((i) =>
        i.orderItem.id === orderItemId ? { ...i, locationId } : i,
      ),
    );
  }

  toggleShipping(): void {
    this.includeShipping.update((v) => !v);
    // Re-fetch preview with updated shipping flag
    this.loadPreview();
  }

  nextStep(): void {
    if (this.currentStep() === 1) {
      // Moving to step 3 → load preview
      this.loadPreview();
    }
    this.currentStep.update((s) => Math.min(s + 1, 2));
  }

  prevStep(): void {
    this.currentStep.update((s) => Math.max(s - 1, 0));
  }

  private buildDto(): CreateRefundRequest {
    const selected = this.selectedItems();
    return {
      items: selected.map((item) => ({
        order_item_id: item.orderItem.id,
        quantity: item.quantity,
        inventory_action: item.inventoryAction,
        location_id: item.inventoryAction !== 'no_return' ? (item.locationId ?? undefined) : undefined,
      })),
      include_shipping: this.includeShipping(),
      refund_method: this.refundMethod(),
      reason: this.reason().trim(),
      notes: this.notes.trim() || undefined,
    };
  }

  private loadPreview(): void {
    const orderId = this.order()?.id;
    if (!orderId) return;

    this.isLoadingPreview.set(true);
    this.ordersService
      .previewRefund(orderId.toString(), this.buildDto())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          this.preview.set(result);
          this.isLoadingPreview.set(false);
        },
        error: () => {
          this.isLoadingPreview.set(false);
        },
      });
  }

  submitRefund(): void {
    const orderId = this.order()?.id;
    if (!orderId || this.isProcessing()) return;

    this.isProcessing.set(true);
    this.ordersService
      .createRefund(orderId.toString(), this.buildDto())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.isProcessing.set(false);
          this.refundSubmitted.emit();
          this.onModalClosed();
        },
        error: () => {
          this.isProcessing.set(false);
        },
      });
  }

  onModalClosed(): void {
    this.resetState();
    this.closed.emit();
    this.isOpenChange.emit(false);
  }

  private resetState(): void {
    this.currentStep.set(0);
    this.refundItems.set([]);
    this.reason.set('');
    this.notes = '';
    this.includeShipping.set(false);
    this.refundMethod.set('original_payment');
    this.preview.set(null);
    this.isLoadingPreview.set(false);
    this.isProcessing.set(false);
  }

}
