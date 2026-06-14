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
  StatsComponent,
  TableColumn,
  ToastService,
} from '../../../../../../shared/components';
import {
  CurrencyFormatService,
  CurrencyPipe,
} from '../../../../../../shared/pipes/currency/currency.pipe';
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

interface StatCardConfig {
  title: string;
  value: string | number;
  smallText: string;
  icon: string;
  bg: string;
  color: string;
}

interface StatsConfig {
  card1: StatCardConfig;
  card2: StatCardConfig;
  card3: StatCardConfig;
  card4: StatCardConfig;
}

@Component({
  selector: 'app-fiscal-reports',
  standalone: true,
  imports: [
    FormsModule,
    CurrencyPipe,
    CardComponent,
    EmptyStateComponent,
    InputComponent,
    ResponsiveDataViewComponent,
    ScrollableTabsComponent,
    SelectorComponent,
    SpinnerComponent,
    StatsComponent,
  ],
  templateUrl: './reports.component.html',
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
    return this.trialRows().map((r) => ({
      value: r.account_code,
      label: `${r.account_code} — ${r.account_name}`,
    }));
  });

  // ─── Title per active report ───────────────────────────────────────────
  readonly reportTitle = computed<string>(() => {
    switch (this.activeTab()) {
      case 'trial':
        return 'Balance de Prueba';
      case 'balance':
        return 'Balance General';
      case 'income':
        return 'Estado de Resultados';
      case 'ledger':
        return 'Libro Mayor';
      default:
        return 'Reportes';
    }
  });

  // ─── Stats per active report ───────────────────────────────────────────
  readonly statsConfig = computed<StatsConfig>(() => {
    const tab = this.activeTab();
    if (tab === 'trial') {
      const rows = this.trialRows();
      return {
        card1: {
          title: 'Cuentas',
          value: rows.length,
          smallText: 'Con movimientos en el rango',
          icon: 'book',
          bg: 'bg-blue-100',
          color: 'text-blue-600',
        },
        card2: {
          title: 'Σ Débito',
          value: this.currencyFormat.format(this.trialTotalDebit()),
          smallText: 'Total débito del rango',
          icon: 'arrow-down-circle',
          bg: 'bg-emerald-100',
          color: 'text-emerald-600',
        },
        card3: {
          title: 'Σ Crédito',
          value: this.currencyFormat.format(this.trialTotalCredit()),
          smallText: 'Total crédito del rango',
          icon: 'arrow-up-circle',
          bg: 'bg-amber-100',
          color: 'text-amber-600',
        },
        card4: {
          title: 'Diferencia',
          value: this.currencyFormat.format(
            Math.abs(this.trialTotalDebit() - this.trialTotalCredit()),
          ),
          smallText: 'DR − CR',
          icon: 'scale',
          bg: 'bg-purple-100',
          color: 'text-purple-600',
        },
      };
    }
    if (tab === 'balance') {
      const bs = this.balanceSheet();
      const assets = this.toNumber(bs?.total_assets);
      const liabEq = this.toNumber(bs?.total_liabilities_equity);
      return {
        card1: {
          title: 'Activos',
          value: this.currencyFormat.format(assets),
          smallText: 'Total activos',
          icon: 'wallet',
          bg: 'bg-blue-100',
          color: 'text-blue-600',
        },
        card2: {
          title: 'Pasivos',
          value: this.currencyFormat.format(this.toNumber(bs?.liabilities?.total)),
          smallText: 'Obligaciones',
          icon: 'credit-card',
          bg: 'bg-amber-100',
          color: 'text-amber-600',
        },
        card3: {
          title: 'Patrimonio',
          value: this.currencyFormat.format(this.toNumber(bs?.equity?.total)),
          smallText: 'Capital + utilidades',
          icon: 'building',
          bg: 'bg-emerald-100',
          color: 'text-emerald-600',
        },
        card4: {
          title: 'Diferencia',
          value: this.currencyFormat.format(Math.abs(assets - liabEq)),
          smallText: 'A − (P + Patrim.)',
          icon: 'scale',
          bg: 'bg-purple-100',
          color: 'text-purple-600',
        },
      };
    }
    if (tab === 'income') {
      const is = this.incomeStatement();
      return {
        card1: {
          title: 'Ingresos',
          value: this.currencyFormat.format(this.toNumber(is?.total_revenue)),
          smallText: 'Total ingresos',
          icon: 'trending-up',
          bg: 'bg-emerald-100',
          color: 'text-emerald-600',
        },
        card2: {
          title: 'Costos',
          value: this.currencyFormat.format(this.toNumber(is?.total_cost)),
          smallText: 'Costo de ventas',
          icon: 'package',
          bg: 'bg-amber-100',
          color: 'text-amber-600',
        },
        card3: {
          title: 'Gastos',
          value: this.currencyFormat.format(this.toNumber(is?.total_expenses)),
          smallText: 'Gastos operativos',
          icon: 'trending-down',
          bg: 'bg-red-100',
          color: 'text-red-600',
        },
        card4: {
          title: 'Resultado',
          value: this.currencyFormat.format(this.toNumber(is?.net_income)),
          smallText: 'Utilidad neta',
          icon: 'dollar-sign',
          bg: 'bg-purple-100',
          color: 'text-purple-600',
        },
      };
    }
    // ledger
    const rows = this.ledgerRows();
    const totalDebit = rows.reduce(
      (acc, r) => acc + Number(r.debit_amount ?? 0) || 0,
      0,
    );
    const totalCredit = rows.reduce(
      (acc, r) => acc + Number(r.credit_amount ?? 0) || 0,
      0,
    );
    const lastBalance = rows.length
      ? this.toNumber(rows[rows.length - 1].balance)
      : 0;
    return {
      card1: {
        title: 'Movimientos',
        value: rows.length,
        smallText: 'En la cuenta seleccionada',
        icon: 'list',
        bg: 'bg-blue-100',
        color: 'text-blue-600',
      },
      card2: {
        title: 'Σ Débito',
        value: this.currencyFormat.format(totalDebit),
        smallText: 'Total débito',
        icon: 'arrow-down-circle',
        bg: 'bg-emerald-100',
        color: 'text-emerald-600',
      },
      card3: {
        title: 'Σ Crédito',
        value: this.currencyFormat.format(totalCredit),
        smallText: 'Total crédito',
        icon: 'arrow-up-circle',
        bg: 'bg-amber-100',
        color: 'text-amber-600',
      },
      card4: {
        title: 'Saldo',
        value: this.currencyFormat.format(lastBalance),
        smallText: 'Final del periodo',
        icon: 'scale',
        bg: 'bg-purple-100',
        color: 'text-purple-600',
      },
    };
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
    // React to date range changes (trial / income / ledger)
    this.range.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.reload());

    // React to "as of" changes (balance sheet)
    this.asOfControl.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        if (this.activeTab() === 'balance') this.loadBalance();
      });

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
        this.loadLedger();
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
