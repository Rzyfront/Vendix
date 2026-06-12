import {
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { map, switchMap } from 'rxjs/operators';
import {
  AlertBannerComponent,
  BadgeComponent,
  ButtonComponent,
  CardComponent,
  IconComponent,
  ItemListCardConfig,
  ResponsiveDataViewComponent,
  TableAction,
  TableColumn,
  TooltipComponent,
} from '../../../shared/components/index';
import type { BadgeVariant } from '../../../shared/components/index';
import { CurrencyFormatService } from '../../../shared/pipes/currency/currency.pipe';
import { ToastService } from '../../../shared/components/toast/toast.service';
import { formatDateOnlyUTC } from '../../../shared/utils/date.util';
import {
  FiscalApiScope,
  FiscalCloseSession,
  FiscalEvidence,
  FiscalObligation,
  FiscalOperationEvent,
  FiscalOverview,
  TaxDeclarationDraft,
  TaxDeclarationLine,
} from './interfaces/fiscal-operations.interface';
import { FiscalOperationsService } from './services/fiscal-operations.service';
import { FiscalOperationsHeaderActionsService } from './services/fiscal-operations-header-actions.service';
import { FiscalFlowDashboardComponent } from './components/fiscal-flow-dashboard.component';
import { FiscalRulesTabComponent } from './components/fiscal-rules-tab.component';

type FiscalTab =
  | 'dashboard'
  | 'obligations'
  | 'declarations'
  | 'close'
  // `audit` unifies the former `evidence` + `history` tabs behind an
  // internal toggle. The legacy ids remain valid as internal aliases so
  // old route data keeps rendering the right section.
  | 'audit'
  | 'evidence'
  | 'history'
  | 'rules';

type AuditView = 'evidence' | 'history';

@Component({
  selector: 'app-fiscal-operations',
  standalone: true,
  imports: [
    AlertBannerComponent,
    BadgeComponent,
    ButtonComponent,
    CardComponent,
    FiscalFlowDashboardComponent,
    FiscalRulesTabComponent,
    IconComponent,
    ResponsiveDataViewComponent,
    TooltipComponent,
  ],
  template: `
    <section class="w-full space-y-4 pb-6">
      @if (errorMessage(); as msg) {
        <app-alert-banner variant="danger" title="Operación fiscal">
          {{ msg }}
        </app-alert-banner>
      }

      @if (activeTab() === 'dashboard') {
        <!-- Centro Fiscal: pipeline vivo del período + checklist de configuración.
             El componente hijo carga su propio overview/flow-state/checklist. -->
        <app-fiscal-flow-dashboard
          [scope]="fiscalScope"
          [reloadToken]="dashboardReload()"
        />
      }

      @if (activeTab() === 'obligations') {
        <app-card [responsive]="true" [padding]="false">
          <div
            class="flex flex-col gap-2 px-4 py-3 md:flex-row md:items-center md:justify-between md:px-6 md:py-4 md:border-b md:border-border"
          >
            <div class="flex items-center gap-2">
              <h2 class="text-sm font-semibold text-text-primary md:text-base">
                Obligaciones fiscales ({{ obligations().length }})
              </h2>
              <app-tooltip
                content="Compromisos con la DIAN (declarar, reportar o pagar) con fecha límite."
                position="bottom"
                size="sm"
              >
                <app-icon
                  name="info"
                  [size]="15"
                  class="text-text-secondary"
                />
              </app-tooltip>
              <app-tooltip
                content="Estados: Pendiente → En progreso → Lista → Aprobada → Presentada → Pagada."
                position="bottom"
                size="sm"
              >
                <app-icon
                  name="help-circle"
                  [size]="15"
                  class="text-text-secondary"
                />
              </app-tooltip>
            </div>
            <app-button
              variant="primary"
              size="sm"
              [disabled]="working()"
              (clicked)="generateCurrentMonthObligations()"
            >
              Generar obligaciones
            </app-button>
          </div>
          <div class="px-2 pb-2 pt-3 md:p-4">
            <app-responsive-data-view
              [data]="obligations()"
              [columns]="obligationColumns"
              [cardConfig]="obligationCardConfig"
              [actions]="obligationActions"
              [loading]="loading()"
              emptyTitle="Sin obligaciones"
              emptyMessage="Sin obligaciones"
              emptyDescription="Genera obligaciones para el periodo actual."
              emptyIcon="calendar-days"
              [showEmptyAction]="false"
            />
          </div>
        </app-card>
      }

      @if (activeTab() === 'declarations') {
        <div class="space-y-4">
          <app-card [responsive]="true" [padding]="false">
            <div
              class="flex flex-col gap-2 px-4 py-3 md:flex-row md:items-center md:justify-between md:px-6 md:py-4 md:border-b md:border-border"
            >
              <div class="flex items-center gap-2">
                <h2
                  class="text-sm font-semibold text-text-primary md:text-base"
                >
                  Borradores de declaraciones ({{ declarations().length }})
                </h2>
                <app-tooltip
                  content="Cálculo previo y editable del período; no se envía a la DIAN."
                  position="bottom"
                  size="sm"
                >
                  <app-icon
                    name="info"
                    [size]="15"
                    class="text-text-secondary"
                  />
                </app-tooltip>
              </div>
              <div class="flex flex-wrap gap-2">
                <app-button
                  variant="outline"
                  size="sm"
                  [disabled]="working()"
                  (clicked)="createDraft('vat')"
                >
                  IVA
                </app-button>
                <app-button
                  variant="outline"
                  size="sm"
                  [disabled]="working()"
                  (clicked)="createDraft('withholding')"
                >
                  Retención
                </app-button>
                <app-button
                  variant="outline"
                  size="sm"
                  [disabled]="working()"
                  (clicked)="createDraft('ica')"
                >
                  ICA
                </app-button>
              </div>
            </div>
            <div class="px-2 pb-2 pt-3 md:p-4">
              <app-responsive-data-view
                [data]="declarations()"
                [columns]="declarationColumns"
                [cardConfig]="declarationCardConfig"
                [actions]="declarationActions"
                [loading]="loading()"
                emptyTitle="Sin borradores"
                emptyMessage="Sin borradores"
                emptyDescription="No hay borradores creados."
                emptyIcon="file-spreadsheet"
                [showEmptyAction]="false"
              />
            </div>
          </app-card>

          @if (selectedDeclaration()) {
            <app-card [responsive]="true" [padding]="false">
              <div
                class="px-4 py-3 md:px-6 md:py-4 md:border-b md:border-border"
              >
                <div class="flex items-center gap-2">
                  <h3
                    class="text-sm font-semibold text-text-primary md:text-base"
                  >
                    Líneas:
                    {{
                      declarationLabel(selectedDeclaration()!.declaration_type)
                    }}
                  </h3>
                  <app-tooltip
                    content="Cada línea explica de dónde sale cada valor del borrador."
                    position="bottom"
                    size="sm"
                  >
                    <app-icon
                      name="info"
                      [size]="15"
                      class="text-text-secondary"
                    />
                  </app-tooltip>
                </div>
              </div>
              <div class="px-2 pb-2 pt-3 md:p-4">
                <app-responsive-data-view
                  [data]="declarationLines()"
                  [columns]="declarationLineColumns"
                  [cardConfig]="declarationLineCardConfig"
                  [loading]="working()"
                  emptyTitle="Sin líneas"
                  emptyMessage="Sin líneas"
                  emptyDescription="El borrador no tiene líneas explicativas."
                  emptyIcon="list-checks"
                  [showEmptyAction]="false"
                />
              </div>
            </app-card>
          }
        </div>
      }

      @if (activeTab() === 'close') {
        <div class="space-y-4">
          <app-card [responsive]="true" [padding]="false">
            <div
              class="flex flex-col gap-2 px-4 py-3 md:flex-row md:items-center md:justify-between md:px-6 md:py-4"
            >
              <div class="flex items-center gap-2">
                <h2
                  class="text-sm font-semibold text-text-primary md:text-base"
                >
                  Cierre fiscal mensual ({{ closeSessions().length }})
                </h2>
                <app-tooltip
                  content="El cierre congela el período; reabrirlo queda auditado."
                  position="bottom"
                  size="sm"
                >
                  <app-icon
                    name="info"
                    [size]="15"
                    class="text-text-secondary"
                  />
                </app-tooltip>
              </div>
              <app-button
                variant="primary"
                size="sm"
                [disabled]="working()"
                (clicked)="createCloseSession()"
              >
                Crear cierre del mes
              </app-button>
            </div>
          </app-card>

          @for (session of closeSessions(); track session.id) {
            <app-card [responsive]="true">
              <div
                class="flex flex-col gap-3 md:flex-row md:items-start md:justify-between"
              >
                <div>
                  <div class="flex flex-wrap items-center gap-2">
                    <h3 class="font-medium text-text-primary">
                      {{ periodLabel(session) }}
                    </h3>
                    <app-badge
                      [variant]="statusVariant(session.status)"
                      size="sm"
                    >
                      {{ statusLabel(session.status) }}
                    </app-badge>
                  </div>
                  <p class="mt-1 text-sm text-text-secondary">
                    {{ entityLabel(session) }}
                  </p>
                </div>
                <div class="flex flex-wrap gap-2">
                  <app-tooltip
                    content="Validaciones automáticas que deben pasar antes de poder cerrar."
                    position="bottom"
                    size="sm"
                  >
                    <app-button
                      variant="outline"
                      size="sm"
                      [disabled]="working()"
                      (clicked)="runCloseChecks(session)"
                    >
                      Ejecutar checks
                    </app-button>
                  </app-tooltip>
                  <app-button
                    variant="outline"
                    size="sm"
                    [disabled]="working()"
                    (clicked)="attachCloseEvidence(session)"
                  >
                    Evidencia
                  </app-button>
                  <app-button
                    variant="success"
                    size="sm"
                    [disabled]="working() || session.status !== 'ready'"
                    (clicked)="approveClose(session)"
                  >
                    Aprobar
                  </app-button>
                  <app-button
                    variant="primary"
                    size="sm"
                    [disabled]="
                      working() ||
                      (session.status !== 'approved' &&
                        session.status !== 'ready')
                    "
                    (clicked)="closeFiscalSession(session)"
                  >
                    Cerrar
                  </app-button>
                  <app-button
                    variant="outline-warning"
                    size="sm"
                    [disabled]="working() || session.status !== 'closed'"
                    (clicked)="reopenClose(session)"
                  >
                    Reabrir
                  </app-button>
                </div>
              </div>
              <div class="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                @for (check of session.checks || []; track check.id) {
                  <div class="rounded-md border border-border p-3">
                    <div class="flex items-center justify-between gap-3">
                      <span class="text-sm font-medium text-text-primary">{{
                        check.title
                      }}</span>
                      <app-badge
                        [variant]="statusVariant(check.status)"
                        size="sm"
                      >
                        {{ statusLabel(check.status) }}
                      </app-badge>
                    </div>
                    <p class="mt-2 text-xs text-text-secondary">
                      {{ check.result_summary || check.description }}
                    </p>
                  </div>
                } @empty {
                  <div
                    class="rounded-md border border-dashed border-border p-4 text-sm text-text-secondary"
                  >
                    Ejecuta checks para ver el estado del cierre.
                  </div>
                }
              </div>
            </app-card>
          } @empty {
            <app-card [responsive]="true">
              <p class="py-8 text-center text-sm text-text-secondary">
                No hay sesiones de cierre creadas.
              </p>
            </app-card>
          }
        </div>
      }

      <!-- Tab Auditoría: toggle interno Evidencias ↔ Historial -->
      @if (activeTab() === 'audit') {
        <div class="flex">
          <div
            class="inline-flex items-center gap-1 rounded-lg border border-border bg-surface p-1"
            role="tablist"
            aria-label="Vista de auditoría"
          >
            <button
              type="button"
              role="tab"
              [attr.aria-selected]="auditView() === 'evidence'"
              class="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors md:text-sm"
              [class]="
                auditView() === 'evidence'
                  ? 'bg-primary-600 text-white'
                  : 'text-text-secondary hover:text-text-primary'
              "
              (click)="auditView.set('evidence')"
            >
              <app-icon name="folder-open" [size]="14" />
              Evidencias
            </button>
            <button
              type="button"
              role="tab"
              [attr.aria-selected]="auditView() === 'history'"
              class="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors md:text-sm"
              [class]="
                auditView() === 'history'
                  ? 'bg-primary-600 text-white'
                  : 'text-text-secondary hover:text-text-primary'
              "
              (click)="auditView.set('history')"
            >
              <app-icon name="clipboard-list" [size]="14" />
              Historial
            </button>
          </div>
        </div>
      }

      @if (showEvidence()) {
        <app-card [responsive]="true" [padding]="false">
          <div class="px-4 py-3 md:px-6 md:py-4 md:border-b md:border-border">
            <h2 class="text-sm font-semibold text-text-primary md:text-base">
              Evidencias fiscales ({{ evidence().length }})
            </h2>
          </div>
          <div class="px-2 pb-2 pt-3 md:p-4">
            <app-responsive-data-view
              [data]="evidence()"
              [columns]="evidenceColumns"
              [cardConfig]="evidenceCardConfig"
              [loading]="loading()"
              emptyTitle="Sin evidencias"
              emptyMessage="Sin evidencias"
              emptyDescription="No hay evidencias adjuntas."
              emptyIcon="folder-open"
              [showEmptyAction]="false"
            />
          </div>
        </app-card>
      }

      @if (activeTab() === 'rules') {
        <!-- Tab Reglas: CRUD de reglas fiscales delegado al componente hijo
             (carga sus propios datos, igual que el Centro Fiscal). -->
        <app-fiscal-rules-tab
          [scope]="fiscalScope"
          [reloadToken]="rulesReload()"
        />
      }

      @if (showHistory()) {
        <app-card [responsive]="true" [padding]="false">
          <div class="px-4 py-3 md:px-6 md:py-4 md:border-b md:border-border">
            <h2 class="text-sm font-semibold text-text-primary md:text-base">
              Historial fiscal ({{ history().length }})
            </h2>
          </div>
          <div class="px-2 pb-2 pt-3 md:p-4">
            <app-responsive-data-view
              [data]="history()"
              [columns]="historyColumns"
              [cardConfig]="historyCardConfig"
              [loading]="loading()"
              emptyTitle="Sin eventos"
              emptyMessage="Sin eventos"
              emptyDescription="Todavía no hay eventos auditables para esta entidad fiscal."
              emptyIcon="clipboard-list"
              [showEmptyAction]="false"
            />
          </div>
        </app-card>
      }
    </section>
  `,
})
export class FiscalOperationsComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly service = inject(FiscalOperationsService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly toast = inject(ToastService);
  private readonly currency = inject(CurrencyFormatService);
  private readonly headerActions = inject(FiscalOperationsHeaderActionsService);

  private readonly routeData = toSignal(
    this.route.data.pipe(
      map((data) => (data['tab'] || 'dashboard') as FiscalTab),
    ),
    { initialValue: 'dashboard' as FiscalTab },
  );

  readonly activeTab = computed(() => this.routeData());

  /** Scope de API resuelto desde la ruta; el Centro Fiscal lo recibe como input. */
  readonly fiscalScope = this.apiScope();

  /**
   * Token de recarga para el Centro Fiscal (tab dashboard). El hijo carga sus
   * propios datos; al pulsar "refrescar" en el header solo incrementamos esto.
   */
  readonly dashboardReload = signal(0);

  /** Token de recarga para el tab Reglas (el hijo carga sus propios datos). */
  readonly rulesReload = signal(0);

  /**
   * Sub-view of the unified "Auditoría" tab. Evidencias and Historial
   * keep their full templates/logic — the toggle only switches which
   * section renders under the audit tab.
   */
  readonly auditView = signal<AuditView>('evidence');

  readonly showEvidence = computed(
    () =>
      this.activeTab() === 'evidence' ||
      (this.activeTab() === 'audit' && this.auditView() === 'evidence'),
  );

  readonly showHistory = computed(
    () =>
      this.activeTab() === 'history' ||
      (this.activeTab() === 'audit' && this.auditView() === 'history'),
  );
  readonly overview = signal<FiscalOverview | null>(null);
  readonly obligations = signal<FiscalObligation[]>([]);
  readonly declarations = signal<TaxDeclarationDraft[]>([]);
  readonly selectedDeclaration = signal<TaxDeclarationDraft | null>(null);
  readonly declarationLines = signal<TaxDeclarationLine[]>([]);
  readonly closeSessions = signal<FiscalCloseSession[]>([]);
  readonly evidence = signal<FiscalEvidence[]>([]);
  readonly history = signal<FiscalOperationEvent[]>([]);
  readonly loading = signal(false);
  readonly working = signal(false);
  readonly errorMessage = signal<string | null>(null);

  // --- ResponsiveDataView configuration -----------------------------------
  // Status badges use a `custom` colorFn returning theme hex so both the
  // desktop table and the mobile item-list render the soft-pill look that
  // the old hand-rolled `statusClass()` produced (bg ~15%, full-color text).

  private readonly statusBadge = {
    type: 'custom' as const,
    size: 'sm' as const,
    colorFn: (value: unknown) => this.statusColor(String(value ?? '')),
  };

  readonly obligationColumns: TableColumn[] = [
    { key: 'type', label: 'Tipo', priority: 1, transform: (_v, r) => this.typeLabel(r.type) },
    { key: 'period_year', label: 'Periodo', priority: 2, transform: (_v, r) => this.periodLabel(r) },
    { key: 'accounting_entity', label: 'Entidad fiscal', priority: 3, transform: (_v, r) => this.entityLabel(r) },
    { key: 'due_date', label: 'Vencimiento', priority: 2, transform: (v) => this.formatDate(v) },
    { key: 'final_amount', label: 'Monto', align: 'right', priority: 2, transform: (_v, r) => this.money(r.final_amount || r.estimated_amount) },
    { key: 'status', label: 'Estado', align: 'center', priority: 1, badgeConfig: this.statusBadge, transform: (v) => this.statusLabel(String(v ?? '')) },
  ];

  readonly obligationActions: TableAction[] = [
    { label: 'En progreso', icon: 'edit-3', variant: 'ghost', action: (i) => this.setObligationStatus(i, 'in_progress'), disabled: () => this.working() },
    { label: 'Lista', icon: 'check-square', variant: 'ghost', action: (i) => this.setObligationStatus(i, 'ready'), disabled: () => this.working() },
    { label: 'Evidencia', icon: 'folder-open', variant: 'ghost', action: (i) => this.attachObligationEvidence(i), disabled: () => this.working() },
    { label: 'Aprobar', icon: 'check-circle', variant: 'success', action: (i) => this.setObligationStatus(i, 'approved'), disabled: () => this.working(), show: (i) => i.status === 'ready' },
    { label: 'Presentar', icon: 'file-check', variant: 'primary', action: (i) => this.submitObligation(i), disabled: () => this.working(), show: (i) => i.status === 'ready' || i.status === 'approved' },
    { label: 'Pagar', icon: 'dollar-sign', variant: 'success', action: (i) => this.payObligation(i), disabled: () => this.working(), show: (i) => i.status === 'submitted' },
  ];

  readonly obligationCardConfig: ItemListCardConfig = {
    titleKey: 'type',
    titleTransform: (i) => this.typeLabel(i.type),
    subtitleTransform: (i) => this.periodLabel(i),
    avatarFallbackIcon: 'calendar-days',
    avatarShape: 'square',
    badgeKey: 'status',
    badgeConfig: this.statusBadge,
    badgeTransform: (v) => this.statusLabel(String(v ?? '')),
    detailKeys: [
      { key: 'accounting_entity', label: 'Entidad', icon: 'building-2', transform: (_v, i) => this.entityLabel(i) },
      { key: 'due_date', label: 'Vence', icon: 'calendar-clock', transform: (v) => this.formatDate(v) },
    ],
    footerKey: 'final_amount',
    footerLabel: 'Monto',
    footerStyle: 'prominent',
    footerTransform: (_v, i) => this.money(i.final_amount || i.estimated_amount),
  };

  readonly declarationColumns: TableColumn[] = [
    { key: 'declaration_type', label: 'Tipo', priority: 1, transform: (v) => this.declarationLabel(String(v ?? '')) },
    { key: 'period_year', label: 'Periodo', priority: 2, transform: (_v, r) => this.periodLabel(r) },
    { key: 'accounting_entity', label: 'Entidad', priority: 3, transform: (_v, r) => this.entityLabel(r) },
    { key: 'total_payable', label: 'Total', align: 'right', priority: 2, transform: (v) => this.money(v) },
    { key: 'status', label: 'Estado', align: 'center', priority: 1, badgeConfig: this.statusBadge, transform: (v) => this.statusLabel(String(v ?? '')) },
  ];

  readonly declarationActions: TableAction[] = [
    { label: 'Líneas', icon: 'list-checks', variant: 'ghost', action: (i) => this.loadDeclarationLines(i), disabled: () => this.working() },
    { label: 'Aprobar', icon: 'check-circle', variant: 'success', action: (i) => this.approveDeclaration(i), disabled: () => this.working(), show: (i) => i.status === 'ready' || i.status === 'needs_review' },
    { label: 'Evidencia', icon: 'folder-open', variant: 'ghost', action: (i) => this.attachDeclarationEvidence(i), disabled: () => this.working() },
    { label: 'Presentar', icon: 'file-check', variant: 'primary', action: (i) => this.submitDeclaration(i), disabled: () => this.working(), show: (i) => i.status === 'approved' },
  ];

  readonly declarationCardConfig: ItemListCardConfig = {
    titleKey: 'declaration_type',
    titleTransform: (i) => this.declarationLabel(i.declaration_type),
    subtitleTransform: (i) => this.periodLabel(i),
    avatarFallbackIcon: 'file-spreadsheet',
    avatarShape: 'square',
    badgeKey: 'status',
    badgeConfig: this.statusBadge,
    badgeTransform: (v) => this.statusLabel(String(v ?? '')),
    detailKeys: [
      { key: 'accounting_entity', label: 'Entidad', icon: 'building-2', transform: (_v, i) => this.entityLabel(i) },
    ],
    footerKey: 'total_payable',
    footerLabel: 'Total',
    footerStyle: 'prominent',
    footerTransform: (v) => this.money(v),
  };

  readonly declarationLineColumns: TableColumn[] = [
    { key: 'description', label: 'Línea', priority: 1 },
    { key: 'line_type', label: 'Tipo', priority: 3 },
    { key: 'source_type', label: 'Fuente', priority: 3 },
    { key: 'base_amount', label: 'Base', align: 'right', priority: 2, transform: (v) => this.money(v) },
    { key: 'tax_amount', label: 'Impuesto', align: 'right', priority: 2, transform: (v) => this.money(v) },
    { key: 'withholding_amount', label: 'Retención', align: 'right', priority: 2, transform: (v) => this.money(v) },
  ];

  readonly declarationLineCardConfig: ItemListCardConfig = {
    titleKey: 'description',
    subtitleKey: 'line_type',
    avatarFallbackIcon: 'list-checks',
    avatarShape: 'square',
    detailKeys: [
      { key: 'source_type', label: 'Fuente', icon: 'file-text' },
      { key: 'base_amount', label: 'Base', transform: (v) => this.money(v) },
      { key: 'tax_amount', label: 'Impuesto', transform: (v) => this.money(v) },
      { key: 'withholding_amount', label: 'Retención', transform: (v) => this.money(v) },
    ],
  };

  readonly evidenceColumns: TableColumn[] = [
    { key: 'evidence_type', label: 'Tipo', priority: 1, transform: (v) => this.evidenceLabel(String(v ?? '')) },
    { key: 'source_type', label: 'Fuente', priority: 2, transform: (v) => String(v || 'Soporte manual') },
    { key: 'content_hash', label: 'Hash', priority: 3, transform: (v) => String(v || 'Sin hash') },
    { key: 'created_at', label: 'Fecha', priority: 2, transform: (v) => this.formatDate(v) },
  ];

  readonly evidenceCardConfig: ItemListCardConfig = {
    titleKey: 'evidence_type',
    titleTransform: (i) => this.evidenceLabel(i.evidence_type),
    subtitleTransform: (i) => String(i.source_type || 'Soporte manual'),
    avatarFallbackIcon: 'folder-open',
    avatarShape: 'square',
    detailKeys: [
      { key: 'content_hash', label: 'Hash', icon: 'file-text', transform: (v) => String(v || 'Sin hash') },
      { key: 'created_at', label: 'Fecha', icon: 'calendar-clock', transform: (v) => this.formatDate(v) },
    ],
  };

  readonly historyColumns: TableColumn[] = [
    { key: 'event_type', label: 'Evento', priority: 1, transform: (v) => this.eventLabel(String(v ?? '')) },
    { key: 'resource_type', label: 'Recurso', priority: 3, transform: (_v, r) => `${this.resourceLabel(r.resource_type)} #${r.resource_id || '-'}` },
    { key: 'accounting_entity', label: 'Entidad', priority: 3, transform: (_v, r) => this.historyEntityLabel(r) },
    { key: 'new_status', label: 'Estado', priority: 2, transform: (_v, r) => this.statusTransitionLabel(r) },
    { key: 'actor_user', label: 'Usuario', priority: 3, transform: (_v, r) => this.actorLabel(r) },
    { key: 'created_at', label: 'Fecha', priority: 2, transform: (v) => this.formatDate(v) },
  ];

  readonly historyCardConfig: ItemListCardConfig = {
    titleKey: 'event_type',
    titleTransform: (i) => this.eventLabel(String(i.event_type ?? '')),
    subtitleTransform: (i) => `${this.resourceLabel(i.resource_type)} #${i.resource_id || '-'}`,
    avatarFallbackIcon: 'clipboard-list',
    avatarShape: 'square',
    detailKeys: [
      { key: 'accounting_entity', label: 'Entidad', icon: 'building-2', transform: (_v, i) => this.historyEntityLabel(i) },
      { key: 'new_status', label: 'Estado', transform: (_v, i) => this.statusTransitionLabel(i) },
      { key: 'actor_user', label: 'Usuario', transform: (_v, i) => this.actorLabel(i) },
      { key: 'created_at', label: 'Fecha', icon: 'calendar-clock', transform: (v) => this.formatDate(v) },
    ],
  };

  constructor() {
    this.currency.loadCurrency();

    effect(() => {
      const tab = this.activeTab();
      untracked(() => {
        // El dashboard (Centro Fiscal) carga su propio overview/flow-state.
        if (tab !== 'dashboard') this.loadOverview();
        this.loadTab(tab);
      });
    });

    // Expose the header actions to the FiscalCoreShell sticky-header.
    // We capture `this` so the calls always hit the current instance.
    this.headerActions.register('refresh', () => this.reloadCurrentTab());
    this.headerActions.register('generate-obligations', () =>
      this.generateCurrentMonthObligations(),
    );

    this.destroyRef.onDestroy(() => {
      this.headerActions.unregister('refresh');
      this.headerActions.unregister('generate-obligations');
    });
  }

  reloadCurrentTab(): void {
    if (this.activeTab() === 'dashboard') {
      // El Centro Fiscal recarga sus propios datos al cambiar el token.
      this.dashboardReload.update((value) => value + 1);
      return;
    }
    if (this.activeTab() === 'rules') {
      // El tab Reglas también es autónomo: solo se incrementa su token.
      this.rulesReload.update((value) => value + 1);
      return;
    }
    this.loadOverview();
    this.loadTab(this.activeTab());
  }

  generateCurrentMonthObligations(): void {
    const period = this.currentPeriod();
    this.working.set(true);
    this.service
      .generateObligations(this.apiScope(), period)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.toast.success('Obligaciones generadas');
          this.reloadCurrentTab();
        },
        error: () =>
          this.handleError('No se pudieron generar las obligaciones'),
        complete: () => this.working.set(false),
      });
  }

  setObligationStatus(item: FiscalObligation, status: string): void {
    this.working.set(true);
    this.service
      .updateObligationStatus(this.apiScope(), item.id, status)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.toast.success('Obligación actualizada');
          this.loadObligations();
          this.loadOverview();
        },
        error: () => this.handleError('No se pudo actualizar la obligación'),
        complete: () => this.working.set(false),
      });
  }

  attachObligationEvidence(item: FiscalObligation): void {
    this.working.set(true);
    this.service
      .attachObligationEvidence(
        this.apiScope(),
        item.id,
        this.manualEvidencePayload('fiscal_obligation', item.id),
      )
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.toast.success('Evidencia adjuntada');
          this.loadObligations();
          this.loadEvidence();
          this.loadHistory();
        },
        error: () => this.handleError('No se pudo adjuntar la evidencia'),
        complete: () => this.working.set(false),
      });
  }

  submitObligation(item: FiscalObligation): void {
    this.working.set(true);
    this.service
      .attachObligationEvidence(
        this.apiScope(),
        item.id,
        this.manualEvidencePayload('fiscal_obligation', item.id),
      )
      .pipe(
        switchMap((response) =>
          this.service.updateObligationStatus(
            this.apiScope(),
            item.id,
            'submitted',
            {
              evidence_id: response.data.id,
              notes: 'Presentada con soporte manual.',
            },
          ),
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: () => {
          this.toast.success('Obligación presentada');
          this.loadObligations();
          this.loadOverview();
          this.loadEvidence();
          this.loadHistory();
        },
        error: () => this.handleError('No se pudo presentar la obligación'),
        complete: () => this.working.set(false),
      });
  }

  payObligation(item: FiscalObligation): void {
    this.working.set(true);
    this.service
      .updateObligationStatus(this.apiScope(), item.id, 'paid', {
        payment_info: { source: 'manual', paid_at: new Date().toISOString() },
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.toast.success('Obligación pagada');
          this.loadObligations();
          this.loadOverview();
          this.loadHistory();
        },
        error: () => this.handleError('No se pudo marcar como pagada'),
        complete: () => this.working.set(false),
      });
  }

  createDraft(declarationType: string): void {
    this.working.set(true);
    this.service
      .createDeclarationDraft(this.apiScope(), {
        declaration_type: declarationType,
        ...this.currentPeriod(),
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.toast.success('Borrador generado');
          this.loadDeclarations();
          this.loadOverview();
        },
        error: () => this.handleError('No se pudo crear el borrador'),
        complete: () => this.working.set(false),
      });
  }

  approveDeclaration(item: TaxDeclarationDraft): void {
    this.working.set(true);
    this.service
      .approveDeclaration(this.apiScope(), item.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.toast.success('Declaración aprobada');
          this.loadDeclarations();
          this.loadOverview();
        },
        error: () => this.handleError('No se pudo aprobar la declaración'),
        complete: () => this.working.set(false),
      });
  }

  attachDeclarationEvidence(item: TaxDeclarationDraft): void {
    this.working.set(true);
    this.service
      .attachDeclarationEvidence(
        this.apiScope(),
        item.id,
        this.manualEvidencePayload('tax_declaration_draft', item.id),
      )
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.toast.success('Evidencia adjuntada');
          this.loadDeclarations();
          this.loadEvidence();
          this.loadHistory();
        },
        error: () => this.handleError('No se pudo adjuntar la evidencia'),
        complete: () => this.working.set(false),
      });
  }

  submitDeclaration(item: TaxDeclarationDraft): void {
    this.working.set(true);
    this.service
      .attachDeclarationEvidence(
        this.apiScope(),
        item.id,
        this.manualEvidencePayload('tax_declaration_draft', item.id),
      )
      .pipe(
        switchMap((response) =>
          this.service.markDeclarationSubmitted(this.apiScope(), item.id, {
            submitted_at: new Date().toISOString(),
            evidence_id: response.data.id,
            notes: 'Presentada con soporte manual.',
          }),
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: () => {
          this.toast.success('Declaración presentada');
          this.loadDeclarations();
          this.loadOverview();
          this.loadEvidence();
          this.loadHistory();
        },
        error: () => this.handleError('No se pudo presentar la declaración'),
        complete: () => this.working.set(false),
      });
  }

  loadDeclarationLines(item: TaxDeclarationDraft): void {
    this.selectedDeclaration.set(item);
    this.working.set(true);
    this.service
      .getDeclarationLines(this.apiScope(), item.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => this.declarationLines.set(response.data || []),
        error: () => this.handleError('No se pudieron cargar las líneas'),
        complete: () => this.working.set(false),
      });
  }

  createCloseSession(): void {
    this.working.set(true);
    this.service
      .createCloseSession(this.apiScope(), {
        ...this.currentPeriod(),
        close_type: 'monthly',
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.toast.success('Cierre creado');
          this.loadCloseSessions();
          this.loadOverview();
        },
        error: () => this.handleError('No se pudo crear el cierre'),
        complete: () => this.working.set(false),
      });
  }

  runCloseChecks(session: FiscalCloseSession): void {
    this.working.set(true);
    this.service
      .runCloseChecks(this.apiScope(), session.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.toast.success('Checks actualizados');
          this.loadCloseSessions();
          this.loadOverview();
        },
        error: () => this.handleError('No se pudieron ejecutar los checks'),
        complete: () => this.working.set(false),
      });
  }

  attachCloseEvidence(session: FiscalCloseSession): void {
    this.working.set(true);
    this.service
      .attachCloseEvidence(
        this.apiScope(),
        session.id,
        this.manualEvidencePayload('fiscal_close_session', session.id),
      )
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.toast.success('Evidencia adjuntada');
          this.loadEvidence();
          this.loadHistory();
        },
        error: () => this.handleError('No se pudo adjuntar la evidencia'),
        complete: () => this.working.set(false),
      });
  }

  approveClose(session: FiscalCloseSession): void {
    this.working.set(true);
    this.service
      .approveClose(this.apiScope(), session.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.toast.success('Cierre aprobado');
          this.loadCloseSessions();
          this.loadOverview();
          this.loadHistory();
        },
        error: () => this.handleError('No se pudo aprobar el cierre'),
        complete: () => this.working.set(false),
      });
  }

  closeFiscalSession(session: FiscalCloseSession): void {
    this.working.set(true);
    this.service
      .closeSession(this.apiScope(), session.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.toast.success('Cierre completado');
          this.loadCloseSessions();
          this.loadOverview();
          this.loadHistory();
        },
        error: () => this.handleError('No se pudo cerrar el periodo'),
        complete: () => this.working.set(false),
      });
  }

  reopenClose(session: FiscalCloseSession): void {
    const reason =
      window.prompt(
        'Razón de reapertura',
        'Reapertura auditada solicitada por operación fiscal.',
      ) || '';
    if (reason.trim().length < 20) return;

    this.working.set(true);
    this.service
      .reopenCloseSession(this.apiScope(), session.id, reason.trim())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.toast.success('Cierre reabierto');
          this.loadCloseSessions();
          this.loadOverview();
          this.loadHistory();
        },
        error: () => this.handleError('No se pudo reabrir el cierre'),
        complete: () => this.working.set(false),
      });
  }

  formatDate(value?: string | null): string {
    return value ? formatDateOnlyUTC(value) : '-';
  }

  money(value?: string | number | null): string {
    return this.currency.format(this.toNumber(value));
  }

  toNumber(value?: string | number | null): number {
    const amount = Number(value ?? 0);
    return Number.isFinite(amount) ? amount : 0;
  }

  periodLabel(item: {
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

  declarationLabel(type: string): string {
    const labels: Record<string, string> = {
      vat: 'IVA',
      withholding: 'Retención',
      reteiva: 'ReteIVA',
      reteica: 'ReteICA',
      ica: 'ICA',
      exogenous: 'Exógena',
      income_tax_precierre: 'Pre-cierre renta',
    };
    return labels[type] || type;
  }

  evidenceLabel(type: string): string {
    return type.replace(/_/g, ' ');
  }

  eventLabel(type: string): string {
    return type
      .replace(/^fiscal\./, '')
      .replace(/\./g, ' ')
      .replace(/_/g, ' ');
  }

  resourceLabel(type: string): string {
    const labels: Record<string, string> = {
      fiscal_obligation: 'Obligación',
      tax_declaration_draft: 'Declaración',
      fiscal_close_session: 'Cierre',
      fiscal_close_check: 'Check de cierre',
      fiscal_evidence: 'Evidencia',
    };
    return labels[type] || type;
  }

  actorLabel(item: FiscalOperationEvent): string {
    const actor = item.actor_user;
    if (!actor) return 'Sistema';
    const fullName = [actor.first_name, actor.last_name]
      .filter(Boolean)
      .join(' ');
    return fullName || actor.email || 'Usuario';
  }

  historyEntityLabel(item: FiscalOperationEvent): string {
    const entity = item.accounting_entity;
    const name = entity?.legal_name || entity?.name || entity?.tax_id;
    if (name && item.store?.name) return `${name} · ${item.store.name}`;
    return name || item.store?.name || 'Entidad fiscal';
  }

  statusTransitionLabel(item: FiscalOperationEvent): string {
    const prev = item.previous_status
      ? this.statusLabel(item.previous_status)
      : '';
    const next = item.new_status ? this.statusLabel(item.new_status) : '';
    if (prev && next) return `${prev} → ${next}`;
    return next || prev || '-';
  }

  statusLabel(status: string): string {
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
      draft: 'Borrador',
      calculating: 'Calculando',
      needs_review: 'Revisión',
      closed: 'Cerrado',
      checking: 'Validando',
      passed: 'OK',
      failed: 'Falla',
      warning: 'Alerta',
      active: 'Activa',
    };
    return labels[status] || status;
  }

  /** Theme hex per status group → soft-pill badge (table + item-list colorFn). */
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

  /** BadgeVariant per status group → for `<app-badge>` in close/rules tabs. */
  statusVariant(status: string): BadgeVariant {
    const s = status.toLowerCase();
    if (
      ['accepted', 'approved', 'paid', 'passed', 'active', 'ready'].includes(s)
    ) {
      return 'success';
    }
    if (['rejected', 'overdue', 'failed', 'blocked'].includes(s)) {
      return 'error';
    }
    if (['warning', 'needs_review', 'submitted', 'checking'].includes(s)) {
      return 'warning';
    }
    return 'neutral';
  }

  private loadTab(tab: FiscalTab): void {
    if (tab === 'dashboard') return;
    if (tab === 'obligations') this.loadObligations();
    if (tab === 'declarations') this.loadDeclarations();
    if (tab === 'close') this.loadCloseSessions();
    if (tab === 'audit') {
      // Unified audit view: preload both sections so the internal
      // Evidencias ↔ Historial toggle is instant.
      this.loadEvidence();
      this.loadHistory();
    }
    if (tab === 'evidence') this.loadEvidence();
    if (tab === 'history') this.loadHistory();
    // El tab 'rules' carga sus propios datos en <app-fiscal-rules-tab>.
  }

  private loadOverview(): void {
    this.loading.set(true);
    this.errorMessage.set(null);
    this.service
      .getOverview(this.apiScope())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => this.overview.set(response.data),
        error: () => this.handleError('No se pudo cargar el resumen fiscal'),
        complete: () => this.loading.set(false),
      });
  }

  private loadObligations(): void {
    this.service
      .listObligations(this.apiScope(), { limit: 50 })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => this.obligations.set(response.data || []),
        error: () => this.handleError('No se pudieron cargar las obligaciones'),
      });
  }

  private loadDeclarations(): void {
    this.service
      .listDeclarations(this.apiScope(), { limit: 50 })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => this.declarations.set(response.data || []),
        error: () =>
          this.handleError('No se pudieron cargar las declaraciones'),
      });
  }

  private loadCloseSessions(): void {
    this.service
      .listCloseSessions(this.apiScope())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => this.closeSessions.set(response.data || []),
        error: () => this.handleError('No se pudieron cargar los cierres'),
      });
  }

  private loadEvidence(): void {
    this.service
      .listEvidence(this.apiScope())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => this.evidence.set(response.data || []),
        error: () => this.handleError('No se pudieron cargar las evidencias'),
      });
  }

  private loadHistory(): void {
    this.service
      .listHistory(this.apiScope(), { limit: 50 })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => this.history.set(response.data || []),
        error: () => this.handleError('No se pudo cargar el historial fiscal'),
      });
  }

  private manualEvidencePayload(sourceType: string, sourceId: number) {
    return {
      evidence_type: 'manual_support',
      source_type: sourceType,
      source_id: sourceId,
      metadata: {
        captured_at: new Date().toISOString(),
        capture_mode: 'manual',
      },
    };
  }

  private handleError(message: string): void {
    this.errorMessage.set(message);
    this.toast.error(message);
    this.loading.set(false);
    this.working.set(false);
  }

  private apiScope(): FiscalApiScope {
    const routeScope = this.route.pathFromRoot
      .map((route) => route.snapshot.data['fiscalApiScope'])
      .find(
        (value) =>
          value === 'store' ||
          value === 'organization' ||
          value === 'platform',
      );
    return (routeScope as FiscalApiScope | undefined) ?? 'store';
  }

  private currentPeriod(): { period_year: number; period_month: number } {
    const now = new Date();
    return {
      period_year: now.getFullYear(),
      period_month: now.getMonth() + 1,
    };
  }
}
