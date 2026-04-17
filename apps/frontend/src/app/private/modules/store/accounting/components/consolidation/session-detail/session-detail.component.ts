import {Component,
  inject,
  signal,
  computed,
  DestroyRef} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { DatePipe } from '@angular/common';
import {
  ReactiveFormsModule,
  FormsModule,
  FormBuilder,
  Validators} from '@angular/forms';


import { AccountingService } from '../../../services/accounting.service';
import {
  ConsolidationSession,
  IntercompanyTransaction,
  ConsolidationAdjustment,
  ConsolidatedReport,
  ChartAccount} from '../../../interfaces/accounting.interface';
import {
  ModalComponent,
  ButtonComponent,
  CardComponent,
  InputComponent,
  SelectorComponent,
  TextareaComponent,
  BadgeComponent,
  IconComponent,
  ScrollableTabsComponent,
  ResponsiveDataViewComponent,
  ToastService,
  TableColumn,
  TableAction,
  ItemListCardConfig,
  SelectorOption,
  ScrollableTab,
  BadgeVariant} from '../../../../../../../shared/components/index';
import { CurrencyFormatService } from '../../../../../../../shared/pipes/currency/currency.pipe';

@Component({
  selector: 'vendix-session-detail',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    FormsModule,
    ModalComponent,
    ButtonComponent,
    CardComponent,
    InputComponent,
    SelectorComponent,
    TextareaComponent,
    BadgeComponent,
    IconComponent,
    ScrollableTabsComponent,
    ResponsiveDataViewComponent,
    DatePipe,
  ],
  templateUrl: './session-detail.component.html',
  styleUrls: ['./session-detail.component.scss']})
export class SessionDetailComponent implements {
  private destroyRef = inject(DestroyRef);
private route = inject(ActivatedRoute);
  private router = inject(Router);
  private fb = inject(FormBuilder);
  private accounting_service = inject(AccountingService);
  private toast_service = inject(ToastService);
  private currencyService = inject(CurrencyFormatService);

  // ── State ──────────────────────────────────────────────────────
  session = signal<ConsolidationSession | null>(null);
  action_loading = signal(false);
  active_tab = signal('intercompany');

  // Intercompany
  ic_transactions = signal<IntercompanyTransaction[]>([]);
  ic_loading = signal(false);
  auto_eliminate_loading = signal(false);

  // Adjustments
  adjustments = signal<ConsolidationAdjustment[]>([]);
  adj_loading = signal(false);
  adj_submitting = signal(false);
  // ✅ Migrated to signal for two-way binding (Section 9 — antipatrón variables planas)
  readonly isAdjustmentModalOpen = signal(false);

  // Reports
  report_data = signal<ConsolidatedReport | null>(null);
  report_loading = signal(false);
  selected_report = signal('trial-balance');

  // Drill-down
  drilldown_data = signal<any[]>([]);
  drilldown_meta = signal<any>(null);
  drilldown_loading = signal(false);
  drilldown_filters = signal<Record<string, any>>({ page: 1, limit: 20 });

  // Export
  export_loading = signal(false);

  // Stores for drill-down filter
  stores = signal<Array<{ id: number; name: string }>>([]);
  store_options = computed<SelectorOption[]>(() => [
    { value: '', label: 'Todas las tiendas' },
    ...this.stores().map((s) => ({ value: s.id, label: s.name })),
  ]);

  eliminated_options: SelectorOption[] = [
    { value: '', label: 'Todos' },
    { value: 'true', label: 'Eliminadas' },
    { value: 'false', label: 'Pendientes' },
  ];

  // Accounts for adjustment form
  accounts = signal<ChartAccount[]>([]);
  account_options = computed<SelectorOption[]>(() =>
    this.accounts()
      .filter((a) => a.accepts_entries)
      .map((a) => ({ value: a.id, label: `${a.code} - ${a.name}` })),
  );

  drilldown_account_options = computed<SelectorOption[]>(() => [
    { value: '', label: 'Todas las cuentas' },
    ...this.accounts()
      .filter((a) => a.accepts_entries)
      .map((a) => ({ value: a.id, label: `${a.code} - ${a.name}` })),
  ]);

  // ── Tabs ───────────────────────────────────────────────────────
  tabs: ScrollableTab[] = [
    { id: 'intercompany', label: 'Intercompany', icon: 'git-merge' },
    { id: 'drilldown', label: 'Drill-down', icon: 'search' },
    { id: 'adjustments', label: 'Ajustes', icon: 'sliders' },
    { id: 'reports', label: 'Reportes', icon: 'bar-chart-2' },
  ];

  // ── IC Table Config ────────────────────────────────────────────
  ic_columns: TableColumn[] = [
    {
      key: 'from_store',
      label: 'Desde',
      priority: 1,
      transform: (val: any) => val?.name || '-'},
    {
      key: 'to_store',
      label: 'Hacia',
      priority: 1,
      transform: (val: any) => val?.name || '-'},
    {
      key: 'account',
      label: 'Cuenta',
      priority: 2,
      transform: (val: any) => (val ? `${val.code} - ${val.name}` : '-')},
    {
      key: 'amount',
      label: 'Monto',
      align: 'right',
      priority: 1,
      transform: (val: any) => this.formatCurrency(val)},
    {
      key: 'eliminated',
      label: 'Estado',
      align: 'center',
      priority: 1,
      badge: true,
      badgeConfig: { type: 'status' },
      transform: (val: any) => (val ? 'Eliminada' : 'Pendiente')},
  ];

  ic_card_config: ItemListCardConfig = {
    titleKey: 'from_store',
    titleTransform: (item: any) =>
      `${item.from_store?.name || '-'} → ${item.to_store?.name || '-'}`,
    subtitleKey: 'account',
    subtitleTransform: (item: any) =>
      item.account ? `${item.account.code} - ${item.account.name}` : '-',
    badgeKey: 'eliminated',
    badgeConfig: {
      type: 'status',
      colorMap: { true: 'success', false: 'warn' }},
    badgeTransform: (val: any) => (val ? 'Eliminada' : 'Pendiente'),
    footerKey: 'amount',
    footerLabel: 'Monto',
    footerStyle: 'prominent',
    footerTransform: (val: any) => this.formatCurrency(val),
    detailKeys: [
      {
        key: 'account',
        label: 'Cuenta',
        icon: 'book-open',
        transform: (val: any) => (val ? `${val.code}` : '-')},
    ]};

  ic_table_actions: TableAction[] = [
    {
      label: 'Eliminar',
      icon: 'x-circle',
      variant: 'danger',
      action: (row: IntercompanyTransaction) => this.onEliminateIC(row),
      show: (row: IntercompanyTransaction) =>
        !row.eliminated && this.session()?.status === 'in_progress'},
  ];

  // ── Adjustments Table Config ───────────────────────────────────
  adj_columns: TableColumn[] = [
    {
      key: 'account',
      label: 'Cuenta',
      priority: 1,
      transform: (val: any) => (val ? `${val.code} - ${val.name}` : '-')},
    {
      key: 'type',
      label: 'Tipo',
      priority: 1,
      badge: true,
      badgeConfig: { type: 'status' },
      transform: (val: any) => this.getAdjTypeLabel(val)},
    {
      key: 'debit_amount',
      label: 'Debito',
      align: 'right',
      priority: 1,
      transform: (val: any) => this.formatCurrency(val)},
    {
      key: 'credit_amount',
      label: 'Credito',
      align: 'right',
      priority: 1,
      transform: (val: any) => this.formatCurrency(val)},
    { key: 'description', label: 'Descripcion', priority: 2 },
  ];

  adj_card_config: ItemListCardConfig = {
    titleKey: 'description',
    subtitleKey: 'account',
    badgeKey: 'type',
    badgeConfig: {
      type: 'status',
      colorMap: {
        elimination: 'danger',
        reclassification: 'info',
        adjustment: 'warn'}},
    badgeTransform: (val: any) => this.getAdjTypeLabel(val),
    detailKeys: [
      {
        key: 'debit_amount',
        label: 'Debito',
        icon: 'arrow-up',
        transform: (val: any) => this.formatCurrency(val)},
      {
        key: 'credit_amount',
        label: 'Credito',
        icon: 'arrow-down',
        transform: (val: any) => this.formatCurrency(val)},
    ]};

  adj_table_actions: TableAction[] = [
    {
      label: 'Eliminar',
      icon: 'trash-2',
      variant: 'danger',
      action: (row: ConsolidationAdjustment) => this.onRemoveAdjustment(row),
      show: () => this.session()?.status === 'in_progress'},
  ];

  // ── Adjustment Form ────────────────────────────────────────────
  adj_form = this.fb.group({
    account_id: [null as number | null, [Validators.required]],
    type: ['elimination' as string, [Validators.required]],
    debit_amount: [0, [Validators.required, Validators.min(0)]],
    credit_amount: [0, [Validators.required, Validators.min(0)]],
    description: ['', [Validators.required]]});

  adjustment_type_options: SelectorOption[] = [
    { value: 'elimination', label: 'Eliminacion' },
    { value: 'reclassification', label: 'Reclasificacion' },
    { value: 'adjustment', label: 'Ajuste' },
  ];

  // ── Report Selector ────────────────────────────────────────────
  report_type_options: SelectorOption[] = [
    { value: 'trial-balance', label: 'Balance de Prueba' },
    { value: 'balance-sheet', label: 'Balance General' },
    { value: 'income-statement', label: 'Estado de Resultados' },
    { value: 'eliminations', label: 'Detalle de Eliminaciones' },
  ];

  // ── Lifecycle ──────────────────────────────────────────────────
  constructor() {
    const id = Number(this.route.snapshot.paramMap.get('id'));
    if (id) {
      this.loadSession(id);
      this.loadICTransactions(id);
      this.loadAdjustments(id);
      this.loadAccounts();
    }
  }
// ── Data Loading ───────────────────────────────────────────────
  private loadSession(id: number): void {
    this.accounting_service
      .getConsolidationSession(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => this.session.set(res.data),
        error: () =>
          this.toast_service.show({
            variant: 'error',
            description: 'Error cargando sesion'})});
  }

  private loadICTransactions(session_id: number): void {
    this.ic_loading.set(true);
    this.accounting_service
      .getIntercompanyTransactions(session_id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          const txns = res.data || [];
          this.ic_transactions.set(txns);
          this.ic_loading.set(false);

          // Extract unique stores from IC transactions for drill-down filter
          const store_map = new Map<number, { id: number; name: string }>();
          for (const t of txns) {
            if (t.from_store) store_map.set(t.from_store.id, t.from_store);
            if (t.to_store) store_map.set(t.to_store.id, t.to_store);
          }
          this.stores.set(Array.from(store_map.values()));
        },
        error: () => this.ic_loading.set(false)});
  }

  private loadAdjustments(session_id: number): void {
    this.adj_loading.set(true);
    this.accounting_service
      .getConsolidationSession(session_id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          // Session detail may include adjustments; if backend provides them separately,
          // this can be refactored to use a dedicated endpoint.
          this.adj_loading.set(false);
        },
        error: () => this.adj_loading.set(false)});
  }

  private loadAccounts(): void {
    this.accounting_service
      .getChartOfAccounts()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          const flatten = (accs: ChartAccount[]): ChartAccount[] =>
            accs.reduce(
              (arr, a) => [
                ...arr,
                a,
                ...(a.children ? flatten(a.children) : []),
              ],
              [] as ChartAccount[],
            );
          this.accounts.set(flatten(res.data || []));
        }});
  }

  // ── Tab Change ────────────────────────────────────────────────
  onTabChange(tab: string): void {
    this.active_tab.set(tab);
    if (tab === 'drilldown' && this.drilldown_data().length === 0) {
      this.loadDrilldown();
    }
  }

  // ── Session Actions ────────────────────────────────────────────
  onStart(): void {
    const id = this.session()?.id;
    if (!id) return;
    this.action_loading.set(true);
    this.accounting_service
      .startConsolidationSession(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.session.set(res.data);
          this.action_loading.set(false);
          this.toast_service.show({
            variant: 'success',
            description: 'Sesion iniciada'});
        },
        error: () => {
          this.action_loading.set(false);
          this.toast_service.show({
            variant: 'error',
            description: 'Error iniciando sesion'});
        }});
  }

  onComplete(): void {
    const id = this.session()?.id;
    if (!id) return;
    this.action_loading.set(true);
    this.accounting_service
      .completeConsolidationSession(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.session.set(res.data);
          this.action_loading.set(false);
          this.toast_service.show({
            variant: 'success',
            description: 'Sesion completada'});
        },
        error: () => {
          this.action_loading.set(false);
          this.toast_service.show({
            variant: 'error',
            description: 'Error completando sesion'});
        }});
  }

  onCancel(): void {
    const id = this.session()?.id;
    if (!id) return;
    this.action_loading.set(true);
    this.accounting_service
      .cancelConsolidationSession(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.session.set(res.data);
          this.action_loading.set(false);
          this.toast_service.show({
            variant: 'success',
            description: 'Sesion cancelada'});
        },
        error: () => {
          this.action_loading.set(false);
          this.toast_service.show({
            variant: 'error',
            description: 'Error cancelando sesion'});
        }});
  }

  // ── Intercompany Actions ───────────────────────────────────────
  onDetectIC(): void {
    const id = this.session()?.id;
    if (!id) return;
    this.ic_loading.set(true);
    this.accounting_service
      .detectIntercompanyTransactions(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.ic_transactions.set(res.data || []);
          this.ic_loading.set(false);
          this.toast_service.show({
            variant: 'success',
            description: 'Deteccion completada'});
        },
        error: () => {
          this.ic_loading.set(false);
          this.toast_service.show({
            variant: 'error',
            description: 'Error detectando transacciones'});
        }});
  }

  onEliminateAllIC(): void {
    const id = this.session()?.id;
    if (!id) return;
    this.ic_loading.set(true);
    this.accounting_service
      .eliminateAllIntercompany(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.loadICTransactions(id);
          this.toast_service.show({
            variant: 'success',
            description: 'Todas las transacciones eliminadas'});
        },
        error: () => {
          this.ic_loading.set(false);
          this.toast_service.show({
            variant: 'error',
            description: 'Error eliminando transacciones'});
        }});
  }

  onEliminateIC(txn: IntercompanyTransaction): void {
    this.ic_loading.set(true);
    this.accounting_service
      .eliminateIntercompany(txn.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          const session_id = this.session()?.id;
          if (session_id) this.loadICTransactions(session_id);
          this.toast_service.show({
            variant: 'success',
            description: 'Transaccion eliminada'});
        },
        error: () => {
          this.ic_loading.set(false);
          this.toast_service.show({
            variant: 'error',
            description: 'Error eliminando transaccion'});
        }});
  }

  // ── Adjustment Actions ─────────────────────────────────────────
  onSubmitAdjustment(): void {
    if (this.adj_form.invalid) return;
    const session_id = this.session()?.id;
    if (!session_id) return;

    this.adj_submitting.set(true);
    const { account_id, type, debit_amount, credit_amount, description } =
      this.adj_form.getRawValue();

    this.accounting_service
      .addConsolidationAdjustment(session_id, {
        account_id: account_id!,
        type: type as any,
        debit_amount: debit_amount || 0,
        credit_amount: credit_amount || 0,
        description: description!})
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.adjustments.update((arr) => [...arr, res.data]);
          this.adj_submitting.set(false);
          this.isAdjustmentModalOpen.set(false);
          this.adj_form.reset({
            type: 'elimination',
            debit_amount: 0,
            credit_amount: 0});
          this.toast_service.show({
            variant: 'success',
            description: 'Ajuste agregado'});
        },
        error: () => {
          this.adj_submitting.set(false);
          this.toast_service.show({
            variant: 'error',
            description: 'Error agregando ajuste'});
        }});
  }

  onRemoveAdjustment(adj: ConsolidationAdjustment): void {
    this.adj_loading.set(true);
    this.accounting_service
      .removeConsolidationAdjustment(adj.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.adjustments.update((arr) => arr.filter((a) => a.id !== adj.id));
          this.adj_loading.set(false);
          this.toast_service.show({
            variant: 'success',
            description: 'Ajuste eliminado'});
        },
        error: () => {
          this.adj_loading.set(false);
          this.toast_service.show({
            variant: 'error',
            description: 'Error eliminando ajuste'});
        }});
  }

  // ── Auto-Eliminate Action ──────────────────────────────────────
  onAutoEliminate(): void {
    const id = this.session()?.id;
    if (!id) return;
    this.auto_eliminate_loading.set(true);
    this.accounting_service
      .autoEliminateIntercompany(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.auto_eliminate_loading.set(false);
          this.loadICTransactions(id);
          this.loadDrilldown();
          const data = res.data;
          this.toast_service.show({
            variant: 'success',
            description: `Auto-eliminacion completada: ${data.eliminated_count} transacciones eliminadas`});
        },
        error: () => {
          this.auto_eliminate_loading.set(false);
          this.toast_service.show({
            variant: 'error',
            description: 'Error en auto-eliminacion'});
        }});
  }

  // ── Drill-down Actions ──────────────────────────────────────────
  onDrilldownFilterChange(key: string, value: any): void {
    this.drilldown_filters.update((f) => ({ ...f, [key]: value, page: 1 }));
    this.loadDrilldown();
  }

  onDrilldownPageChange(page: number): void {
    this.drilldown_filters.update((f) => ({ ...f, page }));
    this.loadDrilldown();
  }

  private loadDrilldown(): void {
    const session_id = this.session()?.id;
    if (!session_id) return;

    this.drilldown_loading.set(true);
    const filters = this.drilldown_filters();

    this.accounting_service
      .getConsolidationTransactions(session_id, filters)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.drilldown_data.set(res.data?.data || []);
          this.drilldown_meta.set(res.data?.meta || null);
          this.drilldown_loading.set(false);
        },
        error: () => {
          this.drilldown_loading.set(false);
          this.toast_service.show({
            variant: 'error',
            description: 'Error cargando transacciones'});
        }});
  }

  // ── Export Action ────────────────────────────────────────────────
  onExport(): void {
    const id = this.session()?.id;
    if (!id) return;
    this.export_loading.set(true);
    this.accounting_service
      .exportConsolidation(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.export_loading.set(false);
          const url = res.data?.download_url;
          if (url) {
            window.open(url, '_blank');
          }
          this.toast_service.show({
            variant: 'success',
            description: 'Reporte exportado exitosamente'});
        },
        error: () => {
          this.export_loading.set(false);
          this.toast_service.show({
            variant: 'error',
            description: 'Error exportando reporte'});
        }});
  }

  // ── Report Actions ─────────────────────────────────────────────
  onReportTypeChange(type: any): void {
    this.selected_report.set(type);
    this.loadReport(type);
  }

  private loadReport(type: string): void {
    const session_id = this.session()?.id;
    if (!session_id) return;

    this.report_loading.set(true);
    this.report_data.set(null);

    let obs$;
    switch (type) {
      case 'trial-balance':
        obs$ = this.accounting_service.getConsolidatedTrialBalance(session_id);
        break;
      case 'balance-sheet':
        obs$ = this.accounting_service.getConsolidatedBalanceSheet(session_id);
        break;
      case 'income-statement':
        obs$ =
          this.accounting_service.getConsolidatedIncomeStatement(session_id);
        break;
      case 'eliminations':
        obs$ = this.accounting_service.getEliminationDetail(session_id);
        break;
      default:
        this.report_loading.set(false);
        return;
    }

    obs$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (res: any) => {
        this.report_data.set(res.data);
        this.report_loading.set(false);
      },
      error: () => {
        this.report_loading.set(false);
        this.toast_service.show({
          variant: 'error',
          description: 'Error cargando reporte'});
      }});
  }

  // ── Helpers ────────────────────────────────────────────────────
  goBack(): void {
    this.router.navigate(['/store/accounting/consolidation']);
  }

  getStatusLabel(): string {
    const labels: Record<string, string> = {
      draft: 'Borrador',
      in_progress: 'En Progreso',
      completed: 'Completada',
      cancelled: 'Cancelada'};
    return labels[this.session()?.status || ''] || '-';
  }

  getStatusBadgeVariant(): BadgeVariant {
    const map: Record<string, BadgeVariant> = {
      draft: 'warning',
      in_progress: 'primary',
      completed: 'success',
      cancelled: 'error'};
    return map[this.session()?.status || ''] || 'neutral';
  }

  getAdjTypeLabel(type: string): string {
    const labels: Record<string, string> = {
      elimination: 'Eliminacion',
      reclassification: 'Reclasificacion',
      adjustment: 'Ajuste'};
    return labels[type] || type;
  }

  formatCurrency(val: any): string {
    return this.currencyService.format(Number(val) || 0);
  }
}
