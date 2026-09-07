import {
  Component,
  OnInit,
  OnDestroy,
  PLATFORM_ID,
  DestroyRef,
  inject,
  signal,
  computed,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import type { EChartsOption } from 'echarts';
import { StatsComponent } from '../../../../../shared/components/stats/stats.component';
import { ChartComponent } from '../../../../../shared/components/chart/chart.component';
import { IconComponent } from '../../../../../shared/components/icon/icon.component';
import type { IconName } from '../../../../../shared/components/icon/icons.registry';

/**
 * HeroLiveDashboardComponent — réplica viva del Panel Principal para el
 * hero de vendix.com (`#hero-simulator`).
 *
 * - Usa los mismos componentes que la app real: `app-stats` (cards) y
 *   `app-chart` (ECharts) con los mismos builders de opciones que
 *   `DashboardComponent` (línea suavizada + barras, pie `roseType: area`).
 * - Datos 100 % fake y autocontenidos: PRNG con semilla fija en servidor
 *   (prerender estable) y semilla del reloj en el navegador, así que cada
 *   visita ve otra jornada. La base aleatoria se fija en el primer render y
 *   los ticks sólo SUMAN sobre ella — ningún KPI baja nunca.
 * - Cadencia de ticks duplicada: 5s → 10s → 20s → 40s → 80s → 160s → … sin
 *   indicador visible (el chip "En vivo · próximo en Ns" se retiró).
 * - La tendencia va de 00:00 a la hora local de quien mira y va sumando horas
 *   cuando el reloj del visitante cruza a la siguiente.
 * - Sidebar: réplica a escala del `app-sidebar.collapsed` del store-admin
 *   (cabecera con logo + ítems centrados con los mismos íconos Lucide).
 * - Móvil: sidebar oculto <md + drawer con hamburguesa (mismo patrón que el
 *   sidebar del store-admin: backdrop, Escape, aria).
 */
interface TrendPoint {
  label: string;
  revenue: number;
  orders: number;
}

interface ChannelSlice {
  name: string;
  value: number;
}

// Cadencia en vivo: primer tick a los 5s y duplicando en cada uno
// (5 → 10 → 20 → 40 → 80 → 160 → …).
const FIRST_TICK_S = 5;
// Tope duro: setTimeout desborda pasados 2^31 ms (~24,8 días) y dispararía de
// inmediato, así que la duplicación se detiene mucho antes de ese límite.
const MAX_TICK_S = 3600;

// Curva de actividad por hora (0-1) de una tienda retail: madrugada muerta,
// apertura sobre las 7, pico de almuerzo y segundo pico de tarde. El valor de
// cada hora sale de esta curva multiplicada por un factor aleatorio, así que
// dos visitas nunca ven la misma serie.
const HOUR_ACTIVITY = [
  0.04, 0.02, 0.01, 0.01, 0.02, 0.06, 0.18, 0.42, 0.62, 0.78, 0.9, 1.0, 0.96,
  0.74, 0.7, 0.82, 0.95, 1.0, 0.88, 0.62, 0.42, 0.26, 0.14, 0.07,
];
// Órdenes por hora en el pico (peso 1). Σ(curva) ≈ 11,5 → ~85 órdenes/día.
const PEAK_ORDERS_PER_HOUR = 7.4;
// Semilla del prerender: fija para que el HTML servido sea siempre el mismo.
const SSR_SEED = 20260906;
// Ticket promedio de la tienda demo (COP).
const TICKET_MIN = 380_000;
const TICKET_SPREAD = 160_000;

// PRNG determinista para el primer paint (SSR/prerender estable).
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function formatCompactCOP(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${Math.round(value).toLocaleString('es-CO')}`;
}

function formatAxisCOP(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `$${Math.round(value / 1_000_000)}M`;
  if (abs >= 1_000) return `$${Math.round(value / 1_000)}K`;
  return `$${Math.round(value)}`;
}

interface DockItem {
  label: string;
  icon: IconName;
}

interface QuickLink {
  label: string;
  icon: IconName;
}

// Mismo orden, etiquetas e íconos que `DashboardComponent.QUICK_LINKS`.
const QUICK_LINKS: QuickLink[] = [
  { label: 'Resumen de Ventas', icon: 'trending-up' },
  { label: 'Ventas por Producto', icon: 'package' },
  { label: 'Órdenes', icon: 'shopping-cart' },
  { label: 'Stock Info', icon: 'alert-triangle' },
  { label: 'Gastos', icon: 'credit-card' },
  { label: 'Clientes', icon: 'users' },
  { label: 'Compras', icon: 'shopping-bag' },
];

// Mismo orden e íconos que `StoreAdminLayoutComponent.menuItems` para una
// tienda retail (sin restaurante/gym). El primero es el activo (Panel Principal).
const DOCK_ITEMS: DockItem[] = [
  { label: 'Panel Principal', icon: 'home' },
  { label: 'Punto de Venta', icon: 'store' },
  { label: 'Órdenes', icon: 'cart' },
  { label: 'Despacho', icon: 'truck' },
  { label: 'Productos', icon: 'package' },
  { label: 'Inventario', icon: 'warehouse' },
  { label: 'Clientes', icon: 'users' },
  { label: 'Tienda en línea', icon: 'shopping-bag' },
  { label: 'Marketing', icon: 'megaphone' },
  { label: 'Analíticas', icon: 'chart-line' },
  { label: 'Reportes', icon: 'file-bar-chart' },
  { label: 'Gastos', icon: 'wallet' },
  { label: 'Fiscal', icon: 'landmark' },
  { label: 'Ayuda', icon: 'help-circle' },
  { label: 'Configuración', icon: 'settings' },
];

@Component({
  selector: 'app-hero-live-dashboard',
  standalone: true,
  imports: [StatsComponent, ChartComponent, IconComponent],
  templateUrl: './hero-live-dashboard.component.html',
  styleUrls: ['./hero-live-dashboard.component.scss'],
})
export class HeroLiveDashboardComponent implements OnInit, OnDestroy {
  private readonly platformId = inject(PLATFORM_ID);
  private readonly destroyRef = inject(DestroyRef);
  private readonly isBrowser = isPlatformBrowser(this.platformId);

  private tickTimeout: ReturnType<typeof setTimeout> | null = null;

  // ── Live engine state ──────────────────────────────────────
  readonly livePaused = signal(false);
  readonly drawerOpen = signal(false);
  private nextDelayS = FIRST_TICK_S;

  // Base aleatoria del día: se fija en el primer render y NO se recalcula.
  // Los ticks sólo suman sobre estos acumuladores.
  private ingresosAcum = 0;
  private gastosAcum = 0;
  private cajaBase = 0;
  private margenBase = 61;
  private sinIvaShare = 0.995;
  private lastHour = -1;

  // ── KPIs (fake, base = valores del mock estático) ──────────
  readonly ingresos = signal(39_200_000);
  readonly ingresosSinIva = signal(39_000_000);
  readonly ganancias = signal(23_800_000);
  readonly gananciasTrasGastos = signal(23_700_000);
  readonly margen = signal(61.0);
  readonly balance = signal(39_100_000);
  readonly cajaAcumulada = signal(429_100_000);
  readonly gastos = signal(90_000);

  readonly ingresosText = computed(() => formatCompactCOP(this.ingresos()));
  readonly ingresosSub = computed(
    () => `Sin IVA: ${formatCompactCOP(this.ingresosSinIva())}`,
  );
  readonly gananciasText = computed(() => formatCompactCOP(this.ganancias()));
  readonly gananciasSub = computed(
    () =>
      `Tras gastos: ${formatCompactCOP(this.gananciasTrasGastos())} · ${this.margen().toFixed(1)}% margen`,
  );
  readonly balanceText = computed(() => formatCompactCOP(this.balance()));
  readonly balanceSub = computed(
    () => `Caja acumulada: ${formatCompactCOP(this.cajaAcumulada())}`,
  );
  readonly gastosText = computed(() => formatCompactCOP(this.gastos()));

  // ── Series ─────────────────────────────────────────────────
  readonly trends = signal<TrendPoint[]>([]);
  readonly channels = signal<ChannelSlice[]>([]);
  readonly lowStock = signal(4);
  readonly outOfStock = signal(1);
  readonly dispatchPending = signal(2);

  // «00:00 - HH:00»: la serie arranca a medianoche y llega a la hora local de
  // quien mira, no a una hora fija del mock.
  readonly trendRangeLabel = computed(() => {
    const points = this.trends();
    if (points.length === 0) return 'demo en vivo';
    return `00:00 - ${points[points.length - 1].label} · demo en vivo`;
  });

  readonly trendChartOptions = signal<EChartsOption>({});
  readonly channelChartOptions = signal<EChartsOption>({});
  readonly dockItems = DOCK_ITEMS;
  readonly quickLinks = QUICK_LINKS;

  ngOnInit(): void {
    this.seedInitialData();
    this.rebuildCharts();
    if (!this.isBrowser) return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      this.livePaused.set(true);
      return;
    }
    this.scheduleNextTick();
    this.destroyRef.onDestroy(() => this.clearTimers());
  }

  ngOnDestroy(): void {
    this.clearTimers();
  }

  toggleDrawer(): void {
    this.drawerOpen.update((v) => !v);
  }

  closeDrawer(): void {
    this.drawerOpen.set(false);
  }

  onDrawerKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') this.closeDrawer();
  }

  // ── Fake data engine ───────────────────────────────────────
  // Regla: la base es aleatoria una sola vez y a partir de ahí SÓLO se suma.
  // Ningún KPI retrocede, igual que los totales de un día real en la app.

  /** Hora local de quien mira. En servidor, hora fija para prerender estable. */
  private currentHour(): number {
    return this.isBrowser ? new Date().getHours() : 14;
  }

  /** Punto horario aleatorio siguiendo la curva de actividad de la tienda. */
  private hourlyPoint(hour: number, rand: () => number): TrendPoint {
    const weight = HOUR_ACTIVITY[hour] ?? 0.05;
    const orders = Math.round(
      weight * PEAK_ORDERS_PER_HOUR * (0.55 + rand() * 0.9),
    );
    const ticket = TICKET_MIN + rand() * TICKET_SPREAD;
    return {
      label: `${String(hour).padStart(2, '0')}:00`,
      revenue: Math.round(orders * ticket * (0.85 + rand() * 0.3)),
      orders,
    };
  }

  private seedInitialData(): void {
    // Dos generadores: `ssr` da la base determinista que pinta el prerender y
    // `live` (semilla del reloj) la variación de cada visita.
    const ssr = mulberry32(SSR_SEED);
    const live = this.isBrowser ? mulberry32(Date.now() >>> 0) : null;
    const rand = live ?? ssr;

    // Tendencia: 00:00 → hora local del visitante, un punto aleatorio por hora.
    const hour = this.currentHour();
    this.lastHour = hour;
    this.trends.set(
      Array.from({ length: hour + 1 }, (_, h) => this.hourlyPoint(h, rand)),
    );

    // Base de los KPIs: la determinista del prerender MÁS un tramo aleatorio
    // siempre positivo en el navegador. Así cada visita ve otra jornada y el
    // relevo de hidratación se lee como una suma, nunca como un salto abajo.
    const up = (value: number, pct: number) =>
      live ? value * (1 + live() * pct) : value;
    this.ingresosAcum = up(34_000_000 + ssr() * 10_000_000, 0.22);
    this.margenBase = Math.min(68, up(55 + ssr() * 12, 0.12));
    this.gastosAcum = up(60_000 + ssr() * 70_000, 0.35);
    this.cajaBase = up(380_000_000 + ssr() * 90_000_000, 0.15);
    // Canasta casi exenta, como la tienda demo real (sin IVA ≈ ingresos).
    this.sinIvaShare = 0.99 + ssr() * 0.008;
    this.publishKpis();

    // El pie reparte el mismo total de ingresos entre los tres canales.
    const whatsapp = 0.42 + rand() * 0.08;
    const pos = 0.3 + rand() * 0.07;
    this.channels.set([
      { name: 'WhatsApp', value: Math.round(this.ingresosAcum * whatsapp) },
      { name: 'Punto de Venta', value: Math.round(this.ingresosAcum * pos) },
      {
        name: 'Tienda Online',
        value: Math.round(this.ingresosAcum * (1 - whatsapp - pos)),
      },
    ]);
  }

  /** Deriva las 8 lecturas visibles de los acumuladores. */
  private publishKpis(): void {
    const ingresos = this.ingresosAcum;
    const ganancias = (ingresos * this.margenBase) / 100;
    this.ingresos.set(Math.round(ingresos));
    this.ingresosSinIva.set(Math.round(ingresos * this.sinIvaShare));
    this.ganancias.set(Math.round(ganancias));
    this.gananciasTrasGastos.set(Math.round(ganancias - this.gastosAcum));
    this.margen.set(this.margenBase);
    this.balance.set(Math.round(ingresos - this.gastosAcum));
    this.cajaAcumulada.set(Math.round(this.cajaBase + ingresos));
    this.gastos.set(Math.round(this.gastosAcum));
  }

  private scheduleNextTick(): void {
    this.tickTimeout = setTimeout(() => {
      if (!this.livePaused()) this.applyTick();
    }, this.nextDelayS * 1000);
  }

  /**
   * Si el reloj del visitante cruzó de hora, la serie gana la(s) hora(s) que
   * faltan; si cruzó la medianoche, vuelve a arrancar en 00:00.
   */
  private rollHours(): void {
    const hour = this.currentHour();
    if (hour === this.lastHour) return;
    const rand = Math.random;
    if (hour < this.lastHour) {
      // Cambio de día: jornada nueva desde medianoche.
      this.trends.set(
        Array.from({ length: hour + 1 }, (_, h) => this.hourlyPoint(h, rand)),
      );
    } else {
      const added: TrendPoint[] = [];
      for (let h = this.lastHour + 1; h <= hour; h++) {
        added.push(this.hourlyPoint(h, rand));
      }
      this.trends.update((points) => [...points, ...added]);
    }
    this.lastHour = hour;
  }

  private applyTick(): void {
    this.rollHours();

    // Sólo suma: la base aleatoria del primer render no se recalcula nunca.
    const deltaIngresos = this.ingresosAcum * (0.0015 + Math.random() * 0.0045);
    this.ingresosAcum += deltaIngresos;
    this.gastosAcum += deltaIngresos * (0.001 + Math.random() * 0.004);
    // El margen es una razón, no un acumulador: deriva mínima dentro de banda.
    this.margenBase = Math.min(
      68,
      Math.max(52, this.margenBase + (Math.random() - 0.5) * 0.4),
    );
    this.publishKpis();

    // Ese mismo ingreso entra por la hora en curso (última barra/punto vivo).
    this.trends.update((points) => {
      if (points.length === 0) return points;
      const i = points.length - 1;
      const live = points[i];
      return [
        ...points.slice(0, i),
        {
          ...live,
          revenue: Math.round(live.revenue + deltaIngresos),
          orders: live.orders + (Math.random() < 0.5 ? 1 : 0),
        },
      ];
    });

    // …y por alguno de los canales, para que el pie crezca con el total.
    const lucky = Math.floor(Math.random() * 3);
    this.channels.update((slices) =>
      slices.map((s, i) =>
        i === lucky ? { ...s, value: Math.round(s.value + deltaIngresos) } : s,
      ),
    );

    if (Math.random() > 0.75) {
      this.lowStock.update((v) => Math.max(1, v + (Math.random() > 0.5 ? 1 : -1)));
    }
    if (Math.random() > 0.8) {
      this.dispatchPending.update((v) => Math.max(1, v + (Math.random() > 0.5 ? 1 : -1)));
    }

    // Duplicación de la cadencia: 5 → 10 → 20 → 40 → 80 → 160 → … (tope 1h).
    this.nextDelayS = Math.min(this.nextDelayS * 2, MAX_TICK_S);
    this.rebuildCharts();
    this.clearTickTimeout();
    if (this.isBrowser) this.scheduleNextTick();
  }

  // ── Chart builders (misma forma que DashboardComponent, escala ~0.8) ──
  // Los valores originales del Panel Principal van anotados junto a cada
  // ajuste: el área de gráfico pasa de 400px a 320px, así que fuentes,
  // radios y anchos bajan en la misma proporción para conservar el aspecto.
  private rebuildCharts(): void {
    const points = this.trends();
    const slices = this.channels();
    if (points.length === 0 || slices.length === 0) return;

    // Misma resolución de color que DashboardComponent: tokens del tema con fallback.
    const style = this.isBrowser
      ? getComputedStyle(document.documentElement)
      : (null as unknown as CSSStyleDeclaration);
    const cssVar = (name: string, fallback: string): string => {
      const v = style?.getPropertyValue(name)?.trim();
      return v || fallback;
    };
    const primary = cssVar('--color-primary', '#10b981');
    const accent = cssVar('--color-accent', '#06b6d4');
    const muted = cssVar('--color-muted-foreground', '#64748b');
    const grid = cssVar('--color-border', '#e5e8ef');
    const textColor = cssVar('--color-text-primary', '#374151');
    const surfaceColor = cssVar('--color-surface', '#fff');
    const pieColors = [
      cssVar('--color-accent', '#abf7d6'),
      primary,
      cssVar('--color-secondary', '#07271c'),
    ];

    this.trendChartOptions.set({
      animationDuration: 600,
      tooltip: {
        trigger: 'axis',
        formatter: (params: unknown) => {
          const p = params as Array<{ name: string; value: number }>;
          const rev = p[0];
          const ord = p[1];
          return `<strong>${rev.name}</strong><br/>Ingresos: ${formatCompactCOP(rev.value)}<br/>Órdenes: ${ord?.value ?? 0}`;
        },
      },
      legend: {
        data: ['Ingresos', 'Órdenes'],
        bottom: 0,
        textStyle: { color: muted, fontSize: 9 }, // original 11
      },
      grid: { left: '3%', right: '4%', bottom: '15%', top: '5%', containLabel: true },
      xAxis: {
        type: 'category',
        data: points.map((t) => t.label),
        axisLine: { lineStyle: { color: grid } },
        // Hasta 24 horas en el eje: sin hideOverlap las etiquetas se pisan.
        axisLabel: { color: muted, fontSize: 9, hideOverlap: true }, // original 10
      },
      yAxis: [
        {
          type: 'value',
          position: 'left',
          axisLine: { show: false },
          axisLabel: { color: muted, fontSize: 9, formatter: formatAxisCOP }, // original 10
          splitLine: { lineStyle: { color: grid } },
        },
        {
          type: 'value',
          position: 'right',
          axisLine: { show: false },
          axisLabel: { color: muted, fontSize: 9 }, // original 10
          splitLine: { show: false },
        },
      ],
      series: [
        {
          name: 'Ingresos',
          type: 'line',
          smooth: true,
          data: points.map((t) => t.revenue),
          yAxisIndex: 0,
          areaStyle: {
            color: {
              type: 'linear',
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: `${primary}4D` },
                { offset: 1, color: `${primary}0D` },
              ],
            },
          },
          lineStyle: { color: primary, width: 2 },
          itemStyle: { color: primary },
        },
        {
          name: 'Órdenes',
          type: 'bar',
          data: points.map((t) => t.orders),
          yAxisIndex: 1,
          itemStyle: { color: `${accent}99`, borderRadius: [2, 2, 0, 0] },
          barMaxWidth: 13, // original 16
        },
      ],
    });

    this.channelChartOptions.set({
      animationDuration: 600,
      tooltip: {
        trigger: 'item',
        formatter: (params: unknown) => {
          const p = params as { name: string; value: number; percent: number };
          return `<strong>${p.name}</strong><br/>${formatCompactCOP(p.value)}<br/>${p.percent.toFixed(1)}%`;
        },
      },
      legend: {
        bottom: 0,
        left: 'center',
        orient: 'horizontal',
        textStyle: { color: muted, fontSize: 9 }, // original 10
        itemWidth: 10, // original 12
        itemHeight: 10, // original 12
        itemGap: 8, // original 10
      },
      calculable: true,
      series: [
        {
          name: 'Ventas por Canal',
          type: 'pie',
          radius: [24, 88], // original [30, 110]
          center: ['50%', '45%'],
          roseType: 'area',
          itemStyle: { borderRadius: 3, borderColor: surfaceColor, borderWidth: 2 }, // original radius 4
          // Original: 11px sin ancho fijo. La columna del demo mide ~284px (la
          // real ~380px) y ECharts truncaría «Tienda Online» → «Tiend…»; con
          // ancho acotado y overflow 'break' la etiqueta parte en dos líneas.
          label: {
            show: true,
            fontSize: 9,
            color: textColor,
            width: 56,
            overflow: 'break',
            lineHeight: 11,
          },
          labelLine: {
            show: true,
            length: 8, // original 10
            length2: 12, // original 15
            lineStyle: { color: muted },
          },
          emphasis: {
            label: { show: true, fontSize: 11, fontWeight: 'bold' }, // original 13
            itemStyle: {
              shadowBlur: 10,
              shadowOffsetX: 0,
              shadowColor: 'rgba(0, 0, 0, 0.2)',
            },
          },
          data: slices.map((s, i) => ({
            value: s.value,
            name: s.name,
            itemStyle: { color: pieColors[i % pieColors.length] },
          })),
        },
      ],
    });
  }

  private clearTickTimeout(): void {
    if (this.tickTimeout) {
      clearTimeout(this.tickTimeout);
      this.tickTimeout = null;
    }
  }

  private clearTimers(): void {
    this.clearTickTimeout();
  }
}
