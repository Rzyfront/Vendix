import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { CardComponent } from '../../../../../../shared/components/card/card.component';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { StatsComponent } from '../../../../../../shared/components/stats/stats.component';
import { ChartComponent } from '../../../../../../shared/components/chart/chart.component';
import { AnalyticsService, ReviewsSummary } from '../../services/analytics.service';
import { toSignal } from '@angular/core/rxjs-interop';

@Component({
  selector: 'vendix-review-summary',
  standalone: true,
  imports: [CommonModule, RouterModule, CardComponent, IconComponent, StatsComponent, ChartComponent],
  template: `
    <div class="space-y-6 w-full max-w-[1600px] mx-auto py-4">
      <div class="flex items-center gap-2 text-sm text-text-secondary mb-1">
        <a routerLink="/admin/analytics" class="hover:text-primary">Analíticas</a>
        <app-icon name="chevron-right" [size]="14"></app-icon>
        <span>Reseñas</span>
      </div>
      <h1 class="text-2xl font-bold text-text-primary">Resumen de Reseñas</h1>

      @if (loading()) {
        <app-card shadow="none" [responsivePadding]="true" customClasses="text-center py-8">
          <app-icon name="loader-2" [size]="32" class="animate-spin text-text-tertiary mx-auto"></app-icon>
          <span class="text-sm text-text-secondary mt-2 block">Cargando...</span>
        </app-card>
      } @else if (summary()?.data) {
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <app-card shadow="none" [responsivePadding]="true">
            <app-icon name="message-square" [size]="24" class="text-primary mb-2"></app-icon>
            <div class="text-xs text-text-secondary uppercase tracking-wide">Total Reseñas</div>
            <div class="text-2xl font-bold text-text-primary">{{ summary()?.data?.total_reviews | number }}</div>
          </app-card>

          <app-card shadow="none" [responsivePadding]="true">
            <app-icon name="star" [size]="24" class="text-yellow-500 mb-2"></app-icon>
            <div class="text-xs text-text-secondary uppercase tracking-wide">Rating Promedio</div>
            <div class="text-2xl font-bold text-text-primary flex items-center gap-1">
              {{ summary()?.data?.average_rating | number:'1.1-1' }}
              <app-icon name="star" [size]="16" class="text-yellow-400"></app-icon>
            </div>
          </app-card>

          <app-card shadow="none" [responsivePadding]="true">
            <app-icon name="badge-check" [size]="24" class="text-green-500 mb-2"></app-icon>
            <div class="text-xs text-text-secondary uppercase tracking-wide">Compras Verificadas</div>
            <div class="text-2xl font-bold text-text-primary">{{ summary()?.data?.verified_purchases | number }}</div>
          </app-card>

          <app-card shadow="none" [responsivePadding]="true">
            <app-icon name="thumbs-up" [size]="24" class="text-blue-500 mb-2"></app-icon>
            <div class="text-xs text-text-secondary uppercase tracking-wide">Votos Útiles</div>
            <div class="text-2xl font-bold text-text-primary">{{ summary()?.data?.total_helpful_votes | number }}</div>
          </app-card>

          <app-card shadow="none" [responsivePadding]="true">
            <app-icon name="clock" [size]="24" class="text-yellow-500 mb-2"></app-icon>
            <div class="text-xs text-text-secondary uppercase tracking-wide">Pendientes</div>
            <div class="text-2xl font-bold text-text-primary">{{ summary()?.data?.pending_reviews | number }}</div>
          </app-card>

          <app-card shadow="none" [responsivePadding]="true">
            <app-icon name="check-circle" [size]="24" class="text-green-600 mb-2"></app-icon>
            <div class="text-xs text-text-secondary uppercase tracking-wide">Aprobadas</div>
            <div class="text-2xl font-bold text-text-primary">{{ summary()?.data?.approved_reviews | number }}</div>
          </app-card>

          <app-card shadow="none" [responsivePadding]="true">
            <app-icon name="x-circle" [size]="24" class="text-red-500 mb-2"></app-icon>
            <div class="text-xs text-text-secondary uppercase tracking-wide">Rechazadas</div>
            <div class="text-2xl font-bold text-text-primary">{{ summary()?.data?.rejected_reviews | number }}</div>
          </app-card>
        </div>

        <app-card shadow="none" [responsivePadding]="true">
          <h3 class="text-sm font-semibold text-text-primary mb-4">Distribución de Ratings</h3>
          <div class="space-y-3">
            @for (star of [5,4,3,2,1]; track star) {
              <div class="flex items-center gap-3">
                <span class="text-sm text-text-secondary w-8">{{ star }} ★</span>
                <div class="flex-1 h-4 bg-gray-100 rounded-full overflow-hidden">
                  <div 
                    class="h-full bg-yellow-400 rounded-full transition-all"
                    [style.width.%]="getRatingPercent(star)"
                  ></div>
                </div>
                <span class="text-sm text-text-secondary w-12 text-right">
                  {{ summary()?.data?.rating_distribution?.[star] || 0 }}
                </span>
              </div>
            }
          </div>
        </app-card>
      } @else {
        <app-card shadow="none" [responsivePadding]="true" customClasses="text-center py-8">
          <app-icon name="message-square" [size]="48" class="text-text-tertiary mx-auto mb-4"></app-icon>
          <span class="text-sm font-bold text-[var(--color-text-primary)]">No hay datos</span>
          <span class="text-xs text-[var(--color-text-secondary)] block mt-1">No hay reseñas en el período seleccionado.</span>
        </app-card>
      }
    </div>
  `,
})
export class ReviewSummaryComponent implements OnInit {
  private analyticsService = inject(AnalyticsService);

  loading = signal(true);
  summary = toSignal(this.analyticsService.getReviewsSummary({}), { initialValue: null });

  ngOnInit(): void {
    this.analyticsService.getReviewsSummary({}).subscribe({
      next: (response) => {
        if (response?.data) {
          this.summary.set(response);
        }
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
      }
    });
  }

  getRatingPercent(star: number): number {
    const summaryData = this.summary()?.data;
    if (!summaryData?.total_reviews) return 0;
    const count = summaryData.rating_distribution?.[star] || 0;
    return (count / summaryData.total_reviews) * 100;
  }
}