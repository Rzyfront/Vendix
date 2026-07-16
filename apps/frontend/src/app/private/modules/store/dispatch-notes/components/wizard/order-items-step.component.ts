import {
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import {
  CardComponent,
  EmptyStateComponent,
  IconComponent,
  InputComponent,
  ResponsiveDataViewComponent,
  TableColumn,
} from '../../../../../../shared/components';

import { DispatchNotesService } from '../../services/dispatch-notes.service';
import { DispatchNoteWizardService } from '../../services/dispatch-note-wizard.service';
import { CurrencyPipe } from '../../../../../../shared/pipes/currency/currency.pipe';

/**
 * Order items step (ref 2026-06-25).
 *
 * Shows the items precargados from the selected order. The operator
 * chooses how many units to dispatch per line. The wizard service clamps
 * dispatched_quantity to [0, pending_quantity]; the latter is computed by
 * subtracting the sum of `dispatch_note_items[].dispatched_quantity`
 * already created for each order_item (queried via
 * `DispatchNotesService.getByOrder(orderId)` on mount).
 *
 * Mitigates the "double dispatch" gap of V1: the operator sees the real
 * pending amount per line instead of `order_item.quantity` again.
 */
@Component({
  selector: 'app-dispatch-wizard-order-items-step',
  standalone: true,
  imports: [
    CardComponent,
    CurrencyPipe,
    EmptyStateComponent,
    FormsModule,
    IconComponent,
    InputComponent,
    ResponsiveDataViewComponent,
  ],
  template: `
    <div class="space-y-2">
      @if (items().length === 0) {
        <app-empty-state
          icon="package"
          title="Sin ítems"
          description="La orden seleccionada no tiene ítems para despachar."
        ></app-empty-state>
      } @else {
        <p class="text-xs text-[var(--color-text-muted)]">
          Ajusta las cantidades a despachar. Las cantidades ya remitidas se
          descuentan automáticamente del pendiente.
        </p>

        <div class="space-y-1.5 max-h-72 overflow-y-auto">
          @for (item of items(); track item.order_item_id) {
            <div
              class="flex items-center gap-2 p-2 border border-[var(--color-border)]
                     rounded-lg bg-[var(--color-surface)]"
            >
              <div class="flex-1 min-w-0">
                <p class="text-sm font-medium text-[var(--color-text-primary)] truncate">
                  {{ item.product_name }}
                  @if (item.variant_name) {
                    <span class="text-xs text-[var(--color-text-muted)]">
                      · {{ item.variant_name }}
                    </span>
                  }
                </p>
                <div class="flex items-center gap-2 text-[11px] text-[var(--color-text-muted)] mt-0.5">
                  <span>Pedido: <strong>{{ item.ordered_quantity }}</strong></span>
                  <span>·</span>
                  <span>
                    Pendiente:
                    <strong [class.text-amber-600]="item.pending_quantity > 0">
                      {{ item.pending_quantity }}
                    </strong>
                  </span>
                  @if (item.requires_serial_numbers) {
                    <span
                      class="ml-1 inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full
                             bg-amber-100 text-amber-800 text-[10px] font-medium"
                    >
                      <app-icon name="hash" [size]="10"></app-icon>
                      Seriales
                    </span>
                  }
                </div>
              </div>

              <app-input
                type="number"
                size="sm"
                [min]="0"
                [max]="item.pending_quantity"
                [ngModel]="item.dispatched_quantity"
                (ngModelChange)="onQtyChange(item.order_item_id!, $event)"
                customClasses="w-20"
              ></app-input>

              <span class="text-xs text-[var(--color-text-secondary)] whitespace-nowrap shrink-0 min-w-[5rem] text-right">
                {{ item.dispatched_quantity * item.unit_price | currency }}
              </span>
            </div>
          }
        </div>
      }
    </div>
  `,
})
export class OrderItemsStepComponent {
  readonly wizardService = inject(DispatchNoteWizardService);
  private readonly dispatchNotesService = inject(DispatchNotesService);
  private readonly destroyRef = inject(DestroyRef);

  /** Mirrors `wizardService.items()` so the template can iterate without
   *  calling the signal inside `@for` (which would be fine, but the
   *  computed makes the dependency obvious to the change detector). */
  readonly items = computed(() => this.wizardService.items());

  constructor() {
    // On mount, fetch existing remisiones for the selected order and
    // re-seed the wizard items with the proper `pending_quantity`.
    const order = this.wizardService.selectedOrder();
    if (!order) return;

    this.dispatchNotesService
      .getByOrder(order.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (notes) => {
          // Suma dispatched_quantity por sales_order_item_id (= order_items.id)
          // a través de todas las remisiones NO anuladas de la orden. El
          // backend (getByOrder + createFromOrder) ahora persiste y devuelve
          // sales_order_item_id, dando enlace exacto al renglón de la orden.
          // setSelectedOrder hace match contra oi.id, así que la clave coincide.
          const dispatched = new Map<number, number>();
          for (const note of notes ?? []) {
            for (const line of (note as any).dispatch_note_items ?? []) {
              if (!line?.dispatched_quantity) continue;
              const key = line.sales_order_item_id;
              if (typeof key === 'number') {
                dispatched.set(key, (dispatched.get(key) ?? 0) + Number(line.dispatched_quantity));
              }
            }
          }
          this.wizardService.setSelectedOrder(order, dispatched);
        },
        error: () => {
          // If the call fails, we keep the optimistic seed (pending = quantity).
        },
      });
  }

  onQtyChange(orderItemId: number, value: number | string | null): void {
    const n = typeof value === 'string' ? parseInt(value, 10) : (value ?? 0);
    this.wizardService.updateItemQuantity(orderItemId, isNaN(n) ? 0 : n);
  }
}
