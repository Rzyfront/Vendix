import { Component, DestroyRef, ViewChild, inject, signal } from '@angular/core';
import { Router } from '@angular/router';

// Child Components
import {
  PurchaseOrderStatsComponent,
  PurchaseOrderStats,
  PurchaseOrderListComponent,
} from './components';
import {
  VexiUiHost,
  VexiUiHostRegistry,
} from '../../../../../core/services/vexi-ui-host.registry';

/**
 * STORE_ADMIN — Purchase Orders list shell.
 *
 * The per-order management flow now lives in a dedicated full-page view
 * (`purchase-orders/:id`, StorePurchaseOrderDetailComponent). The list
 * navigates there directly, so this shell no longer opens the legacy
 * `po-detail-modal` (kept in the codebase but no longer routed here).
 */
@Component({
  selector: 'app-purchase-orders',
  standalone: true,
  imports: [PurchaseOrderStatsComponent, PurchaseOrderListComponent],
  templateUrl: './purchase-orders.component.html',
  styleUrls: ['./purchase-orders.component.scss'],
})
export class PurchaseOrdersComponent {
  @ViewChild(PurchaseOrderListComponent) purchaseOrderList!: PurchaseOrderListComponent;

  private router = inject(Router);
  private destroyRef = inject(DestroyRef);
  private vexiHosts = inject(VexiUiHostRegistry);

  // Stats data (updated by child via statsUpdated event)
  readonly stats = signal<PurchaseOrderStats>({
    total: 0,
    pending: 0,
    received: 0,
    total_value: 0,
  });

  // ── Host de Vexi ────────────────────────────────────────────────────────
  //
  // Este es el módulo del caso guía: cuando alguien pide "quiero hacer una orden
  // de compra", Vexi puede ofrecer las dos vías reales — traerlo acá (`ir_a_pop`)
  // o hacerlo ella con la factura adjunta. `escanear_factura` lleva al POP, que
  // es donde vive el escáner nativo; el chat no lo replica.
  private readonly vexiHostAdapter: VexiUiHost = {
    vexiModuleKey: 'purchase-orders',
    readScreen: () => {
      const stats = this.stats();

      return {
        module_key: 'purchase-orders',
        title: 'Órdenes de compra',
        notes:
          `${stats.total} orden(es) de compra, ${stats.pending} pendiente(s), ` +
          `${stats.received} recibida(s).`,
      };
    },
    listActions: () => [
      { id: 'ir_a_pop', label: 'Ir al POP para crear una orden de compra' },
      {
        id: 'escanear_factura',
        label: 'Ir al POP y abrir el escáner de factura de proveedor',
      },
    ],
    runAction: async (id) => {
      switch (id) {
        case 'ir_a_pop':
          this.createOrder();
          return {
            status: 'ok' as const,
            message: 'Te llevé al POP para armar la orden de compra.',
          };
        case 'escanear_factura':
          // El escáner vive dentro del POP (`pop.component.ts`), así que se
          // navega con la intención en la URL y ese módulo la abre.
          this.router.navigate(['/admin/inventory/pop'], {
            queryParams: { scan: 'invoice' },
          });
          return {
            status: 'needs_user_input' as const,
            message:
              'Te llevé al POP con el escáner de factura. Si prefieres, pasame la factura por el chat y la proceso yo.',
          };
        default:
          return {
            status: 'not_found' as const,
            message: `La pantalla de Órdenes de compra no tiene una acción "${id}".`,
          };
      }
    },
    refresh: () => {
      this.onOrderUpdated();
      return {
        status: 'ok' as const,
        message: 'Recargué las órdenes de compra.',
      };
    },
  };

  constructor() {
    this.vexiHosts.register(this.vexiHostAdapter);
    this.destroyRef.onDestroy(() => this.vexiHosts.unregister(this.vexiHostAdapter));
  }

  // Navigate to POP for new order
  createOrder(): void {
    this.router.navigate(['/admin/inventory/pop']);
  }

  // Handle stats update from child component
  onStatsUpdated(stats: PurchaseOrderStats): void {
    this.stats.set(stats);
  }

  // Reload the list (empty-state refresh action)
  onOrderUpdated(): void {
    this.purchaseOrderList?.loadOrders();
  }
}
