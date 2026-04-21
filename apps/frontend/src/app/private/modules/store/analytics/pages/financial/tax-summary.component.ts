import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { CardComponent } from '../../../../../../shared/components/card/card.component';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { StatsComponent } from '../../../../../../shared/components/stats/stats.component';
import { CurrencyPipe } from '../../../../../../shared/pipes/currency/currency.pipe';
import { AnalyticsService, TaxSummary } from '../../services/analytics.service';
import { toSignal } from '@angular/core/rxjs-interop';

@Component({
  selector: 'vendix-tax-summary',
  standalone: true,
  imports: [CommonModule, RouterModule, CardComponent, IconComponent, StatsComponent, CurrencyPipe],
  template: `
    <div class="space-y-6 w-full max-w-[1600px] mx-auto py-4">
      <div class="flex items-center gap-2 text-sm text-text-secondary mb-1">
        <a routerLink="/admin/analytics" class="hover:text-primary">Analíticas</a>
        <app-icon name="chevron-right" [size]="14"></app-icon>
        <span>Financiero</span>
      </div>
      <h1 class="text-2xl font-bold text-text-primary">Resumen de Impuestos</h1>

      @if (loading()) {
        <app-card shadow="none" [responsivePadding]="true" customClasses="text-center py-8">
          <app-icon name="loader-2" [size]="32" class="animate-spin text-text-tertiary mx-auto"></app-icon>
          <span class="text-sm text-text-secondary mt-2 block">Cargando...</span>
        </app-card>
      } @else if (data()?.data) {
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <app-card shadow="none" [responsivePadding]="true">
            <app-icon name="plus-circle" [size]="24" class="text-green-500 mb-2"></app-icon>
            <div class="text-xs text-text-secondary uppercase tracking-wide">Impuestos Cobrados</div>
            <div class="text-2xl font-bold text-text-primary">{{ data()?.data?.tax_collected | currency }}</div>
          </app-card>

          <app-card shadow="none" [responsivePadding]="true">
            <app-icon name="minus-circle" [size]="24" class="text-red-500 mb-2"></app-icon>
            <div class="text-xs text-text-secondary uppercase tracking-wide">Impuestos Devueltos</div>
            <div class="text-2xl font-bold text-text-primary">{{ data()?.data?.tax_refunded | currency }}</div>
          </app-card>

          <app-card shadow="none" [responsivePadding]="true">
            <app-icon name="calculator" [size]="24" class="text-primary mb-2"></app-icon>
            <div class="text-xs text-text-secondary uppercase tracking-wide">Impuesto Neto</div>
            <div class="text-2xl font-bold text-text-primary">{{ data()?.data?.net_tax | currency }}</div>
          </app-card>

          <app-card shadow="none" [responsivePadding]="true">
            <app-icon name="percent" [size]="24" class="text-purple-500 mb-2"></app-icon>
            <div class="text-xs text-text-secondary uppercase tracking-wide">Tasa Efectiva</div>
            <div class="text-2xl font-bold text-text-primary">{{ data()?.data?.effective_rate | number:'1.2-2' }}%</div>
          </app-card>
        </div>
      } @else {
        <app-card shadow="none" [responsivePadding]="true" customClasses="text-center py-8">
          <app-icon name="receipt" [size]="48" class="text-text-tertiary mx-auto mb-4"></app-icon>
          <span class="text-sm font-bold text-[var(--color-text-primary)]">No hay datos</span>
          <span class="text-xs text-[var(--color-text-secondary)] block mt-1">No hay información de impuestos en el período seleccionado.</span>
        </app-card>
      }
    </div>
  `,
})
export class TaxSummaryComponent implements OnInit {
  private analyticsService = inject(AnalyticsService);

  loading = signal(true);
  data = toSignal(this.analyticsService.getTaxSummary({}), { initialValue: null });

  ngOnInit(): void {
    this.analyticsService.getTaxSummary({}).subscribe({
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
}