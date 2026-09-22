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
  StatsComponent,
} from '../../../../../../shared/components';
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
    StatsComponent,
    OptionsDropdownComponent,
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
            <a
              routerLink="/admin/reports/purchases/payable-aging"
              class="inline-flex items-center gap-2 px-3 py-1.5 text-xs md:text-sm font-semibold text-primary bg-primary/10 hover:bg-primary/15 rounded-lg transition-colors"
            >
              <app-icon name="table" [size]="16"></app-icon>
              <span>Ver Reporte de Cartera</span>
            </a>
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

          <!-- Navigation Card to Detailed Report -->
          <div class="p-4 rounded-xl border border-border bg-surface flex flex-col sm:flex-row items-center justify-between gap-4">
            <div class="flex items-center gap-3">
              <div class="w-10 h-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
                <app-icon name="file-text" [size]="20"></app-icon>
              </div>
              <div>
                <h4 class="text-sm font-bold text-[var(--color-text-primary)]">Detalle granular de cartera por proveedor</h4>
                <p class="text-xs text-[var(--color-text-secondary)]">
                  Consulta el listado completo con documento (NIT), saldos pendientes, vencimientos y pagos en la sección de Reportes.
                </p>
              </div>
            </div>
            <a
              routerLink="/admin/reports/purchases/payable-aging"
              class="inline-flex items-center gap-2 px-4 py-2 text-xs md:text-sm font-semibold text-white bg-primary hover:bg-primary-dark rounded-lg transition-colors shrink-0"
            >
              <app-icon name="table" [size]="16"></app-icon>
              <span>Ir al Reporte Detallado</span>
            </a>
          </div>
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
  readonly total = signal<number>(0);

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

  readonly dropdownActions = computed<DropdownAction[]>(() => [
    {
      action: 'view-report',
      label: 'Ver Reporte de Cartera',
      icon: 'table',
    },
    {
      action: 'export-xlsx',
      label: 'Exportar XLSX',
      icon: 'download',
    },
  ]);

  ngOnInit(): void {
    this.currencyService.loadCurrency();
    this.loadData();
  }

  loadData(): void {
    this.loading.set(true);

    this.analyticsService
      .getPayableAging({ page: 1, limit: 1 })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res: any) => {
          const pagination = res?.meta?.pagination;
          const totalCount =
            typeof pagination?.total === 'number'
              ? pagination.total
              : typeof res?.total === 'number'
                ? res.total
                : 0;
          this.total.set(totalCount);

          const totalsData: PayableAgingTotals = res?.meta?.totals ?? {
            total_paid: 0,
            current: 0,
            days_1_30: 0,
            days_31_60: 0,
            days_61_90: 0,
            days_over_90: 0,
            total_outstanding: 0,
          };
          this.totals.set(totalsData);

          this.updateChart(totalsData);
          this.loading.set(false);
        },
        error: () => {
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

  onActionClick(action: string): void {
    if (action === 'view-report') {
      this.router.navigate(['/admin/reports/purchases/payable-aging']);
    } else if (action === 'export-xlsx') {
      this.exportReport();
    }
  }

  exportReport(): void {
    this.exporting.set(true);

    this.analyticsService
      .exportPayableAging()
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
}
