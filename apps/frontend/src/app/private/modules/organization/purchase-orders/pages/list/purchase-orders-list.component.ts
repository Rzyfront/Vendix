import { Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterModule } from '@angular/router';
import { DatePipe } from '@angular/common';
import {
  CardComponent,
  AlertBannerComponent,
  SpinnerComponent,
  EmptyStateComponent,
  BadgeComponent,
  ButtonComponent,
} from '../../../../../../shared/components/index';
import { CurrencyPipe } from '../../../../../../shared/pipes/currency/currency.pipe';
import {
  OrgPurchaseOrdersService,
  OrgPurchaseOrderRow,
} from '../../services/org-purchase-orders.service';
import { ApiErrorService } from '../../../../../../core/services/api-error.service';

/**
 * ORG_ADMIN — Listado consolidado de órdenes de compra.
 */
@Component({
  selector: 'vendix-org-purchase-orders-list',
  standalone: true,
  imports: [
    RouterModule,
    CardComponent,
    AlertBannerComponent,
    SpinnerComponent,
    EmptyStateComponent,
    BadgeComponent,
    ButtonComponent,
    CurrencyPipe,
    DatePipe,
  ],
  template: `
    <div class="w-full p-2 md:p-4">
      <header
        class="sticky top-0 z-10 bg-background py-2 md:py-4 mb-2 flex items-center justify-between gap-2"
      >
        <div>
          <h1 class="text-lg md:text-2xl font-semibold text-text-primary">Órdenes de Compra</h1>
          <p class="text-xs md:text-sm text-text-secondary mt-1">
            Consolidado de OC en todas las tiendas
          </p>
        </div>
        <app-button variant="primary" size="sm" routerLink="/admin/purchase-orders/create">
          Nueva OC
        </app-button>
      </header>

      @if (errorMessage(); as msg) {
        <app-alert-banner variant="danger" title="No se pudieron cargar las órdenes">
          {{ msg }}
        </app-alert-banner>
      }

      <app-card [padding]="false" customClasses="mt-2">
        @if (loading()) {
          <div class="p-8"><app-spinner [center]="true" text="Cargando..." /></div>
        } @else if (rows().length === 0 && !errorMessage()) {
          <app-empty-state
            icon="shopping-bag"
            title="Sin órdenes de compra"
            description="Aún no se han creado órdenes de compra."
            actionButtonText="Crear OC"
            [showActionButton]="true"
            (actionClick)="goCreate()"
          />
        } @else {
          <div class="overflow-x-auto">
            <table class="w-full text-xs md:text-sm">
              <thead class="bg-background-soft border-b border-border">
                <tr class="text-left text-text-secondary">
                  <th class="px-3 py-2 font-medium">Número</th>
                  <th class="px-3 py-2 font-medium hidden md:table-cell">Fecha</th>
                  <th class="px-3 py-2 font-medium">Proveedor</th>
                  <th class="px-3 py-2 font-medium hidden md:table-cell">Tienda</th>
                  <th class="px-3 py-2 font-medium text-right">Total</th>
                  <th class="px-3 py-2 font-medium">Estado</th>
                  <th class="px-3 py-2 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                @for (row of rows(); track row.id) {
                  <tr class="border-b border-border/40 hover:bg-background-soft/50">
                    <td class="px-3 py-2 font-mono">{{ row.po_number || ('#' + row.id) }}</td>
                    <td class="px-3 py-2 hidden md:table-cell">
                      {{ row.created_at | date: 'short' }}
                    </td>
                    <td class="px-3 py-2">{{ row.supplier_name || '—' }}</td>
                    <td class="px-3 py-2 hidden md:table-cell">{{ row.store_name || '—' }}</td>
                    <td class="px-3 py-2 text-right">{{ asNumber(row.total) | currency }}</td>
                    <td class="px-3 py-2">
                      <app-badge [variant]="statusVariant(row.status)" size="sm">
                        {{ row.status || '—' }}
                      </app-badge>
                    </td>
                    <td class="px-3 py-2">
                      <a
                        [routerLink]="['/admin/purchase-orders', row.id]"
                        class="text-primary hover:underline"
                      >Ver</a>
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
      </app-card>
    </div>
  `,
})
export class OrgPurchaseOrdersListComponent {
  private readonly service = inject(OrgPurchaseOrdersService);
  private readonly errors = inject(ApiErrorService);
  private readonly destroyRef = inject(DestroyRef);

  readonly loading = signal(true);
  readonly rows = signal<OrgPurchaseOrderRow[]>([]);
  readonly errorMessage = signal<string | null>(null);

  constructor() {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.service
      .findAll({ page: 1, limit: 50 })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.rows.set(res?.data ?? []);
          this.loading.set(false);
        },
        error: (err) => {
          console.error('[OrgPurchaseOrdersList] load failed', err);
          this.errorMessage.set(
            this.errors.humanize(err, 'No se pudieron cargar las órdenes de compra.'),
          );
          this.loading.set(false);
        },
      });
  }

  goCreate(): void {
    window.location.href = '/admin/purchase-orders/create';
  }

  asNumber(v: number | string | undefined | null): number {
    if (v === null || v === undefined) return 0;
    return typeof v === 'number' ? v : Number(v) || 0;
  }

  statusVariant(s?: string): 'success' | 'error' | 'info' | 'warning' | 'neutral' {
    switch ((s || '').toLowerCase()) {
      case 'received':
      case 'completed':
      case 'approved':
        return 'success';
      case 'pending':
      case 'draft':
        return 'warning';
      case 'cancelled':
        return 'error';
      case 'in_transit':
      case 'sent':
        return 'info';
      default:
        return 'neutral';
    }
  }
}
