import {
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import {
  FormArray,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { interval, firstValueFrom } from 'rxjs';
import {
  ButtonComponent,
  InputComponent,
  ModalComponent,
  PaymentModalComponent,
  ToastService,
} from '../../../../../../../shared/components';
import type { PaymentSubmit } from '../../../../../../../shared/components';
import { CurrencyPipe } from '../../../../../../../shared/pipes';
import { PaymentMethodsCatalogService } from '../../../../../../../shared/services/payment-methods-catalog.service';
import type { PaymentMethod } from '../../../../../../../shared/models/payment-method.model';
import { extractApiErrorMessage } from '../../../../../../../core/utils/api-error-handler';
import { AuthFacade } from '../../../../../../../core/store/auth/auth.facade';
import { PosCustomerSelectorComponent } from '../../../../pos/components/pos-customer-selector/pos-customer-selector.component';
import type { PosCustomer } from '../../../../pos/models/customer.model';
import { TablesService } from '../../services/tables.service';
import type {
  SplitAccountCustomer,
  SplitAccountPayDto,
  SplitFinancialAccount,
  SplitPreviewDto,
  SplitResult,
  SplitSourceItem,
  SplitWompiPaymentMethod,
} from '../../interfaces';

/** Shared financial-only surface: account IDs never navigate to order routes. */
@Component({
  selector: 'app-split-accounts-panel',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    ButtonComponent,
    InputComponent,
    ModalComponent,
    PaymentModalComponent,
    CurrencyPipe,
    PosCustomerSelectorComponent,
  ],
  templateUrl: './split-accounts-panel.component.html',
  styles: [
    `
      :host {
        display: block;
      }
      .split-panel {
        display: grid;
        gap: 1rem;
      }
      .split-summary,
      .split-card {
        border: 1px solid var(--color-border);
        border-radius: 12px;
        padding: 1rem;
        background: var(--color-surface);
      }
      .split-summary {
        display: flex;
        flex-wrap: wrap;
        gap: 1rem;
      }
      .split-summary div {
        flex: 1;
        min-width: 130px;
      }
      .split-summary small {
        display: block;
        color: var(--color-text-secondary);
      }
      .split-accounts {
        display: grid;
        gap: 0.75rem;
      }
      .split-row,
      .split-actions {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 0.5rem;
        justify-content: space-between;
      }
      .split-actions {
        justify-content: flex-start;
        margin-top: 0.75rem;
      }
      h3,
      h4,
      p {
        margin: 0;
      }
      .split-note {
        color: var(--color-text-secondary);
        font-size: 0.875rem;
      }
      .split-error {
        color: var(--color-error);
        padding: 0.75rem;
        border: 1px solid var(--color-error);
        border-radius: 8px;
      }
      .split-item {
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(110px, 40%);
        gap: 0.75rem;
        align-items: center;
        padding: 0.5rem 0;
      }
      select {
        min-height: 44px;
        border: 1px solid var(--color-border);
        border-radius: 8px;
        padding: 0.5rem;
        color: var(--color-text-primary);
        background: var(--color-surface);
      }
      .split-totals {
        display: grid;
        grid-template-columns: 1fr auto;
        gap: 0.35rem;
        margin-top: 0.75rem;
        font-size: 0.875rem;
      }
      @media (min-width: 768px) {
        .split-accounts {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
      }
    `,
  ],
})
export class SplitAccountsPanelComponent {
  private readonly api = inject(TablesService);
  private readonly catalog = inject(PaymentMethodsCatalogService);
  private readonly toast = inject(ToastService);
  private readonly auth = inject(AuthFacade);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  readonly sourceOrderId = input.required<number>();
  readonly items = input<SplitSourceItem[]>([]);
  readonly allowCreate = input(true);
  readonly refreshKey = input(0);
  readonly changed = output<SplitResult | null>();
  readonly loaded = output<SplitResult | null>();
  readonly splitCompleted = output<SplitResult>();
  readonly group = signal<SplitResult | null>(null);
  readonly preview = signal<SplitResult | null>(null);
  readonly loading = signal(false);
  readonly busy = signal(false);
  readonly error = signal('');
  readonly mode = signal<'equal' | 'custom' | 'items'>('equal');
  readonly payers = signal<SplitAccountCustomer[]>([{}, {}]);
  readonly assignments = signal<Partial<Record<number, number>>>({});
  readonly customerNames = signal<Record<number, string>>({});
  readonly paymentMethods = signal<PaymentMethod[]>([]);
  readonly paymentOpen = signal(false);
  readonly payingAccount = signal<SplitFinancialAccount | null>(null);
  readonly pickerOpen = signal(false);
  readonly aliasControl = new FormControl('', {
    nonNullable: true,
    validators: [Validators.maxLength(100)],
  });
  readonly pickerDraftIndex = signal<number | null>(null);
  readonly pickerAccount = signal<SplitFinancialAccount | null>(null);
  readonly gatewayUrl = signal<string | null>(null);
  readonly form = new FormGroup({
    count: new FormControl(2, {
      nonNullable: true,
      validators: [Validators.required, Validators.min(2), Validators.max(20)],
    }),
    amounts: new FormArray<FormControl<number>>([]),
    aliases: new FormArray<FormControl<string>>([]),
  });
  private readonly formValue = toSignal(this.form.valueChanges, {
    initialValue: this.form.getRawValue(),
  });
  private readonly previewFingerprint = signal('');
  private splitKey = '';
  private paymentKey = '';
  private paymentFingerprint = '';
  private loadSequence = 0;
  private currentSourceId = 0;
  readonly activeItems = computed(() =>
    this.items().filter((item) => !item.cancelled_at),
  );
  readonly accountRows = computed(
    () => this.group()?.accounts ?? this.preview()?.accounts ?? [],
  );
  readonly summary = computed(() => this.group() ?? this.preview());
  readonly canManage = computed(
    () =>
      this.auth.hasPermission('store:table_sessions:update') ||
      this.auth.hasPermission('store:pos:access'),
  );
  readonly canPay = computed(() => this.auth.hasPermission('store:pos:access'));
  readonly canInvoice = computed(() =>
    this.auth.hasPermission('invoicing:write'),
  );
  readonly fingerprint = computed(() => {
    this.formValue();
    return JSON.stringify([this.sourceOrderId(), this.request()]);
  });
  readonly canConfirm = computed(
    () =>
      !this.busy() &&
      !this.group() &&
      !!this.preview() &&
      this.previewFingerprint() === this.fingerprint(),
  );
  readonly canCancel = computed(
    () =>
      !!this.group() &&
      !this.group()!.retained_account?.invoice_id &&
      this.group()!.accounts.every(
        (account) =>
          Number(account.total_paid) === 0 &&
          Number(account.reserved_amount) === 0 &&
          !account.invoice_id,
      ),
  );
  readonly paymentAmount = computed(() =>
    Number(this.payingAccount()?.available_to_pay ?? 0),
  );
  readonly paymentCustomer = computed(() =>
    this.payingAccount()?.customer_id
      ? { id: this.payingAccount()!.customer_id! }
      : null,
  );

  constructor() {
    this.resizeAccounts(2);
    this.form.controls.count.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((count) => {
        if (Number.isInteger(count) && count >= 2 && count <= 20)
          this.resizeAccounts(count);
      });
    effect(() => {
      const sourceId = this.sourceOrderId();
      this.refreshKey();
      untracked(() => {
        if (sourceId !== this.currentSourceId) {
          this.currentSourceId = sourceId;
          this.group.set(null);
          this.preview.set(null);
          this.gatewayUrl.set(null);
          this.paymentOpen.set(false);
          this.pickerOpen.set(false);
          this.payingAccount.set(null);
          this.assignments.set({});
          this.payers.set([{}, {}]);
          this.form.controls.count.setValue(2);
        }
        if (sourceId > 0) void this.reload();
      });
    });
    // A gateway result is pending until the server/webhook confirms it.
    interval(10000)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        if (
          !this.busy() &&
          this.group()?.accounts.some(
            (account) => Number(account.reserved_amount) > 0,
          )
        )
          void this.reload(true);
      });
    this.catalog
      .getEnabledMethods()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((methods) => {
        this.paymentMethods.set(
          methods.filter(
            (method) =>
              method.enabled &&
              Number(method.id) > 0 &&
              ((method.processingMode === 'DIRECT' &&
                ['cash', 'card', 'bank_transfer'].includes(method.type)) ||
                (method.processingMode === 'ONLINE' &&
                  method.type === 'wompi')),
          ),
        );
      });
  }

  aliasControlAt(index: number): FormControl<string> {
    return this.form.controls.aliases.at(index);
  }
  amountControl(index: number): FormControl<number> {
    return this.form.controls.amounts.at(index);
  }
  money(value: string | number | null | undefined): number {
    return Number(value ?? 0);
  }
  stateLabel(state: SplitFinancialAccount['payment_state']): string {
    return {
      unpaid: 'Pendiente',
      pending: 'Esperando confirmación',
      partial: 'Abono recibido',
      paid: 'Pagada',
    }[state];
  }
  payerName(account: SplitAccountCustomer): string {
    return (
      account.customer_name ||
      (account.customer_id
        ? (this.customerNames()[account.customer_id] ??
          `Cliente #${account.customer_id}`)
        : account.customer_alias || 'Sin titular asignado')
    );
  }
  private resizeAccounts(count: number): void {
    const controls = this.form.controls.amounts;
    while (controls.length < count)
      controls.push(
        new FormControl(0, {
          nonNullable: true,
          validators: [Validators.min(0.01)],
        }),
        { emitEvent: false },
      );
    while (controls.length > count)
      controls.removeAt(controls.length - 1, { emitEvent: false });
    const aliases = this.form.controls.aliases;
    while (aliases.length < count)
      aliases.push(
        new FormControl('', {
          nonNullable: true,
          validators: [Validators.maxLength(100)],
        }),
        { emitEvent: false },
      );
    while (aliases.length > count)
      aliases.removeAt(aliases.length - 1, { emitEvent: false });
    this.payers.update((current) =>
      Array.from({ length: count }, (_, index) => current[index] ?? {}),
    );
    this.form.updateValueAndValidity();
  }
  setMode(mode: 'equal' | 'custom' | 'items'): void {
    const existing = this.preview();
    this.mode.set(mode);
    if (
      mode === 'custom' &&
      existing?.accounts.length === this.payers().length
    ) {
      this.form.controls.amounts.setValue(
        existing.accounts.map((account) => Number(account.grand_total)),
      );
    }
  }
  assign(itemId: number, event: Event): void {
    const group = Number((event.target as HTMLSelectElement).value);
    this.assignments.update((current) => ({ ...current, [itemId]: group }));
  }
  private request(): SplitPreviewDto {
    const count = this.form.controls.count.value;
    const aliases = this.form.controls.aliases.getRawValue();
    const accounts = this.payers().map((payer, index) => ({
      ...payer,
      customer_alias: payer.customer_id
        ? null
        : aliases[index]?.trim() || payer.customer_alias || null,
    }));
    if (this.mode() === 'items') {
      return {
        mode: 'items',
        accounts,
        item_groups: Array.from({ length: count }, (_, index) => ({
          order_item_ids: this.activeItems()
            .filter((item) => this.assignments()[item.id] === index + 1)
            .map((item) => item.id),
        })),
      };
    }
    return {
      mode: this.mode(),
      n_splits: count,
      accounts,
      ...(this.mode() === 'custom'
        ? { amounts: this.form.controls.amounts.getRawValue() }
        : {}),
    };
  }
  async reload(silent = false): Promise<void> {
    const sourceId = this.sourceOrderId();
    const sequence = ++this.loadSequence;
    if (!silent) {
      this.loading.set(true);
      this.error.set('');
    }
    try {
      let group = await firstValueFrom(this.api.getFinancialSplit(sourceId));
      if (group && this.canPay() && !silent) {
        group = await firstValueFrom(
          this.api.reconcileFinancialSplit(sourceId),
        );
      }
      if (sequence !== this.loadSequence || sourceId !== this.sourceOrderId())
        return;
      this.group.set(group);
      this.loaded.emit(group);
      if (!group && this.allowCreate() && !silent)
        await this.calculatePreview();
    } catch (error) {
      if (sequence === this.loadSequence) this.showError(error);
    } finally {
      if (sequence === this.loadSequence) this.loading.set(false);
    }
  }
  async calculatePreview(): Promise<void> {
    if (this.busy() || !this.canManage()) return;
    if (this.form.controls.count.invalid) {
      this.error.set('Elige entre 2 y 20 cuentas.');
      return;
    }
    const dto = this.request();
    if (
      dto.mode === 'items' &&
      (dto.item_groups?.some((group) => !group.order_item_ids.length) ||
        this.activeItems().some((item) => !this.assignments()[item.id]))
    ) {
      this.error.set(
        'Asigna todos los ítems activos y al menos uno a cada cuenta.',
      );
      return;
    }
    if (dto.mode === 'custom' && this.form.controls.amounts.invalid) {
      this.error.set('Cada cuenta debe tener un importe mayor que cero.');
      return;
    }
    const fingerprint = this.fingerprint();
    this.busy.set(true);
    this.error.set('');
    try {
      const preview = await firstValueFrom(
        this.api.previewFinancialSplit(this.sourceOrderId(), dto),
      );
      if (this.fingerprint() !== fingerprint) return;
      this.previewFingerprint.set(fingerprint);
      this.splitKey = crypto.randomUUID();
      this.preview.set(preview);
    } catch (error) {
      this.preview.set(null);
      this.showError(error);
    } finally {
      this.busy.set(false);
    }
  }
  async confirmSplit(): Promise<void> {
    if (!this.canConfirm() || !this.canManage()) return;
    const preview = this.preview()!;
    const dto = this.request();
    const context = {
      source_version: preview.source_version,
      idempotency_key: this.splitKey,
      accounts: dto.accounts,
    };
    this.busy.set(true);
    this.error.set('');
    try {
      const result = await firstValueFrom(
        dto.mode === 'items'
          ? this.api.splitByItems(this.sourceOrderId(), {
              item_groups: dto.item_groups!,
              ...context,
            })
          : this.api.splitByAmount(this.sourceOrderId(), {
              mode: dto.mode,
              n_splits: dto.n_splits!,
              amounts: dto.amounts,
              ...context,
            }),
      );
      this.applyResult(result);
      this.splitCompleted.emit(result);
      this.toast.success(
        'Saldo dividido. Cocina e inventario permanecen en la orden original.',
      );
    } catch (error) {
      this.showError(error);
    } finally {
      this.busy.set(false);
    }
  }
  editPayer(
    index: number | null,
    account: SplitFinancialAccount | null = null,
  ): void {
    if (account && !this.canEditPayer(account)) return;
    this.aliasControl.setValue(
      account?.customer_alias ??
        (index != null ? this.form.controls.aliases.at(index).value : ''),
    );
    this.pickerDraftIndex.set(index);
    this.pickerAccount.set(account);
    this.pickerOpen.set(true);
  }
  canEditPayer(account: SplitFinancialAccount): boolean {
    return (
      account.role === 'payable' &&
      !account.invoice_id &&
      Number(account.total_paid) === 0 &&
      Number(account.reserved_amount) === 0 &&
      this.canManage()
    );
  }
  async selectCustomer(customer: PosCustomer): Promise<void> {
    const name =
      customer.name ||
      [customer.first_name, customer.last_name].filter(Boolean).join(' ');
    this.customerNames.update((names) => ({ ...names, [customer.id]: name }));
    const account = this.pickerAccount();
    const index = this.pickerDraftIndex();
    if (!account && index != null) {
      this.payers.update((payers) =>
        payers.map((payer, i) =>
          i === index
            ? {
                ...payer,
                customer_id: Number(customer.id),
                customer_alias: null,
              }
            : payer,
        ),
      );
      this.pickerOpen.set(false);
      return;
    }
    if (!account?.id || this.busy()) return;
    this.busy.set(true);
    try {
      this.applyResult(
        await firstValueFrom(
          this.api.updateFinancialAccountCustomer(
            this.sourceOrderId(),
            account.id,
            { customer_id: Number(customer.id) },
          ),
        ),
      );
      this.pickerOpen.set(false);
    } catch (error) {
      this.showError(error);
    } finally {
      this.busy.set(false);
    }
  }
  async useAlias(): Promise<void> {
    if (this.aliasControl.invalid || this.busy()) return;
    const alias = this.aliasControl.value.trim() || null;
    const account = this.pickerAccount();
    const index = this.pickerDraftIndex();
    if (!account && index != null) {
      this.payers.update((payers) =>
        payers.map((payer, i) =>
          i === index
            ? { ...payer, customer_id: null, customer_alias: alias }
            : payer,
        ),
      );
      this.form.controls.aliases.at(index).setValue(alias ?? '');
      this.pickerOpen.set(false);
      return;
    }
    if (!account?.id) return;
    this.busy.set(true);
    try {
      this.applyResult(
        await firstValueFrom(
          this.api.updateFinancialAccountCustomer(
            this.sourceOrderId(),
            account.id,
            { customer_id: null, customer_alias: alias },
          ),
        ),
      );
      this.pickerOpen.set(false);
    } catch (error) {
      this.showError(error);
    } finally {
      this.busy.set(false);
    }
  }
  openPayment(account: SplitFinancialAccount): void {
    if (
      !account.id ||
      account.role !== 'payable' ||
      Number(account.available_to_pay) <= 0 ||
      !this.canPay()
    )
      return;
    this.payingAccount.set(account);
    this.gatewayUrl.set(null);
    this.paymentOpen.set(true);
  }
  async pay(submit: PaymentSubmit): Promise<void> {
    const account = this.payingAccount();
    if (!account?.id || !submit.storePaymentMethodId || this.busy()) return;
    if (submit.methodType === 'wompi' && !account.customer_id) {
      this.error.set(
        'Wompi requiere un cliente registrado. Asigna el titular o elige un medio presencial.',
      );
      return;
    }
    const wompiMethod = submit.wompi
      ? this.wompiMethod(submit.wompi.payload)
      : undefined;
    if (submit.wompi && !wompiMethod) {
      this.error.set(
        'El método de Wompi está incompleto. Vuelve a seleccionarlo.',
      );
      return;
    }
    const request = {
      store_payment_method_id: submit.storePaymentMethodId,
      amount: submit.amount,
      ...(submit.amountReceived != null
        ? { amount_received: submit.amountReceived }
        : {}),
      ...(submit.reference ? { payment_reference: submit.reference } : {}),
      ...(submit.bankAccountId
        ? { bank_account_id: submit.bankAccountId }
        : {}),
      ...(wompiMethod ? { wompi_payment_method: wompiMethod } : {}),
      return_url: window.location.href,
      cancel_url: window.location.href,
    };
    const fingerprint = JSON.stringify([account.id, request]);
    if (this.paymentFingerprint !== fingerprint) {
      this.paymentFingerprint = fingerprint;
      this.paymentKey = crypto.randomUUID();
    }
    const dto: SplitAccountPayDto = {
      ...request,
      idempotency_key: this.paymentKey,
    };
    this.busy.set(true);
    this.error.set('');
    try {
      const result = await firstValueFrom(
        this.api.payFinancialAccount(this.sourceOrderId(), account.id, dto),
      );
      this.applyResult(result.split);
      this.paymentOpen.set(false);
      this.paymentKey = '';
      this.paymentFingerprint = '';
      const url = result.payment.nextAction?.url;
      if (url && this.safeGatewayUrl(url)) this.gatewayUrl.set(url);
      this.toast.success(
        ['succeeded', 'captured'].includes(result.payment.state)
          ? 'Pago recibido.'
          : 'Pago iniciado. Pendiente de confirmación; aún no está cobrado.',
      );
    } catch (error) {
      this.showError(error);
    } finally {
      this.busy.set(false);
    }
  }
  async confirmPayment(
    account: SplitFinancialAccount,
    paymentId: number,
  ): Promise<void> {
    if (!account.id || !this.canPay() || this.busy()) return;
    this.busy.set(true);
    try {
      const result = await firstValueFrom(
        this.api.confirmFinancialAccountPayment(
          this.sourceOrderId(),
          account.id,
          paymentId,
        ),
      );
      this.applyResult(result.split);
    } catch (error) {
      this.showError(error);
    } finally {
      this.busy.set(false);
    }
  }
  async invoice(account: SplitFinancialAccount): Promise<void> {
    if (!account.id || this.busy()) return;
    this.busy.set(true);
    try {
      const invoiceId =
        account.invoice_id ??
        (await firstValueFrom(this.api.invoiceFinancialAccount(account.id))).id;
      // Creation is a draft, NOT successful DIAN emission. Reuse the fiscal detail.
      await this.router.navigate(['/admin/invoicing/invoices'], {
        queryParams: { invoiceId },
      });
    } catch (error) {
      this.showError(error);
    } finally {
      this.busy.set(false);
    }
  }
  async cancelSplit(): Promise<void> {
    const group = this.group();
    if (!group || !this.canCancel() || this.busy()) return;
    this.busy.set(true);
    try {
      await firstValueFrom(
        this.api.cancelFinancialSplit(
          this.sourceOrderId(),
          group.source_version,
        ),
      );
      this.group.set(null);
      this.preview.set(null);
      this.changed.emit(null);
      this.loaded.emit(null);
      this.toast.success(
        'División anulada. Los abonos anteriores permanecen intactos.',
      );
    } catch (error) {
      this.showError(error);
    } finally {
      this.busy.set(false);
    }
  }
  safeGatewayUrl(url: string | null | undefined): string | null {
    if (!url) return null;
    try {
      return new URL(url).protocol === 'https:' ? url : null;
    } catch {
      return null;
    }
  }
  private wompiMethod(payload: unknown): SplitWompiPaymentMethod | undefined {
    if (!payload || typeof payload !== 'object') return undefined;
    const value = payload as Record<string, unknown>;
    if (typeof value['type'] !== 'string') return undefined;
    const result: SplitWompiPaymentMethod = { type: value['type'] };
    for (const key of [
      'token',
      'phone_number',
      'user_legal_id_type',
      'user_legal_id',
      'financial_institution_code',
      'payment_description',
    ] as const) {
      if (typeof value[key] === 'string') result[key] = value[key];
    }
    for (const key of ['installments', 'user_type'] as const) {
      if (typeof value[key] === 'number') result[key] = value[key];
    }
    return result;
  }
  private applyResult(result: SplitResult): void {
    if (result.source_order_id !== this.sourceOrderId()) return;
    ++this.loadSequence;
    this.group.set(result);
    this.changed.emit(result);
    this.loaded.emit(result);
  }
  private showError(error: unknown): void {
    this.error.set(
      typeof error === 'string' ? error : extractApiErrorMessage(error),
    );
  }
}
