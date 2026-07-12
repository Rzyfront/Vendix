import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  AlertBannerComponent,
  ButtonComponent,
  CardComponent,
  IconComponent,
  ItemListCardConfig,
  ResponsiveDataViewComponent,
  SelectorComponent,
  SelectorOption,
  StatsComponent,
  TableColumn,
  TooltipComponent,
} from '../../../../shared/components/index';
import { CurrencyFormatService } from '../../../../shared/pipes/currency/currency.pipe';
import { formatDateOnlyUTC } from '../../../../shared/utils/date.util';
import {
  FiscalApiScope,
  FiscalConfigChecklist,
  FiscalConfigChecklistItem,
  FiscalFlowStage,
  FiscalFlowStageStatus,
  FiscalFlowState,
  FiscalOverview,
} from '../interfaces/fiscal-operations.interface';
import { FiscalOperationsService } from '../services/fiscal-operations.service';

type FlowLaneKey = 'sales' | 'purchases' | 'payroll' | 'convergence';

interface FlowLane {
  key: FlowLaneKey;
  title: string;
  icon: string;
  tooltip: string;
  stages: FiscalFlowStage[];
}

interface ConvergenceCell {
  stage: FiscalFlowStage;
  checksLine?: string;
}

const MONTH_NAMES = [
  'Enero',
  'Febrero',
  'Marzo',
  'Abril',
  'Mayo',
  'Junio',
  'Julio',
  'Agosto',
  'Septiembre',
  'Octubre',
  'Noviembre',
  'Diciembre',
];

/** Etiquetas en lenguaje llano para los counts que devuelve flow-state. */
const COUNT_LABELS: Record<string, string> = {
  total: 'en total',
  accepted: 'aceptados',
  rejected: 'rechazados',
  pending: 'pendientes',
  retry_pending: 'reintentando',
  draft: 'en borrador',
  posted: 'contabilizados',
  blocked: 'bloqueados',
  provisional: 'provisionales',
  calculating: 'calculando',
  ready: 'listos',
  needs_review: 'en revisión',
  approved: 'aprobados',
  submitted: 'presentados',
  paid: 'pagados',
  overdue: 'vencidos',
  in_progress: 'en progreso',
  passed: 'OK',
  failed: 'con falla',
  warnings: 'con alerta',
  open: 'abiertos',
  closed: 'cerrados',
  retefuente: 'retefuente',
  reteiva: 'ReteIVA',
  reteica: 'ReteICA',
};

/** Explicación corta de cada etapa del pipeline (tooltip, una frase). */
const STAGE_EXPLANATIONS: Record<string, string> = {
  'sales/emission':
    'Documentos de venta del período: facturas, notas crédito y débito.',
  'sales/dian':
    'Envío de tus facturas a la DIAN, con reintentos automáticos.',
  'sales/journal':
    'Cada factura aceptada genera su asiento contable automáticamente.',
  'purchases/support_documents':
    'Documento soporte para compras a quienes no facturan electrónicamente.',
  'purchases/withholdings':
    'Retenciones practicadas a proveedores; se declaran y pagan a la DIAN.',
  'payroll/settlement':
    'Liquidación mensual de nómina: salarios, aportes y provisiones.',
  'payroll/dspne':
    'Nómina electrónica que se transmite a la DIAN cada mes.',
  'payroll/journal':
    'El gasto de nómina se contabiliza al aceptarse la nómina electrónica.',
  'convergence/journal':
    'Asientos contables del período; en borrador no afectan saldos definitivos.',
  'convergence/declarations':
    'Borradores de declaraciones calculados con tus datos reales del período.',
  'convergence/obligations':
    'Tu calendario fiscal: qué declarar y pagar este período.',
  'convergence/close':
    'Verificaciones del cierre mensual antes de archivar el período.',
};

const STAGE_ICONS: Record<string, string> = {
  emission: 'receipt',
  dian: 'send',
  journal: 'book-open',
  support_documents: 'file-text',
  withholdings: 'percent',
  settlement: 'calculator',
  dspne: 'send',
  declarations: 'file-spreadsheet',
  obligations: 'calendar-days',
  close: 'lock',
};

const STATUS_LABELS: Record<FiscalFlowStageStatus, string> = {
  ok: 'Al día',
  warning: 'Necesita atención',
  blocked: 'Bloqueado',
  empty: 'Sin movimientos',
  not_applicable: 'No aplica para tu negocio',
};

/**
 * Centro Fiscal — dashboard de flujo vivo del período.
 *
 * Versión in-app interactiva del mapa fiscal (docs/fiscal-flow-map.html):
 * 3 carriles (ventas, compras, nómina) que convergen en Operación fiscal,
 * cada etapa con su estado real del período, clic para navegar al módulo
 * correspondiente y tooltips en lenguaje llano. Incluye además el checklist
 * de configuración fiscal con % de completitud.
 */
@Component({
  selector: 'app-fiscal-flow-dashboard',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    AlertBannerComponent,
    ButtonComponent,
    CardComponent,
    FormsModule,
    IconComponent,
    ResponsiveDataViewComponent,
    SelectorComponent,
    StatsComponent,
    TooltipComponent,
  ],
  template: `
    <div class="space-y-4">
      <!-- ================= Stats del resumen fiscal ================= -->
      <div class="stats-container">
        <app-stats
          title="Próximos vencimientos"
          [value]="overview()?.stats?.upcoming || 0"
          smallText="obligaciones por vencer"
          iconName="calendar-clock"
          iconBgColor="bg-blue-100"
          iconColor="text-blue-500"
          [loading]="overviewLoading()"
        />
        <app-stats
          title="Pendientes críticos"
          [value]="overview()?.stats?.overdue || 0"
          smallText="vencidas"
          iconName="alert-triangle"
          iconBgColor="bg-red-100"
          iconColor="text-red-500"
          [loading]="overviewLoading()"
        />
        <app-stats
          title="Declaraciones listas"
          [value]="overview()?.stats?.declarations_ready || 0"
          smallText="listas para revisar"
          iconName="file-check"
          iconBgColor="bg-emerald-100"
          iconColor="text-emerald-500"
          [loading]="overviewLoading()"
        />
        <app-stats
          title="Estimado a pagar"
          [value]="money(overview()?.stats?.estimated_amount)"
          smallText="según obligaciones"
          iconName="dollar-sign"
          iconBgColor="bg-purple-100"
          iconColor="text-purple-500"
          [loading]="overviewLoading()"
        />
      </div>

      <!-- ================= Flujo del período ================= -->
      <app-card [responsive]="true">
        <div
          class="flex flex-col gap-3 md:flex-row md:items-center md:justify-between"
        >
          <div class="flex items-center gap-2">
            <h2 class="text-sm font-semibold text-text-primary md:text-base">
              Flujo del período
            </h2>
            <app-tooltip
              content="Recorrido automático de tus datos fiscales; haz clic en una etapa para ir a su módulo."
              position="bottom"
              size="sm"
            >
              <span
                class="inline-flex h-5 w-5 cursor-help items-center justify-center rounded-full text-text-secondary hover:text-text-primary"
              >
                <app-icon name="help-circle" [size]="15" />
              </span>
            </app-tooltip>
          </div>

          <div class="flex items-end gap-2">
            <div class="w-36">
              <app-selector
                label="Mes"
                size="sm"
                [options]="monthOptions"
                [ngModel]="month()"
                (ngModelChange)="onMonthChange($event)"
              />
            </div>
            <div class="w-28">
              <app-selector
                label="Año"
                size="sm"
                [options]="yearOptions"
                [ngModel]="year()"
                (ngModelChange)="onYearChange($event)"
              />
            </div>
          </div>
        </div>

        @if (flowError()) {
          <div
            class="mt-4 flex flex-col items-center gap-3 rounded-lg border border-dashed border-border p-6 text-center"
          >
            <app-icon name="alert-circle" [size]="24" class="text-error" />
            <p class="text-sm text-text-secondary">{{ flowError() }}</p>
            <app-button variant="outline" size="sm" (clicked)="loadFlowState()">
              Reintentar
            </app-button>
          </div>
        } @else if (flowLoading() && !flowState()) {
          <div class="mt-4 space-y-3" aria-hidden="true">
            @for (i of [1, 2, 3]; track i) {
              <div class="animate-pulse rounded-lg border border-border p-4">
                <div class="mb-3 h-3 w-24 rounded bg-[var(--color-surface-secondary)]"></div>
                <div class="flex flex-col gap-2 md:flex-row">
                  <div class="h-16 rounded-lg bg-[var(--color-surface-secondary)] md:flex-1"></div>
                  <div class="h-16 rounded-lg bg-[var(--color-surface-secondary)] md:flex-1"></div>
                  <div class="h-16 rounded-lg bg-[var(--color-surface-secondary)] md:flex-1"></div>
                </div>
              </div>
            }
            <div class="h-28 animate-pulse rounded-xl bg-[var(--color-surface-secondary)]"></div>
          </div>
        } @else if (flowState()) {
          @if (allQuiet()) {
            <div
              class="mt-4 flex items-center gap-2 rounded-lg bg-[var(--color-primary-light)] px-3 py-2 text-xs text-text-secondary"
            >
              <app-icon name="info" [size]="14" class="text-[var(--color-primary)]" />
              Sin movimientos fiscales en
              {{ periodLabel() }}. Cuando vendas, compres o liquides nómina,
              verás aquí el recorrido completo.
            </div>
          }

          <!-- Carriles -->
          <div class="mt-4 space-y-3">
            @for (lane of lanes(); track lane.key) {
              <div class="rounded-lg border border-border bg-[var(--color-surface)] p-3">
                <div class="mb-2 flex items-center gap-1.5">
                  <app-icon
                    [name]="lane.icon"
                    [size]="14"
                    class="text-text-secondary"
                  />
                  <span
                    class="text-[11px] font-bold uppercase tracking-wide text-text-secondary"
                  >
                    {{ lane.title }}
                  </span>
                  <app-tooltip
                    [content]="lane.tooltip"
                    position="bottom"
                    size="sm"
                  >
                    <span
                      class="inline-flex h-4 w-4 cursor-help items-center justify-center text-text-secondary hover:text-text-primary"
                    >
                      <app-icon name="help-circle" [size]="12" />
                    </span>
                  </app-tooltip>
                </div>

                <div class="flex flex-col gap-1 md:flex-row md:items-stretch">
                  @for (
                    stage of lane.stages;
                    track stage.key;
                    let last = $last
                  ) {
                    <div class="min-w-0 md:flex-1">
                      <button
                        type="button"
                        [class]="stageCardClass(lane.key, stage)"
                        [attr.aria-label]="
                          stage.label + ': ' + statusLabel(stage.status)
                        "
                        (click)="goToStage(lane.key, stage)"
                      >
                        <span class="flex items-center gap-2">
                          <span [class]="stageIconChipClass(stage.status)">
                            <app-icon
                              [name]="stageIcon(stage.key)"
                              [size]="14"
                            />
                          </span>
                          <span
                            class="min-w-0 flex-1 text-xs font-semibold leading-tight text-text-primary"
                          >
                            {{ stage.label }}
                          </span>
                          <app-tooltip
                            [content]="stageTooltip(lane.key, stage)"
                            position="bottom"
                            size="sm"
                          >
                            <span
                              class="inline-flex h-4 w-4 cursor-help items-center justify-center text-text-secondary hover:text-text-primary"
                              (click)="$event.stopPropagation()"
                            >
                              <app-icon name="help-circle" [size]="12" />
                            </span>
                          </app-tooltip>
                          <span [class]="stageDotClass(stage.status)"></span>
                        </span>
                        <span
                          class="mt-1.5 block text-[11px] leading-snug text-text-secondary"
                        >
                          {{ stageCountsLine(stage) }}
                        </span>
                      </button>
                    </div>

                    @if (!last) {
                      <div
                        class="flex justify-center py-0.5 text-text-secondary md:hidden"
                      >
                        <app-icon name="chevron-down" [size]="14" />
                      </div>
                      <div
                        class="hidden items-center px-0.5 text-text-secondary md:flex"
                      >
                        <app-icon name="chevron-right" [size]="14" />
                      </div>
                    }
                  }
                </div>
              </div>
            }
          </div>

          <!-- Convergencia -->
          <div class="mx-auto h-4 w-px bg-border"></div>
          <div class="rounded-xl border border-[color-mix(in_srgb,var(--color-primary)_20%,transparent)] bg-[var(--color-primary-light)] p-4">
            <div class="mb-3 flex items-center gap-2">
              <app-icon name="landmark" [size]="16" class="text-[var(--color-primary)]" />
              <h3 class="text-sm font-semibold text-text-primary">
                Operación fiscal — aquí converge todo
              </h3>
              <app-tooltip
                content="Los tres flujos alimentan obligaciones, declaraciones, asientos y cierre del mes."
                position="bottom"
                size="sm"
              >
                <span
                  class="inline-flex h-4 w-4 cursor-help items-center justify-center text-text-secondary hover:text-text-primary"
                >
                  <app-icon name="help-circle" [size]="13" />
                </span>
              </app-tooltip>
            </div>

            <div class="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
              @for (cell of convergenceCells(); track cell.stage.key) {
                <div class="min-w-0">
                  <button
                    type="button"
                    [class]="convergenceCellClass(cell.stage)"
                    [attr.aria-label]="
                      cell.stage.label + ': ' + statusLabel(cell.stage.status)
                    "
                    (click)="goToStage('convergence', cell.stage)"
                  >
                    <span class="flex items-center gap-2">
                      <app-icon
                        [name]="stageIcon(cell.stage.key)"
                        [size]="14"
                        class="text-text-secondary"
                      />
                      <span
                        class="min-w-0 flex-1 text-xs font-semibold leading-tight text-text-primary"
                      >
                        {{ cell.stage.label }}
                      </span>
                      <app-tooltip
                        [content]="stageTooltip('convergence', cell.stage)"
                        position="bottom"
                        size="sm"
                      >
                        <span
                          class="inline-flex h-4 w-4 cursor-help items-center justify-center text-text-secondary hover:text-text-primary"
                          (click)="$event.stopPropagation()"
                        >
                          <app-icon name="help-circle" [size]="12" />
                        </span>
                      </app-tooltip>
                      <span
                        [class]="stageDotClass(cell.stage.status)"
                      ></span>
                    </span>
                    <span
                      class="mt-1.5 block text-[11px] leading-snug text-text-secondary"
                    >
                      {{ cell.checksLine || stageCountsLine(cell.stage) }}
                    </span>
                  </button>
                </div>
              }
            </div>
          </div>
        }
      </app-card>

      <!-- ================= Configuración fiscal ================= -->
      <app-card [responsive]="true">
        <div class="flex items-center gap-2">
          <h2 class="text-sm font-semibold text-text-primary md:text-base">
            Configuración fiscal
          </h2>
          <app-tooltip
            content="Piezas necesarias para que el flujo funcione solo; haz clic en un pendiente para configurarlo."
            position="bottom"
            size="sm"
          >
            <span
              class="inline-flex h-5 w-5 cursor-help items-center justify-center rounded-full text-text-secondary hover:text-text-primary"
            >
              <app-icon name="help-circle" [size]="15" />
            </span>
          </app-tooltip>
          @if (checklist(); as cl) {
            <span class="ml-auto text-sm font-semibold" [class]="pctTextClass()">
              {{ cl.completion_pct }}% completo
            </span>
          }
        </div>

        @if (checklistError()) {
          <div
            class="mt-4 flex flex-col items-center gap-3 rounded-lg border border-dashed border-border p-6 text-center"
          >
            <app-icon name="alert-circle" [size]="24" class="text-error" />
            <p class="text-sm text-text-secondary">{{ checklistError() }}</p>
            <app-button
              variant="outline"
              size="sm"
              (clicked)="loadChecklist()"
            >
              Reintentar
            </app-button>
          </div>
        } @else if (checklistLoading() && !checklist()) {
          <div class="mt-4 space-y-3" aria-hidden="true">
            <div class="h-2 w-full animate-pulse rounded-full bg-[var(--color-surface-secondary)]"></div>
            <div class="grid gap-2 sm:grid-cols-2">
              @for (i of [1, 2, 3, 4, 5, 6]; track i) {
                <div
                  class="h-14 animate-pulse rounded-lg border border-border bg-[var(--color-surface-secondary)]"
                ></div>
              }
            </div>
          </div>
        } @else if (checklist(); as cl) {
          <div class="mt-3 h-2 w-full overflow-hidden rounded-full bg-[var(--color-surface-secondary)]">
            <div
              class="h-full rounded-full bg-success transition-all"
              [style.width.%]="cl.completion_pct"
            ></div>
          </div>

          <div class="mt-4 grid gap-2 sm:grid-cols-2">
            @for (item of cl.items; track item.key) {
              <div class="min-w-0">
                <button
                  type="button"
                  [class]="checklistItemClass(item)"
                  [attr.aria-label]="
                    item.label + (item.complete ? ': completo' : ': pendiente')
                  "
                  (click)="goToChecklistItem(item)"
                >
                  <app-icon
                    [name]="item.complete ? 'check-circle' : 'alert-circle'"
                    [size]="18"
                    [class]="
                      item.complete ? 'text-success' : 'text-warning'
                    "
                  />
                  <span class="min-w-0 flex-1">
                    <span
                      class="block text-xs font-semibold text-text-primary"
                    >
                      {{ item.label }}
                    </span>
                    <span
                      class="mt-0.5 block truncate text-[11px] text-text-secondary"
                    >
                      {{ item.detail }}
                    </span>
                  </span>
                  @if (checklistRoute(item)) {
                    <app-icon
                      name="chevron-right"
                      [size]="14"
                      class="text-text-secondary"
                    />
                  }
                </button>
              </div>
            }
          </div>
        }
      </app-card>

      <!-- ================= Próximas obligaciones + riesgo ================= -->
      @if (overviewError()) {
        <app-alert-banner variant="danger" title="Resumen fiscal">
          {{ overviewError() }}
        </app-alert-banner>
      }

      <div class="grid gap-4 lg:grid-cols-3">
        <app-card
          class="lg:col-span-2 min-w-0"
          [responsive]="true"
          [padding]="false"
          [overflow]="'auto'"
        >
          <div class="px-4 py-3 md:px-6 md:py-4 md:border-b md:border-border">
            <h2 class="text-sm font-semibold text-text-primary md:text-base">
              Próximas obligaciones
            </h2>
          </div>
          <div class="px-2 pb-2 pt-3 md:p-4">
            <app-responsive-data-view
              [data]="overview()?.next_obligations || []"
              [columns]="dashboardObligationColumns"
              [cardConfig]="obligationCardConfig"
              [loading]="overviewLoading()"
              emptyTitle="Sin obligaciones próximas"
              emptyMessage="Sin obligaciones próximas"
              emptyDescription="No hay obligaciones próximas."
              emptyIcon="calendar-clock"
              [showEmptyAction]="false"
            />
          </div>
        </app-card>

        <app-card [responsive]="true">
          <h2 class="text-sm font-semibold text-text-primary">
            Riesgo operativo
          </h2>
          <div class="mt-4 space-y-3 text-sm">
            <div class="flex items-center justify-between gap-3">
              <span class="text-text-secondary">Documentos rechazados</span>
              <strong class="text-error">{{
                overview()?.stats?.rejected_documents || 0
              }}</strong>
            </div>
            <div class="flex items-center justify-between gap-3">
              <span class="text-text-secondary">Cierres abiertos</span>
              <strong class="text-warning">{{
                overview()?.stats?.open_close_sessions || 0
              }}</strong>
            </div>
            <div class="flex items-center justify-between gap-3">
              <span class="text-text-secondary">Valor final aprobado</span>
              <strong class="text-text-primary">{{
                money(overview()?.stats?.final_amount)
              }}</strong>
            </div>
          </div>
        </app-card>
      </div>
    </div>
  `,
})
export class FiscalFlowDashboardComponent {
  private readonly service = inject(FiscalOperationsService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly currency = inject(CurrencyFormatService);

  readonly scope = input.required<FiscalApiScope>();
  /** El padre lo incrementa cuando el usuario pide "refrescar" desde el header. */
  readonly reloadToken = input(0);

  readonly year = signal(new Date().getFullYear());
  readonly month = signal(new Date().getMonth() + 1);

  readonly flowState = signal<FiscalFlowState | null>(null);
  readonly flowLoading = signal(false);
  readonly flowError = signal<string | null>(null);

  readonly checklist = signal<FiscalConfigChecklist | null>(null);
  readonly checklistLoading = signal(false);
  readonly checklistError = signal<string | null>(null);

  readonly overview = signal<FiscalOverview | null>(null);
  readonly overviewLoading = signal(false);
  readonly overviewError = signal<string | null>(null);

  readonly monthOptions: SelectorOption[] = MONTH_NAMES.map((label, i) => ({
    value: i + 1,
    label,
  }));

  readonly yearOptions: SelectorOption[] = (() => {
    const current = new Date().getFullYear();
    return [current - 2, current - 1, current].map((y) => ({
      value: y,
      label: String(y),
    }));
  })();

  readonly lanes = computed<FlowLane[]>(() => {
    const fs = this.flowState();
    if (!fs) return [];
    return [
      {
        key: 'sales' as const,
        title: 'Ventas',
        icon: 'shopping-cart',
        tooltip:
          'Cada venta se factura, se transmite a la DIAN y se contabiliza automáticamente.',
        stages: fs.flows.sales.stages,
      },
      {
        key: 'purchases' as const,
        title: 'Compras y retenciones',
        icon: 'package',
        tooltip:
          'Al registrar compras se calculan y practican las retenciones configuradas.',
        stages: fs.flows.purchases.stages,
      },
      {
        key: 'payroll' as const,
        title: 'Nómina',
        icon: 'users',
        tooltip:
          'La nómina converge en contabilidad, retenciones y declaraciones.',
        stages: fs.flows.payroll.stages,
      },
    ];
  });

  readonly convergenceCells = computed<ConvergenceCell[]>(() => {
    const fs = this.flowState();
    if (!fs) return [];
    const close = fs.convergence.close;
    const summary = close.checks_summary;
    return [
      { stage: fs.convergence.obligations },
      { stage: fs.convergence.declarations },
      { stage: fs.convergence.journal },
      {
        stage: close,
        checksLine: summary
          ? `${summary.passed}/${summary.total} checks OK` +
            (summary.failed ? ` · ${summary.failed} con falla` : '') +
            (summary.warnings ? ` · ${summary.warnings} con alerta` : '')
          : undefined,
      },
    ];
  });

  /** true si todas las etapas están vacías o no aplican (período sin actividad). */
  readonly allQuiet = computed(() => {
    const fs = this.flowState();
    if (!fs) return false;
    const stages = [
      ...fs.flows.sales.stages,
      ...fs.flows.purchases.stages,
      ...fs.flows.payroll.stages,
    ];
    return (
      stages.length > 0 &&
      stages.every(
        (s) => s.status === 'empty' || s.status === 'not_applicable',
      )
    );
  });

  // --- ResponsiveDataView: próximas obligaciones (movido del tab padre) ----

  private readonly statusBadge = {
    type: 'custom' as const,
    size: 'sm' as const,
    colorFn: (value: unknown) => this.statusColor(String(value ?? '')),
  };

  readonly dashboardObligationColumns: TableColumn[] = [
    { key: 'type', label: 'Tipo', priority: 1, transform: (_v, r) => this.typeLabel(r.type) },
    { key: 'period_year', label: 'Periodo', priority: 2, transform: (_v, r) => this.obligationPeriodLabel(r) },
    { key: 'accounting_entity', label: 'Entidad', priority: 3, transform: (_v, r) => this.entityLabel(r) },
    { key: 'due_date', label: 'Vence', priority: 2, transform: (v) => this.formatDate(v) },
    { key: 'status', label: 'Estado', align: 'center', priority: 1, badgeConfig: this.statusBadge, transform: (v) => this.obligationStatusLabel(String(v ?? '')) },
  ];

  readonly obligationCardConfig: ItemListCardConfig = {
    titleKey: 'type',
    titleTransform: (i) => this.typeLabel(i.type),
    subtitleTransform: (i) => this.obligationPeriodLabel(i),
    avatarFallbackIcon: 'calendar-days',
    avatarShape: 'square',
    badgeKey: 'status',
    badgeConfig: this.statusBadge,
    badgeTransform: (v) => this.obligationStatusLabel(String(v ?? '')),
    detailKeys: [
      { key: 'accounting_entity', label: 'Entidad', icon: 'building-2', transform: (_v, i) => this.entityLabel(i) },
      { key: 'due_date', label: 'Vence', icon: 'calendar-clock', transform: (v) => this.formatDate(v) },
    ],
    footerKey: 'final_amount',
    footerLabel: 'Monto',
    footerStyle: 'prominent',
    footerTransform: (_v, i) => this.money(i.final_amount || i.estimated_amount),
  };

  constructor() {
    this.currency.loadCurrency();

    // Recarga del pipeline cuando cambia el período, el scope o el token.
    effect(() => {
      this.scope();
      this.year();
      this.month();
      this.reloadToken();
      untracked(() => this.loadFlowState());
    });

    // Overview + checklist no dependen del período seleccionado.
    effect(() => {
      this.scope();
      this.reloadToken();
      untracked(() => {
        this.loadOverview();
        this.loadChecklist();
      });
    });
  }

  // ---------------------------------------------------------------------------
  // Carga de datos
  // ---------------------------------------------------------------------------

  loadFlowState(): void {
    this.flowLoading.set(true);
    this.flowError.set(null);
    this.service
      .getFlowState(this.scope(), { year: this.year(), month: this.month() })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          this.flowState.set(response.data);
          this.flowLoading.set(false);
        },
        error: () => {
          this.flowError.set(
            'No se pudo cargar el flujo del período. Revisa tu conexión e inténtalo de nuevo.',
          );
          this.flowLoading.set(false);
        },
      });
  }

  loadChecklist(): void {
    this.checklistLoading.set(true);
    this.checklistError.set(null);
    this.service
      .getConfigChecklist(this.scope())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          this.checklist.set(response.data);
          this.checklistLoading.set(false);
        },
        error: () => {
          this.checklistError.set(
            'No se pudo cargar el checklist de configuración fiscal.',
          );
          this.checklistLoading.set(false);
        },
      });
  }

  loadOverview(): void {
    this.overviewLoading.set(true);
    this.overviewError.set(null);
    this.service
      .getOverview(this.scope())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          this.overview.set(response.data);
          this.overviewLoading.set(false);
        },
        error: () => {
          this.overviewError.set('No se pudo cargar el resumen fiscal.');
          this.overviewLoading.set(false);
        },
      });
  }

  // ---------------------------------------------------------------------------
  // Período
  // ---------------------------------------------------------------------------

  onMonthChange(value: string | number | null): void {
    const month = Number(value);
    if (month >= 1 && month <= 12) this.month.set(month);
  }

  onYearChange(value: string | number | null): void {
    const year = Number(value);
    if (year > 2000) this.year.set(year);
  }

  periodLabel(): string {
    return `${MONTH_NAMES[this.month() - 1].toLowerCase()} de ${this.year()}`;
  }

  // ---------------------------------------------------------------------------
  // Navegación — cada etapa lleva al módulo donde se gestiona
  // ---------------------------------------------------------------------------

  /**
   * Mapa etapa → ruta real de la app. Los scopes de tenant (store/org
   * admin) montan en `/admin`. El scope platform (super-admin) monta en
   * `/super-admin/fiscal/**` y conserva su submódulo "Contabilidad" con
   * sus páginas contables (PUC, asientos, mapeos, reportes).
   */
  private stageRoute(
    flow: FlowLaneKey,
    stage: FiscalFlowStage,
  ): string | null {
    const isStore = this.scope() === 'store';
    const isPlatform = this.scope() === 'platform';
    if (isPlatform) {
      const map: Record<string, string | null> = {
        'sales/emission': '/super-admin/subscriptions/fiscal-billing',
        'sales/dian': '/super-admin/subscriptions/fiscal-billing',
        'sales/journal': '/super-admin/fiscal/accounting/journal-entries',
        'purchases/support_documents':
          '/super-admin/subscriptions/fiscal-billing',
        'purchases/withholdings':
          '/super-admin/fiscal/accounting/account-mappings',
        'payroll/settlement': null,
        'payroll/dspne': null,
        'payroll/journal':
          '/super-admin/fiscal/accounting/journal-entries',
        'convergence/journal':
          '/super-admin/fiscal/accounting/journal-entries',
        'convergence/declarations': '/super-admin/fiscal/declarations',
        'convergence/obligations': '/super-admin/fiscal/obligations',
        'convergence/close': '/super-admin/fiscal/close',
      };
      return map[`${flow}/${stage.key}`] ?? null;
    }
    const map: Record<string, string | null> = {
      'sales/emission': '/admin/invoicing',
      'sales/dian': '/admin/invoicing',
      'sales/journal': '/admin/accounting/journal-entries',
      'purchases/support_documents': isStore
        ? '/admin/orders/purchase-orders'
        : '/admin/purchase-orders',
      'purchases/withholdings': '/admin/accounting/taxes/withholding',
      'payroll/settlement': isStore
        ? '/admin/payroll/settlements'
        : '/admin/payroll',
      'payroll/dspne': '/admin/payroll',
      'payroll/journal': '/admin/accounting/journal-entries',
      'convergence/journal': '/admin/accounting/journal-entries',
      'convergence/declarations': '/admin/fiscal/declarations',
      'convergence/obligations': '/admin/fiscal/obligations',
      'convergence/close': '/admin/fiscal/close',
    };
    return map[`${flow}/${stage.key}`] ?? null;
  }

  isStageClickable(flow: FlowLaneKey, stage: FiscalFlowStage): boolean {
    return (
      stage.status !== 'not_applicable' && !!this.stageRoute(flow, stage)
    );
  }

  goToStage(flow: FlowLaneKey, stage: FiscalFlowStage): void {
    if (!this.isStageClickable(flow, stage)) return;
    const route = this.stageRoute(flow, stage);
    if (route) this.router.navigateByUrl(route);
  }

  /** link_hint semántico del backend → ruta real (null = sin destino navegable). */
  checklistRoute(item: FiscalConfigChecklistItem): string | null {
    const isStore = this.scope() === 'store';
    const isPlatform = this.scope() === 'platform';
    if (isPlatform) {
      // La plataforma no tiene wizard (siempre opera) ni módulos de
      // tienda (ventas, nómina, retenciones con UVT). El centro fiscal
      // de plataforma reusa el módulo de facturación SaaS para DIAN +
      // resoluciones; lo demás queda en Contabilidad + identidad.
      const map: Record<string, string | null> = {
        'settings/fiscal': '/super-admin/fiscal/identity',
        'fiscal/dian': '/super-admin/subscriptions/fiscal-billing',
        'accounting/chart-of-accounts':
          '/super-admin/fiscal/accounting/chart-of-accounts',
        'accounting/periods': null,
        taxes: null,
        'accounting/mappings':
          '/super-admin/fiscal/accounting/account-mappings',
        'fiscal/withholding': null,
        'invoicing/resolutions':
          '/super-admin/subscriptions/fiscal-billing',
        'fiscal/uvt': null,
        'payroll/settings': null,
      };
      return map[item.link_hint] ?? null;
    }
    const map: Record<string, string | null> = {
      'settings/fiscal': '/admin/fiscal/wizard',
      'fiscal/dian': '/admin/invoicing/dian-config',
      'accounting/chart-of-accounts': '/admin/accounting/chart-of-accounts',
      'accounting/periods': '/admin/accounting/fiscal-periods',
      taxes: '/admin/accounting/taxes',
      'accounting/mappings': '/admin/accounting/configuration/mappings',
      'fiscal/withholding': '/admin/accounting/taxes/withholding',
      'invoicing/resolutions': '/admin/invoicing/resolutions',
      // La UVT vigente se gestiona dentro del módulo de retenciones.
      'fiscal/uvt': '/admin/accounting/taxes/withholding',
      'payroll/settings': isStore ? '/admin/payroll/settings' : '/admin/payroll',
    };
    return map[item.link_hint] ?? null;
  }

  goToChecklistItem(item: FiscalConfigChecklistItem): void {
    const route = this.checklistRoute(item);
    if (route) this.router.navigateByUrl(route);
  }

  // ---------------------------------------------------------------------------
  // Presentación de etapas
  // ---------------------------------------------------------------------------

  stageIcon(key: string): string {
    return STAGE_ICONS[key] || 'circle';
  }

  statusLabel(status: FiscalFlowStageStatus): string {
    return STATUS_LABELS[status] || status;
  }

  /** Una frase corta por etapa; el estado y los counts ya se ven en la tarjeta. */
  stageTooltip(flow: FlowLaneKey, stage: FiscalFlowStage): string {
    return STAGE_EXPLANATIONS[`${flow}/${stage.key}`] || stage.label;
  }

  /** Resumen amigable de counts: "12 aceptados · 2 rechazados". */
  stageCountsLine(stage: FiscalFlowStage): string {
    if (stage.status === 'not_applicable') return 'No aplica para tu negocio';
    const parts = Object.entries(stage.counts || {})
      .filter(([key, value]) => value > 0 && key !== 'total')
      .map(([key, value]) => `${value} ${COUNT_LABELS[key] || this.humanizeCountKey(key)}`);
    if (parts.length === 0) {
      const total = stage.counts?.['total'] || 0;
      if (total > 0) return `${total} ${COUNT_LABELS['total']}`;
      return 'Sin movimientos este período';
    }
    return parts.join(' · ');
  }

  private humanizeCountKey(key: string): string {
    return key.replace(/_/g, ' ');
  }

  stageDotClass(status: FiscalFlowStageStatus): string {
    const base = 'h-2.5 w-2.5 shrink-0 rounded-full';
    switch (status) {
      case 'ok':
        return `${base} bg-success`;
      case 'warning':
        return `${base} bg-warning`;
      case 'blocked':
        return `${base} bg-error`;
      default:
        return `${base} bg-muted`;
    }
  }

  stageIconChipClass(status: FiscalFlowStageStatus): string {
    const base =
      'flex h-7 w-7 shrink-0 items-center justify-center rounded-md';
    switch (status) {
      case 'ok':
        return `${base} bg-success-light text-success`;
      case 'warning':
        return `${base} bg-warning-light text-warning`;
      case 'blocked':
        return `${base} bg-error-light text-error`;
      default:
        return `${base} bg-[var(--color-surface-secondary)] text-text-secondary`;
    }
  }

  stageCardClass(flow: FlowLaneKey, stage: FiscalFlowStage): string {
    const base =
      'block w-full h-full rounded-lg border border-border bg-[var(--color-surface)] p-3 text-left transition-colors';
    if (stage.status === 'not_applicable') {
      return `${base} opacity-50 cursor-default`;
    }
    if (!this.isStageClickable(flow, stage)) {
      return `${base} cursor-default`;
    }
    return `${base} cursor-pointer hover:border-primary hover:shadow-sm`;
  }

  convergenceCellClass(stage: FiscalFlowStage): string {
    const base =
      'block w-full h-full rounded-lg border border-border bg-[var(--color-surface)] p-3 text-left transition-colors';
    if (stage.status === 'not_applicable') {
      return `${base} opacity-50 cursor-default`;
    }
    return `${base} cursor-pointer hover:border-primary hover:shadow-sm`;
  }

  pctTextClass(): string {
    const pct = this.checklist()?.completion_pct ?? 0;
    if (pct >= 100) return 'text-success';
    if (pct >= 60) return 'text-warning';
    return 'text-error';
  }

  checklistItemClass(item: FiscalConfigChecklistItem): string {
    const base =
      'flex w-full items-center gap-2.5 rounded-lg border p-3 text-left transition-colors';
    const tone = item.complete
      ? 'border-border bg-[var(--color-surface)]'
      : 'border-warning bg-warning-light';
    if (this.checklistRoute(item)) {
      return `${base} ${tone} cursor-pointer hover:border-primary`;
    }
    return `${base} ${tone} cursor-default`;
  }

  // ---------------------------------------------------------------------------
  // Helpers de próximas obligaciones (mismos formatos que el módulo)
  // ---------------------------------------------------------------------------

  money(value?: string | number | null): string {
    const amount = Number(value ?? 0);
    return this.currency.format(Number.isFinite(amount) ? amount : 0);
  }

  formatDate(value?: string | null): string {
    return value ? formatDateOnlyUTC(value) : '-';
  }

  obligationPeriodLabel(item: {
    period_year: number;
    period_month?: number | null;
    period_quarter?: number | null;
  }): string {
    if (item.period_month)
      return `${item.period_year}-${String(item.period_month).padStart(2, '0')}`;
    if (item.period_quarter)
      return `${item.period_year} T${item.period_quarter}`;
    return String(item.period_year);
  }

  entityLabel(item: {
    accounting_entity?: {
      legal_name?: string | null;
      business_name?: string | null;
      tax_id?: string | null;
    } | null;
    store?: { name?: string | null } | null;
  }): string {
    const entity = item.accounting_entity;
    const name = entity?.business_name || entity?.legal_name || entity?.tax_id;
    if (name && item.store?.name) return `${name} · ${item.store.name}`;
    return name || item.store?.name || 'Entidad fiscal';
  }

  typeLabel(type: string): string {
    const labels: Record<string, string> = {
      vat_return: 'IVA',
      withholding_return: 'Retención en la fuente',
      reteiva_return: 'ReteIVA',
      reteica_return: 'ReteICA',
      ica_return: 'ICA',
      exogenous_report: 'Información exógena',
      income_tax_precierre: 'Pre-cierre renta',
      electronic_invoice_review: 'Revisión factura electrónica',
      support_document_review: 'Documento soporte',
      payroll_electronic_review: 'Nómina electrónica',
      bank_reconciliation: 'Conciliación bancaria',
      inventory_valuation: 'Valoración inventario',
      monthly_close: 'Cierre mensual',
      annual_close: 'Cierre anual',
    };
    return labels[type] || type;
  }

  obligationStatusLabel(status: string): string {
    const labels: Record<string, string> = {
      pending: 'Pendiente',
      in_progress: 'En progreso',
      blocked: 'Bloqueada',
      ready: 'Lista',
      approved: 'Aprobada',
      submitted: 'Presentada',
      accepted: 'Aceptada',
      rejected: 'Rechazada',
      paid: 'Pagada',
      overdue: 'Vencida',
    };
    return labels[status] || status;
  }

  statusColor(status: string): string {
    const s = status.toLowerCase();
    if (
      ['accepted', 'approved', 'paid', 'passed', 'active', 'ready'].includes(s)
    ) {
      return '#16a34a';
    }
    if (['rejected', 'overdue', 'failed', 'blocked'].includes(s)) {
      return '#dc2626';
    }
    if (['warning', 'needs_review', 'submitted', 'checking'].includes(s)) {
      return '#d97706';
    }
    return '#6b7280';
  }
}
