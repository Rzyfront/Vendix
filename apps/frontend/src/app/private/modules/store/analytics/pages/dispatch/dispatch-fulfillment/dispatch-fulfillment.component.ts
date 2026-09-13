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
import { CurrencyFormatService } from '../../../../../../../shared/pipes/currency/currency.pipe';
import { ToastService } from '../../../../../../../shared/components/toast/toast.service';
import { OptionsDropdownComponent } from '../../../../../../../shared/components/options-dropdown/options-dropdown.component';
import {
  DropdownAction,
  FilterConfig,
  FilterValues,
} from '../../../../../../../shared/components/options-dropdown/options-dropdown.interfaces';
import { getDefaultStartDate, getDefaultEndDate } from '../../../../../../../shared/utils/date.util';
import { truncateLabel, compactCountAxis } from '../../../../../../../shared/utils/chart-labels.util';

import { AnalyticsService } from '../../../services/analytics.service';
import {
  DispatchFulfillment,
  DispatchFulfillmentCarrier,
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
 * "Cumplimiento por Portador" — vista 2 de la categoría Despachos
 * (PLAN-analytics-despachos-2026-09-12, paso 5). Molde:
 * `inventory-low-stock-by-supplier` (signals puros, OnPush, sin NgRx,
 * `takeUntilDestroyed`, `toastService.error()` en el error).
 *
 * `portador_tipo` SIEMPRE se muestra junto al nombre en la tabla — nunca solo
 * el nombre — porque `registrado_por` identifica a quien registró la entrega
 * en el sistema, no a quien la llevó (decisión de negocio no negociable).
 */
@Component({
  selector: 'vendix-dispatch-fulfillment',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    CardComponent,
    ChartComponent,
    IconComponent,
    ResponsiveDataViewComponent,
    StatsComponent,
    AnalyticsCardComponent,
    OptionsDropdownComponent,
  ],
  templateUrl: './dispatch-fulfillment.component.html',
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
export class DispatchFulfillmentComponent {
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

  readonly envelope = signal<DispatchFulfillment | null>(null);
  readonly loading = signal<boolean>(false);

  readonly carriersChartOptions = signal<EChartsOption>({});

  readonly dispatchViews: AnalyticsView[] = getViewsByCategory('dispatch').filter(
    (v) => v.key !== 'dispatch_fulfillment',
  );

  readonly carrierColumns: TableColumn[] = [
    {
      key: 'portador_nombre',
      label: 'Portador',
      sortable: false,
      priority: 1,
      transform: (v: unknown) => (v ? String(v) : 'Sin nombre'),
    },
    {
      key: 'portador_tipo',
      label: 'Tipo',
      sortable: false,
      priority: 1,
      transform: (v: unknown) => portadorTipoLabel(v as string | null),
    },
    {
      key: 'deliveries',
      label: 'Entregas',
      sortable: false,
      align: 'right',
      priority: 1,
      transform: (v: unknown) => Number(v ?? 0).toLocaleString('es-CO'),
    },
    {
      key: 'rejected',
      label: 'Rechazadas',
      sortable: false,
      align: 'right',
      priority: 2,
      transform: (v: unknown) => Number(v ?? 0).toLocaleString('es-CO'),
    },
    {
      key: 'released',
      label: 'Liberadas',
      sortable: false,
      align: 'right',
      priority: 3,
      transform: (v: unknown) => Number(v ?? 0).toLocaleString('es-CO'),
    },
    {
      key: 'fulfillment_rate',
      label: 'Cumplimiento',
      sortable: false,
      align: 'right',
      priority: 1,
      transform: (v: unknown) => `${Number(v ?? 0).toFixed(1)}%`,
    },
    {
      key: 'delivered_value',
      label: 'Valor entregado',
      sortable: false,
      align: 'right',
      priority: 2,
      transform: (v: unknown) => this.currencyService.format(Number(v) || 0),
    },
    {
      key: 'routes',
      label: 'Rutas',
      sortable: false,
      align: 'right',
      priority: 3,
      transform: (v: unknown) => Number(v ?? 0).toLocaleString('es-CO'),
    },
  ];

  readonly carrierCardConfig: ItemListCardConfig = {
    titleKey: 'portador_nombre',
    titleTransform: (item: DispatchFulfillmentCarrier) => item.portador_nombre || 'Sin nombre',
    subtitleKey: 'portador_tipo',
    subtitleTransform: (item: DispatchFulfillmentCarrier) => portadorTipoLabel(item.portador_tipo),
    detailKeys: [
      {
        key: 'deliveries',
        label: 'Entregas',
        icon: 'package-check',
        transform: (v: unknown) => Number(v ?? 0).toLocaleString('es-CO'),
      },
      {
        key: 'fulfillment_rate',
        label: 'Cumplimiento',
        icon: 'percent',
        transform: (v: unknown) => `${Number(v ?? 0).toFixed(1)}%`,
      },
      {
        key: 'delivered_value',
        label: 'Valor entregado',
        icon: 'dollar-sign',
        transform: (v: unknown) => this.currencyService.format(Number(v) || 0),
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
      .getDispatchFulfillment(query)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          const env = res.data ?? null;
          this.envelope.set(env);
          if (env) {
            this.updateCarriersChart(env);
          }
          this.loading.set(false);
        },
        error: () => {
          this.loading.set(false);
          this.toastService.error('No se pudo cargar el cumplimiento por portador.');
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

  // ─── Display helpers ───────────────────────────────────────────────────────

  formatRate(rate: number | null | undefined): string {
    return `${Number(rate ?? 0).toFixed(1)}%`;
  }

  // ─── Chart ─────────────────────────────────────────────────────────────────

  private getThemeColors() {
    const style =
      typeof document !== 'undefined'
        ? getComputedStyle(document.documentElement)
        : null;
    return {
      border: style?.getPropertyValue('--color-border').trim() || '#e5e7eb',
      textSecondary:
        style?.getPropertyValue('--color-text-secondary').trim() || '#6b7280',
    };
  }

  private updateCarriersChart(env: DispatchFulfillment): void {
    const { border, textSecondary } = this.getThemeColors();
    const top = [...(env.carriers ?? [])]
      .sort((a, b) => b.deliveries - a.deliveries)
      .slice(0, 10);

    this.carriersChartOptions.set({
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: (params: any) => {
          const p = params[0];
          const bucket = top[p.dataIndex];
          const tipo = portadorTipoLabel(bucket?.portador_tipo);
          return `${p.name} (${tipo})<br/>Entregas: <b>${p.value.toLocaleString('es-CO')}</b><br/>Cumplimiento: ${bucket?.fulfillment_rate?.toFixed(1) ?? 0}%`;
        },
      },
      grid: { left: '3%', right: '4%', bottom: '4%', top: '4%', containLabel: true },
      xAxis: {
        type: 'value',
        axisLine: { show: false },
        axisLabel: {
          color: textSecondary,
          formatter: (v: number) => compactCountAxis(v),
        },
        splitLine: { lineStyle: { color: border } },
      },
      yAxis: {
        type: 'category',
        data: top.map((c) => c.portador_nombre || 'Sin nombre'),
        axisLine: { lineStyle: { color: border } },
        axisLabel: {
          color: textSecondary,
          formatter: (val: string) => truncateLabel(val, 22),
        },
      },
      series: [
        {
          name: 'Entregas',
          type: 'bar',
          data: top.map((c) => c.deliveries),
          itemStyle: { color: '#3b82f6' },
          barMaxWidth: 18,
        },
      ],
    });
  }
}
