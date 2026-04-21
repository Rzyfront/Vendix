import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { CardComponent } from '../../../../../../shared/components/card/card.component';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { CurrencyPipe } from '../../../../../../shared/pipes/currency/currency.pipe';
import { AnalyticsService, ProfitLossSummary } from '../../services/analytics.service';
import { toSignal } from '@angular/core/rxjs-interop';

@Component({
  selector: 'vendix-refunds-summary',
  standalone: true,
  imports: [CommonModule, RouterModule, CardComponent, IconComponent, CurrencyPipe],
  template: `
    <div class="space-y-6 w-full max-w-[1600px] mx-auto py-4">
      <div class="flex items-center gap-2 text-sm text-text-secondary mb-1">
        <a routerLink="/admin/analytics" class="hover:text-primary">Analíticas</a>
        <app-icon name="chevron-right" [size]="14"></app-icon>
        <span>Financiero</span>
      </div>
      <h1 class="text-2xl font-bold text-text-primary">Resumen de Reembolsos</h1>

      @if (loading()) {
        <app-card shadow="none" [responsivePadding]="true" customClasses="text-center py-8">
          <app-icon name="loader-2" [size]="32" class="animate-spin text-text-tertiary mx-auto"></app-icon>
          <span class="text-sm text-text-secondary mt-2 block">Cargando...</span>
        </app-card>
      } @else if (data()?.data) {
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <app-card shadow="none" [responsivePadding]="true">
            <app-icon name="rotate-ccw" [size]="24" class="text-red-500 mb-2"></app-icon>
            <div class="text-xs text-text-secondary uppercase tracking-wide">Total Reembolsado</div>
            <div class="text-2xl font-bold text-text-primary">{{ data()?.data?.refunds?.total_refunds | currency }}</div>
          </app-card>

          <app-card shadow="none" [responsivePadding]="true">
            <app-icon name="shopping-bag" [size]="24" class="text-orange-500 mb-2"></app-icon>
            <div class="text-xs text-text-secondary uppercase tracking-wide">Subtotal Reembolsado</div>
            <div class="text-2xl font-bold text-text-primary">{{ data()?.data?.refunds?.subtotal_refunds | currency }}</div>
          </app-card>

          <app-card shadow="none" [responsivePadding]="true">
            <app-icon name="percent" [size]="24" class="text-yellow-500 mb-2"></app-icon>
            <div class="text-xs text-text-secondary uppercase tracking-wide">Impuesto Reembolsado</div>
            <div class="text-2xl font-bold text-text-primary">{{ data()?.data?.refunds?.tax_refunds | currency }}</div>
          </app-card>

          <app-card shadow="none" [responsivePadding]="true">
            <app-icon name="truck" [size]="24" class="text-blue-500 mb-2"></app-icon>
            <div class="text-xs text-text-secondary uppercase tracking-wide">Envío Reembolsado</div>
            <div class="text-2xl font-bold text-text-primary">{{ data()?.data?.refunds?.shipping_refunds | currency }}</div>
          </app-card>
        </div>
      } @else {
        <app-card shadow="none" [responsivePadding]="true" customClasses="text-center py-8">
          <app-icon name="rotate-ccw" [size]="48" class="text-text-tertiary mx-auto mb-4"></app-icon>
          <span class="text-sm font-bold text-[var(--color-text-primary)]">No hay datos</span>
          <span class="text-xs text-[var(--color-text-secondary)] block mt-1">No hay información de reembolsos en el período seleccionado.</span>
        </app-card>
      }
    </div>
  `,
})
export class RefundsSummaryComponent implements OnInit {
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
}