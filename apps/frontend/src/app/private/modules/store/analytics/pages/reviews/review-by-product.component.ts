import { Component, DestroyRef, OnInit, inject, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { CardComponent } from '../../../../../../shared/components/card/card.component';
import { StatsComponent } from '../../../../../../shared/components/stats/stats.component';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { ReviewsByProductRow, AnalyticsService } from '../../services/analytics.service';
import { AnalyticsCardComponent } from '../../components/analytics-card/analytics-card.component';
import { getViewsByCategory, AnalyticsView } from '../../config/analytics-registry';
import { DateRangeFilter } from '../../interfaces/analytics.interface';
import { getDefaultStartDate, getDefaultEndDate } from '../../../../../../shared/utils/date.util';
import { queryParamsToDateRange } from '../../../shared/utils/date-range-params.util';
import { OptionsDropdownComponent } from '../../../../../../shared/components/options-dropdown/options-dropdown.component';
import {
  FilterConfig,
  FilterValues,
  DropdownAction,
} from '../../../../../../shared/components/options-dropdown/options-dropdown.interfaces';

@Component({
  selector: 'vendix-review-by-product',
  standalone: true,
  imports: [
    CommonModule,
    CardComponent,
    StatsComponent,
    IconComponent,
    AnalyticsCardComponent,
    OptionsDropdownComponent,
  ],
  styles: [
    `
      :host {
        display: block;
        margin: -16px;
        @media (min-width: 768px) { margin: -24px; }
      }
      :host ::ng-deep .stats-container { padding: 0; margin: 0; margin-bottom: 0; }
      :host ::ng-deep .results-header { padding: 0.75rem 1rem; }
    `,
  ],
  template: `
    <div class="space-y-6 w-full max-w-[1600px] mx-auto py-4">
      @if (loading()) {
        <div class="stats-container sticky top-0 z-20 bg-background md:static md:bg-transparent">
          @for (i of [1, 2, 3, 4]; track i) {
            <div class="bg-surface border border-border rounded-xl p-4 animate-pulse">
              <div class="h-4 bg-gray-200 rounded w-1/2 mb-2"></div>
              <div class="h-8 bg-gray-200 rounded w-3/4"></div>
            </div>
          }
        </div>
      } @else {
        <div class="stats-container sticky top-0 z-20 bg-background md:static md:bg-transparent">
          <app-stats
            title="Total Reseñas"
            [value]="totals().total"
            smallText="En el período"
            iconName="message-square"
            iconBgColor="bg-blue-100"
            iconColor="text-blue-600"
          ></app-stats>
          <app-stats
            title="Promedio General"
            [value]="totals().average"
            smallText="Ponderado sobre 5"
            iconName="star"
            iconBgColor="bg-yellow-100"
            iconColor="text-yellow-600"
          ></app-stats>
          <app-stats
            title="Verificadas"
            [value]="totals().verified"
            smallText="Compra verificada"
            iconName="check-circle"
            iconBgColor="bg-emerald-100"
            iconColor="text-emerald-600"
          ></app-stats>
          <app-stats
            title="Pendientes"
            [value]="totals().pending"
            smallText="Por moderar"
            iconName="clock"
            iconBgColor="bg-orange-100"
            iconColor="text-orange-600"
          ></app-stats>
        </div>
      }

      <app-card shadow="none" [padding]="false" overflow="hidden" [showHeader]="true">
        <div slot="header" class="results-header flex items-center justify-between gap-3 flex-wrap">
          <div class="flex items-center gap-2 min-w-0">
            <app-icon name="star" [size]="20" class="shrink-0 text-[var(--color-primary)]"></app-icon>
            <span class="results-header__title text-base md:text-lg font-bold text-[var(--color-text-primary)] leading-tight whitespace-nowrap">Reseñas por Producto</span>
          </div>
          <div class="flex items-end gap-2 flex-wrap shrink-0">
            <app-options-dropdown
              class="shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:shadow-none rounded-[10px]"
              [filters]="filterConfigs"
              [filterValues]="filterValues()"
              [actions]="dropdownActions()"
              [showActions]="true"
              triggerLabel="Acciones"
              triggerIcon="plus"
              [debounceMs]="350"
              [isLoading]="exporting()"
              (filterChange)="onFilterChange($event)"
              (clearAllFilters)="onClearAllFilters()"
              (actionClick)="onActionsDropdownClick($event)"
            ></app-options-dropdown>
          </div>
        </div>
        <div class="p-4 space-y-6">
          @if (loading()) {
            <div class="h-64 flex items-center justify-center">
              <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            </div>
          } @else if (rows().length === 0) {
            <div class="py-12 text-center text-[var(--color-text-secondary)]">
              Sin reseñas en el período seleccionado.
            </div>
          } @else {
            <div class="overflow-x-auto">
              <table class="w-full text-sm">
                <thead>
                  <tr class="text-left text-[var(--color-text-secondary)] border-b border-border">
                    <th class="py-2 pr-4 font-semibold">Producto</th>
                    <th class="py-2 pr-4 font-semibold">SKU</th>
                    <th class="py-2 pr-4 font-semibold text-right">Reseñas</th>
                    <th class="py-2 pr-4 font-semibold text-right">Promedio</th>
                    <th class="py-2 pr-4 font-semibold text-right">5★</th>
                    <th class="py-2 pr-4 font-semibold text-right">4★</th>
                    <th class="py-2 pr-4 font-semibold text-right">3★</th>
                    <th class="py-2 pr-4 font-semibold text-right">2★</th>
                    <th class="py-2 pr-4 font-semibold text-right">1★</th>
                    <th class="py-2 pr-4 font-semibold text-right">Verificadas</th>
                    <th class="py-2 font-semibold text-right">Pendientes</th>
                  </tr>
                </thead>
                <tbody>
                  @for (row of rows(); track row.product_id) {
                    <tr class="border-b border-border last:border-0">
                      <td class="py-2 pr-4 font-medium text-[var(--color-text-primary)]">{{ row.product_name }}</td>
                      <td class="py-2 pr-4 text-[var(--color-text-secondary)]">{{ row.sku }}</td>
                      <td class="py-2 pr-4 text-right">{{ row.total_reviews }}</td>
                      <td class="py-2 pr-4 text-right">{{ row.average_rating }}</td>
                      <td class="py-2 pr-4 text-right">{{ row.stars_5 }}</td>
                      <td class="py-2 pr-4 text-right">{{ row.stars_4 }}</td>
                      <td class="py-2 pr-4 text-right">{{ row.stars_3 }}</td>
                      <td class="py-2 pr-4 text-right">{{ row.stars_2 }}</td>
                      <td class="py-2 pr-4 text-right">{{ row.stars_1 }}</td>
                      <td class="py-2 pr-4 text-right">{{ row.verified_count }}</td>
                      <td class="py-2 text-right">{{ row.pending_count }}</td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          }

          <app-card shadow="none" [responsivePadding]="true" class="md:mt-4">
            <span class="text-sm font-bold text-[var(--color-text-primary)]">Vistas de Reseñas</span>
            <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
              @for (view of reviewsViews; track view.key) {
                <app-analytics-card [view]="view"></app-analytics-card>
              }
            </div>
          </app-card>
        </div>
      </app-card>
    </div>
  `,
})
export class ReviewByProductComponent implements OnInit {
  private destroyRef = inject(DestroyRef);
  private analyticsService = inject(AnalyticsService);
  private readonly route = inject(ActivatedRoute);

  loading = signal(true);
  exporting = signal(false);
  rows = signal<ReviewsByProductRow[]>([]);

  dateRange = signal<DateRangeFilter>({
    start_date: getDefaultStartDate(),
    end_date: getDefaultEndDate(),
    preset: 'thisMonth',
  });

  readonly reviewsViews: AnalyticsView[] = getViewsByCategory('reviews');

  /** Totales sobre la MISMA base (todas las filas): promedio ponderado. */
  readonly totals = computed(() => {
    const rows = this.rows();
    const total = rows.reduce((acc, r) => acc + (Number(r.total_reviews) || 0), 0);
    const weighted = rows.reduce(
      (acc, r) => acc + (Number(r.average_rating) || 0) * (Number(r.total_reviews) || 0),
      0,
    );
    return {
      total,
      average: total > 0 ? Math.round((weighted / total) * 10) / 10 : 0,
      verified: rows.reduce((acc, r) => acc + (Number(r.verified_count) || 0), 0),
      pending: rows.reduce((acc, r) => acc + (Number(r.pending_count) || 0), 0),
    };
  });

  ngOnInit(): void {
    const urlRange = queryParamsToDateRange(this.route.snapshot.queryParamMap);
    if (urlRange) {
      this.dateRange.set(urlRange);
    }
    this.loadData();
  }

  loadData(): void {
    this.loading.set(true);
    this.analyticsService
      .getReviewsByProduct({ date_range: this.dateRange() })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          this.rows.set(response?.data ?? []);
          this.loading.set(false);
        },
        error: () => {
          this.loading.set(false);
        },
      });
  }

  exportReport(): void {
    this.exporting.set(true);
    this.analyticsService
      .exportReviewsByProduct({ date_range: this.dateRange() })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (blob) => {
          const url = window.URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `resenas_por_producto_${this.dateRange().end_date}.xlsx`;
          a.click();
          window.URL.revokeObjectURL(url);
          this.exporting.set(false);
        },
        error: () => {
          this.exporting.set(false);
        },
      });
  }

  readonly dropdownActions = computed<DropdownAction[]>(() => [
    {
      action: 'export-xlsx',
      label: 'Exportar XLSX',
      icon: 'download',
    },
  ]);

  readonly filterConfigs: FilterConfig[] = [
    {
      key: 'date_range',
      label: 'Período',
      type: 'date-range',
    },
  ];

  readonly filterValues = computed<FilterValues>(() => {
    const range = this.dateRange();
    return {
      date_range_start: range.start_date || null,
      date_range_end: range.end_date || null,
      date_range_preset: range.preset || null,
    };
  });

  onActionsDropdownClick(action: string): void {
    if (action === 'export-xlsx') {
      this.exportReport();
    }
  }

  onFilterChange(values: FilterValues): void {
    const start = values['date_range_start'] as string;
    const end = values['date_range_end'] as string;
    const preset = values['date_range_preset'] as string;
    if (start && end) {
      this.dateRange.set({
        start_date: start,
        end_date: end,
        preset: (preset || 'custom') as DateRangeFilter['preset'],
      });
      this.loadData();
    }
  }

  onClearAllFilters(): void {
    this.dateRange.set({
      start_date: getDefaultStartDate(),
      end_date: getDefaultEndDate(),
      preset: 'thisMonth',
    });
    this.loadData();
  }
}
