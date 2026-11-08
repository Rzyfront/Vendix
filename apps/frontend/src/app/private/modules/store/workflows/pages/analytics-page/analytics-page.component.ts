import {
  Component,
  DestroyRef,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import type { EChartsOption } from 'echarts';
import {
  AlertBannerComponent,
  CardComponent,
  ChartComponent,
  StatsComponent,
  StickyHeaderComponent,
  ToastService,
} from '../../../../../../shared/components/index';
import {
  DateRange,
  DateRangePickerComponent,
} from '../../../../../../shared/components/date-range-picker/date-range-picker.component';
import { ReportExportService } from '../../../reports/services/report-export.service';
import { WorkflowSummary } from '../../interfaces/workflow-insights.interfaces';
import { WorkflowAnalytics } from '../../interfaces/workflow-ops.interfaces';
import { WorkflowInsightsApiService } from '../../services/workflow-insights-api.service';
import { WorkflowsApiService } from '../../services/workflows-api.service';
import { toWorkflowError } from '../../utils/workflow-errors.util';
import {
  flowParagraph,
  formatPeriod,
} from '../../utils/workflow-insights.util';

const COLOR_AVG = '#3b82f6';
const COLOR_P90 = '#8b5cf6';
const COLOR_BOTTLENECK = '#ef4444';
const COLOR_STARTED = '#06b6d4';
const COLOR_COMPLETED = '#10b981';

/** Hours with one decimal, or an em dash when there is no measure. */
export function formatHours(value: number | null): string {
  return value === null ? '—' : `${value.toFixed(1)} h`;
}

/** `0..1` rate as a whole percentage, or an em dash when unknown. */
export function formatRate(value: number | null): string {
  return value === null ? '—' : `${Math.round(value * 100)} %`;
}

/**
 * KPIs of one flow: stats cards, avg vs p90 per stage (bottleneck marked in
 * text, not only color), daily started/completed, stage and people tables, and
 * the XLSX of the same range. Days are the store's business days: the API
 * resolves the range with the store timezone and returns it; the picker only
 * sends calendar dates.
 */
@Component({
  selector: 'app-workflow-analytics-page',
  standalone: true,
  imports: [
    StickyHeaderComponent,
    CardComponent,
    StatsComponent,
    ChartComponent,
    AlertBannerComponent,
    DateRangePickerComponent,
    RouterLink,
  ],
  template: `
    <div class="w-full overflow-x-hidden">
      <app-sticky-header
        [title]="'Analítica · ' + (data()?.definition?.name ?? 'Flujo')"
        subtitle="Tiempos, vencimientos y cumplimiento de plazos por etapa y por persona"
        icon="bar-chart-3"
        variant="glass"
        [showBackButton]="true"
        backRoute="/admin/workflows"
        [actions]="headerActions()"
        (actionClicked)="onHeaderAction($event)"
      />

      <app-card [responsive]="true" overflow="visible">
        <div
          class="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between"
        >
          @if (initialRange(); as r) {
            <app-date-range-picker
              [initialFrom]="r.from"
              [initialTo]="r.to"
              [showClear]="false"
              (dateRangeChange)="onRange($event)"
            />
          }
          @if (data(); as d) {
            <p class="text-xs text-text-secondary">
              Días de negocio en la zona horaria de la tienda ({{
                d.range.timezone
              }})
            </p>
          }
        </div>
      </app-card>

      @if (loadError()) {
        <app-alert-banner variant="danger" icon="alert-triangle">{{
          loadError()
        }}</app-alert-banner>
      }

      <app-card
        [responsive]="true"
        title="Lectura de la IA"
        class="mt-3 block"
      >
        @if (aiReading(); as reading) {
          <p class="text-sm text-text-primary" data-testid="ai-reading-text">
            {{ reading.text }}
          </p>
          <p class="mt-2 text-xs text-text-secondary">
            Resumen semanal {{ readingPeriod(reading.summary) }}
          </p>
        } @else if (aiState() === 'loading') {
          <p class="text-sm text-text-secondary">Cargando la lectura de la IA...</p>
        } @else if (aiState() === 'error') {
          <p class="text-sm text-text-secondary" data-testid="ai-reading-error">
            No se pudo cargar la lectura de la IA.
          </p>
        } @else {
          <p class="text-sm text-text-secondary" data-testid="ai-reading-empty">
            Todavía no hay una lectura de la IA para este flujo.
          </p>
        }
        <a
          routerLink="/admin/workflows/insights"
          class="mt-2 inline-block text-sm font-medium text-primary underline"
          data-testid="ai-reading-link"
          >Ver todos los resúmenes en Analítica IA</a
        >
      </app-card>

      @if (data(); as d) {
        @if (d.insufficient_data) {
          <app-alert-banner variant="warning" icon="info">
            <strong>Datos insuficientes.</strong> Hay pocas solicitudes
            finalizadas en este rango para que el p90 y el cuello de botella
            sean confiables. Amplía el rango o espera más solicitudes.
          </app-alert-banner>
        }
        @if (d.truncated) {
          <app-alert-banner variant="warning" icon="info">
            El rango tiene más registros de los que se analizan; las cifras
            pueden ser parciales. Reduce el rango.
          </app-alert-banner>
        }

        <div class="stats-container mt-3">
          <app-stats
            title="Iniciadas"
            [value]="d.kpis.started"
            smallText="En el rango"
            iconName="play"
            iconBgColor="bg-cyan-100"
            iconColor="text-cyan-600"
            [loading]="loading()"
          />
          <app-stats
            title="Completadas"
            [value]="d.kpis.completed"
            smallText="En el rango"
            iconName="check-circle"
            iconBgColor="bg-green-100"
            iconColor="text-green-600"
            [loading]="loading()"
          />
          <app-stats
            title="Rechazadas"
            [value]="d.kpis.rejected"
            [smallText]="d.kpis.cancelled + ' canceladas'"
            iconName="x-circle"
            iconBgColor="bg-red-100"
            iconColor="text-red-600"
            [loading]="loading()"
          />
          <app-stats
            title="En curso"
            [value]="d.kpis.active"
            smallText="Ahora mismo"
            iconName="loader"
            iconBgColor="bg-blue-100"
            iconColor="text-blue-600"
            [loading]="loading()"
          />
          <app-stats
            title="Vencidas"
            [value]="d.kpis.overdue"
            smallText="Pasaron su plazo de etapa"
            iconName="alert-triangle"
            iconBgColor="bg-orange-100"
            iconColor="text-orange-600"
            [loading]="loading()"
          />
          <app-stats
            title="Ciclo promedio"
            [value]="hours(d.kpis.cycle_avg_hours)"
            smallText="De inicio a fin"
            iconName="clock"
            iconBgColor="bg-purple-100"
            iconColor="text-purple-600"
            [loading]="loading()"
          />
          <app-stats
            title="Ciclo p90"
            [value]="hours(d.kpis.cycle_p90_hours)"
            smallText="9 de cada 10 terminan antes"
            iconName="timer"
            iconBgColor="bg-purple-100"
            iconColor="text-purple-600"
            [loading]="loading()"
          />
          <app-stats
            title="Dentro del plazo"
            [value]="rate(d.kpis.on_time_rate)"
            smallText="Tareas atendidas a tiempo"
            iconName="check-circle"
            iconBgColor="bg-green-100"
            iconColor="text-green-600"
            [loading]="loading()"
          />
        </div>

        <div class="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
          <app-card
            [responsive]="true"
            title="Tiempo por etapa: promedio vs p90"
          >
            @if (d.stages.length === 0) {
              <p class="p-4 text-sm text-text-secondary">
                Este flujo no tiene etapas medibles.
              </p>
            } @else {
              @if (bottleneckName(); as name) {
                <p class="mb-2 text-sm text-text-primary">
                  <strong>Cuello de botella:</strong> {{ name }} (mayor p90 ×
                  solicitudes en curso).
                </p>
              } @else {
                <p class="mb-2 text-sm text-text-secondary">
                  Sin cuello de botella identificado en este rango.
                </p>
              }
              <app-chart [options]="stageChart()" size="medium" />
            }
          </app-card>

          <app-card [responsive]="true" title="Solicitudes por día">
            <app-chart [options]="dailyChart()" size="medium" />
          </app-card>
        </div>

        <app-card [responsive]="true" title="Etapas" class="mt-3 block">
          <div class="overflow-x-auto">
            <table class="w-full text-sm">
              <thead>
                <tr
                  class="border-b border-border text-left text-text-secondary"
                >
                  <th class="px-2 py-2">Etapa</th>
                  <th class="px-2 py-2 text-right">En curso</th>
                  <th class="px-2 py-2 text-right">Entradas</th>
                  <th class="px-2 py-2 text-right">Salidas</th>
                  <th class="px-2 py-2 text-right">Promedio</th>
                  <th class="px-2 py-2 text-right">p90</th>
                  <th class="px-2 py-2 text-right">Vencidas</th>
                  <th class="px-2 py-2 text-right">Dentro del plazo</th>
                  <th class="px-2 py-2 text-right">Rechazo</th>
                </tr>
              </thead>
              <tbody>
                @for (s of d.stages; track s.stage_key) {
                  <tr class="border-b border-border/60">
                    <td class="px-2 py-2 font-medium text-text-primary">
                      {{ s.name }}
                      @if (s.stage_key === d.bottleneck_stage_key) {
                        <span
                          class="ml-1 rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-700"
                          >Cuello de botella</span
                        >
                      }
                    </td>
                    <td class="px-2 py-2 text-right">{{ s.wip }}</td>
                    <td class="px-2 py-2 text-right">{{ s.entered }}</td>
                    <td class="px-2 py-2 text-right">{{ s.exited }}</td>
                    <td class="px-2 py-2 text-right">
                      {{ hours(s.avg_hours) }}
                    </td>
                    <td class="px-2 py-2 text-right">
                      {{ hours(s.p90_hours) }}
                    </td>
                    <td class="px-2 py-2 text-right">{{ s.overdue_now }}</td>
                    <td class="px-2 py-2 text-right">
                      {{ rate(s.on_time_rate) }}
                    </td>
                    <td class="px-2 py-2 text-right">
                      {{ rate(s.reject_rate) }}
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </app-card>

        <app-card [responsive]="true" title="Personas" class="mt-3 block">
          @if (d.people.length === 0) {
            <p class="p-4 text-sm text-text-secondary">
              Nadie atendió tareas en este rango.
            </p>
          } @else {
            <div class="overflow-x-auto">
              <table class="w-full text-sm">
                <thead>
                  <tr
                    class="border-b border-border text-left text-text-secondary"
                  >
                    <th class="px-2 py-2">Persona</th>
                    <th class="px-2 py-2 text-right">Tareas atendidas</th>
                    <th class="px-2 py-2 text-right">Dentro del plazo</th>
                    <th class="px-2 py-2 text-right">Promedio</th>
                  </tr>
                </thead>
                <tbody>
                  @for (p of d.people; track p.user_id) {
                    <tr class="border-b border-border/60">
                      <td class="px-2 py-2 font-medium text-text-primary">
                        {{ p.name }}
                      </td>
                      <td class="px-2 py-2 text-right">{{ p.tasks_done }}</td>
                      <td class="px-2 py-2 text-right">
                        {{ rate(p.on_time_rate) }}
                      </td>
                      <td class="px-2 py-2 text-right">
                        {{ hours(p.avg_hours) }}
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          }
        </app-card>
      } @else if (loading()) {
        <div class="p-6 text-center">
          <div
            class="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"
          ></div>
          <p class="mt-2 text-text-secondary">Cargando analítica...</p>
        </div>
      }
    </div>
  `,
})
export class AnalyticsPageComponent implements OnInit {
  private readonly api = inject(WorkflowsApiService);
  private readonly insightsApi = inject(WorkflowInsightsApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly toast = inject(ToastService);
  private readonly exporter = inject(ReportExportService);
  private readonly destroyRef = inject(DestroyRef);

  private definitionId = 0;
  private flowKey = '';
  private range: { from: string; to: string } | null = null;

  readonly data = signal<WorkflowAnalytics | null>(null);
  readonly loading = signal(true);
  readonly loadError = signal('');
  readonly exporting = signal(false);
  /** Set once, with the range the API chose by default: seeds the picker. */
  readonly initialRange = signal<{ from: string; to: string } | null>(null);

  readonly headerActions = computed(() => [
    {
      id: 'export',
      label: 'Exportar XLSX',
      icon: 'download',
      variant: 'primary' as const,
      loading: this.exporting(),
      disabled: !this.data(),
    },
  ]);

  /** Latest ready summary, loaded once: its paragraph of this flow, if any. */
  private readonly definitionIdSignal = signal(0);
  readonly aiSummaries = signal<WorkflowSummary[]>([]);
  readonly aiState = signal<'loading' | 'ready' | 'error'>('loading');
  readonly aiReading = computed(() =>
    flowParagraph(this.aiSummaries(), this.definitionIdSignal()),
  );
  readonly readingPeriod = (s: WorkflowSummary): string =>
    formatPeriod(s.period_from, s.period_to);

  readonly hours = formatHours;
  readonly rate = formatRate;

  readonly bottleneckName = computed(() => {
    const d = this.data();
    return (
      d?.stages.find((s) => s.stage_key === d.bottleneck_stage_key)?.name ??
      null
    );
  });

  readonly stageChart = computed<EChartsOption>(() => {
    const d = this.data();
    const stages = d?.stages ?? [];
    return {
      tooltip: { trigger: 'axis', valueFormatter: (v) => `${v ?? '—'} h` },
      legend: { data: ['Promedio (h)', 'p90 (h)'] },
      grid: { left: 8, right: 8, bottom: 8, containLabel: true },
      xAxis: {
        type: 'category',
        data: stages.map((s) =>
          s.stage_key === d?.bottleneck_stage_key
            ? `${s.name} (cuello de botella)`
            : s.name,
        ),
        axisLabel: { interval: 0, width: 90, overflow: 'break' },
      },
      yAxis: { type: 'value', name: 'Horas' },
      series: [
        {
          name: 'Promedio (h)',
          type: 'bar',
          itemStyle: { color: COLOR_AVG },
          data: stages.map((s) => s.avg_hours),
        },
        {
          name: 'p90 (h)',
          type: 'bar',
          itemStyle: { color: COLOR_P90 },
          data: stages.map((s) => ({
            value: s.p90_hours,
            itemStyle: {
              color:
                s.stage_key === d?.bottleneck_stage_key
                  ? COLOR_BOTTLENECK
                  : COLOR_P90,
            },
          })),
        },
      ],
    };
  });

  readonly dailyChart = computed<EChartsOption>(() => {
    const daily = this.data()?.daily ?? [];
    return {
      tooltip: { trigger: 'axis' },
      legend: { data: ['Iniciadas', 'Completadas'] },
      grid: { left: 8, right: 8, bottom: 8, containLabel: true },
      xAxis: { type: 'category', data: daily.map((x) => x.date.slice(5)) },
      yAxis: { type: 'value', minInterval: 1 },
      series: [
        {
          name: 'Iniciadas',
          type: 'line',
          smooth: true,
          itemStyle: { color: COLOR_STARTED },
          data: daily.map((x) => x.started),
        },
        {
          name: 'Completadas',
          type: 'line',
          smooth: true,
          itemStyle: { color: COLOR_COMPLETED },
          data: daily.map((x) => x.completed),
        },
      ],
    };
  });

  ngOnInit(): void {
    this.route.paramMap
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((params) => {
        this.definitionId = Number(params.get('id'));
        if (!Number.isInteger(this.definitionId) || this.definitionId <= 0) {
          this.loading.set(false);
          this.loadError.set('El flujo indicado no existe.');
          return;
        }
        this.api
          .getDefinition(this.definitionId)
          .pipe(takeUntilDestroyed(this.destroyRef))
          .subscribe({
            next: (row) => (this.flowKey = row.key),
            error: () => undefined,
          });
        this.definitionIdSignal.set(this.definitionId);
        this.load();
      });
    this.loadAiReading();
  }

  onRange(range: DateRange): void {
    if (!range.from || !range.to || range.from > range.to) return;
    this.range = { from: range.from, to: range.to };
    this.load();
  }

  onHeaderAction(id: string): void {
    if (id === 'export') this.export();
  }

  private loadAiReading(): void {
    this.insightsApi
      .listSummaries()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (list) => {
          this.aiSummaries.set(list.items);
          this.aiState.set('ready');
        },
        error: () => this.aiState.set('error'),
      });
  }

  private load(): void {
    this.loading.set(true);
    this.loadError.set('');
    this.api
      .getAnalytics(this.definitionId, this.range ?? {})
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (data) => {
          this.data.set(data);
          this.range = { from: data.range.from, to: data.range.to };
          if (!this.initialRange()) this.initialRange.set(this.range);
          this.loading.set(false);
        },
        error: (err) => {
          this.loading.set(false);
          this.loadError.set(toWorkflowError(err).message);
        },
      });
  }

  private export(): void {
    const range = this.range;
    if (!range || this.exporting()) return;
    this.exporting.set(true);
    this.api
      .exportAnalytics(this.definitionId, range)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (blob) => {
          const key = this.flowKey || String(this.definitionId);
          this.exporter.downloadBlob(
            blob,
            `flujo-${key}-${range.from}-${range.to}`,
          );
          this.exporting.set(false);
        },
        error: (err) => {
          this.exporting.set(false);
          this.toast.error(toWorkflowError(err).message);
        },
      });
  }
}
