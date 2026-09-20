import {
  Component,
  OnInit,
  inject,
  signal,
  computed,
  DestroyRef,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import type { EChartsOption } from 'echarts';

import {
  CardComponent,
  ChartComponent,
  IconComponent,
  PaginationComponent,
  StatsComponent,
} from '../../../../../../shared/components';
import {
  OptionsDropdownComponent,
} from '../../../../../../shared/components/options-dropdown/options-dropdown.component';
import {
  DropdownAction,
} from '../../../../../../shared/components/options-dropdown/options-dropdown.interfaces';
import {
  CurrencyPipe,
  CurrencyFormatService,
} from '../../../../../../shared/pipes/currency/currency.pipe';
import { ToastService } from '../../../../../../shared/components/toast/toast.service';

import { AnalyticsService } from '../../services/analytics.service';
import {
  CustomerReceivableRow,
  CustomerReceivablesSummary,
} from '../../interfaces/customers-analytics.interface';
import { getViewsByCategory, AnalyticsView } from '../../config/analytics-registry';
import { AnalyticsCardComponent } from '../../components/analytics-card/analytics-card.component';

@Component({
  selector: 'vendix-customer-receivables',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    CardComponent,
    ChartComponent,
    IconComponent,
    PaginationComponent,
    StatsComponent,
    OptionsDropdownComponent,
    CurrencyPipe,
    AnalyticsCardComponent,
  ],
  templateUrl: './customer-receivables.component.html',
  styleUrls: ['./customer-receivables.component.scss'],
})
export class CustomerReceivablesComponent implements OnInit {
  private readonly destroyRef = inject(DestroyRef);
  private readonly analyticsService = inject(AnalyticsService);
  private readonly toastService = inject(ToastService);
  private readonly currencyService = inject(CurrencyFormatService);

  readonly summary = signal<CustomerReceivablesSummary | null>(null);
  readonly rows = signal<CustomerReceivableRow[]>([]);
  readonly total = signal<number>(0);
  readonly page = signal<number>(1);
  readonly limit = signal<number>(10);
  readonly loading = signal<boolean>(false);
  readonly exporting = signal<boolean>(false);
  readonly agingChartOptions = signal<EChartsOption>({});

  readonly totalPages = computed(() =>
    Math.max(1, Math.ceil(this.total() / this.limit())),
  );

  readonly totalBalance = computed(() => {
    const s = this.summary();
    if (s) return s.total_balance;
    return this.rows().reduce((acc, row) => acc + (Number(row.balance) || 0), 0);
  });

  readonly totalOriginal = computed(() => {
    const s = this.summary();
    if (s) return s.total_original;
    return this.rows().reduce(
      (acc, row) => acc + (Number(row.original_amount) || 0),
      0,
    );
  });

  readonly totalPaid = computed(() => {
    const s = this.summary();
    if (s) return s.total_paid;
    return this.rows().reduce((acc, row) => acc + (Number(row.paid_amount) || 0), 0);
  });

  readonly pageBalance = computed(() =>
    this.rows().reduce((acc, row) => acc + (Number(row.balance) || 0), 0),
  );

  readonly pageOriginal = computed(() =>
    this.rows().reduce(
      (acc, row) => acc + (Number(row.original_amount) || 0),
      0,
    ),
  );

  readonly pagePaid = computed(() =>
    this.rows().reduce((acc, row) => acc + (Number(row.paid_amount) || 0), 0),
  );

  readonly bucketTotals = computed(() => {
    const s = this.summary();
    if (s?.bucket_totals) return s.bucket_totals;
    const totals: Record<string, number> = {
      '0-30': 0,
      '31-60': 0,
      '61-90': 0,
      '90+': 0,
    };
    for (const r of this.rows()) {
      const b = r.aging_bucket || '0-30';
      totals[b] = (totals[b] || 0) + (Number(r.balance) || 0);
    }
    return totals;
  });

  readonly bucketCounts = computed(() => {
    const s = this.summary();
    if (s?.bucket_counts) return s.bucket_counts;
    const counts: Record<string, number> = {
      '0-30': 0,
      '31-60': 0,
      '61-90': 0,
      '90+': 0,
    };
    for (const r of this.rows()) {
      const b = r.aging_bucket || '0-30';
      counts[b] = (counts[b] || 0) + 1;
    }
    return counts;
  });

  readonly dropdownActions = computed<DropdownAction[]>(() => [
    {
      action: 'export-xlsx',
      label: 'Exportar Excel',
      icon: 'file-text',
    },
  ]);

  readonly customersViews: AnalyticsView[] = getViewsByCategory(
    'customers',
  ).filter((v) => v.key !== 'customers_receivable');

  ngOnInit(): void {
    this.currencyService.loadCurrency();
    this.loadSummary();
    this.loadData();
  }

  loadSummary(): void {
    this.analyticsService
      .getCustomerReceivablesSummary()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res: any) => {
          const sumData = res?.data ?? res;
          if (sumData) {
            this.summary.set(sumData);
            if (
              typeof sumData.total_documents === 'number' &&
              sumData.total_documents > 0
            ) {
              this.total.set(sumData.total_documents);
            }
            this.updateAgingChartFromSummary(sumData);
          }
        },
        error: () => {
          // Fallback a gráfico por página si summary falla
        },
      });
  }

  loadData(): void {
    this.loading.set(true);
    this.analyticsService
      .getCustomerReceivables({
        page: this.page(),
        limit: this.limit(),
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res: any) => {
          const list = Array.isArray(res?.data)
            ? res.data
            : Array.isArray(res?.data?.data)
              ? res.data.data
              : [];
          const totalCount =
            typeof res?.total === 'number'
              ? res.total
              : typeof res?.data?.total === 'number'
                ? res.data.total
                : list.length;

          this.rows.set(list);
          if (!this.summary()) {
            this.total.set(totalCount);
            this.updateAgingChart(list);
          }
          this.loading.set(false);
        },
        error: () => {
          this.rows.set([]);
          if (!this.summary()) {
            this.total.set(0);
            this.updateAgingChart([]);
          }
          this.loading.set(false);
          this.toastService.error(
            'Error al cargar las cuentas por cobrar de clientes',
          );
        },
      });
  }

  onPageChange(newPage: number): void {
    if (newPage !== this.page() && newPage >= 1 && newPage <= this.totalPages()) {
      this.page.set(newPage);
      this.loadData();
    }
  }

  onActionClick(event: any): void {
    const actionId = typeof event === 'string' ? event : event?.action;
    if (actionId === 'export-xlsx') {
      this.exportXlsx();
    }
  }

  exportXlsx(): void {
    this.exporting.set(true);
    this.analyticsService
      .exportCustomerReceivables()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (blob) => {
          const url = window.URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `cuentas_por_cobrar_${new Date()
            .toISOString()
            .slice(0, 10)}.xlsx`;
          a.click();
          window.URL.revokeObjectURL(url);
          this.exporting.set(false);
          this.toastService.success('Reporte exportado exitosamente');
        },
        error: () => {
          this.exporting.set(false);
          this.toastService.error('No se pudo exportar el reporte');
        },
      });
  }

  private updateAgingChartFromSummary(summary: CustomerReceivablesSummary): void {
    const buckets: Record<string, number> = summary.bucket_totals || {
      '0-30': 0,
      '31-60': 0,
      '61-90': 0,
      '90+': 0,
    };
    const counts: Record<string, number> = summary.bucket_counts || {
      '0-30': 0,
      '31-60': 0,
      '61-90': 0,
      '90+': 0,
    };
    this.renderAgingChart(buckets, counts);
  }

  private updateAgingChart(data: CustomerReceivableRow[]): void {
    const buckets: Record<string, number> = {
      '0-30': 0,
      '31-60': 0,
      '61-90': 0,
      '90+': 0,
    };
    const counts: Record<string, number> = {
      '0-30': 0,
      '31-60': 0,
      '61-90': 0,
      '90+': 0,
    };

    for (const row of data) {
      const b = row.aging_bucket || '0-30';
      buckets[b] = (buckets[b] || 0) + (Number(row.balance) || 0);
      counts[b] = (counts[b] || 0) + 1;
    }

    this.renderAgingChart(buckets, counts);
  }

  private renderAgingChart(
    buckets: Record<string, number>,
    counts: Record<string, number>,
  ): void {
    const bucketColors: Record<string, string> = {
      '0-30': '#10b981',
      '31-60': '#3b82f6',
      '61-90': '#f59e0b',
      '90+': '#ef4444',
    };
    const bucketNames: Record<string, string> = {
      '0-30': '0-30 días',
      '31-60': '31-60 días',
      '61-90': '61-90 días',
      '90+': '90+ días',
    };

    const categories = Object.keys(buckets).map((k) => bucketNames[k]);
    const barValues = Object.keys(buckets).map((k) => ({
      value: Math.round((buckets[k] || 0) * 100) / 100,
      itemStyle: { color: bucketColors[k], borderRadius: [6, 6, 0, 0] },
      bucketKey: k,
    }));
    const symbol = this.currencyService.currencySymbol() || '$';

    this.agingChartOptions.set({
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        backgroundColor: 'rgba(15, 23, 42, 0.92)',
        borderWidth: 0,
        textStyle: { color: '#fff', fontSize: 12 },
        formatter: (params: any) => {
          const p = Array.isArray(params) ? params[0] : params;
          const key = (p?.data?.bucketKey || '').toString();
          const count = counts[key] ?? 0;
          return `
            <div style="font-weight:600;margin-bottom:4px">${p.name}</div>
            <div style="display:flex;align-items:center;gap:6px">
              <span style="width:8px;height:8px;border-radius:50%;background:${p.color};display:inline-block"></span>
              <span>Saldo:</span>
              <b style="margin-left:auto">${symbol} ${p.value?.toLocaleString() ?? 0}</b>
            </div>
            <div style="margin-top:4px;font-size:11px;opacity:0.85">${count} factura${count === 1 ? '' : 's'}</div>
          `;
        },
      },
      grid: {
        left: 16,
        right: 16,
        top: 36,
        bottom: 8,
        containLabel: true,
      },
      xAxis: {
        type: 'category',
        data: categories,
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: {
          color: 'var(--color-text-secondary, #64748b)',
          fontSize: 12,
          fontWeight: 500,
        },
      },
      yAxis: {
        type: 'value',
        show: false,
      },
      series: [
        {
          name: 'Saldo',
          type: 'bar',
          data: barValues,
          barWidth: '46%',
          itemStyle: {
            borderRadius: [6, 6, 0, 0],
          },
          label: {
            show: true,
            position: 'top',
            color: 'var(--color-text-primary, #0f172a)',
            fontSize: 11,
            fontWeight: 600,
            formatter: (p: any) => {
              const v = Number(p.value) || 0;
              if (v === 0) return '';
              return symbol + ' ' + v.toLocaleString();
            },
          },
        },
      ],
    });
  }
}
