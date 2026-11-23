import { Component, computed, inject, input } from '@angular/core';
import type { EChartsOption } from 'echarts';

import { ChartComponent } from '../chart';
import { IconComponent } from '../icon/icon.component';
import { CurrencyFormatService } from '../../pipes/currency/currency.pipe';
import { formatChartPeriod, formatDateOnlyUTC } from '../../utils/date.util';

/** Un día de la serie de actividad (buckets UTC, días en cero incluidos). */
export interface StoreActivityChartsDay {
  date: string;
  orders: number;
  revenue_operating: number;
  audit_events: number;
  logins: number;
}

/** Series de `StoreActivityService.getSeries` (Superadmin y Cuenta Vendix). */
export interface StoreActivityChartsSeries {
  days: StoreActivityChartsDay[];
  by_channel: Record<string, number>;
  by_state: Record<string, number>;
}

/** Fila resumen del comercio (sin identidad ni timeline). */
export interface StoreActivityChartsSummary {
  score: number;
  orders_count: number;
  revenue_operating: number;
  active_users: number;
  audit_events: number;
  last_activity_at: string | null;
}

function axisColors(): { border: string; secondary: string } {
  if (typeof document === 'undefined') {
    return { border: '#e5e7eb', secondary: '#6b7280' };
  }
  const style = getComputedStyle(document.documentElement);
  return {
    border: style.getPropertyValue('--color-border').trim() || '#e5e7eb',
    secondary: style.getPropertyValue('--color-text-secondary').trim() || '#6b7280',
  };
}

/**
 * Gráficas de actividad de un comercio: serie diaria (pedidos, eventos,
 * accesos), ingreso operativo por día y doughnuts por canal y estado. Una sola
 * fuente para el detalle de Superadmin (`app-store-activity-detail-modal`) y la
 * Cuenta Vendix del CRM de Vendix Platform.
 *
 * `summary` es opcional: pinta una tira de métricas encima (la Cuenta Vendix);
 * Superadmin tiene su propio hero y no la pasa.
 */
@Component({
  selector: 'app-store-activity-charts',
  standalone: true,
  host: { class: 'block' },
  imports: [ChartComponent, IconComponent],
  template: `
    @if (summary(); as current) {
      <div
        class="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-5"
        data-testid="store-activity-summary"
      >
        <div class="flex flex-col bg-surface px-3 py-3">
          <span class="text-[11px] font-medium uppercase tracking-wide text-text-secondary">Score</span>
          <span class="text-lg font-bold leading-tight text-text-primary">{{ formatScore(current.score) }}</span>
        </div>
        <div class="flex flex-col bg-surface px-3 py-3">
          <span class="text-[11px] font-medium uppercase tracking-wide text-text-secondary">Pedidos</span>
          <span class="text-lg font-bold leading-tight text-text-primary">{{ current.orders_count }}</span>
        </div>
        <div class="flex flex-col bg-surface px-3 py-3">
          <span class="text-[11px] font-medium uppercase tracking-wide text-text-secondary">Ingresos</span>
          <span class="truncate text-lg font-bold leading-tight text-text-primary">
            {{ formatMoney(current.revenue_operating) }}
          </span>
        </div>
        <div class="flex flex-col bg-surface px-3 py-3">
          <span class="text-[11px] font-medium uppercase tracking-wide text-text-secondary">Usuarios</span>
          <span class="text-lg font-bold leading-tight text-text-primary">{{ current.active_users }}</span>
        </div>
        <div class="col-span-2 flex flex-col bg-surface px-3 py-3 sm:col-span-1">
          <span class="text-[11px] font-medium uppercase tracking-wide text-text-secondary">Última actividad</span>
          <span class="flex items-center gap-1 text-sm font-semibold leading-tight text-text-primary">
            <app-icon name="clock" [size]="12" class="shrink-0"></app-icon>
            {{ formatActivityDate(current.last_activity_at) }}
          </span>
        </div>
      </div>
    }

    <!-- Serie diaria -->
    <section class="mt-4">
      <h4 class="text-sm font-semibold text-text-primary">Actividad diaria</h4>
      <p class="mt-0.5 text-xs text-text-secondary">
        Pedidos, eventos auditados y accesos por día (UTC).
      </p>
      <div class="mt-2 h-64">
        <app-chart [options]="dailyOptions()" [loading]="loading()"></app-chart>
      </div>
    </section>

    <!-- Ingreso operativo -->
    <section class="mt-5">
      <h4 class="text-sm font-semibold text-text-primary">Ingreso operativo por día</h4>
      <p class="mt-0.5 text-xs text-text-secondary">
        Suma diaria de ingreso operativo en el rango (UTC).
      </p>
      <div class="mt-2 h-64">
        <app-chart [options]="revenueOptions()" [loading]="loading()"></app-chart>
      </div>
    </section>

    <!-- Distribuciones -->
    <div class="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2">
      <section>
        <h4 class="text-sm font-semibold text-text-primary">Pedidos por canal</h4>
        <p class="mt-0.5 text-xs text-text-secondary">Distribución de pedidos del rango.</p>
        @if (hasChannelData()) {
          <div class="mt-2 h-60">
            <app-chart [options]="channelOptions()" [loading]="loading()"></app-chart>
          </div>
        } @else {
          <p class="mt-2 rounded-lg border border-dashed border-border px-3 py-6 text-center text-xs text-text-secondary">
            Sin pedidos con canal en el rango.
          </p>
        }
      </section>
      <section>
        <h4 class="text-sm font-semibold text-text-primary">Pedidos por estado</h4>
        <p class="mt-0.5 text-xs text-text-secondary">Distribución de pedidos del rango.</p>
        @if (hasStateData()) {
          <div class="mt-2 h-60">
            <app-chart [options]="stateOptions()" [loading]="loading()"></app-chart>
          </div>
        } @else {
          <p class="mt-2 rounded-lg border border-dashed border-border px-3 py-6 text-center text-xs text-text-secondary">
            Sin pedidos con estado en el rango.
          </p>
        }
      </section>
    </div>
  `,
})
export class StoreActivityChartsComponent {
  private readonly currency = inject(CurrencyFormatService);

  readonly series = input<StoreActivityChartsSeries | null>(null);
  readonly summary = input<StoreActivityChartsSummary | null>(null);
  readonly loading = input(false);

  readonly hasChannelData = computed(() =>
    Object.values(this.series()?.by_channel ?? {}).some((v) => v > 0),
  );

  readonly hasStateData = computed(() =>
    Object.values(this.series()?.by_state ?? {}).some((v) => v > 0),
  );

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
    this.doughnutOptions('Pedidos por canal', Object.entries(this.series()?.by_channel ?? {})),
  );

  readonly stateOptions = computed<EChartsOption>(() =>
    this.doughnutOptions('Pedidos por estado', Object.entries(this.series()?.by_state ?? {})),
  );

  private doughnutOptions(title: string, entries: Array<[string, number]>): EChartsOption {
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
}
