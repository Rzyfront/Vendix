import { Component, DestroyRef, computed, inject, signal, viewChild } from '@angular/core';
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
  vexiWhenReady,
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
    cancelled_orders: 0,
    refunded_orders: 0,
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

  // Los filtros y la paginación de este módulo viven dentro del hijo
  // `OrdersListComponent`: el host delega en SUS handlers (`onSearchChange`,
  // `onFilterChange`, `onPageChange`, `onSort`) en vez de reimplementarlos.
  private readonly ordersList = viewChild(OrdersListComponent);

  // ── Host de Vexi ────────────────────────────────────────────────────────
  private readonly vexiHostAdapter: VexiUiHost = {
    vexiModuleKey: 'orders',
    readScreen: () => {
      const stats = this.orderStats();
      const paging = this.ordersList()?.vexiPaginationState();

      return {
        module_key: 'orders',
        title: 'Ventas',
        visible_count: this.ordersList()?.orders().length,
        filters: {
          search: this.ordersList()?.searchTerm() || undefined,
        },
        page: paging?.page,
        limit: paging?.limit,
        total: paging?.total,
        total_pages: paging?.total_pages,
        sort: paging?.sort,
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
    setFilter: async (values) => {
      const list = this.ordersList();
      if (!list) {
        return {
          status: 'error' as const,
          message: 'El listado de ventas no está montado en esta pantalla.',
        };
      }

      const applied: string[] = [];
      const ignored: string[] = [];
      let note: string | undefined;

      // `selection` (U-7): "abre la orden 1046" selecciona y navega al
      // detalle por el mismo camino del clic en la fila (`viewOrderDetails`),
      // con el nombre humano que `ui_read_selection` reporta en destino.
      if (typeof values['selection'] === 'string' && values['selection'].trim()) {
        const wanted = values['selection'].trim().toLowerCase();
        const match = list.orders().find((order) => {
          const byId = String(order.id) === wanted.replace(/^orden\s+/, '');
          const byNumber = order.order_number?.toLowerCase().includes(wanted);
          const byAlias = order.customer_alias?.toLowerCase().includes(wanted);
          return byId || byNumber || byAlias;
        });
        if (match) {
          const label = `Orden ${match.order_number}${match.customer_alias ? ` de ${match.customer_alias}` : ''}`;
          this.viewOrderDetails(String(match.id));
          applied.push(`selección "${label}"`);
        } else {
          note = `No encontré "${values['selection']}" entre las ventas cargadas; prueba con el número de orden.`;
          ignored.push('selection');
        }
      }

      if (typeof values['search'] === 'string') {
        // `onSearchChange` resetea a página 1, igual que teclear en el buscador.
        list.onSearchChange(values['search']);
        applied.push(`búsqueda "${values['search']}"`);
      }

      // Filtros nominales del dropdown, en la forma que `onFilterChange` espera.
      const dropdown: Record<string, string | string[] | null> = {};
      for (const key of [
        'status',
        'channel',
        'payment_status',
        'payment_method_id',
        'date_range',
        'table_id',
      ]) {
        const value = values[key];
        if (value === undefined || value === null || value === '') continue;
        dropdown[key] =
          Array.isArray(value) || typeof value === 'string'
            ? (value as string | string[])
            : String(value);
      }
      if (Object.keys(dropdown).length) {
        list.onFilterChange(dropdown);
        applied.push(Object.keys(dropdown).join(', '));
      }

      if (typeof values['sort'] === 'string') {
        const [column, direction] = values['sort'].split(':');
        if (column && (direction === 'asc' || direction === 'desc')) {
          list.onSort({ column, direction });
          applied.push(`orden ${column} ${direction}`);
        } else {
          ignored.push('sort');
        }
      }

      if (values['limit'] !== undefined) {
        // El listado no expone cambio de filas por página: el límite es fijo.
        ignored.push('limit');
      }

      if (values['page'] !== undefined) {
        const totalPages = list.vexiPaginationState().total_pages;
        let page = Math.floor(Number(values['page']));
        if (!Number.isFinite(page)) {
          ignored.push('page');
        } else {
          if (page < 1) page = 1;
          if (page > totalPages) {
            note = `Pediste la página ${page} pero solo hay ${totalPages}; te dejé en la última.`;
            page = totalPages;
          }
          list.onPageChange(page);
          applied.push(`página ${page}`);
        }
      }

      for (const key of Object.keys(values)) {
        if (
          ![
            'search',
            'status',
            'channel',
            'payment_status',
            'payment_method_id',
            'date_range',
            'table_id',
            'sort',
            'limit',
            'page',
            'selection',
          ].includes(key)
        ) {
          ignored.push(key);
        }
      }

      if (!applied.length) {
        return {
          status: 'not_found' as const,
          message:
            'No me pasaste ningún filtro que las ventas entiendan (búsqueda, estado, canal, pago, fecha, mesa, sort, page).',
        };
      }

      return {
        status: 'ok' as const,
        message:
          `Apliqué ${applied.join(', ')} en ventas. La lista se está recargando; si necesitas el conteo, léelo de la pantalla después.` +
          (note ? ` ${note}` : '') +
          (ignored.length
            ? ` No apliqué ${ignored.join(', ')} porque esta lista no lo soporta.`
            : ''),
        detail: note ? { note } : undefined,
      };
    },
    refresh: () => {
      this.refreshOrders();
      return { status: 'ok' as const, message: 'Recargué las ventas y sus totales.' };
    },
    whenReady: () => vexiWhenReady(() => this.ordersList()?.loading() ?? false),
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
    // QUI-886: se preservan los query params del listado (página + filtros)
    // en la URL del detalle para que "Volver" retorne al mismo punto.
    this.router.navigate(['/admin/orders', id], {
      queryParamsHandling: 'preserve',
    });
  }

  // Refresh orders and stats. Bug 2 (Fase K): also tick the list
  // reload trigger so the existing "refresh" action in the toolbar
  // does the right thing without waiting for a route change.
  refreshOrders(): void {
    this.loadOrderStats();
    this.reloadTick.update((n) => n + 1);
  }
}
