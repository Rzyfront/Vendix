import {
  Component,
  DestroyRef,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import type { EChartsOption } from 'echarts';
import { AuthFacade } from '../../../../../../core/store/auth/auth.facade';
import {
  AlertBannerComponent,
  ButtonComponent,
  CardComponent,
  ChartComponent,
  SelectorComponent,
  StickyHeaderComponent,
} from '../../../../../../shared/components/index';
import type { SelectorOption } from '../../../../../../shared/components/selector/selector.component';
import {
  WorkflowAiUsage,
  WorkflowSummariesList,
  WorkflowSummary,
} from '../../interfaces/workflow-insights.interfaces';
import { WorkflowInsightsApiService } from '../../services/workflow-insights-api.service';
import { toWorkflowError } from '../../utils/workflow-errors.util';
import {
  AI_PURPOSE_LABELS,
  formatClock,
  formatGeneratedDate,
  formatPeriod,
  formatTokens,
  lastMonths,
} from '../../utils/workflow-insights.util';

const COLOR_ACCENT = '#3b82f6';
const RATE_LIMITED_MESSAGE = 'Ya se generó un resumen hace menos de una hora';
const SKIPPED_MESSAGE = 'No se generó: cupo de IA agotado';
const MONTHS_BACK = 12;

/**
 * "Analítica IA" (Flujos P6): AI tokens of the month against the plan quota,
 * consumption per flow and per use, and the weekly narrative summaries. The
 * quota only exists for the current month, so past months hide the bar.
 */
@Component({
  selector: 'app-workflow-insights-page',
  standalone: true,
  imports: [
    StickyHeaderComponent,
    CardComponent,
    ChartComponent,
    AlertBannerComponent,
    ButtonComponent,
    SelectorComponent,
    NgTemplateOutlet,
  ],
  template: `
    <div class="w-full overflow-x-hidden" data-testid="insights-page">
      <app-sticky-header
        title="Analítica IA"
        subtitle="Consumo de tokens de IA de tus flujos y resumen semanal de lo que se traba"
        icon="sparkles"
        variant="glass"
        [showBackButton]="true"
        backRoute="/admin/workflows"
      />

      <app-card [responsive]="true" overflow="visible">
        <div class="max-w-xs">
          <app-selector
            label="Mes"
            size="sm"
            [options]="monthOptions"
            [value]="month()"
            (valueChange)="onMonth($event)"
          />
        </div>
      </app-card>

      @if (usageError()) {
        <app-alert-banner variant="danger" icon="alert-triangle">{{
          usageError()
        }}</app-alert-banner>
      }

      @if (usage(); as u) {
        @if (u.quota; as q) {
          @switch (q.state) {
            @case ('warning') {
              <app-alert-banner variant="warning" icon="alert-triangle">
                Tus flujos llevan el 80 % del cupo de IA del plan
              </app-alert-banner>
            }
            @case ('blocked') {
              <app-alert-banner variant="danger" icon="alert-circle">
                Cupo de IA agotado: los pasos de IA pasan a revisión manual
                hasta el próximo mes
              </app-alert-banner>
            }
            @case ('unavailable') {
              <app-alert-banner variant="info" icon="info">
                Tu plan no incluye IA para Flujos
              </app-alert-banner>
            }
          }
        }

        <app-card
          [responsive]="true"
          [title]="u.quota ? 'Cupo del plan' : 'Tokens de Flujos'"
          class="mt-3 block"
        >
          @if (u.quota; as q) {
            @if (q.state === 'unavailable') {
              <p class="text-sm text-text-secondary">
                Tu plan no incluye IA para Flujos
              </p>
            } @else if (q.cap === null) {
              <p class="text-sm text-text-primary" data-testid="quota-text">
                Usados {{ tokens(q.used) }} tokens este mes
              </p>
              <p class="mt-1 text-xs text-text-secondary">
                Tu plan no tiene tope mensual de tokens
              </p>
            } @else {
              <p class="text-sm text-text-primary" data-testid="quota-text">
                Usados {{ tokens(q.used) }} de {{ tokens(q.cap) }} tokens este
                mes ({{ tokens(q.percent ?? 0) }} %)
              </p>
              <div
                class="mt-2 h-2.5 w-full overflow-hidden rounded-full bg-border"
                role="progressbar"
                aria-label="Uso del cupo mensual de tokens de IA"
                aria-valuemin="0"
                aria-valuemax="100"
                [attr.aria-valuenow]="barWidth()"
              >
                <div
                  class="h-full rounded-full"
                  [class.bg-primary]="q.state === 'ok'"
                  [class.bg-warning]="q.state === 'warning'"
                  [class.bg-error]="q.state === 'blocked'"
                  [style.width.%]="barWidth()"
                ></div>
              </div>
            }
          }
          <p class="mt-3 text-sm text-text-primary" data-testid="flows-tokens">
            Tokens de Flujos: {{ tokens(u.flows_tokens) }}
          </p>
          <p class="mt-1 text-xs text-text-secondary">
            {{ tokens(u.calls) }} llamadas de IA en el mes
            @if (u.skipped > 0) {
              · {{ tokens(u.skipped) }} omitidas por falta de cupo
            }
          </p>
        </app-card>

        <div class="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
          <app-card [responsive]="true" title="Consumo por flujo">
            @if (u.by_flow.length === 0) {
              <p class="p-4 text-sm text-text-secondary">
                Ningún flujo usó IA en este mes.
              </p>
            } @else {
              <app-chart [options]="flowChart()" size="medium" />
              <div class="mt-3 overflow-x-auto">
                <table class="w-full text-sm" data-testid="by-flow-table">
                  <thead>
                    <tr
                      class="border-b border-border text-left text-text-secondary"
                    >
                      <th class="px-2 py-2">Flujo</th>
                      <th class="px-2 py-2 text-right">Llamadas</th>
                      <th class="px-2 py-2 text-right">Tokens</th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (f of u.by_flow; track f.definition_id ?? f.name) {
                      <tr class="border-b border-border/60">
                        <td class="px-2 py-2 font-medium text-text-primary">
                          {{ f.name }}
                        </td>
                        <td class="px-2 py-2 text-right">
                          {{ tokens(f.calls) }}
                        </td>
                        <td class="px-2 py-2 text-right">
                          {{ tokens(f.tokens) }}
                        </td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            }
          </app-card>

          <app-card [responsive]="true" title="Consumo por uso">
            <div class="overflow-x-auto">
              <table class="w-full text-sm" data-testid="by-purpose-table">
                <thead>
                  <tr
                    class="border-b border-border text-left text-text-secondary"
                  >
                    <th class="px-2 py-2">Uso</th>
                    <th class="px-2 py-2 text-right">Llamadas</th>
                    <th class="px-2 py-2 text-right">Tokens</th>
                  </tr>
                </thead>
                <tbody>
                  @for (p of u.by_purpose; track p.purpose) {
                    <tr class="border-b border-border/60">
                      <td class="px-2 py-2 font-medium text-text-primary">
                        {{ purposeLabels[p.purpose] }}
                      </td>
                      <td class="px-2 py-2 text-right">
                        {{ tokens(p.calls) }}
                      </td>
                      <td class="px-2 py-2 text-right">
                        {{ tokens(p.tokens) }}
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          </app-card>
        </div>
      } @else if (usageLoading()) {
        <div class="p-6 text-center">
          <div
            class="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"
          ></div>
          <p class="mt-2 text-text-secondary">Cargando consumo...</p>
        </div>
      }

      <app-card
        [responsive]="true"
        title="Resumen semanal de la IA"
        subtitle="Dónde y por qué se trabaron tus procesos en los últimos 30 días"
        class="mt-3 block"
      >
        <div class="mb-3 flex flex-col gap-1 sm:flex-row sm:items-center">
          @if (canManage()) {
            <app-button
              variant="primary"
              size="sm"
              [disabled]="!canGenerate()"
              [loading]="generating()"
              (clicked)="generate()"
              >Generar ahora</app-button
            >
          }
          @if (generateHint(); as hint) {
            <p class="text-xs text-text-secondary" data-testid="generate-hint">
              {{ hint }}
            </p>
          }
        </div>

        @if (generateMessage(); as message) {
          <app-alert-banner variant="info" icon="info">{{
            message
          }}</app-alert-banner>
        }
        @if (summariesError()) {
          <app-alert-banner variant="danger" icon="alert-triangle">{{
            summariesError()
          }}</app-alert-banner>
        }

        @if (summaries(); as list) {
          @if (list.items.length === 0) {
            <p class="p-4 text-sm text-text-secondary" data-testid="no-summaries">
              El primer resumen llega el lunes a las 8 a. m.
            </p>
          } @else {
            @if (latest(); as item) {
              <ng-container
                [ngTemplateOutlet]="summaryView"
                [ngTemplateOutletContext]="{ $implicit: item }"
              />
            }
            @if (history().length > 0) {
              <div class="mt-4 border-t border-border pt-3">
                <button
                  type="button"
                  class="text-sm font-medium text-text-primary underline"
                  [attr.aria-expanded]="historyOpen()"
                  (click)="historyOpen.set(!historyOpen())"
                >
                  {{
                    historyOpen()
                      ? 'Ocultar semanas anteriores'
                      : 'Ver semanas anteriores (' + history().length + ')'
                  }}
                </button>
                @if (historyOpen()) {
                  @for (item of history(); track item.id) {
                    <div
                      class="mt-3 rounded-xl border border-border p-3"
                      data-testid="history-item"
                    >
                      <ng-container
                        [ngTemplateOutlet]="summaryView"
                        [ngTemplateOutletContext]="{ $implicit: item }"
                      />
                    </div>
                  }
                }
              </div>
            }
          }
        } @else if (summariesLoading()) {
          <div class="p-6 text-center">
            <div
              class="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"
            ></div>
            <p class="mt-2 text-text-secondary">Cargando resúmenes...</p>
          </div>
        }
      </app-card>
    </div>

    <ng-template #summaryView let-item>
      <p class="text-xs text-text-secondary">
        {{ period(item) }} · generado el {{ generated(item) }}
      </p>
      @if (item.status === 'ready' && item.content) {
        <h3 class="mt-1 text-base font-semibold text-text-primary">
          {{ item.content.headline }}
        </h3>
        <p class="mt-2 text-sm text-text-primary">{{ item.content.summary }}</p>
        @for (flow of item.content.flows; track flow.key) {
          <div class="mt-3">
            <h4 class="text-sm font-semibold text-text-primary">
              {{ flow.name }}
            </h4>
            <p class="text-sm text-text-secondary">{{ flow.text }}</p>
          </div>
        }
        @if (item.content.recommendations.length > 0) {
          <h4 class="mt-4 text-sm font-semibold text-text-primary">
            Recomendaciones
          </h4>
          <ul class="mt-1 list-disc space-y-1 pl-5 text-sm text-text-primary">
            @for (rec of item.content.recommendations; track $index) {
              <li>{{ rec }}</li>
            }
          </ul>
        }
      } @else if (item.status === 'skipped_quota') {
        <p class="mt-2 text-sm text-text-secondary" data-testid="summary-skipped">
          {{ skippedMessage }}
        </p>
      } @else {
        <p class="mt-2 text-sm text-text-secondary" data-testid="summary-failed">
          No se pudo generar este resumen{{
            item.error ? ': ' + item.error : '.'
          }}
        </p>
      }
    </ng-template>
  `,
})
export class InsightsPageComponent implements OnInit {
  private readonly api = inject(WorkflowInsightsApiService);
  private readonly auth = inject(AuthFacade);
  private readonly destroyRef = inject(DestroyRef);

  readonly purposeLabels = AI_PURPOSE_LABELS;
  readonly skippedMessage = SKIPPED_MESSAGE;
  readonly tokens = formatTokens;
  readonly period = (s: WorkflowSummary): string =>
    formatPeriod(s.period_from, s.period_to);
  readonly generated = (s: WorkflowSummary): string =>
    formatGeneratedDate(s.created_at);

  private readonly months = lastMonths(MONTHS_BACK);
  readonly monthOptions: SelectorOption[] = this.months.map((m) => ({
    value: m.value,
    label: m.label,
  }));

  readonly month = signal(this.months[0].value);
  readonly usage = signal<WorkflowAiUsage | null>(null);
  readonly usageLoading = signal(true);
  readonly usageError = signal('');

  readonly summaries = signal<WorkflowSummariesList | null>(null);
  readonly summariesLoading = signal(true);
  readonly summariesError = signal('');
  readonly generating = signal(false);
  readonly generateMessage = signal('');
  readonly historyOpen = signal(false);

  readonly canManage = computed(
    () => this.auth.isOwner() || this.auth.hasPermission('store:workflows:manage'),
  );
  readonly canGenerate = computed(
    () => this.summaries()?.can_generate === true && !this.generating(),
  );
  readonly generateHint = computed(() => {
    const list = this.summaries();
    if (!list || list.can_generate || !list.next_generate_at) return '';
    return `Podrás generar otro a las ${formatClock(list.next_generate_at)}`;
  });
  readonly latest = computed(() => this.summaries()?.items[0] ?? null);
  readonly history = computed(() => this.summaries()?.items.slice(1) ?? []);

  readonly barWidth = computed(() => {
    const percent = this.usage()?.quota?.percent ?? 0;
    return Math.min(100, Math.max(0, Math.round(percent)));
  });

  readonly flowChart = computed<EChartsOption>(() => {
    // Horizontal bars read top-down: the biggest consumer goes first.
    const flows = [...(this.usage()?.by_flow ?? [])].reverse();
    return {
      tooltip: { trigger: 'axis', valueFormatter: (v) => `${v ?? 0} tokens` },
      grid: { left: 8, right: 16, bottom: 8, containLabel: true },
      xAxis: { type: 'value', name: 'Tokens' },
      yAxis: {
        type: 'category',
        data: flows.map((f) => f.name),
        axisLabel: { width: 110, overflow: 'truncate' },
      },
      series: [
        {
          name: 'Tokens',
          type: 'bar',
          itemStyle: { color: COLOR_ACCENT },
          data: flows.map((f) => f.tokens),
        },
      ],
    };
  });

  ngOnInit(): void {
    this.loadUsage();
    this.loadSummaries();
  }

  onMonth(value: string | number | null): void {
    if (typeof value !== 'string' || value === this.month()) return;
    this.month.set(value);
    this.loadUsage();
  }

  generate(): void {
    if (!this.canGenerate()) return;
    this.generating.set(true);
    this.generateMessage.set('');
    this.api
      .generateSummary()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (summary) => {
          this.generating.set(false);
          if (summary.status === 'skipped_quota') {
            this.generateMessage.set(SKIPPED_MESSAGE);
          }
          this.loadSummaries();
          this.loadUsage();
        },
        error: (err) => {
          this.generating.set(false);
          const error = toWorkflowError(err);
          const limited =
            error.status === 429 ||
            error.code === 'WORKFLOW_INSIGHTS_RATE_LIMITED';
          this.generateMessage.set(limited ? RATE_LIMITED_MESSAGE : error.message);
          // The hour window moved: refresh `can_generate` and the hint.
          this.loadSummaries();
        },
      });
  }

  private loadUsage(): void {
    this.usageLoading.set(true);
    this.usageError.set('');
    // The current month is requested without a parameter: the API resolves it
    // with the store's timezone.
    const current = this.month() === this.months[0].value;
    this.api
      .getAiUsage(current ? undefined : this.month())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (usage) => {
          this.usage.set(usage);
          this.usageLoading.set(false);
        },
        error: (err) => {
          this.usage.set(null);
          this.usageLoading.set(false);
          this.usageError.set(toWorkflowError(err).message);
        },
      });
  }

  private loadSummaries(): void {
    this.summariesLoading.set(true);
    this.summariesError.set('');
    this.api
      .listSummaries()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (list) => {
          this.summaries.set(list);
          this.summariesLoading.set(false);
        },
        error: (err) => {
          this.summariesLoading.set(false);
          this.summariesError.set(toWorkflowError(err).message);
        },
      });
  }
}
