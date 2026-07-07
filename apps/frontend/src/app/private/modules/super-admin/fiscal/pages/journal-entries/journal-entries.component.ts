import {
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import {
  FormArray,
  FormBuilder,
  FormControl,
  FormGroup,
  FormsModule,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { startWith } from 'rxjs/operators';

import {
  ButtonComponent,
  CardComponent,
  EmptyStateComponent,
  IconComponent,
  InputComponent,
  InputsearchComponent,
  ItemListCardConfig,
  ModalComponent,
  PaginationComponent,
  ResponsiveDataViewComponent,
  SaveRequirementsModalComponent,
  SelectorComponent,
  SelectorOption,
  SortDirection,
  SpinnerComponent,
  StatsComponent,
  TableAction,
  TableColumn,
  ToastService,
} from '../../../../../../shared/components';
import {
  CurrencyFormatService,
  CurrencyPipe,
} from '../../../../../../shared/pipes/currency/currency.pipe';
import {
  getDefaultEndDate,
  getDefaultStartDate,
  toLocalDateString,
} from '../../../../../../shared/utils/date.util';
import {
  CreateManualJournalEntryDto,
  CreateManualJournalEntryLineDto,
  FiscalPeriod,
  JournalEntry,
  JournalEntrySourceType,
} from '../../interfaces/superadmin-fiscal.interface';
import { SuperadminFiscalService } from '../../services/superadmin-fiscal.service';
import { FiscalRequirementsService } from '../../../../../../shared/services/fiscal-requirements.service';

interface JournalLineForm {
  account_code: FormControl<string>;
  description: FormControl<string>;
  debit_amount: FormControl<number>;
  credit_amount: FormControl<number>;
}

interface ManualEntryForm {
  entry_date: FormControl<string>;
  fiscal_period_id: FormControl<string>;
  description: FormControl<string>;
  lines: FormArray<FormGroup<JournalLineForm>>;
}

interface JournalEntriesStats {
  total: number;
  totalDebit: number;
  totalCredit: number;
  manualCount: number;
}

const SOURCE_TYPE_OPTIONS: SelectorOption[] = [
  { value: 'all', label: 'Todos los orígenes' },
  { value: 'saas_revenue', label: 'SaaS — Revenue' },
  { value: 'saas_refund', label: 'SaaS — Refund' },
  { value: 'saas_bad_debt', label: 'SaaS — Bad debt' },
  { value: 'saas_partner_payout', label: 'SaaS — Partner payout' },
  { value: 'manual_journal_entry', label: 'Manual' },
];

@Component({
  selector: 'app-journal-entries',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    FormsModule,
    CurrencyPipe,
    ButtonComponent,
    CardComponent,
    EmptyStateComponent,
    IconComponent,
    InputComponent,
    InputsearchComponent,
    ModalComponent,
    PaginationComponent,
    ResponsiveDataViewComponent,
    SaveRequirementsModalComponent,
    SelectorComponent,
    SpinnerComponent,
    StatsComponent,
  ],
  templateUrl: './journal-entries.component.html',
})
export class JournalEntriesComponent {
  private readonly api = inject(SuperadminFiscalService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly fb = inject(FormBuilder);
  private readonly toast = inject(ToastService);
  private readonly currencyFormat = inject(CurrencyFormatService);
  readonly fiscalReq = inject(FiscalRequirementsService);

  // ─── List state ─────────────────────────────────────────────────────────
  readonly entries = signal<JournalEntry[]>([]);
  readonly loading = signal<boolean>(false);
  readonly saving = signal<boolean>(false);
  readonly searchTerm = signal<string>('');
  readonly sourceTypeFilter = signal<JournalEntrySourceType | 'all'>('all');
  readonly periodFilter = signal<string>('all');
  readonly periods = signal<FiscalPeriod[]>([]);
  readonly modalOpen = signal<boolean>(false);

  readonly pagination = signal({
    page: 1,
    limit: 20,
    total: 0,
    totalPages: 0,
  });

  // Stats derived from the current page slice (lightweight; the dashboard
  // KPI module already covers full-range aggregations).
  readonly stats = computed<JournalEntriesStats>(() => {
    const rows = this.entries();
    let totalDebit = 0;
    let totalCredit = 0;
    let manualCount = 0;
    for (const e of rows) {
      totalDebit += Number(e.total_debit ?? 0) || 0;
      totalCredit += Number(e.total_credit ?? 0) || 0;
      if (e.source_type === 'manual_journal_entry') manualCount += 1;
    }
    return {
      total: this.pagination().total,
      totalDebit,
      totalCredit,
      manualCount,
    };
  });

  // date range is a tiny ReactiveForm for two inputs
  readonly dateRange = this.fb.group({
    from: this.fb.nonNullable.control(getDefaultStartDate()),
    to: this.fb.nonNullable.control(getDefaultEndDate()),
  });

  readonly sourceTypeOptions: SelectorOption[] = SOURCE_TYPE_OPTIONS;
  readonly periodFilterOptions = computed<SelectorOption[]>(() => {
    const opts: SelectorOption[] = [{ value: 'all', label: 'Todos los periodos' }];
    for (const p of this.periods()) {
      opts.push({ value: p.id, label: p.name });
    }
    return opts;
  });
  readonly periodOptions = computed<SelectorOption[]>(() =>
    this.periods().map((p) => ({ value: p.id, label: p.name })),
  );

  // ─── Table config ───────────────────────────────────────────────────────
  readonly columns: TableColumn[] = [
    {
      key: 'entry_number',
      label: 'Número',
      sortable: true,
      width: '160px',
      priority: 1,
    },
    {
      key: 'entry_date',
      label: 'Fecha',
      sortable: true,
      width: '110px',
      priority: 1,
      transform: (v: string) => v,
    },
    {
      key: 'description',
      label: 'Descripción',
      sortable: true,
      priority: 1,
    },
    {
      key: 'source_type',
      label: 'Origen',
      sortable: true,
      width: '180px',
      priority: 2,
      transform: (v: string) => v ?? '—',
    },
    {
      key: 'total_debit',
      label: 'Débito',
      width: '120px',
      align: 'right',
      priority: 2,
      transform: (v: string | number) => this.currencyFormat.format(Number(v ?? 0)),
    },
    {
      key: 'total_credit',
      label: 'Crédito',
      width: '120px',
      align: 'right',
      priority: 2,
      transform: (v: string | number) => this.currencyFormat.format(Number(v ?? 0)),
    },
    {
      key: 'lines_count',
      label: 'Líneas',
      width: '80px',
      align: 'center',
      priority: 3,
    },
  ];

  readonly actions: TableAction[] = [
    {
      label: 'Ver detalle',
      icon: 'eye',
      variant: 'info',
      action: (item: JournalEntry) => this.onRowClick(item),
    },
  ];

  readonly cardConfig: ItemListCardConfig = {
    titleKey: 'entry_number',
    subtitleKey: 'description',
    avatarFallbackIcon: 'file-text',
    avatarShape: 'square',
    detailKeys: [
      { key: 'source_type', label: 'Origen' },
      { key: 'lines_count', label: 'Líneas' },
    ],
  };

  // ─── Manual entry form ──────────────────────────────────────────────────
  readonly form: FormGroup<ManualEntryForm> = this.fb.group<ManualEntryForm>({
    entry_date: this.fb.nonNullable.control(toLocalDateString(), {
      validators: [Validators.required],
    }),
    fiscal_period_id: this.fb.nonNullable.control('', {
      validators: [Validators.required],
    }),
    description: this.fb.nonNullable.control('', {
      validators: [Validators.required, Validators.minLength(3)],
    }),
    lines: this.fb.array<FormGroup<JournalLineForm>>(
      [this.makeLine(), this.makeLine()],
      [Validators.required, Validators.minLength(2)],
    ),
  });

  get linesArray(): FormArray<FormGroup<JournalLineForm>> {
    return this.form.controls.lines;
  }

  // Bridge form.value + form.status to signals (zoneless-safe).
  private readonly formValue = toSignal(
    this.form.valueChanges.pipe(startWith(this.form.getRawValue())),
    { initialValue: this.form.getRawValue() },
  );
  private readonly formStatus = toSignal(
    this.form.statusChanges.pipe(startWith(this.form.status)),
    { initialValue: this.form.status },
  );

  readonly totalDebit = computed(() => {
    const lines = this.formValue()?.lines ?? [];
    return lines.reduce(
      (acc: number, l: any) => acc + Number(l?.debit_amount ?? 0) || 0,
      0,
    );
  });
  readonly totalCredit = computed(() => {
    const lines = this.formValue()?.lines ?? [];
    return lines.reduce(
      (acc: number, l: any) => acc + Number(l?.credit_amount ?? 0) || 0,
      0,
    );
  });
  readonly balanceDelta = computed(
    () => Math.abs(this.totalDebit() - this.totalCredit()),
  );
  readonly balanced = computed(() => this.balanceDelta() < 0.001);
  readonly submitDisabled = computed(
    () =>
      this.saving() ||
      this.formStatus() !== 'VALID' ||
      !this.balanced() ||
      this.linesArray.length < 2,
  );

  constructor() {
    this.loadPeriods();
    this.loadEntries();

    // React to date range changes
    this.dateRange.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this.pagination.update((p) => ({ ...p, page: 1 }));
        this.loadEntries();
      });
  }

  // ─── Loaders ────────────────────────────────────────────────────────────
  private loadPeriods(): void {
    this.api
      .getFiscalPeriods()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (periods) => {
          this.periods.set(periods);
          // Pre-select the first open period
          const open = periods.find((p) => p.state === 'open');
          if (open && !this.form.controls.fiscal_period_id.value) {
            this.form.controls.fiscal_period_id.setValue(open.id);
          }
        },
        error: () => {
          this.toast.error('No se pudieron cargar los periodos fiscales.');
        },
      });
  }

  private loadEntries(): void {
    this.loading.set(true);
    const pag = this.pagination();
    const range = this.dateRange.getRawValue();
    this.api
      .getJournalEntries({
        page: pag.page,
        limit: pag.limit,
        from: range.from,
        to: range.to,
        source_type: this.sourceTypeFilter(),
        fiscal_period_id:
          this.periodFilter() !== 'all' ? this.periodFilter() : undefined,
        search: this.searchTerm() || undefined,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.entries.set(res.data ?? []);
          this.pagination.update((p) => ({
            ...p,
            total: res.meta?.total ?? 0,
            totalPages: res.meta?.totalPages ?? 0,
          }));
          this.loading.set(false);
        },
        error: (err) => {
          this.toast.error(
            err?.error?.message ?? 'Error al cargar los asientos.',
          );
          this.loading.set(false);
        },
      });
  }

  // ─── Handlers ───────────────────────────────────────────────────────────
  onSearch(term: string): void {
    this.searchTerm.set(term);
    this.pagination.update((p) => ({ ...p, page: 1 }));
    this.loadEntries();
  }
  onSourceTypeChange(value: JournalEntrySourceType | 'all'): void {
    this.sourceTypeFilter.set(value);
    this.pagination.update((p) => ({ ...p, page: 1 }));
    this.loadEntries();
  }
  onPeriodFilterChange(value: string): void {
    this.periodFilter.set(value);
    this.pagination.update((p) => ({ ...p, page: 1 }));
    this.loadEntries();
  }
  onPageChange(page: number): void {
    this.pagination.update((p) => ({ ...p, page }));
    this.loadEntries();
  }
  onSort(_event: { column: string; direction: SortDirection }): void {
    // V2: backend sort.
  }
  onRowClick(item: JournalEntry): void {
    this.toast.info(`Asiento ${item.entry_number} — ver detalle (V2)`);
  }

  // ─── Modal ──────────────────────────────────────────────────────────────
  openModal(): void {
    const open = this.periods().find((p) => p.state === 'open');
    this.form.reset({
      entry_date: toLocalDateString(),
      fiscal_period_id: open?.id ?? '',
      description: '',
    });
    // Rebuild the lines array with two empty lines
    this.linesArray.clear();
    this.addLine();
    this.addLine();
    this.modalOpen.set(true);
  }

  closeModal(): void {
    this.modalOpen.set(false);
  }

  addLine(): void {
    this.linesArray.push(this.makeLine());
  }

  removeLine(index: number): void {
    if (this.linesArray.length <= 2) return;
    this.linesArray.removeAt(index);
  }

  onSubmit(): void {
    if (this.submitDisabled()) return;
    const v = this.form.getRawValue();
    const lines: CreateManualJournalEntryLineDto[] = v.lines.map((l) => ({
      account_code: l.account_code.trim(),
      description: l.description?.trim() || undefined,
      debit_amount: Number(l.debit_amount ?? 0),
      credit_amount: Number(l.credit_amount ?? 0),
    }));
    const dto: CreateManualJournalEntryDto = {
      entry_date: v.entry_date,
      fiscal_period_id: v.fiscal_period_id,
      description: v.description.trim(),
      lines,
    };
    this.saving.set(true);
    this.api
      .createManualJournalEntry(dto)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (created) => {
          this.saving.set(false);
          if (created) {
            this.toast.success(`Asiento ${created.entry_number} creado.`);
            this.closeModal();
            this.pagination.update((p) => ({ ...p, page: 1 }));
            this.loadEntries();
          }
        },
        error: (err) => {
          this.saving.set(false);
          // Restriccion fiscal (p. ej. periodo cerrado): mostrar el modal de
          // requisitos con su CTA en lugar del toast crudo.
          if (this.fiscalReq.presentFiscalError(err)) {
            return;
          }
          this.toast.error(
            err?.error?.message ?? 'No se pudo crear el asiento.',
          );
        },
      });
  }

  // ─── Helpers ────────────────────────────────────────────────────────────
  formatMoney(value: number): string {
    return this.currencyFormat.format(value);
  }

  private makeLine(): FormGroup<JournalLineForm> {
    return this.fb.group<JournalLineForm>({
      account_code: this.fb.nonNullable.control('', {
        validators: [Validators.required, Validators.minLength(2)],
      }),
      description: this.fb.nonNullable.control(''),
      debit_amount: this.fb.nonNullable.control(0, {
        validators: [Validators.min(0)],
      }),
      credit_amount: this.fb.nonNullable.control(0, {
        validators: [Validators.min(0)],
      }),
    });
  }
}
