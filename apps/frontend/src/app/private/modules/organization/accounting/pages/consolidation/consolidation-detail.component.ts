import {
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import {
  AlertBannerComponent,
  ButtonComponent,
  CardComponent,
  IconComponent,
  ItemListCardConfig,
  ResponsiveDataViewComponent,
  ScrollableTabsComponent,
  ScrollableTab,
  StatsComponent,
  TableAction,
  TableColumn,
  ToastService,
} from '../../../../../../shared/components/index';
import { ApiErrorService } from '../../../../../../core/services/api-error.service';
import { CurrencyFormatService } from '../../../../../../shared/pipes/currency';
import { formatDateOnlyUTC } from '../../../../../../shared/utils/date.util';
import {
  BalanceSheetReport,
  ConsolidationSession,
  EliminationsReport,
  IncomeStatementReport,
  IntercompanyTransaction,
  OrgConsolidationService,
  TrialBalanceAccountRow,
  TrialBalanceReport,
} from '../../services/org-consolidation.service';

type ReportTab =
  | 'overview'
  | 'intercompany'
  | 'trial-balance'
  | 'balance-sheet'
  | 'income-statement'
  | 'eliminations';

@Component({
  selector: 'vendix-org-consolidation-detail',
  standalone: true,
  imports: [
    AlertBannerComponent,
    ButtonComponent,
    CardComponent,
    IconComponent,
    ResponsiveDataViewComponent,
    ScrollableTabsComponent,
    StatsComponent,
  ],
  template: `
    <div class="flex w-full flex-col gap-4 overflow-x-hidden">
      <!-- Header / lifecycle -->
      <app-card [responsive]="true">
        <div class="flex flex-col gap-3">
          <div class="flex items-start justify-between gap-3">
            <button
              type="button"
              class="flex items-center gap-1 text-sm text-text-secondary hover:text-text-primary"
              (click)="goBack()"
            >
              <app-icon name="arrow-left" [size]="16"></app-icon>
              Sesiones
            </button>
            @if (session(); as s) {
              <span
                class="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium"
                [class]="statusClass(s.status)"
              >
                {{ statusLabel(s.status) }}
              </span>
            }
          </div>

          @if (session(); as s) {
            <div class="flex flex-col gap-1">
              <h1 class="text-lg font-semibold text-text-primary">{{ s.name }}</h1>
              <p class="text-sm text-text-secondary">
                {{ s.fiscal_period?.name || 'Sin período' }}
                · {{ formatDate(s.session_date) }}
              </p>
              @if (s.notes) {
                <p class="mt-1 text-sm text-text-secondary">{{ s.notes }}</p>
              }
            </div>

            <div class="flex flex-wrap gap-2 pt-1">
              @if (s.status === 'draft') {
                <app-button
                  variant="primary"
                  size="sm"
                  [loading]="acting()"
                  (clicked)="startSession()"
                >
                  <app-icon name="play" [size]="16" slot="icon"></app-icon>
                  Iniciar
                </app-button>
              }
              @if (s.status === 'in_progress') {
                <app-button
                  variant="success"
                  size="sm"
                  [loading]="acting()"
                  (clicked)="completeSession()"
                >
                  <app-icon name="check-circle" [size]="16" slot="icon"></app-icon>
                  Completar
                </app-button>
              }
              @if (s.status === 'draft' || s.status === 'in_progress') {
                <app-button
                  variant="danger"
                  size="sm"
                  [loading]="acting()"
                  (clicked)="cancelSession()"
                >
                  <app-icon name="x-circle" [size]="16" slot="icon"></app-icon>
                  Cancelar
                </app-button>
              }
            </div>
          }
        </div>
      </app-card>

      @if (errorMessage(); as msg) {
        <app-alert-banner variant="danger" title="Error">
          {{ msg }}
        </app-alert-banner>
      }

      <!-- Report tabs -->
      <div class="border-b border-border">
        <app-scrollable-tabs
          [tabs]="reportTabs"
          [activeTab]="activeTab()"
          size="sm"
          ariaLabel="Reportes de consolidación"
          (tabChange)="onTabChange($event)"
        />
      </div>

      <!-- Overview -->
      @if (activeTab() === 'overview') {
        <div class="stats-container">
          <app-stats
            title="Ajustes"
            [value]="session()?._count?.adjustments ?? 0"
            smallText="Eliminaciones y reclasificaciones"
            iconName="sliders"
            iconBgColor="bg-blue-100"
            iconColor="text-blue-500"
          />
          <app-stats
            title="Intercompañía"
            [value]="session()?._count?.intercompany_txns ?? 0"
            smallText="Transacciones detectadas"
            iconName="git-compare"
            iconBgColor="bg-amber-100"
            iconColor="text-amber-500"
          />
        </div>
        <app-card [responsive]="true">
          <p class="text-sm text-text-secondary">
            Detecta operaciones intercompañía, elimínalas y consulta los estados
            financieros consolidados desde las pestañas superiores.
          </p>
        </app-card>
      }

      <!-- Intercompany -->
      @if (activeTab() === 'intercompany') {
        <app-card [responsive]="true" [padding]="false">
          <div class="flex flex-col gap-2 px-2 py-3 md:flex-row md:items-center md:justify-between md:px-6 md:py-4 md:border-b md:border-border">
            <h2 class="text-sm font-semibold text-text-primary md:text-lg">
              Operaciones intercompañía ({{ intercompany().length }})
            </h2>
            <div class="flex flex-wrap gap-2">
              <app-button
                variant="secondary"
                size="sm"
                [loading]="acting()"
                (clicked)="detect()"
              >
                <app-icon name="search" [size]="16" slot="icon"></app-icon>
                Detectar
              </app-button>
              <app-button
                variant="primary"
                size="sm"
                [disabled]="!hasPendingTxns()"
                [loading]="acting()"
                (clicked)="autoEliminate()"
              >
                <app-icon name="wand-2" [size]="16" slot="icon"></app-icon>
                Auto-eliminar
              </app-button>
              <app-button
                variant="danger"
                size="sm"
                [disabled]="!hasPendingTxns()"
                [loading]="acting()"
                (clicked)="eliminateAll()"
              >
                <app-icon name="trash-2" [size]="16" slot="icon"></app-icon>
                Eliminar todas
              </app-button>
            </div>
          </div>
          <div class="px-2 pb-2 pt-3 md:p-4">
            <app-responsive-data-view
              [data]="intercompany()"
              [columns]="icColumns"
              [actions]="icActions"
              [cardConfig]="icCardConfig"
              [loading]="loadingTab()"
              emptyTitle="Sin operaciones"
              emptyMessage="Sin operaciones"
              emptyDescription="Ejecuta 'Detectar' para buscar operaciones intercompañía en el período."
              emptyIcon="git-compare"
              [showEmptyAction]="false"
            />
          </div>
        </app-card>
      }

      <!-- Trial balance -->
      @if (activeTab() === 'trial-balance') {
        @if (trialBalance(); as tb) {
          <div class="stats-container">
            <app-stats
              title="Débitos consolidados"
              [value]="formatMoney(tb.consolidated.totals.total_debit)"
              iconName="arrow-up-circle"
              iconBgColor="bg-emerald-100"
              iconColor="text-emerald-500"
            />
            <app-stats
              title="Créditos consolidados"
              [value]="formatMoney(tb.consolidated.totals.total_credit)"
              iconName="arrow-down-circle"
              iconBgColor="bg-purple-100"
              iconColor="text-purple-500"
            />
          </div>
        }
        <app-card [responsive]="true" [padding]="false">
          <div class="px-2 pb-2 pt-3 md:p-4">
            <app-responsive-data-view
              [data]="trialBalance()?.consolidated?.accounts ?? []"
              [columns]="balanceColumns"
              [cardConfig]="balanceCardConfig"
              [loading]="loadingTab()"
              emptyTitle="Sin datos"
              emptyMessage="Sin datos"
              emptyDescription="No hay saldos consolidados para este período."
              emptyIcon="scale"
              [showEmptyAction]="false"
            />
          </div>
        </app-card>
      }

      <!-- Balance sheet -->
      @if (activeTab() === 'balance-sheet') {
        @if (balanceSheet(); as bs) {
          <div class="stats-container">
            <app-stats
              title="Activos"
              [value]="formatMoney(bs.consolidated.assets.total)"
              iconName="wallet"
              iconBgColor="bg-blue-100"
              iconColor="text-blue-500"
            />
            <app-stats
              title="Pasivos"
              [value]="formatMoney(bs.consolidated.liabilities.total)"
              iconName="credit-card"
              iconBgColor="bg-amber-100"
              iconColor="text-amber-500"
            />
            <app-stats
              title="Patrimonio"
              [value]="formatMoney(bs.consolidated.equity.total)"
              iconName="landmark"
              iconBgColor="bg-emerald-100"
              iconColor="text-emerald-500"
            />
            <app-stats
              [title]="bs.consolidated.balance_check.is_balanced ? 'Cuadrado' : 'Descuadrado'"
              [value]="formatMoney(bs.consolidated.balance_check.total_liabilities_and_equity)"
              smallText="Pasivo + patrimonio"
              [iconName]="bs.consolidated.balance_check.is_balanced ? 'check-circle' : 'alert-triangle'"
              [iconBgColor]="bs.consolidated.balance_check.is_balanced ? 'bg-emerald-100' : 'bg-red-100'"
              [iconColor]="bs.consolidated.balance_check.is_balanced ? 'text-emerald-500' : 'text-red-500'"
            />
          </div>
        }
        <app-card [responsive]="true" [padding]="false">
          <div class="px-2 pb-2 pt-3 md:p-4">
            <app-responsive-data-view
              [data]="balanceSheetRows()"
              [columns]="sectionColumns"
              [cardConfig]="sectionCardConfig"
              [loading]="loadingTab()"
              emptyTitle="Sin datos"
              emptyMessage="Sin datos"
              emptyDescription="No hay balance consolidado para este período."
              emptyIcon="scale"
              [showEmptyAction]="false"
            />
          </div>
        </app-card>
      }

      <!-- Income statement -->
      @if (activeTab() === 'income-statement') {
        @if (incomeStatement(); as is) {
          <div class="stats-container">
            <app-stats
              title="Ingresos"
              [value]="formatMoney(is.consolidated.revenue.total)"
              iconName="trending-up"
              iconBgColor="bg-emerald-100"
              iconColor="text-emerald-500"
            />
            <app-stats
              title="Gastos"
              [value]="formatMoney(is.consolidated.expenses.total)"
              iconName="trending-down"
              iconBgColor="bg-red-100"
              iconColor="text-red-500"
            />
            <app-stats
              title="Utilidad neta"
              [value]="formatMoney(is.consolidated.net_income)"
              iconName="calculator"
              iconBgColor="bg-blue-100"
              iconColor="text-blue-500"
            />
          </div>
        }
        <app-card [responsive]="true" [padding]="false">
          <div class="px-2 pb-2 pt-3 md:p-4">
            <app-responsive-data-view
              [data]="incomeStatementRows()"
              [columns]="sectionColumns"
              [cardConfig]="sectionCardConfig"
              [loading]="loadingTab()"
              emptyTitle="Sin datos"
              emptyMessage="Sin datos"
              emptyDescription="No hay estado de resultados consolidado para este período."
              emptyIcon="file-bar-chart"
              [showEmptyAction]="false"
            />
          </div>
        </app-card>
      }

      <!-- Eliminations -->
      @if (activeTab() === 'eliminations') {
        @if (eliminations(); as el) {
          <div class="stats-container">
            <app-stats
              title="Eliminadas"
              [value]="el.summary.total_transactions_eliminated"
              smallText="Transacciones"
              iconName="trash-2"
              iconBgColor="bg-red-100"
              iconColor="text-red-500"
            />
            <app-stats
              title="Monto eliminado"
              [value]="formatMoney(el.summary.total_amount_eliminated)"
              iconName="banknote"
              iconBgColor="bg-amber-100"
              iconColor="text-amber-500"
            />
          </div>
        }
        <app-card [responsive]="true" [padding]="false">
          <div class="px-2 pb-2 pt-3 md:p-4">
            <app-responsive-data-view
              [data]="eliminations()?.intercompany_transactions ?? []"
              [columns]="icColumns"
              [cardConfig]="icCardConfig"
              [loading]="loadingTab()"
              emptyTitle="Sin eliminaciones"
              emptyMessage="Sin eliminaciones"
              emptyDescription="Todavía no se han eliminado operaciones intercompañía."
              emptyIcon="trash-2"
              [showEmptyAction]="false"
            />
          </div>
        </app-card>
      }
    </div>
  `,
})
export class OrgConsolidationDetailComponent {
  private readonly service = inject(OrgConsolidationService);
  private readonly errors = inject(ApiErrorService);
  private readonly toast = inject(ToastService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly currency = inject(CurrencyFormatService);

  readonly sessionId = Number(this.route.snapshot.paramMap.get('id'));

  readonly session = signal<ConsolidationSession | null>(null);
  readonly acting = signal(false);
  readonly loadingTab = signal(false);
  readonly errorMessage = signal<string | null>(null);

  readonly activeTab = signal<ReportTab>('overview');

  readonly intercompany = signal<IntercompanyTransaction[]>([]);
  readonly trialBalance = signal<TrialBalanceReport | null>(null);
  readonly balanceSheet = signal<BalanceSheetReport | null>(null);
  readonly incomeStatement = signal<IncomeStatementReport | null>(null);
  readonly eliminations = signal<EliminationsReport | null>(null);

  readonly reportTabs: ScrollableTab[] = [
    { id: 'overview', label: 'Resumen', icon: 'layout-dashboard' },
    { id: 'intercompany', label: 'Intercompañía', icon: 'git-compare' },
    { id: 'trial-balance', label: 'Balance de prueba', icon: 'scale' },
    { id: 'balance-sheet', label: 'Balance general', icon: 'wallet' },
    { id: 'income-statement', label: 'Estado de resultados', icon: 'file-bar-chart' },
    { id: 'eliminations', label: 'Eliminaciones', icon: 'trash-2' },
  ];

  readonly hasPendingTxns = computed(() =>
    this.intercompany().some((t) => !t.eliminated),
  );

  readonly balanceSheetRows = computed<TrialBalanceAccountRow[]>(() => {
    const bs = this.balanceSheet();
    if (!bs) return [];
    return [
      ...bs.consolidated.assets.accounts,
      ...bs.consolidated.liabilities.accounts,
      ...bs.consolidated.equity.accounts,
    ];
  });

  readonly incomeStatementRows = computed<TrialBalanceAccountRow[]>(() => {
    const is = this.incomeStatement();
    if (!is) return [];
    return [...is.consolidated.revenue.accounts, ...is.consolidated.expenses.accounts];
  });

  // ── Intercompany table config ──────────────────────────────────────────
  readonly icActions: TableAction[] = [
    {
      label: 'Eliminar',
      icon: 'trash-2',
      variant: 'danger',
      show: (row: IntercompanyTransaction) => !row.eliminated,
      action: (row: IntercompanyTransaction) => this.eliminateOne(row),
    },
  ];

  readonly icColumns: TableColumn[] = [
    { key: 'from_store.name', label: 'Origen', priority: 1, defaultValue: '—' },
    { key: 'to_store.name', label: 'Destino', priority: 1, defaultValue: '—' },
    {
      key: 'account.code',
      label: 'Cuenta',
      priority: 2,
      transform: (value, row) =>
        this.accountLabel((row as IntercompanyTransaction)?.account),
    },
    {
      key: 'amount',
      label: 'Monto',
      align: 'right',
      priority: 1,
      transform: (value) => this.formatMoney(value as string | number),
    },
    {
      key: 'eliminated',
      label: 'Estado',
      align: 'center',
      priority: 1,
      badgeConfig: {
        type: 'status',
        colorMap: { Eliminada: 'success', Pendiente: 'warn' },
      },
      transform: (value) => (value ? 'Eliminada' : 'Pendiente'),
    },
  ];

  readonly icCardConfig: ItemListCardConfig = {
    titleKey: 'id',
    titleTransform: (item: IntercompanyTransaction) =>
      `${item?.from_store?.name ?? '—'} → ${item?.to_store?.name ?? '—'}`,
    subtitleTransform: (item: IntercompanyTransaction) =>
      this.accountLabel(item?.account),
    avatarFallbackIcon: 'git-compare',
    avatarShape: 'square',
    badgeKey: 'eliminated',
    badgeConfig: {
      type: 'status',
      colorMap: { Eliminada: 'success', Pendiente: 'warn' },
    },
    badgeTransform: (value) => (value ? 'Eliminada' : 'Pendiente'),
    footerKey: 'amount',
    footerLabel: 'Monto',
    footerTransform: (value) => this.formatMoney(value as string | number),
  };

  // ── Trial balance table config ─────────────────────────────────────────
  readonly balanceColumns: TableColumn[] = [
    { key: 'account_code', label: 'Código', priority: 1, defaultValue: '—' },
    { key: 'account_name', label: 'Cuenta', priority: 1, defaultValue: '—' },
    {
      key: 'account_type',
      label: 'Tipo',
      priority: 3,
      transform: (value) => this.accountTypeLabel(String(value || '')),
    },
    {
      key: 'total_debit',
      label: 'Débito',
      align: 'right',
      priority: 2,
      transform: (value) => this.formatMoney(value as number),
    },
    {
      key: 'total_credit',
      label: 'Crédito',
      align: 'right',
      priority: 2,
      transform: (value) => this.formatMoney(value as number),
    },
    {
      key: 'balance',
      label: 'Saldo',
      align: 'right',
      priority: 1,
      transform: (value) => this.formatMoney(value as number),
    },
  ];

  readonly balanceCardConfig: ItemListCardConfig = {
    titleKey: 'account_name',
    subtitleKey: 'account_code',
    avatarFallbackIcon: 'scale',
    avatarShape: 'square',
    footerKey: 'balance',
    footerLabel: 'Saldo',
    footerTransform: (value) => this.formatMoney(value as number),
    detailKeys: [
      {
        key: 'total_debit',
        label: 'Débito',
        icon: 'arrow-up-circle',
        transform: (value) => this.formatMoney(value as number),
      },
      {
        key: 'total_credit',
        label: 'Crédito',
        icon: 'arrow-down-circle',
        transform: (value) => this.formatMoney(value as number),
      },
    ],
  };

  // ── Balance-sheet / income-statement section config ────────────────────
  readonly sectionColumns: TableColumn[] = [
    { key: 'account_code', label: 'Código', priority: 1, defaultValue: '—' },
    { key: 'account_name', label: 'Cuenta', priority: 1, defaultValue: '—' },
    {
      key: 'account_type',
      label: 'Tipo',
      align: 'center',
      priority: 2,
      transform: (value) => this.accountTypeLabel(String(value || '')),
    },
    {
      key: 'balance',
      label: 'Saldo',
      align: 'right',
      priority: 1,
      transform: (value) => this.formatMoney(value as number),
    },
  ];

  readonly sectionCardConfig: ItemListCardConfig = {
    titleKey: 'account_name',
    subtitleKey: 'account_code',
    avatarFallbackIcon: 'list-tree',
    avatarShape: 'square',
    badgeKey: 'account_type',
    badgeConfig: { type: 'status', size: 'sm' },
    badgeTransform: (value) => this.accountTypeLabel(String(value || '')),
    footerKey: 'balance',
    footerLabel: 'Saldo',
    footerTransform: (value) => this.formatMoney(value as number),
  };

  constructor() {
    this.currency.loadCurrency();
    this.loadSession();
  }

  private loadSession(): void {
    this.service
      .getSession(this.sessionId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.session.set(res?.data ?? null);
        },
        error: (err) => {
          this.errorMessage.set(
            this.errors.humanize(err, 'No se pudo cargar la sesión.'),
          );
        },
      });
  }

  onTabChange(tabId: string): void {
    const tab = tabId as ReportTab;
    this.activeTab.set(tab);
    this.loadTab(tab);
  }

  private loadTab(tab: ReportTab): void {
    this.errorMessage.set(null);
    switch (tab) {
      case 'intercompany':
        this.loadIntercompany();
        break;
      case 'trial-balance':
        if (!this.trialBalance()) this.loadTrialBalance();
        break;
      case 'balance-sheet':
        if (!this.balanceSheet()) this.loadBalanceSheet();
        break;
      case 'income-statement':
        if (!this.incomeStatement()) this.loadIncomeStatement();
        break;
      case 'eliminations':
        this.loadEliminations();
        break;
      default:
        break;
    }
  }

  private loadIntercompany(): void {
    this.loadingTab.set(true);
    this.service
      .getIntercompany(this.sessionId, { limit: 200 })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.intercompany.set(res?.data ?? []);
          this.loadingTab.set(false);
        },
        error: (err) => {
          this.intercompany.set([]);
          this.loadingTab.set(false);
          this.errorMessage.set(
            this.errors.humanize(err, 'No se pudieron cargar las operaciones.'),
          );
        },
      });
  }

  private loadTrialBalance(): void {
    this.loadingTab.set(true);
    this.service
      .getTrialBalance(this.sessionId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.trialBalance.set(res?.data ?? null);
          this.loadingTab.set(false);
        },
        error: (err) => {
          this.loadingTab.set(false);
          this.errorMessage.set(
            this.errors.humanize(err, 'No se pudo cargar el balance de prueba.'),
          );
        },
      });
  }

  private loadBalanceSheet(): void {
    this.loadingTab.set(true);
    this.service
      .getBalanceSheet(this.sessionId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.balanceSheet.set(res?.data ?? null);
          this.loadingTab.set(false);
        },
        error: (err) => {
          this.loadingTab.set(false);
          this.errorMessage.set(
            this.errors.humanize(err, 'No se pudo cargar el balance general.'),
          );
        },
      });
  }

  private loadIncomeStatement(): void {
    this.loadingTab.set(true);
    this.service
      .getIncomeStatement(this.sessionId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.incomeStatement.set(res?.data ?? null);
          this.loadingTab.set(false);
        },
        error: (err) => {
          this.loadingTab.set(false);
          this.errorMessage.set(
            this.errors.humanize(err, 'No se pudo cargar el estado de resultados.'),
          );
        },
      });
  }

  private loadEliminations(): void {
    this.loadingTab.set(true);
    this.service
      .getEliminations(this.sessionId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.eliminations.set(res?.data ?? null);
          this.loadingTab.set(false);
        },
        error: (err) => {
          this.loadingTab.set(false);
          this.errorMessage.set(
            this.errors.humanize(err, 'No se pudieron cargar las eliminaciones.'),
          );
        },
      });
  }

  // ── Lifecycle actions ────────────────────────────────────────────────
  startSession(): void {
    this.runAction(this.service.startSession(this.sessionId), 'Sesión iniciada.');
  }

  completeSession(): void {
    this.runAction(
      this.service.completeSession(this.sessionId),
      'Sesión completada.',
    );
  }

  cancelSession(): void {
    this.runAction(
      this.service.cancelSession(this.sessionId),
      'Sesión cancelada.',
    );
  }

  private runAction(
    obs: ReturnType<OrgConsolidationService['startSession']>,
    successMsg: string,
  ): void {
    this.acting.set(true);
    obs.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (res) => {
        this.acting.set(false);
        if (res?.data) this.session.set(res.data);
        this.toast.success(successMsg);
      },
      error: (err) => {
        this.acting.set(false);
        this.toast.error(this.errors.humanize(err, 'No se pudo completar la acción.'));
      },
    });
  }

  // ── Intercompany actions ─────────────────────────────────────────────
  detect(): void {
    this.acting.set(true);
    this.service
      .detectIntercompany(this.sessionId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.acting.set(false);
          this.toast.success(
            `${res?.data?.detected ?? 0} operación(es) detectada(s).`,
          );
          this.loadIntercompany();
          this.refreshSessionCounts();
        },
        error: (err) => {
          this.acting.set(false);
          this.toast.error(this.errors.humanize(err, 'No se pudo detectar.'));
        },
      });
  }

  eliminateOne(txn: IntercompanyTransaction): void {
    this.acting.set(true);
    this.service
      .eliminateTransaction(txn.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.acting.set(false);
          this.toast.success('Operación eliminada.');
          this.loadIntercompany();
        },
        error: (err) => {
          this.acting.set(false);
          this.toast.error(this.errors.humanize(err, 'No se pudo eliminar.'));
        },
      });
  }

  eliminateAll(): void {
    this.acting.set(true);
    this.service
      .eliminateAll(this.sessionId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.acting.set(false);
          this.toast.success(
            `${res?.data?.eliminated_count ?? 0} operación(es) eliminada(s).`,
          );
          this.loadIntercompany();
        },
        error: (err) => {
          this.acting.set(false);
          this.toast.error(this.errors.humanize(err, 'No se pudo eliminar.'));
        },
      });
  }

  autoEliminate(): void {
    this.acting.set(true);
    this.service
      .autoEliminate(this.sessionId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.acting.set(false);
          const r = res?.data;
          this.toast.success(
            `${r?.eliminated_count ?? 0} eliminada(s) · ${r?.matched_pairs ?? 0} par(es).`,
          );
          this.loadIntercompany();
        },
        error: (err) => {
          this.acting.set(false);
          this.toast.error(this.errors.humanize(err, 'No se pudo auto-eliminar.'));
        },
      });
  }

  private refreshSessionCounts(): void {
    this.service
      .getSession(this.sessionId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          if (res?.data) this.session.set(res.data);
        },
        error: () => {
          /* non-blocking */
        },
      });
  }

  goBack(): void {
    void this.router.navigate(['/admin/accounting/consolidation']);
  }

  // ── Formatting helpers ───────────────────────────────────────────────
  formatMoney(value: string | number | null | undefined): string {
    return this.currency.format(this.asNumber(value));
  }

  asNumber(value: string | number | undefined | null): number {
    if (value === null || value === undefined) return 0;
    return typeof value === 'number' ? value : Number(value) || 0;
  }

  formatDate(value: string | null | undefined): string {
    return value ? formatDateOnlyUTC(value) : '—';
  }

  accountLabel(account?: { code: string; name: string } | null): string {
    if (!account) return '—';
    return `${account.code} · ${account.name}`;
  }

  statusLabel(status: string): string {
    const labels: Record<string, string> = {
      draft: 'Borrador',
      in_progress: 'En proceso',
      completed: 'Completada',
      cancelled: 'Cancelada',
    };
    return labels[status] || status || '—';
  }

  statusClass(status: string): string {
    const classes: Record<string, string> = {
      draft: 'bg-warning-light text-warning',
      in_progress: 'bg-[var(--color-info-light)] text-[var(--color-info)]',
      completed: 'bg-success-light text-success',
      cancelled: 'bg-error-light text-error',
    };
    return classes[status] || 'bg-[var(--color-surface-secondary)] text-text-primary';
  }

  accountTypeLabel(type: string): string {
    const labels: Record<string, string> = {
      asset: 'Activo',
      liability: 'Pasivo',
      equity: 'Patrimonio',
      revenue: 'Ingreso',
      expense: 'Gasto',
    };
    return labels[type] || type || '—';
  }
}
