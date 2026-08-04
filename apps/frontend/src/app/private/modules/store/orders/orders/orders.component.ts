import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

// Import components
import { OrdersListComponent } from '../components/orders-list';
import { OrderStatsComponent } from '../components/order-stats';

// Import interfaces and services
import { ExtendedOrderStats } from '../interfaces/order.interface';
import { StoreOrdersService } from '../services/store-orders.service';
import { AuthFacade } from '../../../../../core/store/auth/auth.facade';
import {
  VexiUiHost,
  VexiUiHostRegistry,
} from '../../../../../core/services/vexi-ui-host.registry';

@Component({
  selector: 'app-orders',
  standalone: true,
  imports: [OrdersListComponent, OrderStatsComponent],
  templateUrl: './orders.component.html',
  styleUrls: ['./orders.component.css'],
})
export class OrdersComponent {
  private router = inject(Router);
  private ordersService = inject(StoreOrdersService);
  private destroyRef = inject(DestroyRef);
  private authFacade = inject(AuthFacade);
  private vexiHosts = inject(VexiUiHostRegistry);

  /**
   * QUI-599: gate del item "Operaciones masivas" del dropdown del listado —
   * la ÚNICA puerta de entrada a /admin/orders/bulk (no hay entrada en el
   * sidebar). Mismo patrón que `canBulkEditProducts` en
   * `products.component.ts:168-170`: el permiso se lee en el componente de
   * página y baja como `input` al listado presentacional.
   *
   * Se admite CUALQUIERA de los dos permisos porque la vista ofrece dos
   * carriles independientes: quien solo tenga `bulk_print` debe poder entrar
   * a imprimir en lote aunque no pueda transicionar estados. Adentro, cada
   * acción se gatea por su propio permiso.
   */
  readonly canBulkOrderOperations = computed<boolean>(
    () =>
      this.authFacade.hasPermission('store:orders:bulk_update') ||
      this.authFacade.hasPermission('store:orders:bulk_print'),
  );

  // Stats data
  orderStats = signal<ExtendedOrderStats>({
    total_orders: 0,
    total_revenue: 0,
    pending_orders: 0,
    completed_orders: 0,
    average_order_value: 0,
    ordersGrowthRate: 0,
    pendingGrowthRate: 0,
    completedGrowthRate: 0,
    revenueGrowthRate: 0,
  });

  /**
   * Bug 2 (Fase K): tick counter that increments every time the user
   * re-enters `/admin/orders/sales` (or the orders host route). The
   * list component watches it via an effect and re-fetches the orders
   * so the POS-created order shows up without a manual refresh.
   */
  reloadTick = signal(0);

  // ── Host de Vexi ────────────────────────────────────────────────────────
  //
  // Deliberadamente NO declara `setFilter`: los filtros de este módulo viven
  // dentro de `OrdersListComponent`, no acá. Declararlos y no aplicarlos haría
  // que Vexi dijera "ya filtré" sobre una lista intacta, que es exactamente el
  // defecto de honestidad que el registro de hosts viene a cerrar.
  private readonly vexiHostAdapter: VexiUiHost = {
    vexiModuleKey: 'orders',
    readScreen: () => {
      const stats = this.orderStats();

      return {
        module_key: 'orders',
        title: 'Ventas',
        notes:
          `${stats.total_orders} orden(es) en total, ${stats.pending_orders} pendiente(s), ` +
          `${stats.completed_orders} completada(s).`,
      };
    },
    listActions: () => {
      const actions = [
        { id: 'nueva_venta', label: 'Ir al POS para registrar una venta' },
      ];

      if (this.canBulkOrderOperations()) {
        actions.push({
          id: 'operaciones_masivas',
          label: 'Abrir las operaciones masivas de órdenes',
        });
      }

      return actions;
    },
    runAction: async (id) => {
      switch (id) {
        case 'nueva_venta':
          this.createNewOrder();
          return {
            status: 'ok' as const,
            message: 'Te llevé al POS para registrar la venta.',
          };
        case 'operaciones_masivas':
          // El gate de permiso se repite acá: `listActions` solo oculta la
          // afordancia, y el modelo puede pedir un id que no listamos.
          if (!this.canBulkOrderOperations()) {
            return {
              status: 'error' as const,
              message: 'Esta cuenta no tiene permiso para operaciones masivas de órdenes.',
            };
          }
          this.router.navigate(['/admin/orders/bulk']);
          return {
            status: 'ok' as const,
            message: 'Te llevé a las operaciones masivas de órdenes.',
          };
        default:
          return {
            status: 'not_found' as const,
            message: `La pantalla de Ventas no tiene una acción "${id}".`,
          };
      }
    },
    refresh: () => {
      this.refreshOrders();
      return { status: 'ok' as const, message: 'Recargué las ventas y sus totales.' };
    },
  };

  constructor() {
    this.vexiHosts.register(this.vexiHostAdapter);
    this.destroyRef.onDestroy(() => this.vexiHosts.unregister(this.vexiHostAdapter));

    this.loadOrderStats();
    this.router.events
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((evt) => {
        if (evt instanceof NavigationEnd) {
          // Re-entering the orders host route (after a POS sale) should
          // re-fetch. Avoid firing on child navigations that don't
          // remount the list (e.g. order detail back-and-forth).
          if (evt.urlAfterRedirects.startsWith('/admin/orders') &&
              !evt.urlAfterRedirects.match(/^\/admin\/orders\/[^/]+/)) {
            this.reloadTick.update((n) => n + 1);
            this.loadOrderStats();
          }
        }
      });
  }

  loadOrderStats(): void {
    this.ordersService
      .getOrderStats()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response: any) => {
          const stats = response.data || response;
          this.orderStats.set({
            ...stats,
            ordersGrowthRate: 5.2, // Mock data - should come from backend
            pendingGrowthRate: -2.1,
            completedGrowthRate: 8.7,
            revenueGrowthRate: 12.3,
          });
        },
        error: (err: any) => {
          console.error('Error loading order stats:', err);
        },
      });
  }

  // Navigate to POS for new order
  createNewOrder(): void {
    this.router.navigate(['/admin/pos']);
  }

  // Navigate to order details page
  viewOrderDetails(orderId: string | Event): void {
    // Handle Event case (when called from template)
    const id = typeof orderId === 'string' ? orderId : (orderId as any);
    this.router.navigate(['/admin/orders', id]);
  }

  // Refresh orders and stats. Bug 2 (Fase K): also tick the list
  // reload trigger so the existing "refresh" action in the toolbar
  // does the right thing without waiting for a route change.
  refreshOrders(): void {
    this.loadOrderStats();
    this.reloadTick.update((n) => n + 1);
  }
}
