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
  ],
  templateUrl: './order-detail-page.component.html',
})
export class OrderDetailPageComponent implements OnInit {
  private readonly ordersService = inject(ManufacturingOrdersService);
  private readonly settingsService = inject(ManufacturingSettingsService);
  private readonly toastService = inject(ToastService);
  private readonly dialogService = inject(DialogService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  readonly order = signal<ManufacturingOrder | null>(null);
  readonly shortages = signal<ManufacturingShortage[]>([]);
  readonly isLoading = signal(false);
  readonly isBusy = signal(false);
  readonly lotRequired = signal(false);
  readonly completeModalOpen = signal(false);

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
    const id = Number(this.route.snapshot.paramMap.get('id'));
    if (!Number.isFinite(id) || id < 1) {
      this.router.navigate([LIST_ROUTE]);
      return;
    }
    this.loadOrder(id);
    this.settingsService
      .get()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (s) => this.lotRequired.set(!!s.lot_required),
        error: () => this.lotRequired.set(false),
      });
  }

  loadOrder(id?: number): void {
    const orderId = id ?? this.order()?.id;
    if (orderId == null) return;
    this.isLoading.set(true);
    this.ordersService
      .getById(orderId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (order) => {
          this.order.set(order);
          this.isLoading.set(false);
          this.loadShortages(order);
        },
        error: (error) => {
          this.toastService.error(
            typeof error === 'string' ? error : 'No se pudo cargar la orden',
          );
          this.isLoading.set(false);
          this.router.navigate([LIST_ROUTE]);
        },
      });
  }

  private loadShortages(order: ManufacturingOrder): void {
    if (
      order.status === 'completed' ||
      order.status === 'cancelled'
    ) {
      this.shortages.set([]);
      return;
    }
    this.ordersService
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
    action: 'release' | 'start' | 'cancel',
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
