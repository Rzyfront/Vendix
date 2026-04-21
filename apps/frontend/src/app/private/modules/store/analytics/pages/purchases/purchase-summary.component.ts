import { Component, OnInit, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { CardComponent } from '../../../../../../shared/components/card/card.component';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { StatsComponent } from '../../../../../../shared/components/stats/stats.component';
import { ChartComponent } from '../../../../../../shared/components/chart/chart.component';
import { CurrencyPipe } from '../../../../../../shared/pipes/currency/currency.pipe';
import { AnalyticsService, PurchasesSummary } from '../../services/analytics.service';
import { toSignal } from '@angular/core/rxjs-interop';

@Component({
  selector: 'vendix-purchase-summary',
  standalone: true,
  imports: [CommonModule, RouterModule, CardComponent, IconComponent, StatsComponent, ChartComponent, CurrencyPipe],
  template: `
    <div class="space-y-6 w-full max-w-[1600px] mx-auto py-4">
      <div class="flex items-center gap-2 text-sm text-text-secondary mb-1">
        <a routerLink="/admin/analytics" class="hover:text-primary">Analíticas</a>
        <app-icon name="chevron-right" [size]="14"></app-icon>
        <span>Compras</span>
      </div>
      <h1 class="text-2xl font-bold text-text-primary">Resumen de Compras</h1>

      @if (loading()) {
        <app-card shadow="none" [responsivePadding]="true" customClasses="text-center py-8">
          <app-icon name="loader-2" [size]="32" class="animate-spin text-text-tertiary mx-auto"></app-icon>
          <span class="text-sm text-text-secondary mt-2 block">Cargando...</span>
        </app-card>
      } @else if (summary()?.data) {
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <app-card shadow="none" [responsivePadding]="true">
            <app-icon name="shopping-cart" [size]="24" class="text-primary mb-2"></app-icon>
            <div class="text-xs text-text-secondary uppercase tracking-wide">Total Órdenes</div>
            <div class="text-2xl font-bold text-text-primary">{{ summary()?.data?.total_orders | number }}</div>
          </app-card>

          <app-card shadow="none" [responsivePadding]="true">
            <app-icon name="dollar-sign" [size]="24" class="text-green-500 mb-2"></app-icon>
            <div class="text-xs text-text-secondary uppercase tracking-wide">Total Gastado</div>
            <div class="text-2xl font-bold text-text-primary">{{ summary()?.data?.total_spent | currency }}</div>
          </app-card>

          <app-card shadow="none" [responsivePadding]="true">
            <app-icon name="clock" [size]="24" class="text-yellow-500 mb-2"></app-icon>
            <div class="text-xs text-text-secondary uppercase tracking-wide">Pendientes</div>
            <div class="text-2xl font-bold text-text-primary">{{ summary()?.data?.pending_orders | number }}</div>
          </app-card>

          <app-card shadow="none" [responsivePadding]="true">
            <app-icon name="check-circle" [size]="24" class="text-green-600 mb-2"></app-icon>
            <div class="text-xs text-text-secondary uppercase tracking-wide">Completadas</div>
            <div class="text-2xl font-bold text-text-primary">{{ summary()?.data?.completed_orders | number }}</div>
          </app-card>

          <app-card shadow="none" [responsivePadding]="true">
            <app-icon name="package" [size]="24" class="text-blue-500 mb-2"></app-icon>
            <div class="text-xs text-text-secondary uppercase tracking-wide">Items Ordenados</div>
            <div class="text-2xl font-bold text-text-primary">{{ summary()?.data?.total_items_ordered | number }}</div>
          </app-card>

          <app-card shadow="none" [responsivePadding]="true">
            <app-icon name="package-check" [size]="24" class="text-emerald-500 mb-2"></app-icon>
            <div class="text-xs text-text-secondary uppercase tracking-wide">Items Recibidos</div>
            <div class="text-2xl font-bold text-text-primary">{{ summary()?.data?.total_items_received | number }}</div>
          </app-card>

          <app-card shadow="none" [responsivePadding]="true">
            <app-icon name="percent" [size]="24" class="text-purple-500 mb-2"></app-icon>
            <div class="text-xs text-text-secondary uppercase tracking-wide">Impuestos</div>
            <div class="text-2xl font-bold text-text-primary">{{ summary()?.data?.total_tax_amount | currency }}</div>
          </app-card>

          <app-card shadow="none" [responsivePadding]="true">
            <app-icon name="calculator" [size]="24" class="text-indigo-500 mb-2"></app-icon>
            <div class="text-xs text-text-secondary uppercase tracking-wide">Valor Promedio</div>
            <div class="text-2xl font-bold text-text-primary">{{ summary()?.data?.average_order_value | currency }}</div>
          </app-card>
        </div>
      } @else {
        <app-card shadow="none" [responsivePadding]="true" customClasses="text-center py-8">
          <app-icon name="shopping-cart" [size]="48" class="text-text-tertiary mx-auto mb-4"></app-icon>
          <span class="text-sm font-bold text-[var(--color-text-primary)]">No hay datos</span>
          <span class="text-xs text-[var(--color-text-secondary)] block mt-1">No hay órdenes de compra en el período seleccionado.</span>
        </app-card>
      }
    </div>
  `,
})
export class PurchaseSummaryComponent implements OnInit {
  private analyticsService = inject(AnalyticsService);

  private summarySignal = signal<PurchasesSummary | null>(null);
  loading = signal(true);
  summary = toSignal(this.analyticsService.getPurchasesSummary({}), { initialValue: null });

  ngOnInit(): void {
    this.analyticsService.getPurchasesSummary({}).subscribe({
      next: (response) => {
        if (response?.data) {
          this.summarySignal.set(response);
        }
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
      }
    });
  }
}