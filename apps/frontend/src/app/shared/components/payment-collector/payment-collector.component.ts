import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';

import { IconComponent } from '../icon/icon.component';
import type { IconName } from '../icon/icons.registry';
import { CurrencyInputDirective } from '../../directives/currency-input.directive';
import { CurrencyPipe } from '../../pipes/currency';
import {
  PaymentMethodType,
  requiresReferenceFor,
  resolvePaymentIcon,
  resolveReferenceLabel,
  type PaymentMethod,
} from '../../models/payment-method.model';
import { PaymentMethodsCatalogService } from '../../services/payment-methods-catalog.service';
import { PaymentWompiFieldsComponent } from './payment-wompi-fields.component';
import { PaymentCreditFieldsComponent } from './payment-credit-fields.component';
import { StepsLineComponent, type StepsLineItem } from '../steps-line/steps-line.component';
import {
  DEFAULT_CONFIG_BY_CONTEXT,
  type CreditTerms,
  type ManualPaymentMethod,
  type PaymentCollectorConfig,
  type PaymentCollectorLayout,
  type PaymentContext,
  type PaymentMode,
  type PaymentSubmit,
  type WompiSlice,
} from './payment-collector.model';

/**
 * `app-payment-collector` — HEADLESS, capability-driven charge widget.
 *
 * Renders a payment-method grid plus the details each method needs (cash +
 * keypad, reference, tip, wallet balance, Wompi sub-methods, credit terms) and
 * emits ONE normalized {@link PaymentSubmit}. It carries no modal chrome; wrap
 * it with `app-payment-modal` (or embed it) and drive submit from the parent.
 *
 * Zoneless + signals only. Every concern is an INDEPENDENT signal (never one
 * lumped state object). The Wompi and credit slices are delegated to child
 * components via `model()` two-way bindings.
 */
@Component({
  selector: 'app-payment-collector',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    IconComponent,
    CurrencyPipe,
    CurrencyInputDirective,
    PaymentWompiFieldsComponent,
    PaymentCreditFieldsComponent,
    StepsLineComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './payment-collector.component.html',
  styleUrl: './payment-collector.component.scss',
})
export class PaymentCollectorComponent implements OnInit {
  private readonly catalog = inject(PaymentMethodsCatalogService);
  private readonly destroyRef = inject(DestroyRef);

  // ── Data inputs ────────────────────────────────────────────────────────
  readonly amount = input.required<number>();
  readonly remainingBalance = input<number>();
  readonly paymentMethods = input<PaymentMethod[] | null>(null);
  readonly autoLoad = input<boolean>(true);
  readonly isProcessing = input<boolean>(false);
  readonly installments = input<any[]>([]);
  readonly preSelectedInstallment = input<any>(null);
  readonly customer = input<{ id: number | string } | null>(null);
  readonly manualMethods = input<ManualPaymentMethod[]>([]);
  readonly context = input<PaymentContext>('generic');
  readonly currencyDecimals = input<number>();
  readonly walletInfo = input<{ balance: number } | null>(null);
  /**
   * Seed for the initial mode on reset. Honored only when the resolved config
   * has `allowCredit` (a 'credito' seed on a credit-less config falls back to
   * 'contado'). Restores the legacy POS `settings.pos.default_payment_form`.
   */
  readonly initialMode = input<PaymentMode>('contado');
  /**
   * Presentational layout. `flat` (default) keeps the classic single-scroll
   * stack untouched; `stepped` renders an opt-in vertical sub-wizard
   * (mode → method → amount) with the keypad docked to the right.
   */
  readonly layout = input<PaymentCollectorLayout>('flat');

  // ── Capability inputs (undefined → context default) ────────────────────
  // NOTE: signal inputs cannot be `private` (NG1053), and because a parent
  // template binds them by their alias they must be public (`protected` trips
  // TS2445 on external binding). The alias is the real public knob.
  readonly allowCashIn = input<boolean | undefined>(undefined, { alias: 'allowCash' });
  readonly allowReferenceIn = input<boolean | undefined>(undefined, { alias: 'allowReference' });
  readonly allowTipIn = input<boolean | undefined>(undefined, { alias: 'allowTip' });
  readonly allowCreditIn = input<boolean | undefined>(undefined, { alias: 'allowCredit' });
  readonly allowWompiIn = input<boolean | undefined>(undefined, { alias: 'allowWompi' });
  readonly allowWalletIn = input<boolean | undefined>(undefined, { alias: 'allowWallet' });
  readonly requireCustomerIn = input<boolean | undefined>(undefined, { alias: 'requireCustomer' });
  readonly allowAmountOverrideIn = input<boolean | undefined>(undefined, { alias: 'allowAmountOverride' });
  readonly showKeypadIn = input<boolean | undefined>(undefined, { alias: 'showKeypad' });

  // ── Outputs ────────────────────────────────────────────────────────────
  readonly submit = output<PaymentSubmit>();
  readonly closed = output<void>();
  readonly methodSelected = output<PaymentMethod>();
  readonly requestCustomer = output<void>();
  readonly walletLookup = output<{ id: number | string }>();

  // ── Form controls (each concern isolated) ──────────────────────────────
  readonly cashReceivedControl = new FormControl<number>(0, { nonNullable: true });
  readonly tipControl = new FormControl<number>(0, { nonNullable: true });
  readonly amountOverrideControl = new FormControl<number | null>(null);
  readonly referenceControl = new FormControl<string>('', { nonNullable: true });

  // ── Independent state slices (signals) ──────────────────────────────────
  readonly selectedMethod = signal<PaymentMethod | null>(null);
  readonly mode = signal<PaymentMode>('contado');
  /** Active sub-step index for the `stepped` layout sub-wizard. */
  readonly subStep = signal<number>(0);
  readonly selectedInstallmentId = signal<number | null>(null);
  /** Two-way bound to the Wompi child; null = incomplete. */
  readonly wompiSlice = signal<WompiSlice | null>(null);
  /** Two-way bound to the credit child; null = no usable plan. */
  readonly creditTerms = signal<CreditTerms | null>(null);
  private readonly loadedMethods = signal<PaymentMethod[] | null>(null);

  // ── Reactive bridges (never read FormControl.value inside computeds) ────
  readonly cashReceived = toSignal(this.cashReceivedControl.valueChanges, { initialValue: 0 });
  readonly tip = toSignal(this.tipControl.valueChanges, { initialValue: 0 });
  readonly amountOverride = toSignal(this.amountOverrideControl.valueChanges, { initialValue: null });
  readonly referenceValue = toSignal(this.referenceControl.valueChanges, { initialValue: '' });

  readonly PaymentMethodType = PaymentMethodType;

  /** Synthetic method echoed back for credito-mode submits. */
  private readonly CREDIT_METHOD: PaymentMethod = {
    id: '',
    type: 'credit',
    name: 'Crédito',
    icon: 'calendar',
    enabled: true,
  };

  // ── Effective config (context defaults merged with explicit overrides) ──
  readonly config = computed<PaymentCollectorConfig>(() => {
    const base = DEFAULT_CONFIG_BY_CONTEXT[this.context()] ?? DEFAULT_CONFIG_BY_CONTEXT.generic;
    return {
      allowCash: this.allowCashIn() ?? base.allowCash,
      allowReference: this.allowReferenceIn() ?? base.allowReference,
      allowTip: this.allowTipIn() ?? base.allowTip,
      allowCredit: this.allowCreditIn() ?? base.allowCredit,
      allowWompi: this.allowWompiIn() ?? base.allowWompi,
      allowWallet: this.allowWalletIn() ?? base.allowWallet,
      requireCustomer: this.requireCustomerIn() ?? base.requireCustomer,
      allowAmountOverride: this.allowAmountOverrideIn() ?? base.allowAmountOverride,
      showKeypad: this.showKeypadIn() ?? base.showKeypad,
    };
  });

  // ── Stepped sub-wizard (presentation only; drives `layout==='stepped'`) ──
  /** When credit is exposed, sub-step 0 is the "Forma de pago" (mode) picker. */
  readonly hasModoStep = computed<boolean>(() => this.config().allowCredit);
  /** Index of the first sub-step after the (optional) mode picker. */
  readonly modoOffset = computed<number>(() => (this.hasModoStep() ? 1 : 0));
  /** Index of the "Monto" sub-step in contado mode. */
  readonly montoIndex = computed<number>(() => this.modoOffset() + 1);
  readonly subSteps = computed<StepsLineItem[]>(() => {
    const modo: StepsLineItem[] = this.hasModoStep() ? [{ label: 'Forma de pago' }] : [];
    if (this.mode() === 'credito') return [...modo, { label: 'Plan de crédito' }];
    return [...modo, { label: 'Método' }, { label: 'Monto' }];
  });

  // ── Method cards ────────────────────────────────────────────────────────
  readonly resolvedMethods = computed<PaymentMethod[]>(() => {
    const cfg = this.config();
    const base = this.paymentMethods() ?? this.loadedMethods() ?? [];
    return base.filter((m) => {
      switch (m.type) {
        case PaymentMethodType.WALLET:
          return cfg.allowWallet;
        case PaymentMethodType.WOMPI:
          return cfg.allowWompi;
        case PaymentMethodType.CASH:
          return cfg.allowCash;
        default:
          return true;
      }
    });
  });

  readonly manualCards = computed<PaymentMethod[]>(() =>
    this.manualMethods().map((m) => ({
      id: 'manual:' + m.value,
      type: m.value,
      name: m.label,
      icon: m.icon ?? 'wallet',
      enabled: true,
    })),
  );

  readonly allCards = computed<PaymentMethod[]>(() => [
    ...this.resolvedMethods(),
    ...this.manualCards(),
  ]);

  readonly installmentOptions = computed(() =>
    (this.installments() ?? []).map((inst: any) => ({
      value: Number(inst?.id ?? inst?.installment_id ?? 0),
      label: String(inst?.label ?? inst?.due_date ?? `Cuota ${inst?.number ?? inst?.id ?? ''}`),
      amount: Number(inst?.amount ?? 0),
    })),
  );

  // ── Derived amounts ──────────────────────────────────────────────────────
  readonly effectiveBase = computed<number>(
    () => this.amountOverride() ?? this.remainingBalance() ?? this.amount(),
  );

  readonly effectiveTotal = computed<number>(
    () => this.effectiveBase() + (this.config().allowTip ? this.tip() || 0 : 0),
  );

  readonly isCashSelected = computed(() => this.selectedMethod()?.type === PaymentMethodType.CASH);
  readonly isWalletSelected = computed(() => this.selectedMethod()?.type === PaymentMethodType.WALLET);
  readonly isWompiSelected = computed(() => this.selectedMethod()?.type === PaymentMethodType.WOMPI);

  readonly change = computed<number>(() =>
    this.isCashSelected() ? Math.max(0, (this.cashReceived() || 0) - this.effectiveTotal()) : 0,
  );

  readonly isCashInsufficient = computed(
    () => this.isCashSelected() && (this.cashReceived() || 0) < this.effectiveTotal(),
  );

  readonly missingAmount = computed(() =>
    this.isCashInsufficient() ? this.effectiveTotal() - (this.cashReceived() || 0) : 0,
  );

  /** True when the selected method needs a manual reference string. */
  readonly needsReference = computed<boolean>(() => {
    const method = this.selectedMethod();
    if (!method || !this.config().allowReference) return false;
    if (this.isManual(method)) return false;
    if (method.type === PaymentMethodType.WOMPI) return false;
    return method.requiresReference ?? requiresReferenceFor(String(method.type));
  });

  readonly referenceLabel = computed<string>(() => {
    const method = this.selectedMethod();
    if (!method) return 'Referencia';
    return method.referenceLabel || resolveReferenceLabel(String(method.type));
  });

  readonly walletSufficient = computed<boolean>(() => {
    const info = this.walletInfo();
    return !!info && info.balance >= this.effectiveTotal();
  });

  /** Suggested round cash amounts for quick tender. */
  readonly quickAmounts = computed<number[]>(() => {
    const total = this.effectiveTotal();
    if (total <= 0) return [];
    const roundUp = (step: number) => Math.ceil(total / step) * step;
    const candidates = [total, roundUp(1000), roundUp(5000), roundUp(10000), roundUp(20000), roundUp(50000)];
    return Array.from(new Set(candidates))
      .filter((v) => v >= total)
      .sort((a, b) => a - b)
      .slice(0, 4);
  });

  // ── The single submit gate ───────────────────────────────────────────────
  readonly canSubmit = computed<boolean>(() => {
    if (this.isProcessing()) return false;
    const cfg = this.config();

    if (this.mode() === 'credito') {
      if (!cfg.allowCredit) return false;
      if (!this.customer()) return false; // credit always needs a customer
      if (this.effectiveBase() <= 0) return false;
      return this.creditTerms() != null;
    }

    const method = this.selectedMethod();
    if (!method) return false;
    const type = method.type;

    if (type === PaymentMethodType.WALLET) {
      if (!this.customer()) return false;
      return this.walletSufficient();
    }

    if (cfg.requireCustomer && !this.customer()) return false;

    if (type === PaymentMethodType.WOMPI) {
      return this.wompiSlice() != null;
    }

    if (type === PaymentMethodType.CASH) {
      return (this.cashReceived() || 0) >= this.effectiveTotal();
    }

    if (this.needsReference()) {
      return this.referenceValue().trim().length >= 1;
    }

    return true;
  });

  constructor() {
    // Single reset effect. Tracks ONLY context(); all writes happen inside
    // untracked() so no cross-slice dependency is created.
    effect(() => {
      this.context();
      untracked(() => this.resetState());
    });
  }

  ngOnInit(): void {
    if (this.autoLoad() && !this.paymentMethods()) {
      this.catalog
        .getEnabledMethods()
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe((methods) => this.loadedMethods.set(methods));
    }
  }

  // ── Public API used by the wrapper / parent ──────────────────────────────
  triggerSubmit(): void {
    if (!this.canSubmit()) return;
    this.submit.emit(this.buildSubmit());
  }

  emitClose(): void {
    this.closed.emit();
  }

  // ── Interaction handlers ─────────────────────────────────────────────────
  setMode(mode: PaymentMode): void {
    this.mode.set(mode);
    if (mode === 'credito' && !this.customer()) {
      this.requestCustomer.emit();
    }
    // In the stepped layout, choosing the mode advances past the mode picker:
    // contado → Método, credito → Plan de crédito (both = modoOffset).
    if (this.layout() === 'stepped') this.subStep.set(this.modoOffset());
  }

  /** Jump the stepped sub-wizard to a given sub-step (clamped to range). */
  goToSubStep(i: number): void {
    if (i >= 0 && i < this.subSteps().length) this.subStep.set(i);
  }

  selectMethod(method: PaymentMethod): void {
    // Reset per-method slices so a previous method never leaks state.
    this.wompiSlice.set(null);
    this.referenceControl.setValue('');

    if (method.type === PaymentMethodType.WALLET) {
      const customer = this.customer();
      if (!customer) {
        this.requestCustomer.emit();
        return; // do not select until a customer exists
      }
      this.selectedMethod.set(method);
      this.methodSelected.emit(method);
      this.walletLookup.emit({ id: customer.id });
      this.cashReceivedControl.setValue(0);
      // A customer existed → the method was really selected: advance to Monto.
      if (this.layout() === 'stepped') this.subStep.set(this.montoIndex());
      return;
    }

    this.selectedMethod.set(method);
    this.methodSelected.emit(method);

    if (method.type === PaymentMethodType.CASH) {
      this.cashReceivedControl.setValue(this.effectiveTotal());
    } else {
      this.cashReceivedControl.setValue(0);
    }
    // In the stepped layout, picking a method advances to the Monto sub-step.
    if (this.layout() === 'stepped') this.subStep.set(this.montoIndex());
  }

  isSelected(method: PaymentMethod): boolean {
    return this.selectedMethod()?.id === method.id;
  }

  isManual(method: PaymentMethod): boolean {
    return typeof method.id === 'string' && method.id.startsWith('manual:');
  }

  iconFor(method: PaymentMethod): IconName {
    return (method.icon as IconName) || (resolvePaymentIcon(String(method.type)) as IconName);
  }

  onInstallmentChange(value: string): void {
    const id = Number(value);
    const valid = Number.isFinite(id) && id > 0;
    this.selectedInstallmentId.set(valid ? id : null);
    // Preserve the legacy abono UX: picking an installment pre-fills the amount
    // with that installment's outstanding balance (operator may still override).
    if (valid && this.config().allowAmountOverride) {
      const inst = (this.installments() ?? []).find(
        (i: any) => Number(i?.id ?? i?.installment_id) === id,
      );
      const bal = inst ? Number(inst.remaining_balance ?? inst.amount ?? 0) : 0;
      if (bal > 0) this.amountOverrideControl.setValue(bal);
    }
  }

  // ── Keypad / quick cash ──────────────────────────────────────────────────
  appendDigit(digit: number): void {
    const current = this.cashReceivedControl.value || 0;
    const next = parseFloat(`${current}${digit}`);
    this.cashReceivedControl.setValue(Number.isFinite(next) ? next : 0);
  }

  backspace(): void {
    const current = this.cashReceivedControl.value;
    if (!current) return;
    const str = current.toString();
    this.cashReceivedControl.setValue(str.length <= 1 ? 0 : parseFloat(str.slice(0, -1)) || 0);
  }

  clearCash(): void {
    this.cashReceivedControl.setValue(0);
  }

  setCash(amount: number): void {
    this.cashReceivedControl.setValue(amount);
  }

  setFullAmount(): void {
    this.cashReceivedControl.setValue(this.effectiveTotal());
  }

  // ── Internals ────────────────────────────────────────────────────────────
  private resetState(): void {
    this.selectedMethod.set(null);
    this.subStep.set(0);
    // Seed the mode from `initialMode`, but only respect a 'credito' seed when
    // credit is actually enabled; otherwise fall back to 'contado'.
    const seedCredit = this.initialMode() === 'credito' && this.config().allowCredit;
    this.mode.set(seedCredit ? 'credito' : 'contado');
    this.wompiSlice.set(null);
    this.creditTerms.set(null);
    this.cashReceivedControl.setValue(0);
    this.tipControl.setValue(0);
    this.amountOverrideControl.setValue(null);
    this.referenceControl.setValue('');
    const pre = this.preSelectedInstallment();
    const preId = pre == null ? null : Number((pre as any)?.id ?? pre);
    if (preId && preId > 0) {
      this.selectedInstallmentId.set(preId);
      // Match the legacy modal: a pre-selected installment seeds the abono
      // amount with its outstanding balance.
      const preBal = Number(
        (pre as any)?.remaining_balance ?? (pre as any)?.amount ?? 0,
      );
      this.amountOverrideControl.setValue(preBal > 0 ? preBal : null);
    } else {
      this.selectedInstallmentId.set(null);
    }
  }

  private buildSubmit(): PaymentSubmit {
    const base = this.effectiveBase();
    const cfg = this.config();
    const customerId = this.customer()?.id ?? null;

    if (this.mode() === 'credito') {
      return {
        storePaymentMethodId: null,
        methodType: 'credit',
        amount: base,
        mode: 'credito',
        credit: this.creditTerms() ?? undefined,
        installmentId: this.selectedInstallmentId() ?? undefined,
        customerId,
        method: this.selectedMethod() ?? this.CREDIT_METHOD,
      };
    }

    const method = this.selectedMethod()!;
    const manual = this.isManual(method);
    const out: PaymentSubmit = {
      storePaymentMethodId: manual ? null : Number(method.id) || null,
      methodType: method.type,
      amount: base,
      mode: 'contado',
      customerId,
      method,
    };

    if (cfg.allowTip && (this.tip() || 0) > 0) out.tip = this.tip();
    if (method.type === PaymentMethodType.CASH) {
      out.amountReceived = this.cashReceived() || 0;
      out.change = this.change();
    }
    if (this.needsReference()) out.reference = this.referenceValue().trim();
    if (method.type === PaymentMethodType.WOMPI && this.wompiSlice()) {
      out.wompi = this.wompiSlice()!;
    }
    if (this.selectedInstallmentId() != null) out.installmentId = this.selectedInstallmentId()!;

    return out;
  }
}
