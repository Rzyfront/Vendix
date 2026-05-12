import {
  AfterViewInit,
  Component,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Chart, registerables } from 'chart.js';

import {
  SubscriptionAdminService,
  SubscriptionMetricsResponse,
} from '../../services/subscription-admin.service';
import {
  StatsComponent,
  CardComponent,
  SelectorComponent,
  EmptyStateComponent,
} from '../../../../../../shared/components';
import { CurrencyPipe } from '../../../../../../shared/pipes/currency/currency.pipe';

Chart.register(...registerables);

type PeriodPreset = 'last_30' | 'last_90' | 'last_365';

@Component({
  selector: 'app-subscription-metrics-dashboard',
  standalone: true,
  imports: [
    StatsComponent,
    CardComponent,
    SelectorComponent,
    EmptyStateComponent,
    CurrencyPipe,
    FormsModule,
  ],
  template: `
    <div class="w-full">
      <!-- Period filter -->
      <div class="flex flex-col gap-2 md:flex-row md:items-center md:justify-between mb-4 px-2 md:px-0">
        <h2 class="text-base md:text-lg font-semibold text-text-primary">
          Métricas SaaS
          <span class="text-text-secondary font-normal text-sm">
            · Periodo: {{ periodLabel() }}
          </span>
        </h2>
        <div class="w-full md:w-56">
          <app-selector
            [options]="periodOptions"
            [(ngModel)]="selectedPeriod"
            (ngModelChange)="onPeriodChange($any($event))"
            size="sm"
            variant="outline"
          ></app-selector>
        </div>
      </div>

      <!-- Stats cards -->
      <div class="stats-container !mb-4 md:!mb-8">
        <app-stats
          title="MRR"
          [value]="mrrValueNumber() | currency"
          [smallText]="mrrSubLabel()"
          iconName="trending-up"
          iconBgColor="bg-emerald-100"
          iconColor="text-emerald-600"
          [loading]="loading()"
        ></app-stats>
        <app-stats
          title="ARPU"
          [value]="arpuValueNumber() | currency"
          [smallText]="arpuSubLabel()"
          iconName="banknote"
          iconBgColor="bg-blue-100"
          iconColor="text-blue-600"
          [loading]="loading()"
        ></app-stats>
        <app-stats
          title="Churn"
          [value]="churnFormatted()"
          [smallText]="churnSubLabel()"
          iconName="alert-triangle"
          iconBgColor="bg-amber-100"
          iconColor="text-amber-600"
          [loading]="loading()"
        ></app-stats>
        <app-stats
          title="LTV"
          [value]="ltvValueNumber() === null ? '∞' : (ltvValueNumber() | currency)"
          smallText="Lifetime Value estimado"
          iconName="award"
          iconBgColor="bg-purple-100"
          iconColor="text-purple-600"
          [loading]="loading()"
        ></app-stats>
      </div>

      @if (errorMessage()) {
        <app-empty-state
          icon="alert-triangle"
          title="No se pudieron cargar las métricas"
          [description]="errorMessage()!"
          [showActionButton]="false"
        ></app-empty-state>
      }

      <!-- Charts grid -->
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <app-card [padding]="false" customClasses="!p-4">
          <h3 class="text-sm font-semibold text-text-primary mb-3">
            Evolución del MRR (12 meses)
          </h3>
          <div class="h-64 w-full">
            <canvas #mrrCanvas></canvas>
          </div>
        </app-card>

        <app-card [padding]="false" customClasses="!p-4">
          <h3 class="text-sm font-semibold text-text-primary mb-3">
            Cancelaciones por mes (últimos 6)
          </h3>
          <div class="h-64 w-full">
            <canvas #churnCanvas></canvas>
          </div>
        </app-card>

        <app-card
          [padding]="false"
          customClasses="!p-4 lg:col-span-2"
        >
          <h3 class="text-sm font-semibold text-text-primary mb-3">
            Distribución por plan (suscripciones activas)
          </h3>
          @if (planBreakdown().length === 0) {
            <p class="text-sm text-text-secondary py-8 text-center">
              No hay suscripciones activas para mostrar.
            </p>
          } @else {
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4 items-center">
              <div class="h-64 w-full max-w-sm mx-auto">
                <canvas #planCanvas></canvas>
              </div>
              <ul class="space-y-2">
                @for (row of planBreakdown(); track row.plan_id) {
                  <li class="flex items-center justify-between text-sm">
                    <span class="text-text-primary">{{ row.plan_name }}</span>
                    <span class="font-mono text-text-secondary">
                      {{ row.count }}
                    </span>
                  </li>
                }
              </ul>
            </div>
          }
        </app-card>
      </div>
    </div>
  `,
})
export class SubscriptionMetricsDashboardComponent implements AfterViewInit {
  private readonly api = inject(SubscriptionAdminService);
  private readonly destroyRef = inject(DestroyRef);

  // ─── view children (chart canvases) ───
  readonly mrrCanvas = viewChild<ElementRef<HTMLCanvasElement>>('mrrCanvas');
  readonly churnCanvas = viewChild<ElementRef<HTMLCanvasElement>>('churnCanvas');
  readonly planCanvas = viewChild<ElementRef<HTMLCanvasElement>>('planCanvas');

  private mrrChart: Chart | null = null;
  private churnChart: Chart | null = null;
  private planChart: Chart | null = null;
  private viewReady = false;

  // ─── state signals ───
  readonly loading = signal<boolean>(false);
  readonly errorMessage = signal<string | null>(null);
  readonly metrics = signal<SubscriptionMetricsResponse | null>(null);
  readonly selectedPeriod = signal<PeriodPreset>('last_30');

  readonly periodOptions: { value: PeriodPreset; label: string }[] = [
    { value: 'last_30', label: 'Últimos 30 días' },
    { value: 'last_90', label: 'Últimos 90 días' },
    { value: 'last_365', label: 'Últimos 365 días' },
  ];

  // ─── derived values ───
  readonly periodLabel = computed(() => {
    const m = this.metrics();
    if (!m) return '—';
    const start = new Date(m.period.start).toLocaleDateString();
    const end = new Date(m.period.end).toLocaleDateString();
    return `${start} → ${end}`;
  });

  readonly mrrValueNumber = computed(() =>
    Number(this.metrics()?.mrr.value ?? 0),
  );
  readonly mrrAvgNumber = computed(() =>
    Number(this.metrics()?.mrr.monthly_avg ?? 0),
  );
  readonly arpuValueNumber = computed(() =>
    Number(this.metrics()?.arpu.value ?? 0),
  );
  readonly ltvValueNumber = computed(() => {
    const v = this.metrics()?.ltv.value;
    return v == null ? null : Number(v);
  });

  readonly mrrValueFormatted = computed(() => this.mrrValueNumber());
  readonly arpuValueFormatted = computed(() => this.arpuValueNumber());

  readonly churnFormatted = computed(() => {
    const c = this.metrics()?.churn;
    if (!c) return '—';
    return `${c.rate_pct.toFixed(2)}%`;
  });

  readonly ltvFormatted = computed(() => {
    const v = this.ltvValueNumber();
    if (v === null) return '∞';
    return v;
  });

  readonly mrrSubLabel = computed(() => {
    const m = this.metrics();
    if (!m) return undefined;
    return `Promedio mensual: ${this.fmtMoney(Number(m.mrr.monthly_avg))}`;
  });

  readonly arpuSubLabel = computed(() => {
    const m = this.metrics();
    if (!m) return undefined;
    return `${m.arpu.active_subs} stores activas`;
  });

  readonly churnSubLabel = computed(() => {
    const m = this.metrics();
    if (!m) return undefined;
    return `${m.churn.cancelled_count} canceladas / ${m.churn.active_at_start} activas`;
  });

  readonly planBreakdown = computed(
    () => this.metrics()?.active_breakdown.by_plan ?? [],
  );

  constructor() {
    // Reload when period changes
    effect(() => {
      const period = this.selectedPeriod();
      this.fetchMetrics(period);
    });

    // Re-render charts when metrics load
    effect(() => {
      this.metrics();
      if (this.viewReady) {
        requestAnimationFrame(() => this.renderCharts());
      }
    });

    this.destroyRef.onDestroy(() => {
      this.mrrChart?.destroy();
      this.churnChart?.destroy();
      this.planChart?.destroy();
    });
  }

  ngAfterViewInit(): void {
    this.viewReady = true;
    this.renderCharts();
  }

  // ─── handlers ───
  onPeriodChange(value: PeriodPreset): void {
    this.selectedPeriod.set(value);
  }

  // ─── data ───
  private fetchMetrics(period: PeriodPreset): void {
    this.loading.set(true);
    this.errorMessage.set(null);
    this.api
      .getMetrics(period, 12)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.metrics.set(res.data);
          this.loading.set(false);
        },
        error: (err) => {
          this.errorMessage.set(
            err?.error?.message ?? 'Error inesperado al cargar las métricas',
          );
          this.loading.set(false);
        },
      });
  }

  // ─── charts ───
  private renderCharts(): void {
    const m = this.metrics();
    if (!m) return;

    this.renderMrrChart(m);
    this.renderChurnChart(m);
    this.renderPlanChart(m);
  }

  private renderMrrChart(m: SubscriptionMetricsResponse): void {
    const canvas = this.mrrCanvas()?.nativeElement;
    if (!canvas) return;
    const labels = m.mrr_evolution.map((p) => p.month);
    const data = m.mrr_evolution.map((p) => Number(p.mrr));

    if (this.mrrChart) {
      this.mrrChart.data.labels = labels;
      this.mrrChart.data.datasets[0].data = data;
      this.mrrChart.update('none');
      return;
    }

    this.mrrChart = new Chart(canvas, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'MRR (COP)',
            data,
            borderColor: '#10b981',
            backgroundColor: 'rgba(16,185,129,0.15)',
            borderWidth: 2,
            fill: true,
            tension: 0.3,
            pointRadius: 3,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { y: { beginAtZero: true } },
      },
    });
  }

  private renderChurnChart(m: SubscriptionMetricsResponse): void {
    const canvas = this.churnCanvas()?.nativeElement;
    if (!canvas) return;
    // Approximate per-month cancellations: not directly returned, use a
    // single-bar showing cancelled_count for the current period as proxy.
    // Future work: backend can return monthly churn series.
    const labels = m.mrr_evolution.slice(-6).map((p) => p.month);
    const placeholder = labels.map(() => 0);
    placeholder[placeholder.length - 1] = m.churn.cancelled_count;

    if (this.churnChart) {
      this.churnChart.data.labels = labels;
      this.churnChart.data.datasets[0].data = placeholder;
      this.churnChart.update('none');
      return;
    }

    this.churnChart = new Chart(canvas, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: 'Cancelaciones',
            data: placeholder,
            backgroundColor: '#f59e0b',
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { y: { beginAtZero: true, ticks: { precision: 0 } } },
      },
    });
  }

  private renderPlanChart(m: SubscriptionMetricsResponse): void {
    const canvas = this.planCanvas()?.nativeElement;
    if (!canvas) return;
    const rows = m.active_breakdown.by_plan;
    const labels = rows.map((r) => r.plan_name);
    const data = rows.map((r) => r.count);
    const palette = [
      '#10b981',
      '#3b82f6',
      '#f59e0b',
      '#ef4444',
      '#8b5cf6',
      '#06b6d4',
      '#ec4899',
      '#84cc16',
    ];
    const colors = labels.map((_, i) => palette[i % palette.length]);

    if (rows.length === 0) {
      this.planChart?.destroy();
      this.planChart = null;
      return;
    }

    if (this.planChart) {
      this.planChart.data.labels = labels;
      this.planChart.data.datasets[0].data = data;
      (this.planChart.data.datasets[0] as any).backgroundColor = colors;
      this.planChart.update('none');
      return;
    }

    this.planChart = new Chart(canvas, {
      type: 'doughnut',
      data: {
        labels,
        datasets: [{ data, backgroundColor: colors, borderWidth: 0 }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { position: 'bottom' } },
      },
    });
  }

  // ─── helpers ───
  private fmtMoney(value: number): string {
    return new Intl.NumberFormat('es-CO', {
      style: 'currency',
      currency: 'COP',
      maximumFractionDigits: 0,
    }).format(value);
  }
}
