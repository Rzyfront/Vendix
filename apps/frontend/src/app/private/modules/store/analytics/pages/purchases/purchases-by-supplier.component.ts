import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { CardComponent } from '../../../../../../shared/components/card/card.component';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { TableComponent } from '../../../../../../shared/components/table/table.component';
import { CurrencyPipe } from '../../../../../../shared/pipes/currency/currency.pipe';
import { AnalyticsService, PurchasesBySupplier } from '../../services/analytics.service';
import { toSignal } from '@angular/core/rxjs-interop';

@Component({
  selector: 'vendix-purchases-by-supplier',
  standalone: true,
  imports: [CommonModule, RouterModule, CardComponent, IconComponent, TableComponent, CurrencyPipe],
  template: `
    <div class="space-y-6 w-full max-w-[1600px] mx-auto py-4">
      <div class="flex items-center gap-2 text-sm text-text-secondary mb-1">
        <a routerLink="/admin/analytics" class="hover:text-primary">Analíticas</a>
        <app-icon name="chevron-right" [size]="14"></app-icon>
        <span>Compras</span>
      </div>
      <h1 class="text-2xl font-bold text-text-primary">Compras por Proveedor</h1>

      @if (loading()) {
        <app-card shadow="none" [responsivePadding]="true" customClasses="text-center py-8">
          <app-icon name="loader-2" [size]="32" class="animate-spin text-text-tertiary mx-auto"></app-icon>
          <span class="text-sm text-text-secondary mt-2 block">Cargando...</span>
        </app-card>
      } @else if (data()?.length) {
        <app-card shadow="none" [responsivePadding]="true">
          <app-table [data]="data()" [columns]="columns" [loading]="loading()">
            <ng-template #cell-supplier_name let-row>
              <div class="flex items-center gap-2">
                <app-icon name="truck" [size]="16" class="text-text-tertiary"></app-icon>
                <span class="font-medium">{{ row.supplier_name }}</span>
              </div>
            </ng-template>
            <ng-template #cell-order_count let-row>
              <span class="badge bg-blue-100 text-blue-800 px-2 py-1 rounded text-xs">{{ row.order_count }} órdenes</span>
            </ng-template>
            <ng-template #cell-total_spent let-row>
              <span class="font-semibold text-text-primary">{{ row.total_spent | currency }}</span>
            </ng-template>
            <ng-template #cell-pending_orders let-row>
              @if (row.pending_orders > 0) {
                <span class="badge bg-yellow-100 text-yellow-800 px-2 py-1 rounded text-xs">{{ row.pending_orders }} pendientes</span>
              } @else {
                <span class="badge bg-green-100 text-green-800 px-2 py-1 rounded text-xs">Sin pendientes</span>
              }
            </ng-template>
            <ng-template #cell-last_order_date let-row>
              @if (row.last_order_date) {
                {{ row.last_order_date | date:'shortDate' }}
              } @else {
                <span class="text-text-tertiary">Sin órdenes</span>
              }
            </ng-template>
          </app-table>
        </app-card>
      } @else {
        <app-card shadow="none" [responsivePadding]="true" customClasses="text-center py-8">
          <app-icon name="truck" [size]="48" class="text-text-tertiary mx-auto mb-4"></app-icon>
          <span class="text-sm font-bold text-[var(--color-text-primary)]">No hay datos</span>
          <span class="text-xs text-[var(--color-text-secondary)] block mt-1">No hay órdenes de compra en el período seleccionado.</span>
        </app-card>
      }
    </div>
  `,
})
export class PurchasesBySupplierComponent implements OnInit {
  private analyticsService = inject(AnalyticsService);

  loading = signal(true);
  data = toSignal(this.analyticsService.getPurchasesBySupplier({}), { initialValue: [] as PurchasesBySupplier[] });

  columns = [
    { key: 'supplier_name', label: 'Proveedor' },
    { key: 'order_count', label: 'Órdenes' },
    { key: 'total_spent', label: 'Total Gastado' },
    { key: 'pending_orders', label: 'Estado' },
    { key: 'last_order_date', label: 'Última Orden' },
  ];

  ngOnInit(): void {
    this.analyticsService.getPurchasesBySupplier({}).subscribe({
      next: (response) => {
        if (Array.isArray(response?.data)) {
          this.data.set(response.data);
        } else if (response?.data?.data) {
          this.data.set(response.data.data);
        }
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
      }
    });
  }
}