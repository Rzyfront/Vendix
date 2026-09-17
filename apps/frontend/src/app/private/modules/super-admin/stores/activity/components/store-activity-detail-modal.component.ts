import {
  Component,
  DestroyRef,
  computed,
  inject,
  input,
  model,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import type { EChartsOption } from 'echarts';

import {
  ChartComponent,
  EmptyStateComponent,
  IconComponent,
  ModalComponent,
  OptionsDropdownComponent,
  ToastService,
} from '../../../../../../shared/components/index';
import type {
  FilterConfig,
  FilterValues,
} from '../../../../../../shared/components/options-dropdown/options-dropdown.interfaces';
import { CurrencyFormatService } from '../../../../../../shared/pipes/currency/currency.pipe';
import {
  formatChartPeriod,
  formatDateOnlyUTC,
  toLocalDateString,
} from '../../../../../../shared/utils/date.util';
import { parseApiError } from '../../../../../../core/utils/parse-api-error';

import { StoreActivityService } from '../services/store-activity.service';
import {
  STORE_ACTIVITY_CHANNELS,
  STORE_ACTIVITY_ORDER_STATES,
  StoreActivityDetail,
  StoreActivitySeries,
  StoreActivitySeriesQuery,
  StoreActivityRow,
} from '../contracts/store-activity.contract';

function defaultFrom(): string {
  const d = new Date();
  d.setDate(d.getDate() - 29);
  return toLocalDateString(d);
}

function defaultTo(): string {
  return toLocalDateString();
}

function axisColors(): { border: string; secondary: string } {
  if (typeof document === 'undefined') {
    return { border: '#e5e7eb', secondary: '#6b7280' };
  }
  const style = getComputedStyle(document.documentElement);
  return {
    border: style.getPropertyValue('--color-border').trim() || '#e5e7eb',
    secondary:
      style.getPropertyValue('--color-text-secondary').trim() || '#6b7280',
  };
}

/**
 * Detalle de actividad de una tienda sobre el ranking (no navega).
 *
 * Hero con score protagonista + tira de métricas con iconos, tres gráficos
 * `app-chart` (serie diaria, ingreso operativo, doughnuts por canal/estado) y
 * filtros propios en `app-options-dropdown` (rango con presets, canal,
 * estado). El resumen sale de `getDetail().summary`; las series del endpoint
 * `GET /superadmin/stores/activity/:storeId/series` (buckets diarios UTC con
 * días en cero incluidos). Sin lista de auditoría ni paginación.
 *
 * Todo el estado vive aquí dentro: cerrar el modal no toca los filtros ni
 * la página del ranking que queda detrás.
 */
@Component({
  selector: 'app-store-activity-detail-modal',
  standalone: true,
  imports: [
    ModalComponent,
    OptionsDropdownComponent,
    ChartComponent,
    EmptyStateComponent,
    IconComponent,
  ],
  template: `
    <app-modal
      [isOpen]="isOpen()"
      (isOpenChange)="isOpen.set($event)"
      (opened)="onOpened()"
      (cancel)="onCancel()"
      size="xl"
      [title]="modalTitle()"
      [subtitle]="modalSubtitle()"
    >
      @if (summary(); as current) {
        <!-- Hero: score protagonista + tira de métricas -->
        <div class="overflow-hidden rounded-xl border border-border">
          <div class="flex flex-col gap-1 p-4 sm:flex-row sm:items-end sm:justify-between">
            <div class="min-w-0">
              <p class="text-xs font-semibold uppercase tracking-wider text-text-secondary">
                Score de actividad
              </p>
              <p class="mt-1 text-4xl font-extrabold leading-none text-text-primary">
                {{ formatScore(current.score) }}
              </p>
              <p class="mt-2 flex items-center gap-1 text-xs text-text-secondary">
                <app-icon name="clock" [size]="12" class="shrink-0"></app-icon>
                <span>
                  Última actividad: {{ formatActivityDate(current.last_activity_at) }} ·
                  {{ rangeLabel() }}
                </span>
              </p>
            </div>
            @if (!current.is_active) {
              <span
                class="inline-flex w-fit shrink-0 items-center rounded-full bg-warning/10 px-2.5 py-1 text-xs font-semibold text-warning"
              >
                Inactiva
              </span>
            }
          </div>
          <div class="grid grid-cols-2 gap-px border-t border-border bg-border sm:grid-cols-5">
            <div class="flex items-center gap-2.5 bg-surface px-3 py-3">
              <span
                class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"
              >
                <app-icon name="shopping-bag" [size]="16"></app-icon>
              </span>
              <span class="min-w-0">
                <span class="block text-[11px] font-medium uppercase tracking-wide text-text-secondary">
                  Pedidos
                </span>
                <span class="block truncate text-lg font-bold leading-tight text-text-primary">
                  {{ current.orders_count }}
                </span>
              </span>
            </div>
            <div class="flex items-center gap-2.5 bg-surface px-3 py-3">
              <span
                class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-success/10 text-success"
              >
                <app-icon name="wallet" [size]="16"></app-icon>
              </span>
              <span class="min-w-0">
                <span class="block text-[11px] font-medium uppercase tracking-wide text-text-secondary">
                  Ingresos
                </span>
                <span class="block truncate text-lg font-bold leading-tight text-text-primary">
                  {{ formatMoney(current.revenue_operating) }}
                </span>
              </span>
            </div>
            <div class="flex items-center gap-2.5 bg-surface px-3 py-3">
              <span
                class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-info/10 text-info"
              >
                <app-icon name="list" [size]="16"></app-icon>
              </span>
              <span class="min-w-0">
                <span class="block text-[11px] font-medium uppercase tracking-wide text-text-secondary">
                  Eventos
                </span>
                <span class="block truncate text-lg font-bold leading-tight text-text-primary">
                  {{ current.audit_events }}
                </span>
              </span>
            </div>
            <div class="flex items-center gap-2.5 bg-surface px-3 py-3">
              <span
                class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-warning/10 text-warning"
              >
                <app-icon name="users" [size]="16"></app-icon>
              </span>
              <span class="min-w-0">
                <span class="block text-[11px] font-medium uppercase tracking-wide text-text-secondary">
                  Usuarios
                </span>
                <span class="block truncate text-lg font-bold leading-tight text-text-primary">
                  {{ current.active_users }}
                </span>
              </span>
            </div>
            <div class="flex items-center gap-2.5 bg-surface px-3 py-3">
              <span
                class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-success/10 text-success"
              >
                <app-icon name="log-in" [size]="16"></app-icon>
              </span>
              <span class="min-w-0">
                <span class="block text-[11px] font-medium uppercase tracking-wide text-text-secondary">
                  Accesos
                </span>
                <span class="block truncate text-lg font-bold leading-tight text-text-primary">
                  {{ successfulLogins() }}
                </span>
              </span>
            </div>
          </div>
        </div>

        <!-- Filtros propios en dropdown -->
        <div class="mt-3 flex items-center justify-end">
          <app-options-dropdown
            [filters]="filterConfigs"
            [filterValues]="filterValues()"
            title="Filtros"
            triggerLabel="Filtros"
            [debounceMs]="350"
            (filterChange)="onFilterChange($event)"
            (clearAllFilters)="onClearFilters()"
          ></app-options-dropdown>
        </div>

        @if (!isLoadingSeries() && (series()?.days ?? []).length === 0) {
          <app-empty-state
            icon="activity"
            title="Sin datos"
            description="Ningún movimiento coincide con los filtros del rango."
            [showActionButton]="false"
            [showRefreshButton]="true"
            [showClearFilters]="true"
            (refreshClick)="reload()"
            (clearFiltersClick)="onClearFilters()"
          />
        } @else {
          <!-- Serie diaria -->
          <section class="mt-4">
            <h4 class="text-sm font-semibold text-text-primary">Actividad diaria</h4>
            <p class="mt-0.5 text-xs text-text-secondary">
              Pedidos, eventos auditados y accesos por día (UTC).
            </p>
            <div class="mt-2 h-64">
              <app-chart
                [options]="dailyOptions()"
                [loading]="isLoadingSeries()"
              ></app-chart>
            </div>
          </section>

          <!-- Ingreso operativo -->
          <section class="mt-5">
            <h4 class="text-sm font-semibold text-text-primary">
              Ingreso operativo por día
            </h4>
            <p class="mt-0.5 text-xs text-text-secondary">
              Suma diaria de ingreso operativo en el rango (UTC).
            </p>
            <div class="mt-2 h-64">
              <app-chart
                [options]="revenueOptions()"
                [loading]="isLoadingSeries()"
              ></app-chart>
            </div>
          </section>

          <!-- Distribuciones -->
          <div class="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2">
            <section>
              <h4 class="text-sm font-semibold text-text-primary">Pedidos por canal</h4>
              <p class="mt-0.5 text-xs text-text-secondary">
                Distribución de pedidos del rango.
              </p>
              @if (hasChannelData()) {
                <div class="mt-2 h-60">
                  <app-chart
                    [options]="channelOptions()"
                    [loading]="isLoadingSeries()"
                  ></app-chart>
                </div>
              } @else {
                <p class="mt-2 rounded-lg border border-dashed border-border px-3 py-6 text-center text-xs text-text-secondary">
                  Sin pedidos con canal en el rango.
                </p>
              }
            </section>
            <section>
              <h4 class="text-sm font-semibold text-text-primary">Pedidos por estado</h4>
              <p class="mt-0.5 text-xs text-text-secondary">
                Distribución de pedidos del rango.
              </p>
              @if (hasStateData()) {
                <div class="mt-2 h-60">
                  <app-chart
                    [options]="stateOptions()"
                    [loading]="isLoadingSeries()"
                  ></app-chart>
                </div>
              } @else {
                <p class="mt-2 rounded-lg border border-dashed border-border px-3 py-6 text-center text-xs text-text-secondary">
                  Sin pedidos con estado en el rango.
                </p>
              }
            </section>
          </div>
        }
      }
    </app-modal>
  `,
})
export class StoreActivityDetailModalComponent {
  private readonly detailService = inject(StoreActivityService);
  private readonly toastService = inject(ToastService);
  private readonly currency = inject(CurrencyFormatService);
  private readonly destroyRef = inject(DestroyRef);

  readonly isOpen = model<boolean>(false);
  readonly store = input<StoreActivityRow | null>(null);

  readonly detail = signal<StoreActivityDetail | null>(null);
  readonly series = signal<StoreActivitySeries | null>(null);
  readonly isLoadingDetail = signal(false);
  readonly isLoadingSeries = signal(false);

  readonly from = signal(defaultFrom());
  readonly to = signal(defaultTo());
  readonly rangePreset = signal('custom');
  readonly channel = signal('');
  readonly orderState = signal('');

  readonly filterConfigs: FilterConfig[] = [
    {
      key: 'range',
      label: 'Rango de fechas',
      type: 'date-range',
    },
    {
      key: 'channel',
      label: 'Canal',
      type: 'select',
      placeholder: 'Todos los canales',
      options: [
        { value: '', label: 'Todos los canales' },
        ...STORE_ACTIVITY_CHANNELS.map((c) => ({ value: c, label: c })),
      ],
    },
    {
      key: 'order_state',
      label: 'Estado de orden',
      type: 'select',
      placeholder: 'Todos los estados',
      options: [
        { value: '', label: 'Todos los estados' },
        ...STORE_ACTIVITY_ORDER_STATES.map((s) => ({ value: s, label: s })),
      ],
    },
  ];

  /**
   * Proyección reactiva al contrato plano del dropdown: el filtro
   * `date-range` se descompone en `range_start/range_end/range_preset`
   * (mismo patrón que el ranking y las analíticas de tienda).
   */
  readonly filterValues = computed<FilterValues>(() => ({
    range_start: this.from() || null,
    range_end: this.to() || null,
    range_preset: this.rangePreset(),
    channel: this.channel() || null,
    order_state: this.orderState() || null,
  }));

  /** El resumen sale del detalle existente; la fila del ranking cubre
   * el primer pintado mientras el detalle viaja. */
  readonly summary = computed(() => this.detail()?.summary ?? this.store());

  readonly successfulLogins = computed(
    () => this.detail()?.summary?.successful_logins ?? 0,
  );

  readonly rangeLabel = computed(() => {
    const from = this.from();
    const to = this.to();
    if (!from && !to) return 'Últimos 30 días';
    if (from && to) return `${formatDateOnlyUTC(from)} – ${formatDateOnlyUTC(to)}`;
    return from ? `Desde ${formatDateOnlyUTC(from)}` : `Hasta ${formatDateOnlyUTC(to)}`;
  });

  readonly hasChannelData = computed(() =>
    Object.values(this.series()?.by_channel ?? {}).some((v) => v > 0),
  );

  readonly hasStateData = computed(() =>
    Object.values(this.series()?.by_state ?? {}).some((v) => v > 0),
  );

  readonly modalTitle = computed(() => {
    const current = this.store();
    return current ? `Actividad · ${current.name}` : 'Actividad de tienda';
  });

  readonly modalSubtitle = computed(() => {
    const current = this.store();
    if (!current) return '';
    const org = current.organization_name ?? 'Sin organización';
    return `${current.slug} · ${org}`;
  });

  readonly dailyOptions = computed<EChartsOption>(() => {
    const days = this.series()?.days ?? [];
    const { border, secondary } = axisColors();
    const labels = days.map((d) => formatChartPeriod(d.date, 'day'));
    return {
      tooltip: {
        trigger: 'axis',
        confine: true,
        backgroundColor: 'rgba(255,255,255,0.98)',
        borderColor: border,
        borderWidth: 1,
        textStyle: { color: secondary, fontSize: 12 },
      },
      dataZoom: [
        {
          type: 'inside',
          start: 0,
          end: 100,
          zoomOnMouseWheel: true,
          moveOnMouseMove: true,
        },
      ],
      grid: { left: '3%', right: '4%', bottom: '18%', containLabel: true },
      xAxis: {
        type: 'category',
        data: labels,
        axisLine: { lineStyle: { color: border } },
        axisLabel: { color: secondary, fontSize: 11, hideOverlap: true },
      },
      yAxis: {
        type: 'value',
        axisLine: { show: false },
        axisLabel: { color: secondary, fontSize: 11 },
        splitLine: { lineStyle: { color: border, type: 'dashed' } },
      },
      series: [
        {
          name: 'Pedidos',
          type: 'line',
          smooth: 0.4,
          data: days.map((d) => d.orders),
          symbol: 'circle',
          symbolSize: 6,
          showSymbol: false,
          emphasis: { scale: true },
          lineStyle: { color: '#3b82f6', width: 3 },
          itemStyle: { color: '#3b82f6' },
        },
        {
          name: 'Eventos',
          type: 'line',
          smooth: 0.4,
          data: days.map((d) => d.audit_events),
          symbol: 'circle',
          symbolSize: 6,
          showSymbol: false,
          emphasis: { scale: true },
          lineStyle: { color: '#06b6d4', width: 2 },
          itemStyle: { color: '#06b6d4' },
        },
        {
          name: 'Accesos',
          type: 'line',
          smooth: 0.4,
          data: days.map((d) => d.logins),
          symbol: 'circle',
          symbolSize: 6,
          showSymbol: false,
          emphasis: { scale: true },
          lineStyle: { color: '#10b981', width: 2 },
          itemStyle: { color: '#10b981' },
        },
      ],
    };
  });

  readonly revenueOptions = computed<EChartsOption>(() => {
    const days = this.series()?.days ?? [];
    const { border, secondary } = axisColors();
    const labels = days.map((d) => formatChartPeriod(d.date, 'day'));
    return {
      tooltip: {
        trigger: 'axis',
        confine: true,
        backgroundColor: 'rgba(255,255,255,0.98)',
        borderColor: border,
        borderWidth: 1,
        textStyle: { color: secondary, fontSize: 12 },
        formatter: (params: unknown) => {
          const point = Array.isArray(params) ? params[0] : params as { name?: string; value?: number };
          const value = Number(point?.value) || 0;
          const name = String(point?.name ?? '');
          return name + '<br/>' + 'Ingreso: <strong>' + this.currency.format(value) + '</strong>';
        },
      },
      dataZoom: [
        {
          type: 'inside',
          start: 0,
          end: 100,
          zoomOnMouseWheel: true,
          moveOnMouseMove: true,
        },
      ],
      grid: { left: '3%', right: '4%', bottom: '18%', containLabel: true },
      xAxis: {
        type: 'category',
        data: labels,
        axisLine: { lineStyle: { color: border } },
        axisLabel: { color: secondary, fontSize: 11, hideOverlap: true },
      },
      yAxis: {
        type: 'value',
        axisLine: { show: false },
        axisLabel: {
          color: secondary,
          fontSize: 11,
          formatter: (value: number) => this.currency.formatChartAxis(value),
        },
        splitLine: { lineStyle: { color: border, type: 'dashed' } },
      },
      series: [
        {
          name: 'Ingreso operativo',
          type: 'bar',
          data: days.map((d) => Number(d.revenue_operating) || 0),
          itemStyle: { color: '#3b82f6', borderRadius: [6, 6, 0, 0] },
          barMaxWidth: 48,
        },
      ],
    };
  });

  readonly channelOptions = computed<EChartsOption>(() =>
    this.doughnutOptions(
      'Pedidos por canal',
      Object.entries(this.series()?.by_channel ?? {}),
    ),
  );

  readonly stateOptions = computed<EChartsOption>(() =>
    this.doughnutOptions(
      'Pedidos por estado',
      Object.entries(this.series()?.by_state ?? {}),
    ),
  );

  private doughnutOptions(
    title: string,
    entries: Array<[string, number]>,
  ): EChartsOption {
    const { secondary } = axisColors();
    return {
      tooltip: {
        trigger: 'item',
        confine: true,
        backgroundColor: 'rgba(255,255,255,0.98)',
        textStyle: { color: secondary, fontSize: 12 },
        formatter: (params: unknown) => {
          const point = params as { name?: string; value?: number };
          const value = Number(point?.value) || 0;
          return String(point?.name ?? title) + ': <strong>' + value + '</strong>';
        },
      },
      legend: {
        bottom: 0,
        textStyle: { color: secondary, fontSize: 11 },
      },
      series: [
        {
          name: title,
          type: 'pie',
          radius: ['55%', '75%'],
          center: ['50%', '44%'],
          avoidLabelOverlap: true,
          itemStyle: { borderRadius: 6, borderColor: '#fff', borderWidth: 2 },
          label: {
            color: secondary,
            fontSize: 11,
            formatter: '{b}: {c}',
          },
          data: entries.map(([name, value]) => ({ name, value })),
        },
      ],
    };
  }

  onOpened(): void {
    this.reload();
  }

  onCancel(): void {
    this.isOpen.set(false);
  }

  reload(): void {
    this.loadDetail();
    this.loadSeries();
  }

  loadDetail(): void {
    const current = this.store();
    if (!current) return;
    this.isLoadingDetail.set(true);
    this.detailService
      .getDetail(current.store_id, this.seriesQuery())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          this.detail.set(response.data ?? null);
          this.isLoadingDetail.set(false);
        },
        error: (error) => {
          this.isLoadingDetail.set(false);
          this.toastService.error(
            parseApiError(error).userMessage || 'Error al cargar el detalle de actividad',
          );
        },
      });
  }

  loadSeries(): void {
    const current = this.store();
    if (!current) return;
    this.isLoadingSeries.set(true);
    this.detailService
      .getSeries(current.store_id, this.seriesQuery())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          this.series.set(response.data ?? null);
          this.isLoadingSeries.set(false);
        },
        error: (error) => {
          this.isLoadingSeries.set(false);
          this.toastService.error(
            parseApiError(error).userMessage || 'Error al cargar la serie de actividad',
          );
        },
      });
  }

  /** Único handler de filtros: rango (vacío = últimos 30 días) + canal + estado. */
  onFilterChange(values: FilterValues): void {
    this.from.set((values['range_start'] as string) || defaultFrom());
    this.to.set((values['range_end'] as string) || defaultTo());
    this.rangePreset.set((values['range_preset'] as string) || 'custom');
    this.channel.set((values['channel'] as string) ?? '');
    this.orderState.set((values['order_state'] as string) ?? '');
    this.reload();
  }

  onClearFilters(): void {
    this.from.set(defaultFrom());
    this.to.set(defaultTo());
    this.rangePreset.set('custom');
    this.channel.set('');
    this.orderState.set('');
    this.reload();
  }

  formatScore(value: number | string | null | undefined): string {
    const n = Number(value);
    if (!Number.isFinite(n)) return '—';
    return Number.isInteger(n) ? String(n) : n.toFixed(1);
  }

  formatMoney(value: number | string | null | undefined): string {
    return this.currency.format(value ?? 0);
  }

  formatActivityDate(value: string | null | undefined): string {
    if (!value) return 'Sin actividad';
    return formatDateOnlyUTC(value);
  }

  private seriesQuery(): StoreActivitySeriesQuery {
    return {
      from: this.from() || undefined,
      to: this.to() || undefined,
      channel: this.channel().trim() || undefined,
      order_state: this.orderState().trim() || undefined,
    };
  }
}
