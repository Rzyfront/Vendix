import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { CardComponent } from '../../../../../../shared/components/card/card.component';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { StatsComponent } from '../../../../../../shared/components/stats/stats.component';
import { ChartComponent } from '../../../../../../shared/components/chart/chart.component';
import { CurrencyPipe } from '../../../../../../shared/pipes/currency/currency.pipe';
import { AnalyticsService, ProfitLossSummary } from '../../services/analytics.service';
import { toSignal } from '@angular/core/rxjs-interop';

@Component({
  selector: 'vendix-profit-loss',
  standalone: true,
  imports: [CommonModule, RouterModule, CardComponent, IconComponent, StatsComponent, ChartComponent, CurrencyPipe],
  template: `
    <div class="space-y-6 w-full max-w-[1600px] mx-auto py-4">
      <div class="flex items-center gap-2 text-sm text-text-secondary mb-1">
        <a routerLink="/admin/analytics" class="hover:text-primary">Analíticas</a>
        <app-icon name="chevron-right" [size]="14"></app-icon>
        <span>Financiero</span>
      </div>
      <h1 class="text-2xl font-bold text-text-primary">Estado de Pérdidas y Ganancias</h1>

      @if (loading()) {
        <app-card shadow="none" [responsivePadding]="true" customClasses="text-center py-8">
          <app-icon name="loader-2" [size]="32" class="animate-spin text-text-tertiary mx-auto"></app-icon>
          <span class="text-sm text-text-secondary mt-2 block">Cargando...</span>
        </app-card>
      } @else if (data()) {
        <div class="space-y-6">
          <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <app-card shadow="none" [responsivePadding]="true">
              <app-icon name="trending-up" [size]="24" class="text-green-500 mb-2"></app-icon>
              <div class="text-xs text-text-secondary uppercase tracking-wide">Ingresos Netos</div>
              <div class="text-2xl font-bold text-text-primary">{{ data()?.net_revenue | currency }}</div>
            </app-card>

            <app-card shadow="none" [responsivePadding]="true">
              <app-icon name="percent" [size]="24" class="text-primary mb-2"></app-icon>
              <div class="text-xs text-text-secondary uppercase tracking-wide">Ganancia Bruta</div>
              <div class="text-2xl font-bold text-text-primary">{{ data()?.gross_profit | currency }}</div>
              <div class="text-xs" [class.text-green-600]="data()?.gross_margin >= 0" [class.text-red-600]="data()?.gross_margin < 0">
                {{ data()?.gross_margin | number:'1.1-1' }}% margen
              </div>
            </app-card>

            <app-card shadow="none" [responsivePadding]="true">
              <app-icon name="arrow-down-circle" [size]="24" class="text-red-500 mb-2"></app-icon>
              <div class="text-xs text-text-secondary uppercase tracking-wide">Reembolsos</div>
              <div class="text-2xl font-bold text-text-primary">{{ data()?.total_refunds | currency }}</div>
            </app-card>

            <app-card shadow="none" [responsivePadding]="true" [customClasses]="getNetProfitClass()">
              <app-icon name="landmark" [size]="24" class="mb-2" [class.text-green-600]="data()?.net_profit >= 0" [class.text-red-600]="data()?.net_profit < 0"></app-icon>
              <div class="text-xs text-text-secondary uppercase tracking-wide">Ganancia Neta</div>
              <div class="text-2xl font-bold">{{ data()?.net_profit | currency }}</div>
              <div class="text-xs" [class.text-green-600]="data()?.net_margin >= 0" [class.text-red-600]="data()?.net_margin < 0">
                {{ data()?.net_margin | number:'1.1-1' }}% margen
              </div>
            </app-card>
          </div>

          <app-card shadow="none" [responsivePadding]="true">
            <h3 class="text-sm font-semibold text-text-primary mb-4">Resumen del Período</h3>
            <div class="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div>
                <span class="text-text-secondary">Ingresos:</span>
                <span class="ml-2 font-medium">{{ data()?.revenue | currency }}</span>
              </div>
              <div>
                <span class="text-text-secondary">COGS:</span>
                <span class="ml-2 font-medium text-red-600">-{{ data()?.cost_of_goods_sold | currency }}</span>
              </div>
              <div>
                <span class="text-text-secondary">Órdenes:</span>
                <span class="ml-2 font-medium">{{ data()?.orders_count | number }}</span>
              </div>
              <div>
                <span class="text-text-secondary">Período:</span>
                <span class="ml-2 font-medium text-xs">{{ getPeriodLabel() }}</span>
              </div>
            </div>
          </app-card>
        </div>
      } @else {
        <app-card shadow="none" [responsivePadding]="true" customClasses="text-center py-8">
          <app-icon name="landmark" [size]="48" class="text-text-tertiary mx-auto mb-4"></app-icon>
          <span class="text-sm font-bold text-[var(--color-text-primary)]">No hay datos</span>
          <span class="text-xs text-[var(--color-text-secondary)] block mt-1">No hay información financiera en el período seleccionado.</span>
        </app-card>
      }
    </div>
  `,
})
export class ProfitLossComponent implements OnInit {
  private analyticsService = inject(AnalyticsService);

  loading = signal(true);
  data = toSignal(this.analyticsService.getProfitLossSummary({}), { initialValue: null });

  ngOnInit(): void {
    this.analyticsService.getProfitLossSummary({}).subscribe({
      next: (response) => {
        if (response?.data) {
          this.data.set(response.data);
        }
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
      }
    });
  }

  getNetProfitClass(): string {
    const profit = this.data()?.net_profit || 0;
    return profit >= 0 ? 'border-l-4 border-green-500' : 'border-l-4 border-red-500';
  }

  getPeriodLabel(): string {
    const data = this.data();
    if (!data?.period) return '';
    const start = new Date(data.period.start_date).toLocaleDateString('es');
    const end = new Date(data.period.end_date).toLocaleDateString('es');
    return `${start} - ${end}`;
  }
}