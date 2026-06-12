import {
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, FormControl, FormsModule } from '@angular/forms';

import {
  CardComponent,
  EmptyStateComponent,
  InputComponent,
  ItemListCardConfig,
  ResponsiveDataViewComponent,
  ScrollableTab,
  ScrollableTabsComponent,
  SelectorComponent,
  SelectorOption,
  SpinnerComponent,
  StickyHeaderComponent,
  TableColumn,
  ToastService,
} from '../../../../../../shared/components';
import { CurrencyFormatService, CurrencyPipe } from '../../../../../../shared/pipes/currency/currency.pipe';
import { getDefaultEndDate, getDefaultStartDate } from '../../../../../../shared/utils/date.util';
import {
  BalanceSheetGroup,
  BalanceSheetReport,
  GeneralLedgerRow,
  IncomeStatementReport,
  TrialBalanceRow,
} from '../../interfaces/superadmin-fiscal.interface';
import { SuperadminFiscalService } from '../../services/superadmin-fiscal.service';

type ReportTab = 'trial' | 'balance' | 'income' | 'ledger';

@Component({
  selector: 'app-fiscal-reports',
  standalone: true,
  imports: [
    FormsModule,
    CurrencyPipe,
    StickyHeaderComponent,
    CardComponent,
    EmptyStateComponent,
    InputComponent,
    ResponsiveDataViewComponent,
    ScrollableTabsComponent,
    SelectorComponent,
    SpinnerComponent,
  ],
  template: `
    <div class="w-full">
      <app-sticky-header
        title="Reportes Contables"
        subtitle="Balance de prueba, balance general, estado de resultados y libro mayor"
        icon="file-text"
      />

      <div class="px-2 md:px-4 pt-2 pb-4 space-y-4">
        <app-card [responsive]="true" [padding]="false" customClasses="!p-0">
          <div class="px-2 py-2 md:px-4 md:py-3 border-b border-border">
            <app-scrollable-tabs
              [tabs]="tabs"
              [activeTab]="activeTab()"
              size="sm"
              ariaLabel="Secciones de reportes"
              (tabChange)="onTabChange($any($event))"
            />
          </div>

          <div class="p-3 md:p-4 space-y-4">
            <!-- Filters per tab -->
            <div class="grid grid-cols-1 md:grid-cols-12 gap-3">
              @if (activeTab() !== 'balance' && activeTab() !== 'ledger') {
                <div class="md:col-span-3">
                  <app-input
                    label="Desde"
                    type="date"
                    size="sm"
                    [control]="range.controls.from"
                  />
                </div>
                <div class="md:col-span-3">
                  <app-input
                    label="Hasta"
                    type="date"
                    size="sm"
                    [control]="range.controls.to"
                  />
                </div>
              }
              @if (activeTab() === 'balance') {
                <div class="md:col-span-3">
                  <app-input
                    label="Al"
                    type="date"
                    size="sm"
                    [control]="asOfControl"
                  />
                </div>
              }
              @if (activeTab() === 'ledger') {
                <div class="md:col-span-3">
                  <app-selector
                    size="sm"
                    variant="outline"
                    label="Cuenta"
                    placeholder="Selecciona una cuenta…"
                    [options]="ledgerAccountOptions()"
                    [ngModel]="ledgerAccountCode()"
                    (ngModelChange)="onLedgerAccountChange($any($event))"
                  />
                </div>
                <div class="md:col-span-3">
                  <app-input
                    label="Desde"
                    type="date"
                    size="sm"
                    [control]="range.controls.from"
                  />
                </div>
                <div class="md:col-span-3">
                  <app-input
                    label="Hasta"
                    type="date"
                    size="sm"
                    [control]="range.controls.to"
                  />
                </div>
              }
              <div class="md:col-span-3 flex items-end">
                <app-selector
                  size="sm"
                  variant="outline"
                  label="Vista"
                  [options]="groupingOptions"
                  [ngModel]="grouping()"
                  (ngModelChange)="onGroupingChange($any($event))"
                />
              </div>
            </div>

            @if (loading()) {
              <div class="py-8 text-center">
                <app-spinner size="md" label="Generando reporte…"></app-spinner>
              </div>
            }

            <!-- TRIAL BALANCE -->
            @if (activeTab() === 'trial' && !loading()) {
              <h3 class="text-sm font-semibold text-text-primary">Balance de Prueba</h3>
              @if (trialRows().length === 0) {
                <app-empty-state
                  icon="file-text"
                  title="Sin movimientos"
                  description="No hay movimientos en el periodo seleccionado."
                  [showActionButton]="false"
                />
              } @else {
                <app-responsive-data-view
                  [data]="trialRows()"
                  [columns]="trialColumns"
                  [cardConfig]="trialCard"
                  [loading]="loading()"
                />
                <div class="text-right text-sm font-semibold pt-2">
                  Σ DR {{ trialTotalDebit() | currency }} · Σ CR {{ trialTotalCredit() | currency }}
                </div>
              }
            }

            <!-- BALANCE SHEET -->
            @if (activeTab() === 'balance' && !loading()) {
              <h3 class="text-sm font-semibold text-text-primary">Balance General</h3>
              @if (!balanceSheet()) {
                <app-empty-state
                  icon="file-text"
                  title="Sin datos"
                  description="No se pudo generar el balance general para la fecha indicada."
                  [showActionButton]="false"
                />
              } @else {
                <div class="space-y-4">
                  @for (group of balanceGroups(); track group.account_type) {
                    <div>
                      <h4 class="text-xs font-semibold text-text-secondary uppercase tracking-wide mb-1">
                        {{ group.label }}
                      </h4>
                      <app-responsive-data-view
                        [data]="group.accounts"
                        [columns]="groupColumns"
                        [cardConfig]="groupCard"
                        [loading]="loading()"
                      />
                      <div class="text-right text-sm font-semibold pt-1">
                        Subtotal: {{ toNumber(group.total) | currency }}
                      </div>
                    </div>
                  }
                  <div class="grid grid-cols-1 md:grid-cols-2 gap-2 pt-2 border-t border-border">
                    <div class="flex justify-between text-sm">
                      <span class="text-text-secondary">Total activos</span>
                      <span class="font-mono font-semibold">
                        {{ toNumber(balanceSheet()?.total_assets) | currency }}
                      </span>
                    </div>
                    <div class="flex justify-between text-sm">
                      <span class="text-text-secondary">Total pasivo + patrimonio</span>
                      <span class="font-mono font-semibold">
                        {{ toNumber(balanceSheet()?.total_liabilities_equity) | currency }}
                      </span>
                    </div>
                  </div>
                </div>
              }
            }

            <!-- INCOME STATEMENT -->
            @if (activeTab() === 'income' && !loading()) {
              <h3 class="text-sm font-semibold text-text-primary">Estado de Resultados</h3>
              @if (!incomeStatement()) {
                <app-empty-state
                  icon="file-text"
                  title="Sin datos"
                  description="No se pudo generar el estado de resultados para el periodo."
                  [showActionButton]="false"
                />
              } @else {
                <div class="space-y-4">
                  @for (group of incomeGroups(); track group.account_type) {
                    <div>
                      <h4 class="text-xs font-semibold text-text-secondary uppercase tracking-wide mb-1">
                        {{ group.label }}
                      </h4>
                      <app-responsive-data-view
                        [data]="group.accounts"
                        [columns]="groupColumns"
                        [cardConfig]="groupCard"
                        [loading]="loading()"
                      />
                      <div class="text-right text-sm font-semibold pt-1">
                        Subtotal: {{ toNumber(group.total) | currency }}
                      </div>
                    </div>
                  }
                  <div class="grid grid-cols-1 md:grid-cols-2 gap-2 pt-2 border-t border-border">
                    <div class="flex justify-between text-sm">
                      <span class="text-text-secondary">Resultado neto</span>
                      <span class="font-mono font-semibold">
                        {{ toNumber(incomeStatement()?.net_income) | currency }}
                      </span>
                    </div>
                  </div>
                </div>
              }
            }

            <!-- GENERAL LEDGER -->
            @if (activeTab() === 'ledger' && !loading()) {
              <h3 class="text-sm font-semibold text-text-primary">Libro Mayor</h3>
              @if (!ledgerAccountCode()) {
                <p class="text-sm text-text-secondary py-4">
                  Selecciona una cuenta para ver su libro mayor.
                </p>
              } @else if (ledgerRows().length === 0) {
                <app-empty-state
                  icon="file-text"
                  title="Sin movimientos"
                  description="La cuenta no tiene movimientos en el periodo."
                  [showActionButton]="false"
                />
              } @else {
                <app-responsive-data-view
                  [data]="ledgerRows()"
                  [columns]="ledgerColumns"
                  [cardConfig]="ledgerCard"
                  [loading]="loading()"
                />
              }
            }
          </div>
        </app-card>
      </div>
    </div>
  `,
})
export class ReportsComponent {
  private readonly api = inject(SuperadminFiscalService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly toast = inject(ToastService);
  private readonly fb = inject(FormBuilder);
  private readonly currencyFormat = inject(CurrencyFormatService);

  readonly activeTab = signal<ReportTab>('trial');
  readonly loading = signal<boolean>(false);
  readonly grouping = signal<'detail' | 'summary'>('detail');
  readonly ledgerAccountCode = signal<string>('');

  readonly tabs: ScrollableTab[] = [
    { id: 'trial', label: 'Balance de Prueba', icon: 'file-text' },
    { id: 'balance', label: 'Balance General', icon: 'building' },
    { id: 'income', label: 'Estado de Resultados', icon: 'trending-up' },
    { id: 'ledger', label: 'Libro Mayor', icon: 'book' },
  ];

  readonly groupingOptions: SelectorOption[] = [
    { value: 'detail', label: 'Detalle por cuenta' },
    { value: 'summary', label: 'Resumen por tipo' },
  ];

  readonly range = this.fb.group({
    from: new FormControl(getDefaultStartDate(), { nonNullable: true }),
    to: new FormControl(getDefaultEndDate(), { nonNullable: true }),
  });

  // `asOf` is a single control for the balance sheet
  readonly asOfControl = new FormControl(getDefaultEndDate(), { nonNullable: true });

  // ─── State per report ──────────────────────────────────────────────────
  readonly trialRows = signal<TrialBalanceRow[]>([]);
  readonly balanceSheet = signal<BalanceSheetReport | null>(null);
  readonly incomeStatement = signal<IncomeStatementReport | null>(null);
  readonly ledgerRows = signal<GeneralLedgerRow[]>([]);

  readonly trialTotalDebit = computed(() =>
    this.trialRows().reduce(
      (acc, r) => acc + Number(r.total_debit ?? 0) || 0,
      0,
    ),
  );
  readonly trialTotalCredit = computed(() =>
    this.trialRows().reduce(
      (acc, r) => acc + Number(r.total_credit ?? 0) || 0,
      0,
    ),
  );

  readonly balanceGroups = computed<BalanceSheetGroup[]>(() => {
    const bs = this.balanceSheet();
    if (!bs) return [];
    return [bs.assets, bs.liabilities, bs.equity];
  });

  readonly incomeGroups = computed<BalanceSheetGroup[]>(() => {
    const is = this.incomeStatement();
    if (!is) return [];
    return [is.revenue, is.cost, is.expenses];
  });

  readonly ledgerAccountOptions = computed<SelectorOption[]>(() => {
    // Trial balance rows include the account code + name; reuse as a quick
    // source for account selection without a second round-trip.
    return this.trialRows().map((r) => ({
      value: r.account_code,
      label: `${r.account_code} — ${r.account_name}`,
    }));
  });

  // ─── Table configs ─────────────────────────────────────────────────────
  readonly trialColumns: TableColumn[] = [
    { key: 'account_code', label: 'Código', width: '140px', priority: 1 },
    { key: 'account_name', label: 'Nombre', priority: 1 },
    {
      key: 'total_debit',
      label: 'Débito',
      align: 'right',
      priority: 2,
      transform: (v: string | number) => this.currencyFormat.format(Number(v ?? 0)),
    },
    {
      key: 'total_credit',
      label: 'Crédito',
      align: 'right',
      priority: 2,
      transform: (v: string | number) => this.currencyFormat.format(Number(v ?? 0)),
    },
    {
      key: 'net_balance',
      label: 'Saldo',
      align: 'right',
      priority: 2,
      transform: (v: string | number) => this.currencyFormat.format(Number(v ?? 0)),
    },
  ];

  readonly groupColumns: TableColumn[] = [
    { key: 'account_code', label: 'Código', width: '140px', priority: 1 },
    { key: 'account_name', label: 'Nombre', priority: 1 },
    {
      key: 'balance',
      label: 'Saldo',
      align: 'right',
      priority: 1,
      transform: (v: string | number) => this.currencyFormat.format(Number(v ?? 0)),
    },
  ];

  readonly ledgerColumns: TableColumn[] = [
    {
      key: 'entry_date',
      label: 'Fecha',
      width: '110px',
      priority: 1,
    },
    { key: 'entry_number', label: 'Asiento', width: '160px', priority: 1 },
    { key: 'description', label: 'Descripción', priority: 1 },
    {
      key: 'debit_amount',
      label: 'Débito',
      align: 'right',
      priority: 2,
      transform: (v: string | number) => this.currencyFormat.format(Number(v ?? 0)),
    },
    {
      key: 'credit_amount',
      label: 'Crédito',
      align: 'right',
      priority: 2,
      transform: (v: string | number) => this.currencyFormat.format(Number(v ?? 0)),
    },
    {
      key: 'balance',
      label: 'Saldo',
      align: 'right',
      priority: 1,
      transform: (v: string | number) => this.currencyFormat.format(Number(v ?? 0)),
    },
  ];

  readonly trialCard: ItemListCardConfig = {
    titleKey: 'account_name',
    subtitleKey: 'account_code',
    avatarFallbackIcon: 'book',
    detailKeys: [
      { key: 'total_debit', label: 'Débito' },
      { key: 'total_credit', label: 'Crédito' },
    ],
  };
  readonly groupCard: ItemListCardConfig = {
    titleKey: 'account_name',
    subtitleKey: 'account_code',
    avatarFallbackIcon: 'building',
    detailKeys: [{ key: 'balance', label: 'Saldo' }],
  };
  readonly ledgerCard: ItemListCardConfig = {
    titleKey: 'description',
    subtitleKey: 'entry_number',
    avatarFallbackIcon: 'file-text',
    detailKeys: [
      { key: 'entry_date', label: 'Fecha' },
      { key: 'debit_amount', label: 'Débito' },
      { key: 'credit_amount', label: 'Crédito' },
    ],
  };

  constructor() {
    this.reload();
  }

  // ─── Tab / filter handlers ─────────────────────────────────────────────
  onTabChange(id: string): void {
    this.activeTab.set(id as ReportTab);
    this.reload();
  }

  onGroupingChange(value: 'detail' | 'summary'): void {
    this.grouping.set(value);
    // V2: collapse detail rows; for V1 the table is the same.
  }

  onLedgerAccountChange(value: string): void {
    this.ledgerAccountCode.set(value);
    this.loadLedger();
  }

  // ─── Loaders ────────────────────────────────────────────────────────────
  private reload(): void {
    switch (this.activeTab()) {
      case 'trial':
        this.loadTrial();
        break;
      case 'balance':
        this.loadBalance();
        break;
      case 'income':
        this.loadIncome();
        break;
      case 'ledger':
        // Ledger waits for an account selection; pre-warm trial rows so the
        // account selector has data.
        this.loadTrial();
        break;
    }
  }

  private loadTrial(): void {
    const { from, to } = this.range.getRawValue();
    this.loading.set(true);
    this.api
      .getTrialBalance({ from, to })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (rows) => {
          this.trialRows.set(rows);
          this.loading.set(false);
        },
        error: (err) => {
          this.loading.set(false);
          this.toast.error(
            err?.error?.message ?? 'Error al generar el balance de prueba.',
          );
        },
      });
  }

  private loadBalance(): void {
    this.loading.set(true);
    this.api
      .getBalanceSheet(this.asOfControl.value || getDefaultEndDate())
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (bs) => {
          this.balanceSheet.set(bs);
          this.loading.set(false);
        },
        error: (err) => {
          this.loading.set(false);
          this.toast.error(
            err?.error?.message ?? 'Error al generar el balance general.',
          );
        },
      });
  }

  private loadIncome(): void {
    const { from, to } = this.range.getRawValue();
    this.loading.set(true);
    this.api
      .getIncomeStatement({ from, to })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (is) => {
          this.incomeStatement.set(is);
          this.loading.set(false);
        },
        error: (err) => {
          this.loading.set(false);
          this.toast.error(
            err?.error?.message ?? 'Error al generar el estado de resultados.',
          );
        },
      });
  }

  private loadLedger(): void {
    const code = this.ledgerAccountCode();
    if (!code) {
      this.ledgerRows.set([]);
      return;
    }
    const { from, to } = this.range.getRawValue();
    this.loading.set(true);
    this.api
      .getGeneralLedger({ account_code: code, from, to })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (rows) => {
          this.ledgerRows.set(rows);
          this.loading.set(false);
        },
        error: (err) => {
          this.loading.set(false);
          this.toast.error(
            err?.error?.message ?? 'Error al generar el libro mayor.',
          );
        },
      });
  }

  toNumber(v: string | number | null | undefined): number {
    const n = Number(v ?? 0);
    return Number.isFinite(n) ? n : 0;
  }
}
