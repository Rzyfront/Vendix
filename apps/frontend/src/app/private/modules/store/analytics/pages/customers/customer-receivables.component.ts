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
import { CustomerReceivableRow } from '../../interfaces/customers-analytics.interface';
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

  readonly totalBalance = computed(() =>
    this.rows().reduce((acc, row) => acc + (Number(row.balance) || 0), 0),
  );

  readonly totalOriginal = computed(() =>
    this.rows().reduce(
      (acc, row) => acc + (Number(row.original_amount) || 0),
      0,
    ),
  );

  readonly totalPaid = computed(() =>
    this.rows().reduce((acc, row) => acc + (Number(row.paid_amount) || 0), 0),
  );

  readonly bucketTotals = computed(() => {
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
    this.loadData();
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
          this.total.set(totalCount);
          this.updateAgingChart(list);
          this.loading.set(false);
        },
        error: () => {
          this.rows.set([]);
          this.total.set(0);
          this.updateAgingChart([]);
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

  private updateAgingChart(data: CustomerReceivableRow[]): void {
    const buckets: Record<string, number> = {
      '0-30': 0,
      '31-60': 0,
      '61-90': 0,
      '90+': 0,
    };

    for (const row of data) {
      const b = row.aging_bucket || '0-30';
      buckets[b] = (buckets[b] || 0) + (Number(row.balance) || 0);
    }

    const chartData = [
      { name: '0-30 días', value: Math.round(buckets['0-30'] * 100) / 100, itemStyle: { color: '#10b981' } },
      { name: '31-60 días', value: Math.round(buckets['31-60'] * 100) / 100, itemStyle: { color: '#3b82f6' } },
      { name: '61-90 días', value: Math.round(buckets['61-90'] * 100) / 100, itemStyle: { color: '#f59e0b' } },
      { name: '90+ días', value: Math.round(buckets['90+'] * 100) / 100, itemStyle: { color: '#ef4444' } },
    ];

    const symbol = this.currencyService.currencySymbol() || '$';

    this.agingChartOptions.set({
      tooltip: {
        trigger: 'item',
        formatter: (params: any) => {
          const val = params.value?.toLocaleString() ?? 0;
          return `${params.name}: <b>${symbol} ${val}</b> (${params.percent}%)`;
        },
      },
      legend: {
        bottom: '0%',
        left: 'center',
        textStyle: {
          color: 'var(--color-text-secondary, #64748b)',
          fontSize: 11,
        },
      },
      series: [
        {
          name: 'Antigüedad',
          type: 'pie',
          radius: ['45%', '70%'],
          center: ['50%', '42%'],
          avoidLabelOverlap: false,
          itemStyle: {
            borderRadius: 6,
            borderColor: 'var(--color-surface, #fff)',
            borderWidth: 2,
          },
          label: {
            show: false,
          },
          emphasis: {
            label: {
              show: true,
              fontSize: 12,
              fontWeight: 'bold',
            },
          },
          data: chartData,
        },
      ],
    });
  }
}
