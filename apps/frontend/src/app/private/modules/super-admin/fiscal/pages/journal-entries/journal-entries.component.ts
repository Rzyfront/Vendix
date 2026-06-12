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
  InputComponent,
  InputsearchComponent,
  ItemListCardConfig,
  ModalComponent,
  PaginationComponent,
  ResponsiveDataViewComponent,
  SelectorComponent,
  SelectorOption,
  SpinnerComponent,
  StickyHeaderActionButton,
  StickyHeaderComponent,
  TableAction,
  TableColumn,
  ToastService,
  SortDirection,
} from '../../../../../../shared/components';
import { CurrencyFormatService, CurrencyPipe } from '../../../../../../shared/pipes/currency/currency.pipe';
import { getDefaultEndDate, getDefaultStartDate, toLocalDateString } from '../../../../../../shared/utils/date.util';
import {
  CreateManualJournalEntryDto,
  CreateManualJournalEntryLineDto,
  FiscalPeriod,
  JournalEntry,
  JournalEntrySourceType,
} from '../../interfaces/superadmin-fiscal.interface';
import { SuperadminFiscalService } from '../../services/superadmin-fiscal.service';

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
    StickyHeaderComponent,
    ButtonComponent,
    CardComponent,
    EmptyStateComponent,
    InputComponent,
    InputsearchComponent,
    ModalComponent,
    PaginationComponent,
    ResponsiveDataViewComponent,
    SelectorComponent,
    SpinnerComponent,
  ],
  template: `
    <div class="w-full">
      <app-sticky-header
        title="Asientos Contables"
        subtitle="Libro diario de la plataforma"
        icon="book"
        [actions]="headerActions()"
        (actionClicked)="onHeaderAction($event)"
      />

      <div class="px-2 md:px-4 pt-2 pb-4 space-y-4">
        <!-- Filters card -->
        <app-card [responsive]="true" [padding]="false" customClasses="!p-0">
          <div class="px-2 py-2 md:px-4 md:py-3 border-b border-border">
            <div class="grid grid-cols-1 md:grid-cols-12 gap-3">
              <div class="md:col-span-3">
                <app-inputsearch
                  size="sm"
                  placeholder="Buscar por descripción o número…"
                  [debounceTime]="400"
                  (searchChange)="onSearch($event)"
                />
              </div>
              <div class="md:col-span-3">
                <app-selector
                  size="sm"
                  variant="outline"
                  label="Origen"
                  [options]="sourceTypeOptions"
                  [ngModel]="sourceTypeFilter()"
                  (ngModelChange)="onSourceTypeChange($any($event))"
                />
              </div>
              <div class="md:col-span-3">
                <app-selector
                  size="sm"
                  variant="outline"
                  label="Periodo fiscal"
                  [options]="periodFilterOptions()"
                  [ngModel]="periodFilter()"
                  (ngModelChange)="onPeriodFilterChange($any($event))"
                />
              </div>
              <div class="md:col-span-3">
                <div class="grid grid-cols-2 gap-2">
                  <app-input
                    label="Desde"
                    type="date"
                    size="sm"
                    [control]="dateRange.controls.from"
                  />
                  <app-input
                    label="Hasta"
                    type="date"
                    size="sm"
                    [control]="dateRange.controls.to"
                  />
                </div>
              </div>
            </div>
          </div>

          @if (loading()) {
            <div class="p-4 md:p-6 text-center">
              <app-spinner size="md" label="Cargando asientos…"></app-spinner>
            </div>
          }

          @if (!loading() && entries().length === 0) {
            <app-empty-state
              icon="file-text"
              title="Sin asientos"
              description="No se encontraron asientos contables con los filtros actuales."
              [showActionButton]="false"
            ></app-empty-state>
          }

          @if (!loading() && entries().length > 0) {
            <div class="px-2 pb-2 pt-2 md:p-4">
              <app-responsive-data-view
                [data]="entries()"
                [columns]="columns"
                [cardConfig]="cardConfig"
                [actions]="actions"
                [loading]="loading()"
                [sortable]="true"
                (sort)="onSort($event)"
                (rowClick)="onRowClick($any($event))"
              />
              @if (pagination().totalPages > 1) {
                <div class="mt-4 flex justify-center">
                  <app-pagination
                    [currentPage]="pagination().page"
                    [totalPages]="pagination().totalPages"
                    [total]="pagination().total"
                    [limit]="pagination().limit"
                    infoStyle="range"
                    (pageChange)="onPageChange($any($event))"
                  />
                </div>
              }
            </div>
          }
        </app-card>
      </div>
    </div>

    <!-- Manual entry modal -->
    <app-modal
      [isOpen]="modalOpen()"
      title="Asiento manual"
      subtitle="Crea un asiento contable con dos o más líneas balanceadas (DR = CR)"
      size="xl-mid"
      (closed)="closeModal()"
    >
      <form
        [formGroup]="form"
        (ngSubmit)="onSubmit()"
        class="space-y-4"
        autocomplete="off"
      >
        <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
          <app-input
            label="Fecha"
            type="date"
            [required]="true"
            [control]="form.controls.entry_date"
          />
          <div class="md:col-span-2">
            <app-selector
              label="Periodo fiscal"
              [required]="true"
              [options]="periodOptions()"
              [ngModel]="form.controls.fiscal_period_id.value"
              (ngModelChange)="form.controls.fiscal_period_id.setValue($any($event))"
            />
          </div>
        </div>

        <app-input
          label="Descripción"
          placeholder="Concepto del asiento"
          [required]="true"
          [control]="form.controls.description"
        />

        <div>
          <div class="flex items-center justify-between mb-2">
            <h4 class="text-sm font-semibold text-text-primary">Líneas</h4>
            <app-button
              variant="outline"
              size="sm"
              label="+ Añadir línea"
              (clicked)="addLine()"
            />
          </div>

          <div formArrayName="lines" class="space-y-2">
            @for (line of linesArray.controls; track $index; let i = $index) {
              <div
                [formGroupName]="i"
                class="grid grid-cols-12 gap-2 items-end p-2 rounded-lg border border-border bg-background"
              >
                <div class="col-span-12 md:col-span-3">
                  <app-input
                    label="Cuenta"
                    placeholder="Ej. 110505"
                    [required]="true"
                    [control]="line.controls.account_code"
                  />
                </div>
                <div class="col-span-12 md:col-span-4">
                  <app-input
                    label="Descripción"
                    [control]="line.controls.description"
                  />
                </div>
                <div class="col-span-6 md:col-span-2">
                  <app-input
                    label="Débito"
                    type="number"
                    [control]="line.controls.debit_amount"
                  />
                </div>
                <div class="col-span-6 md:col-span-2">
                  <app-input
                    label="Crédito"
                    type="number"
                    [control]="line.controls.credit_amount"
                  />
                </div>
                <div class="col-span-12 md:col-span-1 flex justify-end">
                  @if (linesArray.length > 2) {
                    <app-button
                      variant="ghost"
                      size="sm"
                      label="Quitar"
                      (clicked)="removeLine(i)"
                    />
                  }
                </div>
              </div>
            }
          </div>
        </div>

        <!-- Live balance indicator -->
        <div
          class="flex items-center justify-between rounded-lg border p-3"
          [class.border-border]="balanced()"
          [class.bg-surface]="balanced()"
          [class.border-red-300]="!balanced()"
          [class.bg-red-50]="!balanced()"
        >
          <div class="text-sm">
            <span class="text-text-secondary">DR </span>
            <span class="font-mono font-semibold">{{ totalDebit() | currency }}</span>
            <span class="text-text-secondary"> / CR </span>
            <span class="font-mono font-semibold">{{ totalCredit() | currency }}</span>
          </div>
          <div class="text-sm font-semibold" [class.text-emerald-600]="balanced()" [class.text-red-600]="!balanced()">
            @if (balanced()) {
              Balanceado
            } @else {
              Diferencia: {{ balanceDelta() | currency }}
            }
          </div>
        </div>
      </form>

      <div slot="footer" class="flex items-center justify-end gap-2">
        <app-button
          variant="outline"
          size="md"
          label="Cancelar"
          (clicked)="closeModal()"
        />
        <app-button
          variant="primary"
          size="md"
          label="Crear asiento"
          [loading]="saving()"
          [disabled]="submitDisabled()"
          (clicked)="onSubmit()"
        />
      </div>
    </app-modal>
  `,
})
export class JournalEntriesComponent {
  private readonly api = inject(SuperadminFiscalService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly fb = inject(FormBuilder);
  private readonly toast = inject(ToastService);
  private readonly currencyFormat = inject(CurrencyFormatService);

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

  // ─── Header actions ─────────────────────────────────────────────────────
  readonly headerActions = computed<StickyHeaderActionButton[]>(() => [
    {
      id: 'new-entry',
      label: 'Asiento Manual',
      variant: 'primary',
      icon: 'plus',
    },
  ]);

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
      transform: (v: string) => v, // template uses DatePipe
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
  onHeaderAction(actionId: string): void {
    if (actionId === 'new-entry') this.openModal();
  }
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
          this.toast.error(
            err?.error?.message ?? 'No se pudo crear el asiento.',
          );
        },
      });
  }

  // ─── Helpers ────────────────────────────────────────────────────────────
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
