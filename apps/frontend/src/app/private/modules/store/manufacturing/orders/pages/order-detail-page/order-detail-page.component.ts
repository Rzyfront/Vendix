import {
  Component,
  computed,
  DestroyRef,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { EMPTY, Subject, Subscription } from 'rxjs';
import { catchError, switchMap, tap } from 'rxjs/operators';
import { AuthFacade } from '../../../../../../../core/store/auth/auth.facade';

import {
  BadgeComponent,
  CardComponent,
  DialogService,
  IconComponent,
  StickyHeaderActionButton,
  StickyHeaderComponent,
  ToastService,
} from '../../../../../../../shared/components/index';
import { CurrencyPipe } from '../../../../../../../shared/pipes/currency';
import { formatDateOnlyUTC } from '../../../../../../../shared/utils/date.util';

import {
  ManufacturingOrder,
  ManufacturingOrderLine,
  ManufacturingOrderStatus,
  ManufacturingShortage,
  ORDER_PRIORITY_LABELS,
  ORDER_STATUS_LABELS,
} from '../../../interfaces';
import {
  ManufacturingOrdersService,
  ManufacturingSettingsService,
} from '../../../services';
import { ProductionSaleLinesComponent } from '../../../../restaurant-ops/production/components/production-sale-lines/production-sale-lines.component';
import { ProductionOrdersService } from '../../../../restaurant-ops/production/services/production-orders.service';
import { ProductionSseService } from '../../../../restaurant-ops/production/services/production-sse.service';
import { ProductionOrder } from '../../../../restaurant-ops/production/interfaces/production-order.interface';
import { CompleteOrderModalComponent } from '../../components/complete-order-modal/complete-order-modal.component';

const LIST_ROUTE = '/admin/manufacturing/orders';

@Component({
  selector: 'app-manufacturing-order-detail-page',
  standalone: true,
  imports: [
    StickyHeaderComponent,
    CardComponent,
    BadgeComponent,
    IconComponent,
    CurrencyPipe,
    CompleteOrderModalComponent,
    ProductionSaleLinesComponent,
  ],
  templateUrl: './order-detail-page.component.html',
})
export class OrderDetailPageComponent implements OnInit {
  private readonly ordersService = inject(ManufacturingOrdersService);
  private readonly settingsService = inject(ManufacturingSettingsService);
  private readonly productionOrdersService = inject(ProductionOrdersService);
  private readonly toastService = inject(ToastService);
  private readonly dialogService = inject(DialogService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly sse = inject(ProductionSseService);
  private readonly auth = inject(AuthFacade);

  /** Id of the order on screen; SSE events and silent reloads follow it. */
  private currentId: number | null = null;
  /** Loads of the order itself: a newer request cancels the one in flight (S27). */
  private readonly orderRequests = new Subject<{ id: number; silent: boolean }>();
  private shortagesSub: Subscription | null = null;
  private saleDetailSub: Subscription | null = null;

  readonly order = signal<ManufacturingOrder | null>(null);
  readonly shortages = signal<ManufacturingShortage[]>([]);
  readonly isLoading = signal(false);
  readonly isBusy = signal(false);
  readonly lotRequired = signal(false);
  readonly completeModalOpen = signal(false);
  /** Same production order read through the shared detail: sale link, lines and add-ons (T13). */
  readonly saleDetail = signal<Pick<ProductionOrder, 'sale_order' | 'order_lines'> | null>(null);

  readonly lines = computed<ManufacturingOrderLine[]>(() => this.order()?.lines ?? []);
  readonly hasShortages = computed(() => this.shortages().some((s) => s.missing > 0));
  readonly showShortages = computed(() => {
    const status = this.order()?.status;
    return (
      status === 'draft' ||
      status === 'released' ||
      status === 'in_progress' ||
      status === 'partially_completed'
    );
  });

  readonly headerActions = computed<StickyHeaderActionButton[]>(() => {
    const status = this.order()?.status;
    const busy = this.isBusy();
    const editable = status === 'draft' || status === 'released';
    const cancellable =
      status === 'draft' || status === 'released' || status === 'in_progress';
    return [
      {
        id: 'edit',
        label: 'Editar',
        icon: 'edit',
        variant: 'outline',
        visible: editable,
        disabled: busy,
      },
      {
        id: 'release',
        label: 'Lanzar',
        icon: 'send',
        variant: 'primary',
        visible: status === 'draft',
        disabled: busy,
      },
      {
        id: 'start',
        label: 'Iniciar',
        icon: 'play',
        variant: 'primary',
        visible: status === 'released',
        disabled: busy,
      },
      {
        id: 'complete',
        label: status === 'partially_completed' ? 'Completar el resto' : 'Completar',
        icon: 'check',
        variant: 'primary',
        visible: status === 'in_progress' || status === 'partially_completed',
        disabled: busy,
      },
      {
        id: 'restart',
        label: 'Volver a iniciar',
        icon: 'rotate-ccw',
        variant: 'primary',
        // The backend decides: cancelled order, active sale, live production line.
        visible: status === 'cancelled' && this.order()?.can_restart === true,
        disabled: busy,
      },
      {
        id: 'cancel',
        label: 'Cancelar orden',
        icon: 'x',
        variant: 'outline-danger',
        visible: cancellable,
        disabled: busy,
      },
    ];
  });

  ngOnInit(): void {
    this.orderRequests
      .pipe(
        // A new request (another `:id`, or a reload) drops the previous one,
        // so a slow older response never overwrites the current order.
        switchMap(({ id, silent }) =>
          this.ordersService.getById(id).pipe(
            tap((order) => {
              this.order.set(order);
              this.isLoading.set(false);
              this.loadShortages(order);
              this.loadSaleDetail(order);
            }),
            catchError((error) => {
              this.isLoading.set(false);
              if (silent) return EMPTY;
              this.toastService.error(
                typeof error === 'string' ? error : 'No se pudo cargar la orden',
              );
              this.router.navigate([LIST_ROUTE]);
              return EMPTY;
            }),
          ),
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe();

    // The same instance can be reused with another `:id`: follow the param, not the snapshot.
    this.route.paramMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      const id = Number(params.get('id'));
      if (!Number.isFinite(id) || id < 1) {
        this.router.navigate([LIST_ROUTE]);
        return;
      }
      if (this.currentId !== id) {
        this.currentId = id;
        this.order.set(null);
        this.shortages.set([]);
        this.saleDetail.set(null);
        this.shortagesSub?.unsubscribe();
        this.saleDetailSub?.unsubscribe();
      }
      this.loadOrder(id);
    });

    // Only events of this order reload it, silently and never navigating away.
    this.sse.listen(
      this.destroyRef,
      () => {
        const id = this.currentId;
        if (id != null && !this.isBusy()) this.loadOrder(id, true);
      },
      (event) => event.id === this.currentId,
      'manufacturing',
    );
    this.settingsService
      .get()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (s) => this.lotRequired.set(!!s.lot_required),
        error: () => this.lotRequired.set(false),
      });
  }

  loadOrder(id?: number, silent = false): void {
    const orderId = id ?? this.order()?.id;
    if (orderId == null) return;
    if (!silent) this.isLoading.set(true);
    this.orderRequests.next({ id: orderId, silent });
  }

  /** Only orders born from a sale have the "Pedido de venta" section. */
  private loadSaleDetail(order: ManufacturingOrder): void {
    this.saleDetailSub?.unsubscribe();
    if (order.order_id == null) {
      this.saleDetail.set(null);
      return;
    }
    if (!this.auth.isRestaurant()) {
      // Planta-only store: the restaurant endpoint (`store/production-orders/:id`)
      // fails its industry guard. The manufacturing order already carries the
      // sale link; the lines and add-ons need a manufacturing detail endpoint.
      this.saleDetail.set({
        sale_order: order.sale_order
          ? { ...order.sale_order, customer_name: null, due_at: null }
          : null,
        order_lines: [],
      });
      return;
    }
    this.saleDetailSub = this.productionOrdersService
      .getById(order.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (detail) => this.saleDetail.set(detail),
        // Optional context: Planta users may lack production_orders:read.
        error: () => this.saleDetail.set(null),
      });
  }

  private loadShortages(order: ManufacturingOrder): void {
    this.shortagesSub?.unsubscribe();
    if (
      order.status === 'completed' ||
      order.status === 'cancelled'
    ) {
      this.shortages.set([]);
      return;
    }
    this.shortagesSub = this.ordersService
      .getShortages(order.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (rows) => this.shortages.set(rows),
        error: () => this.shortages.set([]),
      });
  }

  onHeaderAction(actionId: string): void {
    const order = this.order();
    if (!order || this.isBusy()) return;
    switch (actionId) {
      case 'edit':
        this.router.navigate([LIST_ROUTE, order.id, 'edit']);
        break;
      case 'release':
        this.confirmTransition(order, 'release');
        break;
      case 'start':
        this.confirmTransition(order, 'start');
        break;
      case 'complete':
        this.completeModalOpen.set(true);
        break;
      case 'restart':
        this.confirmTransition(order, 'restart');
        break;
      case 'cancel':
        this.confirmTransition(order, 'cancel');
        break;
    }
  }

  onCompleted(updated: ManufacturingOrder): void {
    this.loadOrder(updated.id ?? this.order()?.id);
  }

  private async confirmTransition(
    order: ManufacturingOrder,
    action: 'release' | 'start' | 'restart' | 'cancel',
  ): Promise<void> {
    const copy = {
      release: {
        title: 'Lanzar orden',
        message: this.hasShortages()
          ? 'Hay insumos con faltante para esta orden. ¿Lanzarla de todos modos?'
          : '¿Lanzar esta orden a producción?',
        confirmText: 'Lanzar',
        success: 'Orden lanzada',
      },
      start: {
        title: 'Iniciar producción',
        message: '¿Iniciar la producción de esta orden?',
        confirmText: 'Iniciar',
        success: 'Producción iniciada',
      },
      restart: {
        title: 'Volver a iniciar',
        message:
          'La orden volverá a borrador con la cantidad y la entrega vigentes de la venta, lista para lanzarse.',
        confirmText: 'Volver a iniciar',
        success: 'Orden reiniciada',
      },
      cancel: {
        title: 'Cancelar orden',
        message: `¿Cancelar la orden ${order.order_number ?? `#${order.id}`}? Esta acción no se puede deshacer.`,
        confirmText: 'Cancelar orden',
        success: 'Orden cancelada',
      },
    }[action];

    const ok = await this.dialogService.confirm({
      title: copy.title,
      message: copy.message,
      confirmText: copy.confirmText,
      cancelText: 'Volver',
      confirmVariant: action === 'cancel' ? 'danger' : undefined,
    });
    if (!ok) return;

    this.isBusy.set(true);
    this.ordersService[action](order.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.toastService.success(copy.success);
          this.isBusy.set(false);
          this.loadOrder(order.id);
        },
        error: (error) => {
          this.isBusy.set(false);
          this.toastService.error(
            typeof error === 'string' ? error : 'No se pudo cambiar el estado de la orden',
          );
        },
      });
  }

  // ─── Presentación ────────────────────────────────────────────────────────

  statusLabel(status: ManufacturingOrderStatus): string {
    return ORDER_STATUS_LABELS[status] ?? String(status);
  }

  statusVariant(
    status: ManufacturingOrderStatus,
  ): 'success' | 'warning' | 'error' | 'info' | 'neutral' {
    switch (status) {
      case 'completed':
        return 'success';
      case 'in_progress':
      case 'partially_completed':
        return 'warning';
      case 'released':
        return 'info';
      case 'cancelled':
        return 'error';
      default:
        return 'neutral';
    }
  }

  /** S19: "Producto · Variante". */
  displayName(order: ManufacturingOrder): string {
    return ProductionOrdersService.displayName(
      order.product?.name || `Producto #${order.product_id}`,
      order.product_variant?.name,
    );
  }

  priorityLabel(order: ManufacturingOrder): string {
    return order.priority ? ORDER_PRIORITY_LABELS[order.priority] : '—';
  }

  dateLabel(value: string | Date | null | undefined): string {
    return value ? formatDateOnlyUTC(value) : '—';
  }

  num(value: number | string | null | undefined): string {
    if (value == null || value === '') return '—';
    const n = Number(value);
    if (!Number.isFinite(n)) return String(value);
    return Number.isInteger(n) ? n.toString() : n.toFixed(4).replace(/\.?0+$/, '');
  }

  lineName(line: ManufacturingOrderLine): string {
    return (
      line.component_product?.name ??
      line.product_name ??
      `Producto #${line.component_product_id}`
    );
  }

  toNumber(value: number | string | null | undefined): number | null {
    if (value == null || value === '') return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
}
