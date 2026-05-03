import { Component, OnInit, inject, signal, viewChild, effect, TemplateRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { CardComponent } from '../../../../../../shared/components/card/card.component';
import { StatsComponent } from '../../../../../../shared/components/stats/stats.component';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { TableComponent, TableColumn } from '../../../../../../shared/components/table/table.component';
import { CurrencyPipe } from '../../../../../../shared/pipes/currency/currency.pipe';
import { AnalyticsService, PurchasesBySupplier } from '../../services/analytics.service';

@Component({
  selector: 'vendix-purchases-by-supplier',
  standalone: true,
  imports: [CommonModule, RouterModule, CardComponent, StatsComponent, IconComponent, TableComponent, CurrencyPipe],
  template: `
    <div class="space-y-6 w-full max-w-[1600px] mx-auto py-4" style="display:block;width:100%">
      <!-- Stats Cards -->
      <div class="stats-container sticky top-0 z-20 bg-background md:static md:bg-transparent">
        <app-stats
          title="Proveedores"
          [value]="data().length"
          smallText=" proveedores"
          iconName="truck"
          iconBgColor="bg-blue-100"
          iconColor="text-blue-600"
        ></app-stats>

        <app-stats
          title="Total Ordenes"
          [value]="getTotalOrders()"
          iconName="file-text"
          iconBgColor="bg-purple-100"
          iconColor="text-purple-600"
        ></app-stats>

        <app-stats
          title="Total Gastado"
          [value]="getTotalSpent()"
          iconName="dollar-sign"
          iconBgColor="bg-green-100"
          iconColor="text-green-600"
        ></app-stats>

        <app-stats
          title="Proveedor Top"
          [value]="getTopSupplier()"
          iconName="trophy"
          iconBgColor="bg-amber-100"
          iconColor="text-amber-600"
        ></app-stats>
      </div>

      <div class="flex items-center gap-2 text-sm text-text-secondary mb-1">
        <a routerLink="/admin/analytics" class="hover:text-primary">Analíticas</a>
        <app-icon name="chevron-right" [size]="14"></app-icon>
        <span>Compras</span>
      </div>
      <h1 class="text-xl font-bold text-text-primary">Compras por Proveedor</h1>

      @if (loading()) {
        <app-card shadow="none" [responsivePadding]="true" customClasses="text-center py-8">
          <app-icon name="loader-2" [size]="32" class="animate-spin text-text-tertiary mx-auto"></app-icon>
          <span class="text-sm text-text-secondary mt-2 block">Cargando...</span>
        </app-card>
      } @else if (data().length > 0) {
        <app-card shadow="none" [responsivePadding]="true">
          <app-table [data]="data()" [columns]="tableColumns" [loading]="loading()">
          </app-table>
        </app-card>
      } @else {
        <app-card shadow="none" [responsivePadding]="true" customClasses="text-center py-8">
          <app-icon name="truck" [size]="48" class="text-text-tertiary mx-auto mb-4"></app-icon>
          <span class="text-sm font-bold text-[var(--color-text-text-primary)]">No hay datos</span>
          <span class="text-xs text-[var(--color-text-secondary)] block mt-1">No hay órdenes de compra en el período seleccionado.</span>
        </app-card>
      }
    </div>

    <ng-template #supplierCell let-row>
      <div class="flex items-center gap-2">
        <app-icon name="truck" [size]="16" class="text-text-tertiary"></app-icon>
        <span class="font-medium">{{ row.supplier_name }}</span>
      </div>
    </ng-template>

    <ng-template #orderCountCell let-row>
      <span class="badge bg-blue-100 text-blue-800 px-2 py-1 rounded text-xs">{{ row.order_count }} órdenes</span>
    </ng-template>

    <ng-template #totalSpentCell let-row>
      <span class="font-semibold text-text-primary">{{ row.total_spent | currency }}</span>
    </ng-template>

    <ng-template #pendingOrdersCell let-row>
      @if (row.pending_orders > 0) {
        <span class="badge bg-yellow-100 text-yellow-800 px-2 py-1 rounded text-xs">{{ row.pending_orders }} pendientes</span>
      } @else {
        <span class="badge bg-green-100 text-green-800 px-2 py-1 rounded text-xs">Sin pendientes</span>
      }
    </ng-template>

    <ng-template #lastOrderDateCell let-row>
      @if (row.last_order_date) {
        {{ row.last_order_date | date:'shortDate' }}
      } @else {
        <span class="text-text-tertiary">Sin órdenes</span>
      }
    </ng-template>
  `,
})
export class PurchasesBySupplierComponent implements OnInit {
  private analyticsService = inject(AnalyticsService);

  readonly supplierTemplate = viewChild<TemplateRef<any>>('supplierCell');
  readonly orderCountTemplate = viewChild<TemplateRef<any>>('orderCountCell');
  readonly totalSpentTemplate = viewChild<TemplateRef<any>>('totalSpentCell');
  readonly pendingOrdersTemplate = viewChild<TemplateRef<any>>('pendingOrdersCell');
  readonly lastOrderDateTemplate = viewChild<TemplateRef<any>>('lastOrderDateCell');

  loading = signal(true);
  data = signal<PurchasesBySupplier[]>([]);
  tableColumns: TableColumn[] = [
    { key: 'supplier_name', label: 'Proveedor' },
    { key: 'order_count', label: 'Órdenes' },
    { key: 'total_spent', label: 'Total Gastado' },
    { key: 'pending_orders', label: 'Estado' },
    { key: 'last_order_date', label: 'Última Orden' },
  ];

  constructor() {
    effect(() => {
      const supplierTpl = this.supplierTemplate();
      const orderCountTpl = this.orderCountTemplate();
      const totalSpentTpl = this.totalSpentTemplate();
      const pendingTpl = this.pendingOrdersTemplate();
      const lastOrderTpl = this.lastOrderDateTemplate();

      this.tableColumns = this.tableColumns.map(col => {
        if (col.key === 'supplier_name' && supplierTpl) {
          return { ...col, template: supplierTpl };
        }
        if (col.key === 'order_count' && orderCountTpl) {
          return { ...col, template: orderCountTpl };
        }
        if (col.key === 'total_spent' && totalSpentTpl) {
          return { ...col, template: totalSpentTpl };
        }
        if (col.key === 'pending_orders' && pendingTpl) {
          return { ...col, template: pendingTpl };
        }
        if (col.key === 'last_order_date' && lastOrderTpl) {
          return { ...col, template: lastOrderTpl };
        }
        return col;
      });
    });
  }

  ngOnInit(): void {
    this.analyticsService.getPurchasesBySupplier({}).subscribe({
      next: (response) => {
        const responseData = response?.data;
        if (Array.isArray(responseData)) {
          this.data.set(responseData);
        } else if (responseData && (responseData as any).data) {
          this.data.set((responseData as any).data);
        }
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
      }
    });
  }

  getTotalOrders(): number {
    return this.data().reduce((sum, s) => sum + (s.order_count || 0), 0);
  }

  getTotalSpent(): string {
    const total = this.data().reduce((sum, s) => sum + (s.total_spent || 0), 0);
    return '$' + total.toLocaleString('es-CO', { maximumFractionDigits: 0 });
  }

  getTopSupplier(): string {
    if (!this.data().length) return '-';
    const top = [...this.data()].sort((a, b) => b.total_spent - a.total_spent)[0];
    return top?.supplier_name?.substring(0, 15) || '-';
  }
}