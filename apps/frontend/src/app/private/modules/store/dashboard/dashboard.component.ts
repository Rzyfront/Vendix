import { Component, signal, inject, effect, untracked, computed, DestroyRef } from '@angular/core';
import { Router } from '@angular/router';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { EChartsOption } from 'echarts';

import { AuthFacade } from '../../../../core/store/auth/auth.facade';
import { StatsComponent } from '../../../../shared/components/stats/stats.component';
import { ChartComponent } from '../../../../shared/components/chart/chart.component';
import { IconComponent } from '../../../../shared/components/icon/icon.component';
import { EmptyStateComponent } from '../../../../shared/components/empty-state/empty-state.component';
import { ToastService } from '../../../../shared/components/toast/toast.service';
import { CurrencyFormatService } from '../../../../shared/pipes/currency';
import { OptionsDropdownComponent } from '../../../../shared/components/options-dropdown/options-dropdown.component';
import { FilterConfig, FilterValues } from '../../../../shared/components/options-dropdown/options-dropdown.interfaces';

import { toLocalDateString, getDefaultEndDate, formatChartPeriod } from '../../../../shared/utils/date.util';
import { AnalyticsService, ProfitLossSummary } from '../analytics/services/analytics.service';
import { DateRangeFilter } from '../analytics/interfaces/analytics.interface';
import {
  SalesTrend,
  SalesByChannel,
  SalesAnalyticsQueryDto,
} from '../analytics/interfaces/sales-analytics.interface';
import { StoreDashboardService } from './services/store-dashboard.service';

// Channel → CSS variable mapping for the pie chart
const CHANNEL_COLOR_VAR: Record<string, string> = {
  pos: '--color-primary',
  ecommerce: '--color-secondary',
  whatsapp: '--color-accent',
  agent: '--color-warning',
  marketplace: '--color-error',
  default: '--color-muted-foreground',
};

// Quick-access links configuration
interface QuickLink {
  icon: string;
  label: string;
  route: string;
}

const QUICK_LINKS: QuickLink[] = [
  { icon: 'trending-up', label: 'Resumen de Ventas', route: '/admin/analytics/sales/summary' },
  { icon: 'package', label: 'Ventas por Producto', route: '/admin/analytics/sales/by-product' },
  { icon: 'shopping-cart', label: 'Órdenes', route: '/admin/orders/sales' },
  { icon: 'alert-triangle', label: 'Stock Info', route: '/admin/analytics/inventory/stock-info' },
  { icon: 'credit-card', label: 'Gastos', route: '/admin/expenses' },
  { icon: 'users', label: 'Clientes', route: '/admin/analytics/customers/summary' },
  { icon: 'shopping-bag', label: 'Compras', route: '/admin/inventory/pop' },
];

@Component({
  selector: 'app-store-dashboard',
  standalone: true,
  imports: [
    StatsComponent,
    ChartComponent,
    IconComponent,
    OptionsDropdownComponent,
    EmptyStateComponent,
  ],
  template: `
    <div class="w-full space-y-4 pb-6">
      <!-- 4 Stats Cards (Bug 6 — decisión de producto 2026-08-14: el usuario
           pidió explícitamente retirar Ganancias y Órdenes del dashboard
           principal por sobrecarga visual). Backend sigue calculando esas
           métricas (FinancialAnalyticsService + StoreDashboardService) por si
           se restauran en otra superficie; aquí solo dejamos Ingresos /
           Balance / Gastos / Reembolsos. -->
      <div class="stats-container">
        <!-- Las cuatro tarjetas leen BASE CAJA (cash.*): el día de negocio es el
             de la tienda y cada cifra se bucketea por el instante en que la plata
             se movió, no por la fecha del documento.

             Los fondos de ícono usan los tokens *-light y no bg-*/10: en Tailwind
             3 un token declarado como var(--color-x) plano NO admite el
             modificador de opacidad, así que bg-success/10, bg-info/10 y
             bg-error/10 no compilaban a ninguna regla y esas tres tarjetas venían
             sin fondo desde antes, en silencio. bg-primary/10 sí funciona porque
             ese token es rgba(var(--color-primary-rgb), alpha). -->
        <app-stats
          title="Ingresos"
          [value]="formatCurrency(profitLoss()?.cash?.income || 0)"
          [smallText]="ingresosSubText()"
          iconName="dollar-sign"
          iconBgColor="bg-primary/10"
          iconColor="text-primary"
          [loading]="loading()"
        />
        <app-stats
          title="Ganancias"
          [value]="formatCurrency(profitLoss()?.cash?.net_profit || 0)"
          [smallText]="gananciasSubText()"
          iconName="trending-up"
          iconBgColor="bg-success-light"
          iconColor="text-success"
          [loading]="loading()"
        />
        <app-stats
          title="Balance"
          [value]="formatCurrency(profitLoss()?.cash?.balance || 0)"
          [smallText]="balanceSubText()"
          iconName="wallet"
          iconBgColor="bg-info-light"
          iconColor="text-info"
          [loading]="loading()"
        />
        <app-stats
          title="Gastos"
          [value]="formatCurrency(profitLoss()?.operating_expenses || 0)"
          [smallText]="gastosSubText()"
          iconName="trending-down"
          iconBgColor="bg-error-light"
          iconColor="text-error"
          [loading]="loading()"
        />
      </div>

      <!-- Cost coverage: a COGS built on missing snapshots reads as a 100 %
           margin, which looks exactly like a real one. -->
      @if (hasIncompleteCost()) {
        <div
          class="flex items-start gap-3 p-3 rounded-lg bg-warning-light border border-warning/30"
        >
          <app-icon
            name="alert-triangle"
            [size]="16"
            class="text-warning shrink-0 mt-0.5"
          ></app-icon>
          <p class="text-xs text-text-secondary leading-relaxed">
            {{ incompleteCostText() }}
          </p>
        </div>
      }

      <!-- Charts: Trend (2/3) + Channels (1/3) -->
      <div class="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <!-- Sales Trend Chart -->
        <div class="lg:col-span-2 bg-surface rounded-xl shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:border md:border-border overflow-hidden flex flex-col">
          <div class="p-4 border-b border-border flex items-center justify-between gap-2">
            <div>
              <h3 class="font-semibold text-text-primary text-sm">Tendencia de Ventas</h3>
              <p class="text-xs text-text-secondary">{{ dateRangeLabel() }}</p>
            </div>
            <app-options-dropdown
              [filters]="dateFilters()"
              [filterValues]="dateFilterValues()"
              title="Período"
              triggerLabel="Período"
              [debounceMs]="300"
              (filterChange)="onDateFilterChange($event)"
            />
          </div>
          <div class="p-4 flex-1">
            @if (loadingTrends()) {
              <div class="h-56 flex items-center justify-center">
                <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
              </div>
            } @else if (trends().length === 0) {
              <app-empty-state
                icon="bar-chart-2"
                title="No hay datos de ventas"
                description="Realiza ventas para ver las tendencias"
                [showActionButton]="false"
                size="sm"
              />
            } @else {
              <app-chart [options]="trendChartOptions()" size="large"></app-chart>
            }
          </div>
        </div>

        <!-- Sales by Channel Chart -->
        <div class="bg-surface rounded-xl shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:border md:border-border overflow-hidden flex flex-col">
          <div class="p-4 border-b border-border">
            <h3 class="font-semibold text-text-primary text-sm">Ventas por Canal</h3>
            <p class="text-xs text-text-secondary">Distribución del período</p>
          </div>
          <div class="p-4 flex-1">
            @if (loadingChannels()) {
              <div class="h-56 flex items-center justify-center">
                <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
              </div>
            } @else if (channels().length === 0) {
              <app-empty-state
                icon="pie-chart"
                title="No hay datos de canales"
                description="Realiza ventas para ver la distribución por canal"
                [showActionButton]="false"
                size="sm"
              />
            } @else {
              <app-chart [options]="channelChartOptions()" size="large"></app-chart>
            }
          </div>
        </div>
      </div>

      <!-- Alerts (1/2) + Quick Links (1/2) -->
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <!-- Alerts Panel -->
        <div class="bg-surface rounded-xl shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:border md:border-border overflow-hidden">
          <div class="px-4 py-3 border-b border-border">
            <h3 class="font-semibold text-text-primary text-sm">Alertas Operativas</h3>
          </div>
          <div class="p-3 space-y-2">
            @if (loadingAlerts()) {
              <div class="py-4 flex items-center justify-center">
                <div class="animate-spin rounded-full h-6 w-6 border-b-2 border-primary"></div>
              </div>
            } @else {
              @if (lowStockCount() > 0) {
                <div
                  class="flex items-center gap-3 p-3 bg-warning-light rounded-lg cursor-pointer hover:bg-warning/15 transition-colors"
                  (click)="navigateTo('/admin/analytics/inventory/stock-info')"
                >
                  <div class="flex-shrink-0 w-7 h-7 bg-warning/20 rounded-full flex items-center justify-center">
                    <app-icon name="alert-triangle" [size]="14" class="text-warning"></app-icon>
                  </div>
                  <div class="flex-1 min-w-0">
                    <p class="text-sm font-medium text-warning">{{ lowStockCount() }} bajo stock</p>
                  </div>
                  <app-icon name="chevron-right" [size]="14" class="text-warning/60"></app-icon>
                </div>
              }

              @if (outOfStockCount() > 0) {
                <div
                  class="flex items-center gap-3 p-3 bg-error-light rounded-lg cursor-pointer hover:bg-error/15 transition-colors"
                  (click)="navigateTo('/admin/analytics/inventory/stock-info')"
                >
                  <div class="flex-shrink-0 w-7 h-7 bg-error/20 rounded-full flex items-center justify-center">
                    <app-icon name="x-circle" [size]="14" class="text-error"></app-icon>
                  </div>
                  <div class="flex-1 min-w-0">
                    <p class="text-sm font-medium text-error">{{ outOfStockCount() }} agotados</p>
                  </div>
                  <app-icon name="chevron-right" [size]="14" class="text-error/60"></app-icon>
                </div>
              }

              @if (dispatchPendingCount() > 0) {
                <div
                  class="flex items-center gap-3 p-3 bg-primary/10 rounded-lg cursor-pointer hover:bg-primary/15 transition-colors"
                  (click)="navigateTo('/admin/orders/sales?dispatchable=true')"
                >
                  <div class="flex-shrink-0 w-7 h-7 bg-primary/20 rounded-full flex items-center justify-center">
                    <app-icon name="truck" [size]="14" class="text-primary"></app-icon>
                  </div>
                  <div class="flex-1 min-w-0">
                    <p class="text-sm font-medium text-primary">{{ dispatchPendingCount() }} listas para despachar</p>
                  </div>
                  <app-icon name="chevron-right" [size]="14" class="text-primary/60"></app-icon>
                </div>
              }

              @if (refundPendingCount() > 0) {
                <div
                  class="flex items-center gap-3 p-3 bg-accent/10 rounded-lg cursor-pointer hover:bg-accent/15 transition-colors"
                  (click)="navigateTo('/admin/orders/sales?status=refunded')"
                >
                  <div class="flex-shrink-0 w-7 h-7 bg-accent/20 rounded-full flex items-center justify-center">
                    <app-icon name="rotate-ccw" [size]="14" class="text-accent"></app-icon>
                  </div>
                  <div class="flex-1 min-w-0">
                    <p class="text-sm font-medium text-accent">{{ refundPendingCount() }} reembolsos pendientes</p>
                  </div>
                  <app-icon name="chevron-right" [size]="14" class="text-accent/60"></app-icon>
                </div>
              }

              @if (lowStockCount() === 0 && outOfStockCount() === 0 && dispatchPendingCount() === 0 && refundPendingCount() === 0) {
                <app-empty-state
                  icon="check-circle"
                  iconColor="success"
                  title="Todo en orden"
                  description="Sin alertas pendientes"
                  [showActionButton]="false"
                  size="sm"
                />
              }
            }
          </div>
        </div>

        <!-- Quick Links -->
        <div class="bg-surface rounded-xl shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:border md:border-border overflow-hidden">
          <div class="px-4 py-3 border-b border-border">
            <h3 class="font-semibold text-text-primary text-sm">Accesos Rápidos</h3>
          </div>
          <div class="p-3 grid grid-cols-2 gap-1">
            @for (link of quickLinks; track link.route) {
              <button
                class="flex items-center gap-2 px-3 py-2.5 text-sm text-text-primary hover:bg-primary/5 rounded-lg transition-colors text-left"
                (click)="navigateTo(link.route)"
              >
                <app-icon [name]="link.icon" [size]="15" class="text-text-secondary"></app-icon>
                <span class="truncate">{{ link.label }}</span>
              </button>
            }
          </div>
        </div>
      </div>
    </div>
  `,
})
export class DashboardComponent {
  private readonly authFacade = inject(AuthFacade);
  private readonly analyticsService = inject(AnalyticsService);
  private readonly dashboardService = inject(StoreDashboardService);
  private readonly currencyService = inject(CurrencyFormatService);
  private readonly toastService = inject(ToastService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  // Quick links config
  readonly quickLinks = QUICK_LINKS;

  // Preset options for the date filter
  private readonly presetOptions = [
    { value: 'today', label: 'Hoy' },
    { value: 'yesterday', label: 'Ayer' },
    { value: 'thisWeek', label: 'Esta Semana' },
    { value: 'lastWeek', label: 'Semana Pasada' },
    { value: 'thisMonth', label: 'Este Mes' },
    { value: 'lastMonth', label: 'Mes Pasado' },
    { value: 'thisYear', label: 'Este Año' },
    { value: 'lastYear', label: 'Año Pasado' },
    { value: 'custom', label: 'Personalizado' },
  ];

  // Store — derived from facade signal (userStore$ converted once)
  private readonly userStore = toSignal(this.authFacade.userStore$, { initialValue: null });
  storeId = signal<string | null>(null);

  // Date range
  //
  // QUI-744: el filtro del dashboard quedaba fijado en 'hoy' y no respondía al
  // cambio de preset. Tres causas medidas:
  //   (a) `dateRange` y `selectedPreset` eran signals independientes que el
  //       handler tenía que sincronizar a mano — si el handler salía por el
  //       camino `custom` sin `start && end`, `dateRange` quedaba stale.
  //   (b) `dateFilterValues` era un `computed` que devolvía un objeto NUEVO
  //       en cada lectura; el sync effect del `options-dropdown` lo
  //       comparaba con `localFilterValues` por `shallowEqual` (key count
  //       primero) → siempre veía `incoming` con `start_date/end_date: null`
  //       y `local` con solo `{preset}` → pisaba el local justo antes de que
  //       el `timer(0)` emitiese.
  //   (c) `debounceMs="0"` con `timer(0)` programaba en macrotask y dejaba
  //       la ventana abierta para que el sync effect corriese primero.
  //
  // Fix: `dateRange` ahora es un `computed` derivado del preset + customRange
  // (single source of truth — cambiar el preset siempre actualiza dateRange
  // atómicamente); `dateFilterValues` es un writable signal que el handler
  // rellena con la forma EXACTA que emitió el dropdown (round-trip estable
  // → shallowEqual pasa → no overwrite); `debounceMs=300` da tiempo real al
  // sync effect para correr antes que el emit.

  selectedPreset = signal<string>('today');
  private readonly customRange = signal<{ start_date: string; end_date: string }>({
    start_date: '',
    end_date: '',
  });

  // Dynamic filters: show date inputs when preset is 'custom'
  dateFilters = computed<FilterConfig[]>(() => {
    const filters: FilterConfig[] = [
      {
        key: 'preset',
        label: 'Período',
        type: 'select',
        options: this.presetOptions,
        placeholder: 'Seleccionar período',
      },
    ];
    if ((this.selectedPreset() as string) === 'custom') {
      filters.push(
        { key: 'start_date', label: 'Fecha inicio', type: 'date' },
        { key: 'end_date', label: 'Fecha fin', type: 'date' },
      );
    }
    return filters;
  });

  // Stable writable signal — se setea explícitamente en el handler con la
  // forma exacta del dropdown (`{preset}` o `{preset, start_date, end_date}`
  // sólo cuando aplica). Así el round-trip preserva la cantidad de keys y
  // el `shallowEqual` del sync effect del dropdown pasa → no pisa el local.
  private readonly _dateFilterValues = signal<FilterValues>({ preset: 'today' });
  readonly dateFilterValues = this._dateFilterValues.asReadonly();

  dateRangeLabel = computed(() => {
    const range = this.dateRange();
    if (!range.start_date || !range.end_date) {
      return 'Selecciona un rango';
    }
    const start = new Date(range.start_date + 'T12:00:00').toLocaleDateString('es-CO', { day: '2-digit', month: 'short' });
    const end = new Date(range.end_date + 'T12:00:00').toLocaleDateString('es-CO', { day: '2-digit', month: 'short' });
    return `${start} - ${end}`;
  });

  // dateRange es un computed del preset + customRange. Single source of truth:
  // el backend (`analytics-query.dto` + `parseDateRange`) resuelve las fechas
  // del preset en la TZ de la tienda. La capa front solo necesita mandar el
  // `preset` (o `start_date/end_date` si es custom). Ver analytics-metrics
  // contract — `getDateRangeFromPreset` se mantiene solo como fallback para
  // el label visible y para custom; el backend es el dueño del cálculo.
  dateRange = computed<DateRangeFilter>(() => {
    const preset = this.selectedPreset();
    if (preset === 'custom') {
      const c = this.customRange();
      return {
        start_date: c.start_date,
        end_date: c.end_date,
        preset: 'custom',
      };
    }
    const range = this.getDateRangeFromPreset(preset);
    return (
      range ?? {
        start_date: getDefaultEndDate(),
        end_date: getDefaultEndDate(),
        preset: 'today' as any,
      }
    );
  });

  // Loading states
  loading = signal(true);
  loadingTrends = signal(true);
  loadingChannels = signal(true);
  loadingAlerts = signal(true);

  // Data
  profitLoss = signal<ProfitLossSummary | null>(null);
  trends = signal<SalesTrend[]>([]);
  trendGranularity = signal<'hour' | 'day'>('day');
  channels = signal<SalesByChannel[]>([]);
  lowStockCount = signal(0);
  outOfStockCount = signal(0);
  dispatchPendingCount = signal(0);
  refundPendingCount = signal(0);

  // Charts
  trendChartOptions = signal<EChartsOption>({});
  channelChartOptions = signal<EChartsOption>({});

  constructor() {
    this.currencyService.loadCurrency();

    // Bootstrap: wait for store id then load data once.
    //
    // NOTA: este effect llama loadAllData() una vez al detectar el store. NO
    // hace falta coordinarlo con el effect del dateRange porque cada uno se
    // dispara por su propia signal. Si el store ya estaba seteado cuando el
    // effect corre por primera vez (CD tras init), el body se ejecuta y
    // fetchea "today" — es el comportamiento esperado del primer render.
    effect(() => {
      const store = this.userStore();
      const id = (store as any)?.id;
      if (id && !this.storeId()) {
        this.storeId.set(String(id));
        untracked(() => this.loadAllData());
      }
    });

    // React to date range changes. Como `dateRange` ahora es un `computed`
    // del preset + customRange, este effect se dispara SIEMPRE que el usuario
    // cambia el preset (no hay carrera entre `selectedPreset` y `dateRange`
    // porque son la misma fuente). El guard `isFirst` se reemplazó por
    // `userChangedFilter` — solo recargamos cuando el usuario cambió algo,
    // no en la primera lectura ni cuando el bootstrap effect ya disparó
    // el fetch inicial. Esto evita el doble GET al montar el componente.
    let userChangedFilter = false;
    effect(() => {
      this.dateRange();
      if (!userChangedFilter) return;
      untracked(() => this.loadAllData());
    });
    // Marcamos el "ya cambió el usuario" recién cuando el handler corre;
    // así el primer render monta la pantalla con los datos del bootstrap
    // effect (que ya disparó loadAllData) y no recargamos encima.
    effect(() => {
      // Solo leemos para registrar reactividad; el handler setea el flag.
      this.dateFilterValues();
      untracked(() => {
        userChangedFilter = true;
      });
    });
  }

  onDateFilterChange(values: FilterValues): void {
    const preset = values['preset'] as string;
    if (!preset) return;

    this.selectedPreset.set(preset);

    // Round-trip: replicar la forma EXACTA que emitió el dropdown.
    // Si el preset no es custom, NO añadimos `start_date/end_date: null`
    // porque el sync effect del dropdown compara por key count y eso
    // causaba el overwrite que rompía el flujo.
    if (preset === 'custom') {
      const start = values['start_date'] as string;
      const end = values['end_date'] as string;
      if (start || end) {
        this.customRange.update((c) => ({
          start_date: start || c.start_date,
          end_date: end || c.end_date,
        }));
      }
      this._dateFilterValues.set({
        preset: 'custom',
        ...(start ? { start_date: start } : {}),
        ...(end ? { end_date: end } : {}),
      });
    } else {
      this._dateFilterValues.set({ preset });
    }
  }

  // ── Data Loading ─────────────────────────────────────────

  private loadAllData(): void {
    const storeId = this.storeId();
    if (!storeId) return;

    const query: SalesAnalyticsQueryDto = { date_range: this.dateRange() };

    // Reset loading states
    this.loading.set(true);
    this.loadingTrends.set(true);
    this.loadingChannels.set(true);
    this.loadingAlerts.set(true);

    // 1. Profit & Loss → the FOUR money cards. Single source on purpose: revenue,
    // cost, expenses, profit and their growth all come from one aggregation, so
    // the numbers on this screen always reconcile with each other.
    this.analyticsService
      .getProfitLossSummary(query)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          this.profitLoss.set(response.data);
          this.loading.set(false);
        },
        error: () => {
          this.toastService.error('Error al cargar el resumen');
          this.loading.set(false);
        },
      });

    // 2. Sales trends → trend chart (hourly when viewing "today", else daily)
    const trendGranularity: 'hour' | 'day' =
      this.selectedPreset() === 'today' ? 'hour' : 'day';
    this.trendGranularity.set(trendGranularity);
    this.analyticsService
      .getSalesTrends({ ...query, granularity: trendGranularity })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          const data = response.data || [];
          this.trends.set(data);
          this.updateTrendChart(data);
          this.loadingTrends.set(false);
        },
        error: () => this.loadingTrends.set(false),
      });

    // 3. Sales by channel → pie chart
    this.analyticsService
      .getSalesByChannel(query)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          const data = response.data || [];
          this.channels.set(data);
          this.updateChannelChart(data);
          this.loadingChannels.set(false);
        },
        error: () => this.loadingChannels.set(false),
      });

    // 4. Dashboard stats → dispatch/refund alerts
    this.dashboardService
      .getDashboardStats()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (stats) => {
          this.dispatchPendingCount.set(stats.dispatchPendingCount || 0);
          this.refundPendingCount.set(stats.refundPendingCount || 0);
        },
        error: () => { /* alerts are non-critical */ },
      });

    // 5. Inventory summary → low stock/out of stock alerts
    this.analyticsService
      .getInventorySummary({})
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          this.lowStockCount.set(response.data.low_stock_count || 0);
          this.outOfStockCount.set(response.data.out_of_stock_count || 0);
          this.loadingAlerts.set(false);
        },
        error: () => this.loadingAlerts.set(false),
      });
  }

  // ── Chart Builders ───────────────────────────────────────

  private updateTrendChart(trends: SalesTrend[]): void {
    if (!trends?.length) return;

    const style = getComputedStyle(document.documentElement);
    const primaryColor = style.getPropertyValue('--color-primary').trim() || '#2ecc71';
    const accentColor = style.getPropertyValue('--color-accent').trim() || '#06b6d4';
    const mutedColor = style.getPropertyValue('--color-muted-foreground').trim() || '#6b7280';
    const borderColor = style.getPropertyValue('--color-border').trim() || '#e5e7eb';

    const labels = trends.map((t) => formatChartPeriod(t.period, this.trendGranularity()));
    const revenues = trends.map((t) => t.revenue);
    const orders = trends.map((t) => t.orders);

    this.trendChartOptions.set({
      tooltip: {
        trigger: 'axis',
        formatter: (params: any) => {
          const rev = params[0];
          const ord = params[1];
          return `<strong>${rev.name}</strong><br/>Ingresos: ${this.currencyService.formatCompact(rev.value)}<br/>Órdenes: ${ord?.value || 0}`;
        },
      },
      legend: {
        data: ['Ingresos', 'Órdenes'],
        bottom: 0,
        textStyle: { color: mutedColor, fontSize: 11 },
      },
      grid: { left: '3%', right: '4%', bottom: '15%', top: '5%', containLabel: true },
      xAxis: {
        type: 'category',
        data: labels,
        axisLine: { lineStyle: { color: borderColor } },
        axisLabel: { color: mutedColor, fontSize: 10 },
      },
      yAxis: [
        {
          type: 'value',
          position: 'left',
          axisLine: { show: false },
          axisLabel: {
            color: mutedColor,
            fontSize: 10,
            formatter: (value: number) => this.currencyService.formatChartAxis(value),
          },
          splitLine: { lineStyle: { color: borderColor } },
        },
        {
          type: 'value',
          position: 'right',
          axisLine: { show: false },
          axisLabel: { color: mutedColor, fontSize: 10 },
          splitLine: { show: false },
        },
      ],
      series: [
        {
          name: 'Ingresos',
          type: 'line',
          smooth: true,
          data: revenues,
          yAxisIndex: 0,
          areaStyle: {
            color: {
              type: 'linear',
              x: 0, y: 0, x2: 0, y2: 1,
              colorStops: [
                { offset: 0, color: primaryColor + '4D' },
                { offset: 1, color: primaryColor + '0D' },
              ],
            },
          },
          lineStyle: { color: primaryColor, width: 2 },
          itemStyle: { color: primaryColor },
        },
        {
          name: 'Órdenes',
          type: 'bar',
          data: orders,
          yAxisIndex: 1,
          itemStyle: { color: accentColor + '99', borderRadius: [2, 2, 0, 0] },
          barMaxWidth: 16,
        },
      ],
    });
  }

  private updateChannelChart(channels: SalesByChannel[]): void {
    if (!channels?.length) return;

    const style = getComputedStyle(document.documentElement);
    const mutedColor = style.getPropertyValue('--color-muted-foreground').trim() || '#6b7280';
    const textColor = style.getPropertyValue('--color-text-primary').trim() || '#374151';
    const surfaceColor = style.getPropertyValue('--color-surface').trim() || '#fff';

    const channelColors = channels.map((c) => {
      const cssVar = CHANNEL_COLOR_VAR[c.channel.toLowerCase()] || CHANNEL_COLOR_VAR['default'];
      return style.getPropertyValue(cssVar).trim() || '#6b7280';
    });

    this.channelChartOptions.set({
      tooltip: {
        trigger: 'item',
        formatter: (params: any) =>
          `<strong>${params.name}</strong><br/>${this.currencyService.formatCompact(params.value)}<br/>${params.percent.toFixed(1)}%`,
      },
      legend: {
        bottom: 0,
        left: 'center',
        orient: 'horizontal',
        textStyle: { color: mutedColor, fontSize: 10 },
        itemWidth: 12,
        itemHeight: 12,
        itemGap: 10,
      },
      calculable: true,
      series: [
        {
          name: 'Ventas por Canal',
          type: 'pie',
          radius: [30, 110],
          center: ['50%', '45%'],
          roseType: 'area',
          itemStyle: { borderRadius: 4, borderColor: surfaceColor, borderWidth: 2 },
          label: {
            show: true,
            fontSize: 11,
            color: textColor,
          },
          labelLine: {
            show: true,
            length: 10,
            length2: 15,
            lineStyle: { color: mutedColor },
          },
          emphasis: {
            label: { show: true, fontSize: 13, fontWeight: 'bold' },
            itemStyle: { shadowBlur: 10, shadowOffsetX: 0, shadowColor: 'rgba(0, 0, 0, 0.2)' },
          },
          data: channels.map((c, i) => ({
            value: c.revenue,
            name: c.display_name || c.channel,
            itemStyle: { color: channelColors[i] },
          })),
        },
      ],
    });
  }

  // ── Helpers ──────────────────────────────────────────────

  formatCurrency(value: number): string {
    return this.currencyService.formatCompact(value);
  }

  /**
   * The comparison label is DERIVED from the selected preset. It used to read
   * "vs mes ant." for every preset — including "Hoy" and "Este Año", where the
   * comparison being made was not a month at all.
   *
   * `null` growth means the previous period had no base; saying "0 %" there
   * asserts "no change" about a period that had nothing.
   */
  getGrowthText(growth?: number | null): string {
    if (growth === undefined || growth === null) return 'sin base de comparación';
    const sign = growth >= 0 ? '+' : '';
    return `${sign}${growth.toFixed(1)}% vs ${this.comparisonLabel()}`;
  }

  /** What the previous equivalent period is called, per selected preset. */
  private comparisonLabel(): string {
    switch (this.selectedPreset()) {
      case 'today':
        return 'ayer';
      case 'yesterday':
        return 'día ant.';
      case 'thisWeek':
      case 'lastWeek':
        return 'semana ant.';
      case 'thisMonth':
      case 'lastMonth':
        return 'mes ant.';
      case 'thisYear':
      case 'lastYear':
        return 'año ant.';
      default:
        return 'período ant.';
    }
  }

  getMarginText(margin?: number): string {
    if (margin === undefined || margin === null) return '';
    return `${margin.toFixed(1)}% margen`;
  }

  /**
   * Sub-etiqueta de INGRESOS. El número grande es `cash.income`: toda la plata
   * que entró en el día, BRUTA. Abajo van las dos cifras que el comerciante
   * necesita para leerlo bien:
   *  - "Sin IVA": el ingreso menos el impuesto trasladado (IVA + INC) que viene
   *    dentro, prorrateado por la fracción efectivamente cobrada de cada orden.
   *  - "Reembolsos": lo que salió de vuelta ESE día, bucketeado por la fecha del
   *    reembolso y nunca por la de la venta original.
   * Si además hay reembolsos solicitados sin desembolsar, se avisan: no están
   * restados en ninguna cifra porque la plata todavía no se movió.
   *
   * Las partes se unen con ' · ' y no con '\n': `.stat-small` del componente
   * compartido no declara `white-space: pre-line` y clampa a 2 líneas, así que
   * un salto de línea se colapsaba a espacio y las cifras quedaban pegadas.
   */
  readonly ingresosSubText = computed(() => {
    const cash = this.profitLoss()?.cash;
    const parts = [`Sin IVA: ${this.formatCurrency(cash?.income_without_tax || 0)}`];
    const refunds = cash?.refunds || 0;
    if (refunds > 0) {
      parts.push(`Reembolsos: ${this.formatCurrency(refunds)}`);
    }
    const pending = cash?.refunds_pending || 0;
    if (pending > 0) {
      parts.push(`Por reembolsar: ${this.formatCurrency(pending)}`);
    }
    return parts.join(' · ');
  });

  /**
   * Sub-etiqueta de GANANCIAS. El número grande ya está neto de IVA, de costo y
   * de reembolsos; abajo va la misma ganancia después de los gastos que salieron
   * de la caja — lo que de verdad quedó en el bolsillo.
   */
  readonly gananciasSubText = computed(() => {
    const cash = this.profitLoss()?.cash;
    if (!cash) return '';
    const parts = [
      `Tras gastos: ${this.formatCurrency(cash.net_profit_after_expenses || 0)}`,
    ];
    if (cash.net_margin) {
      parts.push(this.getMarginText(cash.net_margin));
    }
    return parts.join(' · ');
  });

  /**
   * Sub-etiqueta de BALANCE. El número grande es la posición de caja del día
   * (entró − devuelto − pagado); abajo va la caja acumulada, que es LA MISMA
   * serie sin límite inferior: por construcción no puede contradecir a la diaria.
   */
  readonly balanceSubText = computed(() => {
    const cash = this.profitLoss()?.cash;
    if (!cash) return '';
    return `Caja acumulada: ${this.formatCurrency(cash.balance_accumulated || 0)}`;
  });

  /**
   * Sub-etiqueta de GASTOS. El número grande sigue siendo el gasto RECONOCIDO
   * del periodo (aprobado + pagado), igual que siempre. Cuando lo pagado no
   * coincide con lo reconocido se muestra la parte pagada, que es la que el
   * Balance resta — sin eso la resta del panel no cuadraría a la vista.
   */
  readonly gastosSubText = computed(() => {
    const data = this.profitLoss();
    const parts = [this.getGrowthText(data?.comparison?.expenses_growth)];
    const recognized = data?.operating_expenses || 0;
    const paid = data?.cash?.expenses_paid || 0;
    if (data && paid !== recognized) {
      parts.push(`Pagado: ${this.formatCurrency(paid)}`);
    }
    return parts.join(' · ');
  });

  /**
   * True when some sold units have no cost snapshot, so profit is overstated.
   * Lee la cobertura de la BASE CAJA porque es la que alimenta la tarjeta de
   * Ganancias; leer la contable avisaría sobre un COGS que el panel no muestra.
   */
  readonly hasIncompleteCost = computed(() => {
    const coverage = this.profitLoss()?.cash?.cost_coverage;
    return !!coverage && coverage.units_without_cost > 0;
  });

  /** Human sentence for the incomplete-cost warning. */
  readonly incompleteCostText = computed(() => {
    const coverage = this.profitLoss()?.cash?.cost_coverage;
    if (!coverage || coverage.units_without_cost === 0) return '';
    const pct = (coverage.coverage_ratio * 100).toFixed(0);
    const units = Math.round(coverage.units_without_cost);
    const total = Math.round(coverage.units_total);
    return `${units} de ${total} unidades vendidas no tienen costo registrado (cobertura ${pct} %). La ganancia mostrada está sobreestimada hasta que se registre ese costo.`;
  });

  navigateTo(path: string): void {
    // Handle paths with query params
    const [route, queryString] = path.split('?');
    if (queryString) {
      const params: Record<string, string> = {};
      queryString.split('&').forEach((pair) => {
        const [key, val] = pair.split('=');
        params[key] = val;
      });
      this.router.navigate([route], { queryParams: params });
    } else {
      this.router.navigate([route]);
    }
  }

  private getDateRangeFromPreset(preset: string): DateRangeFilter | null {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    let start: Date;
    let end: Date;

    switch (preset) {
      case 'today':
        start = today; end = today; break;
      case 'yesterday':
        start = new Date(today); start.setDate(start.getDate() - 1); end = start; break;
      case 'thisWeek':
        start = new Date(today); start.setDate(start.getDate() - start.getDay()); end = today; break;
      case 'lastWeek':
        start = new Date(today); start.setDate(start.getDate() - start.getDay() - 7);
        end = new Date(start); end.setDate(end.getDate() + 6); break;
      case 'thisMonth':
        start = new Date(today.getFullYear(), today.getMonth(), 1); end = today; break;
      case 'lastMonth':
        start = new Date(today.getFullYear(), today.getMonth() - 1, 1);
        end = new Date(today.getFullYear(), today.getMonth(), 0); break;
      case 'thisYear':
        start = new Date(today.getFullYear(), 0, 1); end = today; break;
      case 'lastYear':
        start = new Date(today.getFullYear() - 1, 0, 1);
        end = new Date(today.getFullYear() - 1, 11, 31); break;
      default:
        return null;
    }
    return {
      start_date: toLocalDateString(start),
      end_date: toLocalDateString(end),
      preset: preset as any,
    };
  }

}
