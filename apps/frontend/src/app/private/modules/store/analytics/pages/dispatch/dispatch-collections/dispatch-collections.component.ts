import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import type { EChartsOption } from 'echarts';

import {
  CardComponent,
  ChartComponent,
  IconComponent,
  ResponsiveDataViewComponent,
  StatsComponent,
  TableColumn,
  ItemListCardConfig,
} from '../../../../../../../shared/components';
import { CurrencyPipe, CurrencyFormatService } from '../../../../../../../shared/pipes/currency/currency.pipe';
import { ToastService } from '../../../../../../../shared/components/toast/toast.service';
import { OptionsDropdownComponent } from '../../../../../../../shared/components/options-dropdown/options-dropdown.component';
import {
  DropdownAction,
  FilterConfig,
  FilterValues,
} from '../../../../../../../shared/components/options-dropdown/options-dropdown.interfaces';
import {
  getDefaultStartDate,
  getDefaultEndDate,
  formatDateOnlyUTC,
} from '../../../../../../../shared/utils/date.util';

import { AnalyticsService } from '../../../services/analytics.service';
import {
  DispatchCollections,
  DispatchCollectionsRoute,
  DispatchRouteType,
} from '../../../interfaces/dispatch-analytics.interface';
import { DateRangeFilter } from '../../../interfaces/analytics.interface';
import { getViewsByCategory, AnalyticsView } from '../../../config/analytics-registry';
import { AnalyticsCardComponent } from '../../../components/analytics-card/analytics-card.component';
import { queryParamsToDateRange } from '../../../../shared/utils/date-range-params.util';
import { portadorTipoLabel } from '../dispatch-carrier-type.util';

const ROUTE_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: 'all', label: 'Todas' },
  { value: 'dsd', label: 'Planillas DSD' },
  { value: 'carrier', label: 'Repartidor' },
];

/**
 * "Recaudo de Rutas" — vista 3 de la categoría Despachos
 * (PLAN-analytics-despachos-2026-09-12, paso 5). Molde:
 * `inventory-low-stock-by-supplier` (signals puros, OnPush, sin NgRx,
 * `takeUntilDestroyed`, `toastService.error()` en el error).
 *
 * `cash_variance` viene del cierre de caja — NUNCA se recalcula en cliente.
 * "Recaudo en caja" (concilia con el cierre) y "Valor entregado" (operación,
 * incl. prepagos + retenciones) son métricas distintas — vendix-analytics-metrics.
 */
@Component({
  selector: 'vendix-dispatch-collections',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    CardComponent,
    ChartComponent,
    CurrencyPipe,
    IconComponent,
    ResponsiveDataViewComponent,
    StatsComponent,
    AnalyticsCardComponent,
    OptionsDropdownComponent,
  ],
  templateUrl: './dispatch-collections.component.html',
  styles: [
    `
      :host {
        display: block;
        margin: -16px;
        @media (min-width: 768px) { margin: -24px; }
      }
      :host ::ng-deep .stats-container { padding: 0; margin: 0; margin-bottom: 0; }
    `,
  ],
})
export class DispatchCollectionsComponent {
  private readonly destroyRef = inject(DestroyRef);
  private readonly analyticsService = inject(AnalyticsService);
  private readonly toastService = inject(ToastService);
  private readonly route = inject(ActivatedRoute);
  private readonly currencyService = inject(CurrencyFormatService);

  readonly dateRange = signal<DateRangeFilter>({
    start_date: getDefaultStartDate(),
    end_date: getDefaultEndDate(),
    preset: 'thisMonth',
  });
  readonly routeType = signal<DispatchRouteType>('all');

  readonly envelope = signal<DispatchCollections | null>(null);
  readonly loading = signal<boolean>(false);

  readonly withholdingChartOptions = signal<EChartsOption>({});

  readonly dispatchViews: AnalyticsView[] = getViewsByCategory('dispatch').filter(
    (v) => v.key !== 'dispatch_collections',
  );

  readonly routeColumns: TableColumn[] = [
    {
      key: 'route_number',
      label: 'Ruta',
      sortable: false,
      priority: 1,
      transform: (v: unknown) => (v ? String(v) : '—'),
    },
    {
      key: 'planned_date',
      label: 'Fecha',
      sortable: false,
      priority: 2,
      transform: (v: unknown) => (v ? formatDateOnlyUTC(v as string) : '—'),
    },
    {
      key: 'conductor_nombre',
      label: 'Conductor',
      sortable: false,
      priority: 1,
      transform: (_v: unknown, item?: DispatchCollectionsRoute) => {
        const nombre = item?.conductor_nombre || 'Sin nombre';
        const tipo = portadorTipoLabel(item?.conductor_tipo);
        return `${nombre} (${tipo})`;
      },
    },
    {
      key: 'is_carrier_route',
      label: 'Tipo de ruta',
      sortable: false,
      priority: 2,
      transform: (v: unknown) => (v ? 'Repartidor' : 'DSD'),
    },
    {
      key: 'delivered_value',
      label: 'Valor entregado',
      sortable: false,
      align: 'right',
      priority: 1,
      transform: (v: unknown) => this.currencyService.format(Number(v) || 0),
    },
    {
      key: 'cash_collected',
      label: 'Recaudo en caja',
      sortable: false,
      align: 'right',
      priority: 1,
      transform: (v: unknown) => this.currencyService.format(Number(v) || 0),
    },
    {
      key: 'total_withholdings',
      label: 'Retenciones',
      sortable: false,
      align: 'right',
      priority: 2,
      transform: (v: unknown) => this.currencyService.format(Number(v) || 0),
    },
    {
      key: 'cash_variance',
      label: 'Diferencia de caja',
      sortable: false,
      align: 'right',
      priority: 1,
      transform: (v: unknown) => {
        if (v === null || v === undefined) return 'Pendiente';
        const num = Number(v);
        const sign = num > 0 ? '+' : '';
        return `${sign}${this.currencyService.format(num)}`;
      },
      cellClass: (v: unknown) => {
        if (v === null || v === undefined) return 'text-[var(--color-text-secondary)]';
        const num = Number(v);
        if (num > 0) return 'text-emerald-600 font-semibold';
        if (num < 0) return 'text-red-600 font-semibold';
        return '';
      },
    },
  ];

  readonly routeCardConfig: ItemListCardConfig = {
    titleKey: 'route_number',
    titleTransform: (item: DispatchCollectionsRoute) => item.route_number || '—',
    subtitleKey: 'conductor_nombre',
    subtitleTransform: (item: DispatchCollectionsRoute) => {
      const nombre = item.conductor_nombre || 'Sin nombre';
      const tipo = portadorTipoLabel(item.conductor_tipo);
      return `${nombre} (${tipo})`;
    },
    detailKeys: [
      {
        key: 'delivered_value',
        label: 'Valor entregado',
        icon: 'package',
        transform: (v: unknown) => this.currencyService.format(Number(v) || 0),
      },
      {
        key: 'cash_collected',
        label: 'Recaudo en caja',
        icon: 'wallet',
        transform: (v: unknown) => this.currencyService.format(Number(v) || 0),
      },
      {
        key: 'cash_variance',
        label: 'Diferencia de caja',
        icon: 'scale',
        transform: (v: unknown) => {
          if (v === null || v === undefined) return 'Pendiente';
          const num = Number(v);
          const sign = num > 0 ? '+' : '';
          return `${sign}${this.currencyService.format(num)}`;
        },
      },
    ],
  };

  constructor() {
    const urlRange = queryParamsToDateRange(this.route.snapshot.queryParamMap);
    if (urlRange) {
      this.dateRange.set(urlRange);
    }
    this.refresh();
  }

  refresh(): void {
    const query = {
      date_range: this.dateRange(),
      route_type: this.routeType(),
    };

    this.loading.set(true);
    this.analyticsService
      .getDispatchCollections(query)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          const env = res.data ?? null;
          this.envelope.set(env);
          if (env) {
            this.updateWithholdingChart(env);
          }
          this.loading.set(false);
        },
        error: () => {
          this.loading.set(false);
          this.toastService.error('No se pudo cargar el recaudo de rutas.');
        },
      });
  }

  // ─── Filters ───────────────────────────────────────────────────────────────

  readonly filterConfigs: FilterConfig[] = [
    { key: 'date_range', type: 'date-range', label: 'Período' },
    {
      key: 'route_type',
      type: 'select',
      label: 'Tipo de ruta',
      options: ROUTE_TYPE_OPTIONS,
      placeholder: 'Todas',
    },
  ];

  readonly filterValues = computed<FilterValues>(() => {
    const range = this.dateRange();
    return {
      date_range_start: range.start_date || null,
      date_range_end: range.end_date || null,
      date_range_preset: range.preset || null,
      route_type: this.routeType(),
    };
  });

  readonly dropdownActions: DropdownAction[] = [];

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
    }
    const routeType = values['route_type'] as DispatchRouteType | null;
    this.routeType.set(routeType || 'all');
    this.refresh();
  }

  onClearAllFilters(): void {
    this.dateRange.set({
      start_date: getDefaultStartDate(),
      end_date: getDefaultEndDate(),
      preset: 'thisMonth',
    });
    this.routeType.set('all');
    this.refresh();
  }

  // ─── Chart ─────────────────────────────────────────────────────────────────

  private getThemeColors() {
    const style =
      typeof document !== 'undefined'
        ? getComputedStyle(document.documentElement)
        : null;
    return {
      textSecondary:
        style?.getPropertyValue('--color-text-secondary').trim() || '#6b7280',
    };
  }

  private updateWithholdingChart(env: DispatchCollections): void {
    const { textSecondary } = this.getThemeColors();
    const totals = env.totals;
    const data = [
      { name: 'Retefuente', value: totals?.retefuente ?? 0 },
      { name: 'Reteiva', value: totals?.reteiva ?? 0 },
      { name: 'Reteica', value: totals?.reteica ?? 0 },
    ].filter((d) => d.value > 0);

    this.withholdingChartOptions.set({
      tooltip: {
        trigger: 'item',
        formatter: (params: any) =>
          `${params.name}<br/><b>${this.currencyService.format(params.value)}</b> (${params.percent}%)`,
      },
      legend: {
        bottom: 0,
        textStyle: { color: textSecondary },
      },
      series: [
        {
          name: 'Retenciones',
          type: 'pie',
          radius: ['40%', '70%'],
          avoidLabelOverlap: true,
          itemStyle: { borderRadius: 6, borderColor: 'var(--color-surface)', borderWidth: 2 },
          label: { show: false },
          data: data.length
            ? data
            : [{ name: 'Sin retenciones', value: 1 }],
          color: ['#3b82f6', '#f59e0b', '#8b5cf6'],
        },
      ],
    });
  }

  // ─── Display helpers ───────────────────────────────────────────────────────

  formatVariance(v: number | null | undefined): string {
    if (v === null || v === undefined) return 'Pendiente';
    const sign = v > 0 ? '+' : '';
    return `${sign}${this.currencyService.format(v)}`;
  }

  varianceSmallText(v: number | null | undefined): string {
    if (v === null || v === undefined) return 'Cierre de caja pendiente';
    if (v > 0) return 'Sobra en caja';
    if (v < 0) return 'Falta en caja';
    return 'Caja cuadrada';
  }

  varianceIconBg(v: number | null | undefined): string {
    if (v === null || v === undefined) return 'bg-gray-100';
    if (v > 0) return 'bg-emerald-100';
    if (v < 0) return 'bg-red-100';
    return 'bg-blue-100';
  }

  varianceIconColor(v: number | null | undefined): string {
    if (v === null || v === undefined) return 'text-gray-500';
    if (v > 0) return 'text-emerald-600';
    if (v < 0) return 'text-red-600';
    return 'text-blue-600';
  }
}
