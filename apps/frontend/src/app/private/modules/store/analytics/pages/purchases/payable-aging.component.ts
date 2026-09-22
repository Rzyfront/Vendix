import {
  Component,
  OnInit,
  inject,
  signal,
  computed,
  DestroyRef,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import type { EChartsOption } from 'echarts';

import {
  CardComponent,
  ChartComponent,
  IconComponent,
  PaginationComponent,
  StatsComponent,
  ResponsiveDataViewComponent,
  InputsearchComponent,
} from '../../../../../../shared/components';
import type { TableColumn, ItemListCardConfig } from '../../../../../../shared/components';
import {
  OptionsDropdownComponent,
} from '../../../../../../shared/components/options-dropdown/options-dropdown.component';
import type {
  DropdownAction,
} from '../../../../../../shared/components/options-dropdown/options-dropdown.interfaces';
import {
  CurrencyPipe,
  CurrencyFormatService,
} from '../../../../../../shared/pipes/currency/currency.pipe';
import { ToastService } from '../../../../../../shared/components/toast/toast.service';

import { AnalyticsService } from '../../services/analytics.service';
import type {
  PayableAgingRow,
  PayableAgingTotals,
} from '../../interfaces/purchases-analytics.interface';

@Component({
  selector: 'vendix-payable-aging',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    CardComponent,
    ChartComponent,
    IconComponent,
    PaginationComponent,
    StatsComponent,
    ResponsiveDataViewComponent,
    OptionsDropdownComponent,
    InputsearchComponent,
    CurrencyPipe,
  ],
  styles: [
    `
      :host {
        display: block;
        margin: -16px;
        @media (min-width: 768px) {
          margin: -24px;
        }
      }
      :host ::ng-deep .stats-container {
        padding: 0;
        margin: 0;
        margin-bottom: 0;
      }
      :host ::ng-deep .results-header {
        padding: 0.75rem 1rem;
      }
    `,
  ],
  template: `
    <div class="space-y-6 w-full max-w-[1600px] mx-auto py-4">
      <!-- Stats Cards -->
      <div class="stats-container sticky top-0 z-20 bg-background md:static md:bg-transparent">
        <app-stats
          title="Saldo Total"
          [value]="totals().total_outstanding | currency"
          smallText="Deuda total a proveedores"
          iconName="dollar-sign"
          iconBgColor="bg-amber-100"
          iconColor="text-amber-600"
        ></app-stats>

        <app-stats
          title="Corriente (Al día)"
          [value]="totals().current | currency"
          smallText="Sin mora de pago"
          iconName="check-circle"
          iconBgColor="bg-emerald-100"
          iconColor="text-emerald-600"
        ></app-stats>

        <app-stats
          title="Mora Crítica (>90d)"
          [value]="totals().days_over_90 | currency"
          smallText="Vencimiento superior a 90 días"
          iconName="alert-triangle"
          iconBgColor="bg-rose-100"
          iconColor="text-rose-600"
        ></app-stats>

        <app-stats
          title="Proveedores con Deuda"
          [value]="total()"
          smallText="Cuentas comerciales activas"
          iconName="building-2"
          iconBgColor="bg-blue-100"
          iconColor="text-blue-600"
        ></app-stats>
      </div>

      <!-- Main Card -->
      <app-card shadow="none" [padding]="false" overflow="hidden" [showHeader]="true">
        <div slot="header" class="results-header flex items-center justify-between gap-3 flex-wrap">
          <div class="flex items-center gap-2 min-w-0">
            <app-icon name="clock" [size]="20" class="shrink-0 text-[var(--color-primary)]"></app-icon>
            <span class="results-header__title text-base md:text-lg font-bold text-[var(--color-text-primary)] leading-tight whitespace-nowrap">
              Cuentas por Pagar Proveedor
            </span>
          </div>
          <div class="flex items-center gap-2 flex-wrap shrink-0">
            <app-inputsearch
              placeholder="Buscar proveedor o NIT..."
              [debounceTime]="350"
              (searchChange)="onSearchChange($event)"
            ></app-inputsearch>
            <app-options-dropdown
              class="shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:shadow-none rounded-[10px]"
              [actions]="dropdownActions()"
              [showActions]="true"
              triggerLabel="Acciones"
              triggerIcon="plus"
              [isLoading]="exporting()"
              (actionClick)="onActionClick($event)"
            ></app-options-dropdown>
          </div>
        </div>

        <div class="p-4 space-y-6">
          <!-- Aging Distribution Chart + Summary Badges -->
          <app-card shadow="none" [padding]="false" overflow="hidden" [showHeader]="true">
            <div slot="header" class="results-header flex flex-col">
              <span class="text-sm font-bold text-[var(--color-text-primary)]">Distribución por Antigüedad</span>
              <span class="text-xs text-[var(--color-text-secondary)]">
                Saldos pendientes agrupados por tramos de vencimiento (Corriente, 1-30d, 31-60d, 61-90d, >90d)
              </span>
            </div>
            <div class="p-4 space-y-4">
              <div class="h-72">
                <app-chart [options]="chartOptions()" [loading]="loading()"></app-chart>
              </div>

              <!-- Summary Badges by Bucket -->
              <div class="grid grid-cols-2 sm:grid-cols-5 gap-3">
                <div class="p-3 rounded-xl border border-border bg-surface flex flex-col">
                  <span class="text-xs font-semibold text-emerald-600 dark:text-emerald-400">Corriente</span>
                  <span class="text-sm md:text-base font-bold text-[var(--color-text-primary)] mt-1">
                    {{ totals().current | currency }}
                  </span>
                  <span class="text-xs text-[var(--color-text-secondary)] mt-0.5">
                    {{ getBucketPercentage('current') }} % del total
                  </span>
                </div>

                <div class="p-3 rounded-xl border border-border bg-surface flex flex-col">
                  <span class="text-xs font-semibold text-blue-600 dark:text-blue-400">1 - 30 días</span>
                  <span class="text-sm md:text-base font-bold text-[var(--color-text-primary)] mt-1">
                    {{ totals().days_1_30 | currency }}
                  </span>
                  <span class="text-xs text-[var(--color-text-secondary)] mt-0.5">
                    {{ getBucketPercentage('days_1_30') }} % del total
                  </span>
                </div>

                <div class="p-3 rounded-xl border border-border bg-surface flex flex-col">
                  <span class="text-xs font-semibold text-amber-600 dark:text-amber-400">31 - 60 días</span>
                  <span class="text-sm md:text-base font-bold text-[var(--color-text-primary)] mt-1">
                    {{ totals().days_31_60 | currency }}
                  </span>
                  <span class="text-xs text-[var(--color-text-secondary)] mt-0.5">
                    {{ getBucketPercentage('days_31_60') }} % del total
                  </span>
                </div>

                <div class="p-3 rounded-xl border border-border bg-surface flex flex-col">
                  <span class="text-xs font-semibold text-orange-600 dark:text-orange-400">61 - 90 días</span>
                  <span class="text-sm md:text-base font-bold text-[var(--color-text-primary)] mt-1">
                    {{ totals().days_61_90 | currency }}
                  </span>
                  <span class="text-xs text-[var(--color-text-secondary)] mt-0.5">
                    {{ getBucketPercentage('days_61_90') }} % del total
                  </span>
                </div>

                <div class="p-3 rounded-xl border border-border bg-surface flex flex-col col-span-2 sm:col-span-1">
                  <span class="text-xs font-semibold text-rose-600 dark:text-rose-400">&gt; 90 días</span>
                  <span class="text-sm md:text-base font-bold text-[var(--color-text-primary)] mt-1">
                    {{ totals().days_over_90 | currency }}
                  </span>
                  <span class="text-xs text-[var(--color-text-secondary)] mt-0.5">
                    {{ getBucketPercentage('days_over_90') }} % del total
                  </span>
                </div>
              </div>
            </div>
          </app-card>

          <!-- Detail Table -->
          <app-card shadow="none" [padding]="false" overflow="hidden" [showHeader]="true">
            <div slot="header" class="results-header flex flex-col">
              <span class="text-sm font-bold text-[var(--color-text-primary)]">Detalle por Proveedor</span>
              <span class="text-xs text-[var(--color-text-secondary)]">
                Mostrando {{ rows().length }} de {{ total() }} proveedores con cartera pendiente
              </span>
            </div>
            <div class="p-4 space-y-4">
              <app-responsive-data-view
                [data]="rows()"
                [columns]="columns"
                [cardConfig]="cardConfig"
                [loading]="loading()"
                [hoverable]="true"
                emptyTitle="Sin cuentas por pagar"
                emptyMessage="No hay saldos pendientes a proveedores en este momento."
                (rowClick)="openSupplier($event)"
              ></app-responsive-data-view>

              <!-- Footer Total Bar -->
              @if (rows().length > 0) {
                <div class="bg-[var(--color-surface-subtle,#f8fafc)] dark:bg-surface border border-border rounded-xl p-4 flex flex-wrap items-center justify-between gap-4 text-sm font-semibold">
                  <div class="flex items-center gap-2">
                    <app-icon name="calculator" [size]="18" class="text-primary"></app-icon>
                    <span>Total Cartera General:</span>
                  </div>
                  <div class="flex flex-wrap items-center gap-6 text-xs md:text-sm">
                    <span class="text-primary font-medium">Abonado: {{ totals().total_paid | currency }}</span>
                    <span class="text-emerald-600">Corriente: {{ totals().current | currency }}</span>
                    <span class="text-blue-600">1-30d: {{ totals().days_1_30 | currency }}</span>
                    <span class="text-amber-600">31-60d: {{ totals().days_31_60 | currency }}</span>
                    <span class="text-orange-600">61-90d: {{ totals().days_61_90 | currency }}</span>
                    <span class="text-rose-600">&gt;90d: {{ totals().days_over_90 | currency }}</span>
                    <span class="text-base font-bold text-[var(--color-text-primary)] border-l border-border pl-4">
                      Total: {{ totals().total_outstanding | currency }}
                    </span>
                  </div>
                </div>
              }

              <!-- Pagination -->
              @if (totalPages() > 1) {
                <div class="flex justify-center pt-2">
                  <app-pagination
                    [currentPage]="page()"
                    [totalPages]="totalPages()"
                    (pageChange)="onPageChange($event)"
                  ></app-pagination>
                </div>
              }
            </div>
          </app-card>
        </div>
      </app-card>
    </div>
  `,
})
export class PayableAgingComponent implements OnInit {
  private readonly destroyRef = inject(DestroyRef);
  private readonly analyticsService = inject(AnalyticsService);
  private readonly toastService = inject(ToastService);
  private readonly currencyService = inject(CurrencyFormatService);
  private readonly router = inject(Router);

  readonly loading = signal<boolean>(false);
  readonly exporting = signal<boolean>(false);
  readonly rows = signal<PayableAgingRow[]>([]);
  readonly total = signal<number>(0);
  readonly page = signal<number>(1);
  readonly limit = signal<number>(10);
  readonly search = signal<string>('');

  readonly totals = signal<PayableAgingTotals>({
    total_paid: 0,
    current: 0,
    days_1_30: 0,
    days_31_60: 0,
    days_61_90: 0,
    days_over_90: 0,
    total_outstanding: 0,
  });

  readonly chartOptions = signal<EChartsOption>({});

  readonly totalPages = computed(() =>
    Math.max(1, Math.ceil(this.total() / this.limit())),
  );

  readonly dropdownActions = computed<DropdownAction[]>(() => [
    {
      action: 'export-xlsx',
      label: 'Exportar XLSX',
      icon: 'download',
    },
  ]);

  readonly columns: TableColumn[] = [
    { key: 'supplier_name', label: 'Proveedor', priority: 1 },
    { key: 'supplier_document', label: 'Documento (NIT)', priority: 2 },
    {
      key: 'total_paid',
      label: 'Total Abonado',
      align: 'right',
      priority: 2,
      transform: (val: any) => this.currencyService.format(Number(val) || 0),
    },
    {
      key: 'total_outstanding',
      label: 'Saldo Total',
      align: 'right',
      priority: 1,
      transform: (val: any) => this.currencyService.format(Number(val) || 0),
    },
    {
      key: 'due_in_days',
      label: 'Vencimiento',
      priority: 2,
      badge: true,
      badgeConfig: {
        type: 'custom',
        size: 'sm',
        colorFn: (value: any) => {
          if (value === null || value === undefined || value === '') return '#9ca3af';
          const num = Number(value);
          if (!Number.isFinite(num)) return '#9ca3af';
          if (num < 0) return '#ef4444';
          if (num === 0) return '#f97316';
          if (num <= 7) return '#f59e0b';
          return '#10b981';
        },
      },
      transform: (value: any, row?: any) =>
        this.formatDueBadge(row?.due_in_days ?? value),
      sortable: true,
    },
    {
      key: 'last_payment_date',
      label: 'Último Pago',
      align: 'right',
      priority: 3,
      defaultValue: 'Sin pagos',
      transform: (val: any) => this.formatDate(val as string | null),
    },
  ];

  readonly cardConfig: ItemListCardConfig = {
    titleKey: 'supplier_name',
    subtitleKey: 'supplier_document',
    detailKeys: [
      {
        key: 'total_paid',
        label: 'Abonado',
        icon: 'dollar-sign',
        transform: (val: any) => this.currencyService.format(Number(val) || 0),
      },
      {
        key: 'due_in_days',
        label: 'Vencimiento',
        icon: 'clock',
        transform: (val: any, row?: any) =>
          this.formatDueBadge(row?.due_in_days ?? val),
      },
      {
        key: 'last_payment_date',
        label: 'Último Pago',
        icon: 'calendar',
        transform: (val: any) => this.formatDate(val as string | null),
      },
    ],
    footerKey: 'total_outstanding',
    footerLabel: 'Saldo Total',
    footerTransform: (val: any) => this.currencyService.format(Number(val) || 0),
  };

  ngOnInit(): void {
    this.currencyService.loadCurrency();
    this.loadData();
  }

  loadData(): void {
    this.loading.set(true);
    const query: Record<string, any> = {
      page: this.page(),
      limit: this.limit(),
    };
    if (this.search().trim()) {
      query['search'] = this.search().trim();
    }

    this.analyticsService
      .getPayableAging(query)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res: any) => {
          const list: PayableAgingRow[] = Array.isArray(res?.data)
            ? res.data
            : Array.isArray(res?.data?.data)
              ? res.data.data
              : [];
          this.rows.set(list);

          const pagination = res?.meta?.pagination;
          const totalCount =
            typeof pagination?.total === 'number'
              ? pagination.total
              : typeof res?.total === 'number'
                ? res.total
                : list.length;
          this.total.set(totalCount);

          const totalsData: PayableAgingTotals = res?.meta?.totals ?? {
            total_paid: list.reduce((sum, r) => sum + (Number(r.total_paid) || 0), 0),
            current: list.reduce((sum, r) => sum + (Number(r.current) || 0), 0),
            days_1_30: list.reduce((sum, r) => sum + (Number(r.days_1_30) || 0), 0),
            days_31_60: list.reduce((sum, r) => sum + (Number(r.days_31_60) || 0), 0),
            days_61_90: list.reduce((sum, r) => sum + (Number(r.days_61_90) || 0), 0),
            days_over_90: list.reduce((sum, r) => sum + (Number(r.days_over_90) || 0), 0),
            total_outstanding: list.reduce((sum, r) => sum + (Number(r.total_outstanding) || 0), 0),
          };
          this.totals.set(totalsData);

          this.updateChart(totalsData);
          this.loading.set(false);
        },
        error: () => {
          this.rows.set([]);
          this.total.set(0);
          this.updateChart({
            total_paid: 0,
            current: 0,
            days_1_30: 0,
            days_31_60: 0,
            days_61_90: 0,
            days_over_90: 0,
            total_outstanding: 0,
          });
          this.loading.set(false);
          this.toastService.error('Error al cargar las cuentas por pagar a proveedores');
        },
      });
  }

  onPageChange(newPage: number): void {
    if (newPage !== this.page() && newPage >= 1 && newPage <= this.totalPages()) {
      this.page.set(newPage);
      this.loadData();
    }
  }

  onSearchChange(term: string): void {
    const searchTerm = (term || '').trim();
    if (this.search() !== searchTerm) {
      this.search.set(searchTerm);
      this.page.set(1);
      this.loadData();
    }
  }

  onActionClick(action: string): void {
    if (action === 'export-xlsx') {
      this.exportReport();
    }
  }

  exportReport(): void {
    this.exporting.set(true);
    const query: Record<string, any> = {};
    if (this.search().trim()) {
      query['search'] = this.search().trim();
    }

    this.analyticsService
      .exportPayableAging(query)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (blob) => {
          const url = window.URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `cuentas_por_pagar_proveedor_${new Date().toISOString().split('T')[0]}.xlsx`;
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

  openSupplier(row: PayableAgingRow): void {
    if (row.supplier_id) {
      this.router.navigate(['/admin/inventory/suppliers', row.supplier_id]);
    }
  }

  getBucketPercentage(key: keyof PayableAgingTotals): number {
    const total = this.totals().total_outstanding;
    if (!total || total <= 0) return 0;
    const value = this.totals()[key] || 0;
    return Math.round((value / total) * 1000) / 10;
  }

  private updateChart(t: PayableAgingTotals): void {
    const categories = ['Corriente', '1-30 días', '31-60 días', '61-90 días', '>90 días'];
    const values = [t.current, t.days_1_30, t.days_31_60, t.days_61_90, t.days_over_90];
    const colors = ['#10b981', '#3b82f6', '#f59e0b', '#f97316', '#ef4444'];

    this.chartOptions.set({
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: (params: any) => {
          const p = Array.isArray(params) ? params[0] : params;
          const val = this.currencyService.format(Number(p.value) || 0);
          return `<div class="p-1"><strong>${p.name}</strong><br/>Monto pendiente: ${val}</div>`;
        },
      },
      grid: {
        top: 20,
        right: 25,
        bottom: 30,
        left: 80,
        containLabel: true,
      },
      xAxis: {
        type: 'value',
        axisLabel: {
          formatter: (value: number) => this.currencyService.format(value),
        },
        splitLine: {
          lineStyle: { color: 'var(--color-border, #e2e8f0)', type: 'dashed' },
        },
      },
      yAxis: {
        type: 'category',
        data: categories,
        axisLine: { lineStyle: { color: 'var(--color-border, #cbd5e1)' } },
        axisLabel: { fontWeight: 'bold' },
      },
      series: [
        {
          name: 'Saldo Pendiente',
          type: 'bar',
          data: values.map((val, idx) => ({
            value: val,
            itemStyle: {
              color: colors[idx],
              borderRadius: [0, 6, 6, 0],
            },
          })),
          barMaxWidth: 32,
        },
      ],
    });
  }

  private formatDate(dateStr: string | null): string {
    if (!dateStr) return 'Sin pagos';
    try {
      const d = new Date(dateStr);
      return isNaN(d.getTime())
        ? dateStr
        : d.toLocaleDateString('es-CO', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
          });
    } catch {
      return dateStr;
    }
  }

  formatDueBadge(days: number | null | undefined): string {
    if (days === null || days === undefined) return 'Sin fecha';
    const num = Number(days);
    if (!Number.isFinite(num)) return 'Sin fecha';
    if (num < 0) return `Vencida hace ${Math.abs(num)}d`;
    if (num === 0) return 'Vence hoy';
    return `Vence en ${num}d`;
  }
}
