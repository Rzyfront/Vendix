import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, model, output, signal, untracked } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Subscription, finalize, map, startWith } from 'rxjs';
import { ModalComponent } from '../../../../../shared/components/modal/modal.component';
import { AuthFacade } from '../../../../../core/store/auth/auth.facade';
import { StoreSettingsFacade } from '../../../../../core/store/store-settings/store-settings.facade';
import { CurrencyFormatService } from '../../../../../shared/pipes/currency';
import { formatStoreDateTime } from '../../../../../shared/utils/date.util';
import { describeApiFailure } from '../utils/invoicing-errors.util';
import type {
  ConfirmReceivedDocumentMatchInput,
  ReceivedDocument,
  ReceivedDocumentMatchExpense,
  ReceivedDocumentMatchLineBalance,
  ReceivedDocumentMatchExpensesResponse,
  ReceivedDocumentsScope,
} from './received-documents.interface';
import { ReceivedDocumentsService } from './received-documents.service';

type ExpenseMatchForm = FormGroup<{
  source_quantity: FormControl<string>;
  target_quantity: FormControl<string>;
  allocated_net_amount: FormControl<string>;
  target_unit_code: FormControl<string>;
  manual_reason: FormControl<string>;
}>;

const PAGE_SIZE = 20;
const MAX_PAGE = 1000;
const POSITIVE_QUANTITY = /^(?=.*[1-9])(?:0|[1-9]\d{0,10})(?:\.\d{1,4})?$/;
const NON_NEGATIVE_MONEY = /^(?:0|[1-9]\d{0,12})(?:\.\d{1,2})?$/;

@Component({
  selector: 'app-received-document-match-expense-confirm',
  standalone: true,
  imports: [ModalComponent, ReactiveFormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './received-document-match-expense-confirm.component.html',
  styles: [`.field{display:flex;flex-direction:column;gap:.375rem;color:var(--color-text-primary);font-size:.875rem;font-weight:500}.field input,.field select,.field textarea{min-height:2.75rem;width:100%;border:1px solid var(--color-border);border-radius:.5rem;background:var(--color-background);padding:.5rem .75rem;color:var(--color-text-primary);font-size:.875rem;font-weight:400}.field input:focus,.field select:focus,.field textarea:focus{outline:2px solid var(--color-primary);outline-offset:1px}`],
})
export class ReceivedDocumentMatchExpenseConfirmComponent {
  private readonly fb = inject(FormBuilder);
  private readonly destroyRef = inject(DestroyRef);
  private readonly auth = inject(AuthFacade);
  private readonly storeSettings = inject(StoreSettingsFacade);
  private readonly currency = inject(CurrencyFormatService);
  private readonly api = inject(ReceivedDocumentsService);

  readonly document = input.required<ReceivedDocument>();
  readonly scope = input.required<ReceivedDocumentsScope>();
  readonly storeId = input<number | null>(null);
  readonly lineBalances = input.required<ReceivedDocumentMatchLineBalance[]>();
  readonly documentVersion = input<number | null>(null);
  readonly allocationsLoaded = input(false);
  readonly isOpen = model(false);
  readonly changed = output<void>();
  readonly reloadRequested = output<void>();

  readonly form: ExpenseMatchForm = this.createForm();
  readonly formStatus = toSignal(this.form.statusChanges.pipe(startWith(this.form.status)), { initialValue: this.form.status });
  readonly formValues = toSignal(this.form.valueChanges.pipe(map(() => this.form.getRawValue()), startWith(this.form.getRawValue())), { initialValue: this.form.getRawValue() });
  readonly searchControl = new FormControl('', { nonNullable: true, validators: [Validators.maxLength(100)] });
  readonly searchStatus = toSignal(this.searchControl.statusChanges.pipe(startWith(this.searchControl.status)), { initialValue: this.searchControl.status });
  readonly searchAttempted = signal(false);
  readonly searchLoading = signal(false);
  readonly searchError = signal<string | null>(null);
  readonly warnings = signal<string[]>([]);
  readonly expenses = signal<ReceivedDocumentMatchExpense[]>([]);
  readonly total = signal(0);
  readonly page = signal(1);
  readonly selectedExpenseId = signal<number | null>(null);
  readonly selectedExpenseItemId = signal<number | null>(null);
  readonly selectedDocumentItemId = signal<number | null>(null);
  readonly confirmationOpen = signal(false);
  readonly submitAttempted = signal(false);
  readonly pending = signal(false);
  readonly conflict = signal(false);
  readonly mutationError = signal<string | null>(null);
  readonly idempotencyKey = signal(crypto.randomUUID());
  readonly permission = computed(() => this.auth.hasPermission(`${this.scope() === 'store' ? 'invoicing' : 'organization:invoicing'}:received:match:confirm`));
  readonly eligible = computed(() => {
    const doc = this.document();
    const terminal = ['recognized', 'accepted', 'posted'].includes(doc.fiscal_status)
      || ['recognized', 'accepted', 'posted'].includes(doc.posting_status)
      || !!doc.accepted_at;
    return doc.processing_status === 'ready' && doc.validation_status === 'valid' && !terminal;
  });
  readonly sourceLines = computed(() => (this.document().items ?? []).filter((item) => item.id != null));
  readonly selectedExpense = computed(() => this.expenses().find((expense) => expense.id === this.selectedExpenseId()) ?? null);
  readonly selectedExpenseItem = computed(() => this.selectedExpense()?.items.find((item) => item.id === this.selectedExpenseItemId()) ?? null);
  readonly selectedSourceLine = computed(() => this.sourceLines().find((item) => item.id === this.selectedDocumentItemId()) ?? null);
  readonly selectedSourceBalance = computed(() => this.lineBalances().find((balance) => balance.document_item_id === this.selectedDocumentItemId()) ?? null);
  readonly targetRemainingAmount = computed(() => this.selectedExpenseItem()?.remaining_net_amount ?? this.selectedExpense()?.remaining_net_amount ?? null);
  readonly amountBoundsValid = computed(() => {
    const values = this.formValues();
    const source = this.selectedSourceBalance();
    const targetRemaining = this.targetRemainingAmount();
    if (!source || targetRemaining == null || !NON_NEGATIVE_MONEY.test(values.allocated_net_amount)) return false;
    return this.compareDecimal(values.allocated_net_amount, source.remaining_net_amount) <= 0
      && this.compareDecimal(values.allocated_net_amount, targetRemaining) <= 0
      && POSITIVE_QUANTITY.test(values.source_quantity)
      && this.compareDecimal(values.source_quantity, source.remaining_quantity) <= 0;
  });
  readonly canClose = (): boolean => !this.pending();
  readonly canConfirm = computed(() => this.permission() && this.eligible() && this.allocationsLoaded()
    && this.documentVersion() != null && !this.pending() && !this.conflict()
    && this.formStatus() === 'VALID' && this.formValues().manual_reason.trim().length >= 10 && this.selectedDocumentItemId() != null
    && this.selectedExpenseId() != null && this.amountBoundsValid());
  readonly totalPages = computed(() => Math.min(MAX_PAGE, Math.max(1, Math.ceil(this.total() / PAGE_SIZE))));

  private searchRequest?: Subscription;
  private mutationRequest?: Subscription;
  private epoch = 0;
  private resetKey = '';

  constructor() {
    this.form.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(() => this.idempotencyKey.set(crypto.randomUUID()));
    effect(() => {
      const key = `${this.isOpen()}:${this.scope()}:${this.storeId() ?? ''}:${this.document().id}:${this.document().version}`;
      if (key === this.resetKey) return;
      this.resetKey = key;
      untracked(() => this.resetSession());
    });
    this.destroyRef.onDestroy(() => {
      this.epoch++;
      this.searchRequest?.unsubscribe();
      this.mutationRequest?.unsubscribe();
      this.searchRequest = undefined;
      this.mutationRequest = undefined;
    });
  }

  open(): void {
    if (this.permission() && this.eligible() && this.allocationsLoaded()) this.isOpen.set(true);
  }

  onSearchSubmit(event: SubmitEvent): void {
    event.preventDefault();
    this.search();
  }

  search(): void {
    this.searchAttempted.set(true);
    const query = this.searchControl.value.trim();
    if (this.searchControl.invalid) { this.searchControl.markAsTouched(); return; }
    this.selectedExpenseId.set(null);
    this.selectedExpenseItemId.set(null);
    this.expenses.set([]);
    this.total.set(0);
    this.page.set(1);
    this.loadExpenses(query, 1);
  }

  previousPage(): void { if (this.page() > 1) this.loadExpenses(this.searchControl.value.trim(), this.page() - 1); }
  nextPage(): void { if (this.page() < this.totalPages() && this.page() < MAX_PAGE) this.loadExpenses(this.searchControl.value.trim(), this.page() + 1); }

  selectExpense(expense: ReceivedDocumentMatchExpense): void {
    this.selectedExpenseId.set(expense.id);
    this.selectedExpenseItemId.set(null);
    this.rotateKey();
  }

  selectExpenseItem(event: Event): void {
    const raw = event.target instanceof HTMLSelectElement ? event.target.value : '';
    this.selectedExpenseItemId.set(this.parseId(raw));
    this.rotateKey();
  }

  selectSourceLine(event: Event): void {
    const raw = event.target instanceof HTMLSelectElement ? event.target.value : '';
    const id = this.parseId(raw);
    this.selectedDocumentItemId.set(id);
    this.rotateKey();
    const balance = this.lineBalances().find((row) => row.document_item_id === id);
    this.form.patchValue({ source_quantity: balance?.remaining_quantity ?? '', allocated_net_amount: balance?.remaining_net_amount ?? '' });
  }

  lineBalance(id: number | undefined): ReceivedDocumentMatchLineBalance | undefined {
    return id == null ? undefined : this.lineBalances().find((balance) => balance.document_item_id === id);
  }

  sourceAvailable(id: number | undefined): boolean {
    const balance = this.lineBalance(id);
    return !!balance && /[1-9]/.test(balance.remaining_quantity.replace(/[.]/g, ''));
  }

  dateLabel(value: string): string {
    const timezone = this.storeSettings.timezone() || 'America/Bogota';
    return formatStoreDateTime(value, timezone, { dateStyle: 'short' }) || 'Fecha no disponible';
  }

  money(value: string | null | undefined, currency: string | null | undefined): string {
    if (value == null || value === '') return 'Importe no disponible';
    const code = currency?.trim().toUpperCase();
    if (!code || !/^[A-Z]{3}$/.test(code)) return `${value} · moneda no identificada`;
    const configured = this.currency.currentCurrency();
    return configured?.code.toUpperCase() === code ? this.currency.format(value, 2) : `${value} ${code}`;
  }

  warningLabel(code: string): string {
    const labels: Record<string, string> = {
      MANUAL_SUPPLIER_IDENTITY_UNVERIFIED: 'La identidad del proveedor del gasto no está verificada; revisa el soporte por separado.',
      DOCUMENT_CURRENCY_INVALID: 'La moneda del documento no es válida; no se listaron gastos.',
      EXPENSE_OVERALLOCATED: 'Uno o más gastos ya superan su saldo disponible.',
      EXPENSE_ITEM_OVERALLOCATED: 'Una o más líneas del gasto ya superan su saldo disponible.',
      EXPENSE_ITEMS_LIMIT_REACHED: 'El gasto tiene más líneas de las que se muestran.',
    };
    return labels[code] ?? code.replace(/_/g, ' ').toLocaleLowerCase();
  }

  prepareConfirmation(): void {
    this.submitAttempted.set(true);
    this.form.markAllAsTouched();
    if (!this.canConfirm()) return;
    this.confirmationOpen.set(true);
  }

  confirm(): void {
    if (!this.canConfirm()) return;
    const documentItemId = this.selectedDocumentItemId();
    const expenseId = this.selectedExpenseId();
    const expectedVersion = this.documentVersion();
    if (documentItemId == null || expenseId == null || expectedVersion == null) return;
    const raw = this.form.getRawValue();
    const expenseItemId = this.selectedExpenseItemId();
    const payload: ConfirmReceivedDocumentMatchInput = {
      expected_version: expectedVersion,
      idempotency_key: this.idempotencyKey(),
      document_item_id: documentItemId,
      expense_id: expenseId,
      ...(expenseItemId != null ? { expense_item_id: expenseItemId } : {}),
      source_quantity: raw.source_quantity,
      target_quantity: raw.target_quantity,
      allocated_net_amount: raw.allocated_net_amount,
      target_unit_code: raw.target_unit_code.trim(),
      manual_reason: raw.manual_reason.trim(),
    };
    this.pending.set(true);
    this.mutationError.set(null);
    this.mutationRequest = this.api.confirmMatch(this.scope(), this.document().id, payload, this.storeId() ?? undefined)
      .pipe(finalize(() => this.pending.set(false)))
      .subscribe({
        next: (response) => {
          if (!response?.success || !response.data?.allocation) {
            this.mutationError.set('El servidor no confirmó la asignación. Recarga el historial antes de volver a intentar.');
            this.confirmationOpen.set(false);
            return;
          }
          this.confirmationOpen.set(false);
          this.isOpen.set(false);
          this.rotateKey();
          this.changed.emit();
        },
        error: (failure: unknown) => {
          const status = typeof failure === 'object' && failure !== null && 'status' in failure ? Number((failure as { status?: unknown }).status) : 0;
          this.confirmationOpen.set(false);
          if (status === 409) {
            this.conflict.set(true);
            this.mutationError.set('El documento cambió desde la última consulta. Recarga el detalle para actualizar versión e historial antes de confirmar otra asignación.');
            return;
          }
          this.mutationError.set(describeApiFailure(failure).message || 'No se pudo confirmar la asignación.');
        },
      });
  }

  reloadAfterConflict(): void {
    this.mutationRequest?.unsubscribe();
    this.isOpen.set(false);
    this.confirmationOpen.set(false);
    this.reloadRequested.emit();
  }

  onClosed(): void { this.resetSession(); }

  formValue(field: 'source_quantity' | 'target_quantity' | 'allocated_net_amount' | 'target_unit_code' | 'manual_reason'): string {
    return this.formValues()[field];
  }

  private loadExpenses(search: string, page: number): void {
    if (!this.isOpen() || page < 1 || page > MAX_PAGE) return;
    this.searchRequest?.unsubscribe();
    this.selectedExpenseId.set(null);
    this.selectedExpenseItemId.set(null);
    this.expenses.set([]);
    this.total.set(0);
    this.warnings.set([]);
    const requestEpoch = ++this.epoch;
    this.searchLoading.set(true);
    this.searchError.set(null);
    this.searchAttempted.set(true);
    this.searchRequest = this.api.getMatchExpenses(this.scope(), this.document().id, {
      ...(search ? { search } : {}), page, limit: PAGE_SIZE,
    }, this.storeId() ?? undefined)
      .pipe(finalize(() => { if (requestEpoch === this.epoch) this.searchLoading.set(false); }))
      .subscribe({
        next: (response) => {
          if (requestEpoch !== this.epoch || !this.isOpen()) return;
          if (!response?.success || !response.data) {
            this.searchError.set('El servidor no confirmó la búsqueda manual de gastos.');
            return;
          }
          const data: ReceivedDocumentMatchExpensesResponse = response.data;
          this.expenses.set(data.data ?? []);
          this.total.set(data.total ?? 0);
          this.page.set(data.page ?? page);
          this.warnings.set(data.warnings ?? []);
        },
        error: (failure: unknown) => {
          if (requestEpoch === this.epoch) this.searchError.set(describeApiFailure(failure).message || 'No se pudieron buscar gastos.');
        },
      });
  }

  private createForm(): ExpenseMatchForm {
    return this.fb.nonNullable.group({
      source_quantity: ['', [Validators.required, Validators.pattern(POSITIVE_QUANTITY)]],
      target_quantity: ['', [Validators.required, Validators.pattern(POSITIVE_QUANTITY)]],
      allocated_net_amount: ['', [Validators.required, Validators.pattern(NON_NEGATIVE_MONEY)]],
      target_unit_code: ['', [Validators.required, Validators.maxLength(30)]],
      manual_reason: ['', [Validators.required, Validators.pattern(/^(?=.*\S).{10,500}$/)]],
    }) as ExpenseMatchForm;
  }

  private resetSession(): void {
    this.searchRequest?.unsubscribe();
    this.mutationRequest?.unsubscribe();
    this.searchRequest = undefined;
    this.mutationRequest = undefined;
    this.epoch++;
    this.searchLoading.set(false);
    this.searchControl.reset('');
    this.searchAttempted.set(false);
    this.searchError.set(null);
    this.warnings.set([]);
    this.expenses.set([]);
    this.total.set(0);
    this.page.set(1);
    this.selectedExpenseId.set(null);
    this.selectedExpenseItemId.set(null);
    this.selectedDocumentItemId.set(null);
    this.confirmationOpen.set(false);
    this.submitAttempted.set(false);
    this.pending.set(false);
    this.conflict.set(false);
    this.mutationError.set(null);
    this.form.reset({ source_quantity: '', target_quantity: '', allocated_net_amount: '', target_unit_code: '', manual_reason: '' });
    this.rotateKey();
  }

  private parseId(raw: string): number | null {
    if (!/^[1-9]\d*$/.test(raw)) return null;
    const value = Number(raw);
    return Number.isSafeInteger(value) && value <= 2147483647 ? value : null;
  }

  private compareDecimal(left: string, right: string): number {
    const [leftWhole, leftFraction = ''] = left.split('.');
    const [rightWhole, rightFraction = ''] = right.split('.');
    const scale = Math.max(leftFraction.length, rightFraction.length);
    const multiplier = 10n ** BigInt(scale);
    const leftValue = BigInt(leftWhole) * multiplier + BigInt((leftFraction + '0'.repeat(scale)).slice(0, scale) || '0');
    const rightValue = BigInt(rightWhole) * multiplier + BigInt((rightFraction + '0'.repeat(scale)).slice(0, scale) || '0');
    return leftValue === rightValue ? 0 : leftValue < rightValue ? -1 : 1;
  }

  private rotateKey(): void { this.idempotencyKey.set(crypto.randomUUID()); }
}
