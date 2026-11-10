import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  model,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { StoreSettingsFacade } from '../../../../../../core/store/store-settings/store-settings.facade';
import { extractApiErrorMessage } from '../../../../../../core/utils/api-error-handler';
import { formatStoreDateTime } from '../../../../../../shared/utils/date.util';
import {
  ButtonComponent,
  ModalComponent,
  SpinnerComponent,
  ToastService,
} from '../../../../../../shared/components';
import { CurrencyPipe } from '../../../../../../shared/pipes/currency/currency.pipe';
import { ProductionOrdersService } from '../../../restaurant-ops/production/services/production-orders.service';
import { ProductionSseService } from '../../../restaurant-ops/production/services/production-sse.service';
import { ProductionOrderRef } from '../../../restaurant-ops/production/interfaces/production-order.interface';
import { NonProducibleNoticeComponent } from '../non-producible-notice/non-producible-notice.component';
import { ScheduledOrdersApiService } from '../../services/scheduled-orders-api.service';
import {
  DESTINATION_LABELS,
  ScheduledOrderItem,
  DISPLAY_STATUS_COLORS,
  DISPLAY_STATUS_LABELS,
  STATUS_LABELS,
  ScheduledOrderChange,
  ScheduledOrderDetail,
  ScheduledOrderDisplayStatus,
  customerName,
  describeVariant,
  uomLabel,
} from '../../interfaces/scheduled-order.interface';

@Component({
  selector: 'app-schedule-detail-modal',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ModalComponent,
    ButtonComponent,
    SpinnerComponent,
    CurrencyPipe,
    NonProducibleNoticeComponent,
  ],
  styles: [
    `
      .st-badge {
        display: inline-block;
        padding: 2px 10px;
        border-radius: 999px;
        font-size: var(--fs-xs, 0.75rem);
        font-weight: 600;
        color: var(--st);
        background: color-mix(in srgb, var(--st) 15%, transparent);
      }
      .section-title {
        font-size: var(--fs-sm, 0.875rem);
        font-weight: 600;
        color: var(--color-text-primary);
        margin-bottom: 0.5rem;
      }
      .muted {
        color: var(--color-text-muted);
      }
      .box {
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md, 10px);
        padding: 0.75rem;
        background: var(--color-surface);
      }
    `,
  ],
  template: `
    <app-modal
      [(isOpen)]="isOpen"
      [title]="detail() ? 'Pedido ' + detail()!.order.order_number : 'Pedido programado'"
      size="lg"
    >
      @if (loading()) {
        <div class="flex justify-center py-10"><app-spinner /></div>
      } @else if (detail(); as d) {
        <div class="flex flex-col gap-4">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <span class="st-badge" [style.--st]="color(d.display_status)">{{ label(d.display_status) }}</span>
            <span class="muted text-sm">
              {{ fulfillmentLabel(d) }} · {{ formatDateTime(d.scheduled_start) }}
            </span>
          </div>

          <div class="box text-sm">
            <div class="font-semibold">{{ customer(d) }}</div>
            @if (d.order.users?.phone) {
              <div class="muted">{{ d.order.users?.phone }}</div>
            }
            <div class="muted">Total: {{ toNumber(d.order.grand_total) | currency }}</div>
          </div>

          <div>
            <div class="section-title">Productos</div>
            <div class="flex flex-col gap-2">
              @for (item of d.order.order_items; track item.id) {
                <div class="box text-sm">
                  <div class="font-semibold">
                    {{ item.quantity }} × {{ item.product_name }}
                    @if (variant(item.variant_attributes)) {
                      <span class="muted font-normal">({{ variant(item.variant_attributes) }})</span>
                    }
                  </div>
                  @if (destinationState(d, item); as state) {
                    <div class="mt-1 flex flex-wrap items-center gap-1">
                      <span class="st-badge" [style.--st]="'var(--color-text-muted)'">{{ state }}</span>
                      @if (item.fulfillment_destination === 'production' && item.production_order; as po) {
                        <button
                          type="button"
                          class="st-badge cursor-pointer"
                          [style.--st]="'var(--color-text-primary)'"
                          [attr.title]="'Ver la orden de producción'"
                          (click)="goToProduction(po.id)"
                        >
                          {{ po.order_number || '#' + po.id }} · {{ productionStatus(po) }}
                        </button>
                      }
                    </div>
                  }
                  @for (opt of item.order_item_options ?? []; track $index) {
                    <div class="muted">
                      + {{ opt.option_name }}
                      @if (+opt.quantity !== 1 || opt.uom) {
                        × {{ opt.quantity }}{{ uom(opt.uom) ? ' ' + uom(opt.uom) : '' }}
                      }
                      <span class="text-xs">({{ opt.group_name }})</span>
                      @if (opt.note) {
                        <span class="italic"> — Nota: {{ opt.note }}</span>
                      }
                    </div>
                  }
                  @if (item.notes) {
                    <div class="muted italic">Nota: {{ item.notes }}</div>
                  }
                  @if (item.is_producible === false && item.fulfillment_destination !== 'production') {
                    <div class="mt-1">
                      <app-non-producible-notice
                        [productId]="item.product_id ?? null"
                        [productType]="item.product_type ?? null"
                      ></app-non-producible-notice>
                    </div>
                  }
                </div>
              }
            </div>
          </div>

          <div>
            <div class="section-title">Historial</div>
            <ul class="flex flex-col gap-1 text-sm">
              @for (c of d.changes ?? []; track $index) {
                <li>
                  {{ describeChange(c) }}
                  <span class="muted text-xs">· {{ formatDateTime(c.created_at) }}</span>
                </li>
              } @empty {
                <li class="muted">Sin movimientos.</li>
              }
            </ul>
          </div>
        </div>
      } @else {
        <p class="muted text-sm py-6 text-center">No se pudo cargar el pedido.</p>
      }

      <div slot="footer" class="flex flex-wrap justify-end gap-2 w-full">
        @if (detail(); as d) {
          <app-button variant="outline" (clicked)="goToSaleOrder(d.order_id)">Ver orden de venta</app-button>
          @for (po of productionOrders(); track po.id) {
            <app-button variant="outline" (clicked)="goToProduction(po.id)">
              {{ productionOrders().length > 1 ? 'Ver orden de producción ' + (po.order_number || '#' + po.id) : 'Ver orden de producción' }}
            </app-button>
          }
        }
      </div>
    </app-modal>
  `,
})
export class ScheduleDetailModalComponent {
  private readonly api = inject(ScheduledOrdersApiService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);
  private readonly settings = inject(StoreSettingsFacade);
  private readonly destroyRef = inject(DestroyRef);
  private readonly sse = inject(ProductionSseService);

  readonly scheduleId = input<number | null>(null);
  readonly isOpen = model<boolean>(false);
  readonly detail = signal<ScheduledOrderDetail | null>(null);
  readonly loading = signal(false);

  /** Distinct production orders linked to the sale's lines ("Ver orden de producción"). */
  readonly productionOrders = computed<ProductionOrderRef[]>(() => {
    const seen = new Map<number, ProductionOrderRef>();
    for (const item of this.detail()?.order.order_items ?? []) {
      if (item.production_order && !seen.has(item.production_order.id)) {
        seen.set(item.production_order.id, item.production_order);
      }
    }
    return [...seen.values()];
  });

  /** The agenda is read-only (S23): changes are made on the sale / production order. */
  goToSaleOrder(orderId: number): void {
    this.isOpen.set(false);
    void this.router.navigate(['/admin/orders', orderId]);
  }

  goToProduction(productionOrderId: number): void {
    this.isOpen.set(false);
    void this.router.navigate(['/admin/restaurant-ops/production/orders', productionOrderId]);
  }

  productionStatus(po: ProductionOrderRef): string {
    return ProductionOrdersService.statusLabelSafe(po.status);
  }

  /**
   * Destination state of one line (QUI-999). A line KDS does not manage
   * (production / stock) never shows KDS state. For `kds` lines the contract
   * has no per-line sent flag, so the state comes from the order-level count of
   * dishes still pending: none pending = all sent; all pending = none sent.
   */
  destinationState(d: ScheduledOrderDetail, item: ScheduledOrderItem): string | null {
    switch (item.fulfillment_destination) {
      case 'production':
        return DESTINATION_LABELS.production;
      case 'stock':
        return DESTINATION_LABELS.stock;
      case 'kds': {
        const pending = d.pending_kitchen_item_count ?? 0;
        const kdsLines = d.order.order_items.filter(
          (i) => i.fulfillment_destination === 'kds',
        ).length;
        if (pending === 0) return `${DESTINATION_LABELS.kds} · enviado a cocina`;
        if (pending >= kdsLines) return `${DESTINATION_LABELS.kds} · pendiente de enviar`;
        return DESTINATION_LABELS.kds;
      }
      default:
        return null;
    }
  }

  constructor() {
    effect(() => {
      const id = this.scheduleId();
      if (this.isOpen() && id !== null) {
        this.detail.set(null);
        this.load(id);
      }
    });
    // Production state changed elsewhere: refresh the open detail silently.
    this.sse.listen(this.destroyRef, () => {
      const id = this.scheduleId();
      if (this.isOpen() && id !== null) this.load(id, true);
    });
  }

  private load(id: number, silent = false): void {
    if (!silent) this.loading.set(true);
    this.api
      .getDetail(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (d) => {
          this.detail.set(d);
          this.loading.set(false);
        },
        error: (err) => {
          this.loading.set(false);
          if (silent) return;
          this.detail.set(null);
          this.toast.error(extractApiErrorMessage(err));
        },
      });
  }

  label(s: ScheduledOrderDisplayStatus): string {
    return DISPLAY_STATUS_LABELS[s];
  }
  color(s: ScheduledOrderDisplayStatus): string {
    return DISPLAY_STATUS_COLORS[s];
  }
  customer(d: ScheduledOrderDetail): string {
    return customerName(d.order.users, d.order.customer_alias);
  }
  variant = describeVariant;
  uom = uomLabel;
  toNumber(v: number | string): number {
    return Number(v);
  }
  fulfillmentLabel(d: ScheduledOrderDetail): string {
    return d.fulfillment_type === 'delivery' ? 'Domicilio' : 'Recogida';
  }

  formatDateTime(iso: string | null): string {
    return iso ? formatStoreDateTime(iso, this.settings.timezone()) : '';
  }

  describeChange(c: ScheduledOrderChange): string {
    const who = c.changed_by
      ? [c.changed_by.first_name, c.changed_by.last_name].filter(Boolean).join(' ')
      : '';
    const by = who ? ` por ${who}` : '';
    if (c.change_type === 'reschedule') {
      return `Reprogramado de ${this.formatDateTime(c.from_start)} a ${this.formatDateTime(c.to_start)}${by}`;
    }
    if (c.change_type === 'status' && c.to_status) {
      const from = c.from_status ? `${STATUS_LABELS[c.from_status]} → ` : '';
      return `Estado: ${from}${STATUS_LABELS[c.to_status]}${by}`;
    }
    return `Pedido programado${by}`;
  }
}
