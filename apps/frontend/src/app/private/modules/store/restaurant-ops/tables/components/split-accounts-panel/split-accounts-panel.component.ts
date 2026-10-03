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
import { NgTemplateOutlet } from '@angular/common';
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
  AlertBannerComponent,
  BadgeComponent,
  ButtonComponent,
  CardComponent,
  DialogService,
  IconComponent,
  InputComponent,
  ModalComponent,
  PaymentCollectorComponent,
  StepsLineComponent,
  ToastService,
} from '../../../../../../../shared/components';
import type {
  PaymentSubmit,
  StepsLineItem,
} from '../../../../../../../shared/components';
import {
  CurrencyFormatService,
  CurrencyPipe,
} from '../../../../../../../shared/pipes';
import { PaymentMethodsCatalogService } from '../../../../../../../shared/services/payment-methods-catalog.service';
import type { PaymentMethod } from '../../../../../../../shared/models/payment-method.model';
import { extractApiErrorMessage } from '../../../../../../../core/utils/api-error-handler';
import { parseApiError } from '../../../../../../../core/utils/parse-api-error';
import { AuthFacade } from '../../../../../../../core/store/auth/auth.facade';
import { StoreSettingsFacade } from '../../../../../../../core/store/store-settings/store-settings.facade';
import { PosCustomerSelectorComponent } from '../../../../pos/components/pos-customer-selector/pos-customer-selector.component';
import type { PosCustomer } from '../../../../pos/models/customer.model';
import { TablesService } from '../../services/tables.service';
import { SplitAccountDetailComponent } from '../split-account-detail/split-account-detail.component';
import {
  STATUS_BADGE,
  STATUS_LABEL,
  accountStatus,
  includesSummary,
  invoiceStatusLabel,
  money,
  primaryAction,
  safeHttpsUrl,
  type SplitPrimaryAction,
} from '../split-account-detail/split-account-view.util';
import type {
  SplitAccountCustomer,
  SplitAccountPayDto,
  SplitFinancialAccount,
  SplitPreviewDto,
  SplitResult,
  SplitResultMode,
  SplitSourceItem,
  SplitWompiPaymentMethod,
} from '../../interfaces';

const SPLIT_ERROR_COPY: Record<string, string> = {
  SPLIT_ACCOUNT_UNPAID_INVOICE:
    'Esta cuenta aún no está cobrada completa. Cóbrala antes de facturarla.',
  SPLIT_CANCEL_BLOCKED:
    'No se puede quitar la división: hay pagos registrados o una factura ya enviada a la DIAN.',
};

const MODE_LABEL: Record<SplitResultMode, string> = {
  items: 'Por productos',
  equal: 'Partes iguales',
  custom: 'Por montos',
};

/** Shared financial-only surface: account IDs never navigate to order routes. */
@Component({
  selector: 'app-split-accounts-panel',
  standalone: true,
  imports: [
    NgTemplateOutlet,
    ReactiveFormsModule,
    AlertBannerComponent,
    BadgeComponent,
    ButtonComponent,
    CardComponent,
    IconComponent,
    InputComponent,
    ModalComponent,
    PaymentCollectorComponent,
    StepsLineComponent,
    CurrencyPipe,
    PosCustomerSelectorComponent,
    SplitAccountDetailComponent,
  ],
  templateUrl: './split-accounts-panel.component.html',
})
export class SplitAccountsPanelComponent {
  private readonly api = inject(TablesService);
  private readonly catalog = inject(PaymentMethodsCatalogService);
  private readonly toast = inject(ToastService);
  private readonly dialog = inject(DialogService);
  private readonly auth = inject(AuthFacade);
  private readonly router = inject(Router);
  private readonly storeSettings = inject(StoreSettingsFacade);
  private readonly destroyRef = inject(DestroyRef);
  private readonly currencyFormat = inject(CurrencyFormatService);
  private destroyed = false;

  readonly sourceOrderId = input.required<number>();
  readonly items = input<SplitSourceItem[]>([]);
  readonly allowCreate = input(true);
  readonly refreshKey = input(0);
  readonly changed = output<SplitResult | null>();
  readonly loaded = output<SplitResult | null>();
  readonly splitCompleted = output<SplitResult>();

  readonly money = money;
  readonly modeOptions: Array<{ value: SplitResultMode; label: string }> = [
    { value: 'items', label: 'Por productos' },
    { value: 'equal', label: 'Partes iguales' },
    { value: 'custom', label: 'Por montos' },
  ];
  readonly steps: StepsLineItem[] = [
    { label: 'Cómo dividir' },
    { label: 'Repartir' },
    { label: 'Confirmar' },
  ];
  readonly timezone = this.storeSettings.timezone;

  readonly group = signal<SplitResult | null>(null);
  readonly preview = signal<SplitResult | null>(null);
  readonly loading = signal(false);
  readonly busy = signal(false);
  readonly previewing = signal(false);
  readonly error = signal('');
  readonly mode = signal<SplitResultMode>('items');
  readonly accountCount = signal(2);
  readonly payers = signal<SplitAccountCustomer[]>([{}, {}]);
  readonly assignments = signal<Partial<Record<number, number>>>({});
  readonly customerNames = signal<Record<number, string>>({});
  readonly baselinePending = signal<number | null>(null);
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
  readonly detailOpen = signal(false);
  readonly detailAccount = signal<SplitFinancialAccount | null>(null);
  readonly form = new FormGroup({
    amounts: new FormArray<FormControl<number>>([]),
    aliases: new FormArray<FormControl<string>>([]),
  });
  private readonly formValue = toSignal(this.form.valueChanges, {
    initialValue: this.form.getRawValue(),
  });
  private readonly previewFingerprint = signal('');
  private splitKey = '';
  /** fingerprint de cada POST de cobro -> idempotency key (se conserva ante fallos de transporte). */
  private readonly paymentKeys = new Map<string, string>();
  private loadSequence = 0;
  private currentSourceId = 0;

  readonly activeItems = computed(() =>
    this.items().filter((item) => !item.cancelled_at),
  );
  readonly fingerprint = computed(() => {
    this.formValue();
    return JSON.stringify([this.sourceOrderId(), this.request()]);
  });
  readonly currentPreview = computed(() =>
    this.previewFingerprint() === this.fingerprint() ? this.preview() : null,
  );
  readonly summary = computed(() => this.group() ?? this.currentPreview());
  readonly canManage = computed(
    () =>
      this.auth.hasPermission('store:table_sessions:update') ||
      this.auth.hasPermission('store:pos:access'),
  );
  readonly canPay = computed(() => this.auth.hasPermission('store:pos:access'));
  readonly canInvoice = computed(() =>
    this.auth.hasPermission('invoicing:write'),
  );
  readonly accountNumbers = computed(() =>
    Array.from({ length: this.accountCount() }, (_, i) => i + 1),
  );
  readonly unassignedItems = computed(() =>
    this.activeItems().filter((item) => !this.assignments()[item.id]),
  );
  /** Vista por cuenta en armado: productos asignados y total en vivo. */
  readonly draftAccounts = computed(() => {
    const preview = this.currentPreview();
    return this.accountNumbers().map((n, index) => {
      const assigned = this.activeItems().filter(
        (item) => this.assignments()[item.id] === n,
      );
      const known = assigned.every((item) => this.itemTotal(item) !== null);
      const itemsSum = assigned.reduce(
        (sum, item) => sum + (this.itemTotal(item) ?? 0),
        0,
      );
      const total = preview?.accounts[index]
        ? money(preview.accounts[index].grand_total)
        : this.mode() === 'items' && known && assigned.length
          ? itemsSum
          : null;
      return { number: n, index, itemCount: assigned.length, total };
    });
  });
  /** Monto por repartir en modo montos (pendiente − suma de importes). */
  readonly remaining = computed<number | null>(() => {
    this.formValue();
    const base = this.baselinePending();
    if (base === null) return null;
    const sum = this.form.controls.amounts
      .getRawValue()
      .reduce((acc, value) => acc + Number(value || 0), 0);
    return Math.round((base - sum) * 100) / 100;
  });
  readonly draftIssue = computed(() => {
    const mode = this.mode();
    if (mode === 'items') {
      if (!this.activeItems().length) return 'No hay productos para repartir.';
      const missing = this.unassignedItems().length;
      if (missing)
        return missing === 1
          ? 'Falta asignar 1 producto a una cuenta.'
          : `Faltan ${missing} productos por asignar a una cuenta.`;
      const empty = this.draftAccounts().find((a) => a.itemCount === 0);
      if (empty) return `Cuenta ${empty.number} necesita al menos un producto.`;
    }
    if (mode === 'custom') {
      this.formValue();
      if (this.form.controls.amounts.controls.some((c) => !(Number(c.value) > 0)))
        return 'Cada cuenta debe tener un monto mayor que cero.';
    }
    return '';
  });
  readonly draftValid = computed(() => {
    if (this.draftIssue()) return false;
    if (this.mode() === 'custom') {
      const remaining = this.remaining();
      return remaining !== null && Math.abs(remaining) < 0.005;
    }
    return true;
  });
  readonly currentStep = computed(() =>
    this.currentPreview() ? 2 : this.draftValid() ? 1 : 0,
  );
  readonly canConfirm = computed(
    () =>
      !this.busy() &&
      !this.previewing() &&
      !this.group() &&
      !!this.currentPreview(),
  );
  readonly paymentAmount = computed(() =>
    Number(this.payingAccount()?.available_to_pay ?? 0),
  );
  readonly paymentCustomer = computed(() =>
    this.payingAccount()?.customer_id
      ? { id: this.payingAccount()!.customer_id! }
      : null,
  );
  readonly groupModeLabel = computed(() => {
    const mode = this.group()?.mode;
    return mode ? MODE_LABEL[mode] : '';
  });
  readonly collected = computed(() =>
    (this.group()?.accounts ?? []).reduce(
      (sum, account) => sum + money(account.total_paid),
      0,
    ),
  );
  readonly collectable = computed(() =>
    (this.group()?.accounts ?? []).reduce(
      (sum, account) => sum + money(account.grand_total),
      0,
    ),
  );
  readonly collectedPercent = computed(() => {
    const total = this.collectable();
    return total > 0
      ? Math.min(100, Math.round((this.collected() / total) * 100))
      : 0;
  });
  readonly invoicedCount = computed(
    () =>
      (this.group()?.accounts ?? []).filter((account) => !!account.invoice_id)
        .length,
  );
  readonly undo = computed(() => this.group()?.undo ?? null);
  readonly accountCards = computed(() => {
    const group = this.group();
    if (!group) return [];
    return group.accounts.map((account) => this.card(account, group));
  });
  readonly retainedCard = computed(() => {
    const group = this.group();
    return group?.retained_account
      ? this.card(group.retained_account, group)
      : null;
  });

  constructor() {
    this.destroyRef.onDestroy(() => (this.destroyed = true));
    this.resizeAccounts(2);
    effect(() => {
      const sourceId = this.sourceOrderId();
      this.refreshKey();
      untracked(() => {
        if (sourceId !== this.currentSourceId) {
          this.currentSourceId = sourceId;
          this.resetDraft();
          this.group.set(null);
          this.gatewayUrl.set(null);
          this.paymentOpen.set(false);
          this.pickerOpen.set(false);
          this.detailOpen.set(false);
          this.payingAccount.set(null);
        }
        if (sourceId > 0) void this.reload();
      });
    });
    // Vista previa automática: recalcula con debounce cuando el reparto es válido.
    effect((onCleanup) => {
      this.fingerprint();
      const eligible =
        !this.group() &&
        this.allowCreate() &&
        this.canManage() &&
        !this.loading() &&
        this.draftValid();
      if (!eligible) return;
      const timer = setTimeout(
        () => untracked(() => void this.calculatePreview()),
        400,
      );
      onCleanup(() => clearTimeout(timer));
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

  // ─── Presentación ───────────────────────────────────────────────────
  aliasControlAt(index: number): FormControl<string> {
    return this.form.controls.aliases.at(index);
  }
  amountControl(index: number): FormControl<number> {
    return this.form.controls.amounts.at(index);
  }
  /** 2 decimales sólo cuando el monto trae centavos (reparto 18.333,34). */
  decimalsFor(value: number | null | undefined): number | undefined {
    const n = Number(value ?? 0);
    return Math.abs(n - Math.round(n)) > 0.004 ? 2 : undefined;
  }
  hasCustomer(account: SplitAccountCustomer | null | undefined): boolean {
    return !!(
      account?.customer_id ||
      account?.customer_alias ||
      account?.customer_name
    );
  }
  payerName(account: SplitAccountCustomer): string {
    return (
      account.customer_name ||
      (account.customer_id
        ? (this.customerNames()[account.customer_id] ??
          `Cliente #${account.customer_id}`)
        : account.customer_alias || 'Consumidor final')
    );
  }
  itemTotal(item: SplitSourceItem): number | null {
    const raw =
      item.final_total_price ??
      item.total_price ??
      (item.unit_price != null ? Number(item.unit_price) * item.quantity : null);
    return raw === null || raw === undefined || Number.isNaN(Number(raw))
      ? null
      : Number(raw);
  }
  private card(account: SplitFinancialAccount, group: SplitResult) {
    const status = accountStatus(account);
    const retained = account.role === 'paid_original';
    const action = primaryAction(account, {
      canPay: this.canPay(),
      canInvoice: this.canInvoice(),
    });
    return {
      account,
      retained,
      title: retained ? 'Pagos hechos antes de dividir' : account.label,
      status,
      statusLabel: STATUS_LABEL[status],
      badge: STATUS_BADGE[status],
      includes: includesSummary(account, group.mode, this.activeItems().length),
      action,
      invoiceStatusText: invoiceStatusLabel(account.invoice),
      help: this.helpText(status),
    };
  }
  private helpText(status: ReturnType<typeof accountStatus>): string {
    switch (status) {
      case 'pending':
        return 'Cóbrala para poder facturarla.';
      case 'awaiting_confirmation':
        return 'Aún no cuenta como cobrada hasta confirmar el pago.';
      case 'paid':
        return 'Cobrada. Ya puedes facturarla.';
      default:
        return '';
    }
  }

  // ─── Armado ─────────────────────────────────────────────────────────
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
    this.accountCount.set(count);
    this.form.updateValueAndValidity();
  }
  private resetDraft(): void {
    this.preview.set(null);
    this.previewFingerprint.set('');
    this.assignments.set({});
    this.baselinePending.set(null);
    this.mode.set('items');
    this.payers.set([{}, {}]);
    this.form.controls.amounts.clear({ emitEvent: false });
    this.form.controls.aliases.clear({ emitEvent: false });
    this.resizeAccounts(2);
  }
  setMode(mode: SplitResultMode): void {
    this.mode.set(mode);
    if (mode === 'custom') this.distributeEvenly();
  }
  private distributeEvenly(): void {
    const base = this.baselinePending() ?? this.preview()?.pending_to_split;
    if (base === null || base === undefined) return;
    const cents = Math.round(Number(base) * 100);
    const n = this.accountCount();
    const share = Math.floor(cents / n);
    const values = Array.from(
      { length: n },
      (_, i) => (share + (i === 0 ? cents - share * n : 0)) / 100,
    );
    this.form.controls.amounts.setValue(values);
  }
  addAccount(): void {
    if (this.accountCount() >= 20) return;
    this.resizeAccounts(this.accountCount() + 1);
    if (this.mode() === 'custom') this.distributeEvenly();
  }
  setAccountCount(count: number): void {
    const parsed = Math.trunc(Number(count));
    if (!Number.isInteger(parsed) || parsed < 2 || parsed > 20) return;
    this.resizeAccounts(parsed);
    if (this.mode() === 'custom') this.distributeEvenly();
  }
  removeAccount(index: number): void {
    if (this.accountCount() <= 2) return;
    const removed = index + 1;
    this.assignments.update((current) => {
      const next: Partial<Record<number, number>> = {};
      for (const [id, account] of Object.entries(current)) {
        if (account === removed || account === undefined) continue;
        next[Number(id)] = account > removed ? account - 1 : account;
      }
      return next;
    });
    this.form.controls.aliases.removeAt(index, { emitEvent: false });
    this.form.controls.amounts.removeAt(index, { emitEvent: false });
    this.payers.update((payers) => payers.filter((_, i) => i !== index));
    this.accountCount.set(this.accountCount() - 1);
    this.form.updateValueAndValidity();
    if (this.mode() === 'custom') this.distributeEvenly();
  }
  assign(itemId: number, accountNumber: number): void {
    this.assignments.update((current) => ({
      ...current,
      [itemId]: accountNumber,
    }));
  }
  private request(): SplitPreviewDto {
    const count = this.accountCount();
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

  // ─── Carga ──────────────────────────────────────────────────────────
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
      if (!group && this.allowCreate() && !silent) await this.probeBaseline();
    } catch (error) {
      if (sequence === this.loadSequence) this.showError(error, true);
    } finally {
      if (sequence === this.loadSequence) this.loading.set(false);
    }
  }
  /** Consulta el saldo por repartir (necesario para «Por montos»). */
  private async probeBaseline(): Promise<void> {
    if (!this.canManage()) return;
    const probe = await firstValueFrom(
      this.api.previewFinancialSplit(this.sourceOrderId(), {
        mode: 'equal',
        n_splits: 2,
      }),
    );
    this.baselinePending.set(Number(probe.pending_to_split));
  }
  async calculatePreview(): Promise<void> {
    if (this.busy() || !this.canManage() || !this.draftValid()) return;
    const dto = this.request();
    const fingerprint = this.fingerprint();
    this.previewing.set(true);
    this.error.set('');
    try {
      const preview = await firstValueFrom(
        this.api.previewFinancialSplit(this.sourceOrderId(), dto),
      );
      if (this.fingerprint() !== fingerprint) return;
      this.previewFingerprint.set(fingerprint);
      this.baselinePending.set(Number(preview.pending_to_split));
      this.splitKey = crypto.randomUUID();
      this.preview.set(preview);
    } catch (error) {
      this.preview.set(null);
      this.showError(error, true);
    } finally {
      this.previewing.set(false);
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
      this.toast.success('Cuenta dividida. Ya puedes cobrar cada cuenta.');
    } catch (error) {
      this.showError(error);
    } finally {
      this.busy.set(false);
    }
  }

  // ─── Cliente ────────────────────────────────────────────────────────
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
      const result = await firstValueFrom(
        this.api.updateFinancialAccountCustomer(
          this.sourceOrderId(),
          account.id,
          { customer_id: Number(customer.id) },
        ),
      );
      // Cerrar el selector ANTES de publicar el resultado: applyResult emite
      // changed/loaded y el padre puede re-renderizar y destruir este árbol.
      this.pickerOpen.set(false);
      this.applyResult(result);
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
      const result = await firstValueFrom(
        this.api.updateFinancialAccountCustomer(
          this.sourceOrderId(),
          account.id,
          { customer_id: null, customer_alias: alias },
        ),
      );
      this.pickerOpen.set(false);
      this.applyResult(result);
    } catch (error) {
      this.showError(error);
    } finally {
      this.busy.set(false);
    }
  }

  // ─── Cobro, factura y acciones ──────────────────────────────────────
  openDetail(account: SplitFinancialAccount): void {
    this.detailAccount.set(account);
    this.detailOpen.set(true);
  }
  /** La cuenta del detalle siempre es la versión viva del grupo. */
  readonly liveDetailAccount = computed(() => {
    const open = this.detailAccount();
    if (!open) return null;
    const group = this.group();
    const all = [...(group?.accounts ?? []), group?.retained_account ?? null];
    return all.find((a) => a && a.id === open.id && a.role === open.role) ?? open;
  });
  async runAction(
    account: SplitFinancialAccount,
    action: SplitPrimaryAction,
  ): Promise<void> {
    switch (action.kind) {
      case 'pay':
        this.openPayment(account);
        return;
      case 'confirm':
        if (action.paymentId != null)
          await this.confirmPayment(account, action.paymentId);
        return;
      case 'continue':
        if (action.url) window.open(action.url, '_blank', 'noopener,noreferrer');
        return;
      case 'invoice':
        await this.invoiceAccount(account);
        return;
      case 'view_invoice':
        await this.invoice(account);
        return;
    }
  }
  /** «Facturar»: cuenta cobrada; sin cliente se factura a consumidor final. */
  async invoiceAccount(account: SplitFinancialAccount): Promise<void> {
    if (accountStatus(account) !== 'paid' || this.busy()) return;
    if (!account.customer_id) {
      const ok = await this.dialog.confirm({
        title: 'Facturar cuenta',
        message: 'Se facturará a consumidor final. ¿Continuar?',
        confirmText: 'Facturar',
      });
      if (!ok) return;
    }
    await this.invoice(account);
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
    if (!account?.id || this.busy()) return;
    const legs = submit.legs ?? [];
    const multi = legs.length >= 2;
    if (multi && legs.some((leg) => leg.methodType === 'wompi')) {
      this.toast.error(
        'Wompi solo puede cobrarse como único método. Quita Wompi o cobra solo con Wompi.',
      );
      return;
    }
    if (!multi && !submit.storePaymentMethodId) return;
    if (!multi && submit.methodType === 'wompi' && !account.customer_id) {
      this.toast.error(
        'Wompi requiere un cliente registrado. Asigna el cliente o elige un medio presencial.',
      );
      return;
    }
    const cap = money(account.available_to_pay);
    const total = multi
      ? legs.reduce((sum, leg) => sum + money(leg.amount), 0)
      : money(submit.amount);
    if (total > cap + 0.005) {
      this.toast.error(
        `El monto supera el saldo de la cuenta (${this.currencyFormat.format(cap)})`,
      );
      return;
    }
    const wompiMethod = submit.wompi
      ? this.wompiMethod(submit.wompi.payload)
      : undefined;
    if (!multi && submit.wompi && !wompiMethod) {
      this.toast.error(
        'El método de Wompi está incompleto. Vuelve a seleccionarlo.',
      );
      return;
    }
    const requests = multi
      ? legs.map((leg) => ({
          store_payment_method_id: leg.storePaymentMethodId,
          amount: leg.amount,
          ...(leg.amountReceived != null
            ? { amount_received: leg.amountReceived }
            : {}),
          ...(leg.reference ? { payment_reference: leg.reference } : {}),
          ...(leg.bankAccountId ? { bank_account_id: leg.bankAccountId } : {}),
        }))
      : [
          {
            store_payment_method_id: submit.storePaymentMethodId!,
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
          },
        ];
    this.busy.set(true);
    this.error.set('');
    const registered: number[] = [];
    let lastSplit: SplitResult | null = null;
    let lastPayment: { state: string; nextAction?: { url?: string } | null } | null =
      null;
    try {
      for (let i = 0; i < requests.length; i++) {
        const request = requests[i];
        const fingerprint = JSON.stringify([account.id, i, request]);
        let key = this.paymentKeys.get(fingerprint);
        if (!key) {
          key = crypto.randomUUID();
          this.paymentKeys.set(fingerprint, key);
        }
        const dto: SplitAccountPayDto = { ...request, idempotency_key: key };
        try {
          const result = await firstValueFrom(
            this.api.payFinancialAccount(this.sourceOrderId(), account.id, dto),
          );
          lastSplit = result.split;
          lastPayment = result.payment;
          registered.push(money(request.amount));
          this.paymentKeys.delete(fingerprint);
        } catch (error) {
          if (lastSplit) {
            this.applyResult(lastSplit);
            const fresh = lastSplit.accounts.find((a) => a.id === account.id);
            if (fresh) this.payingAccount.set(fresh);
          }
          if (multi) {
            const done = registered.length
              ? `Quedaron registrados ${registered.length} de ${requests.length} cobros (${registered
                  .map((v) => this.currencyFormat.format(v))
                  .join(', ')}). `
              : 'No se registró ningún cobro. ';
            this.toast.error(
              `${done}Falló el cobro ${i + 1} (${this.currencyFormat.format(
                money(request.amount),
              )}): ${this.errorMessage(error)}`,
            );
          } else {
            this.showError(error);
          }
          return;
        }
      }
      if (lastSplit) this.applyResult(lastSplit);
      this.paymentOpen.set(false);
      const url = lastPayment?.nextAction?.url;
      if (url && this.safeGatewayUrl(url)) this.gatewayUrl.set(url);
      this.toast.success(
        !lastPayment || ['succeeded', 'captured'].includes(lastPayment.state)
          ? 'Cobro registrado'
          : 'Pago iniciado. Aún no está cobrado: falta la confirmación.',
      );
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
  onDetailAction(action: SplitPrimaryAction): void {
    const account = this.liveDetailAccount();
    if (!account) return;
    if (action.kind !== 'confirm') this.detailOpen.set(false);
    void this.runAction(account, action);
  }

  // ─── Quitar división ────────────────────────────────────────────────
  async removeSplit(): Promise<void> {
    const group = this.group();
    if (!group || !this.canManage() || this.busy() || !group.undo.allowed)
      return;
    const discards = group.undo.invoices_to_discard;
    const message = discards.length
      ? `Se descartarán los borradores de factura de: ${discards
          .map(
            (d) =>
              `${d.account_label}${d.invoice_number ? ` (${d.invoice_number})` : ''}`,
          )
          .join(', ')}. Los pagos anteriores a la división se conservan.`
      : 'La orden volverá a ser una sola cuenta. Los pagos anteriores a la división se conservan.';
    const ok = await this.dialog.confirm({
      title: 'Quitar división',
      message,
      confirmText: 'Quitar división',
      confirmVariant: 'danger',
    });
    if (!ok) return;
    this.busy.set(true);
    try {
      await firstValueFrom(
        this.api.cancelFinancialSplit(
          this.sourceOrderId(),
          group.source_version,
        ),
      );
      this.group.set(null);
      this.detailOpen.set(false);
      this.resetDraft();
      this.changed.emit(null);
      this.loaded.emit(null);
      this.toast.success('División quitada.');
      void this.reload();
    } catch (error) {
      this.showError(error);
    } finally {
      this.busy.set(false);
    }
  }

  safeGatewayUrl(url: string | null | undefined): string | null {
    return safeHttpsUrl(url);
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
    if (this.destroyed) return;
    this.changed.emit(result);
    this.loaded.emit(result);
  }
  private errorMessage(error: unknown): string {
    if (typeof error === 'string') return error;
    const code = parseApiError(error).errorCode;
    return (code && SPLIT_ERROR_COPY[code]) || extractApiErrorMessage(error);
  }
  private showError(error: unknown, inline = false): void {
    const message = this.errorMessage(error);
    if (inline) this.error.set(message);
    else this.toast.error(message);
  }
}
