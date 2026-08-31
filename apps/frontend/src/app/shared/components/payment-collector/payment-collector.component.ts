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
  type BankAccountSelectOption,
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
 * Sub-bloque del cobro que la validación resalta cuando le falta un dato.
 * `null` = el mensaje se muestra solo en el banner (el faltante no vive en un
 * bloque destacable, p. ej. el saldo de la wallet).
 */
export type PaymentFlashSection = 'method' | 'cash' | 'reference' | 'customer' | 'credit';

/** Resultado de la resolución del primer dato faltante del cobro. */
interface PaymentValidationError {
  section: PaymentFlashSection | null;
  message: string;
  /** Pide el cliente al padre: el collector no puede capturarlo por sí mismo. */
  requestCustomer?: boolean;
}

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
  /**
   * Emitted when the operator confirms the Monto sub-step via the in-panel
   * "Aceptar" button (stepped POS layout). The parent (shell) owns the timing:
   * it waits for the green collapse animation (~420ms) before advancing or
   * finalizing. Never fires in the flat layout.
   */
  readonly amountConfirmed = output<void>();

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
  /**
   * Presentational one-shot (stepped POS layout only): when the operator hits
   * "Aceptar" on the Monto sub-step, the Total/detail cards collapse into a
   * green summary row (the shared `subwizard-fill` keyframe) and
   * {@link amountConfirmed} fires. Reset on any wizard navigation and on
   * collector reset.
   */
  readonly amountCollapsed = signal<boolean>(false);
  readonly selectedInstallmentId = signal<number | null>(null);
  /** Two-way bound to the Wompi child; null = incomplete. */
  readonly wompiSlice = signal<WompiSlice | null>(null);
  /** Two-way bound to the credit child; null = no usable plan. */
  readonly creditTerms = signal<CreditTerms | null>(null);
  private readonly loadedMethods = signal<PaymentMethod[] | null>(null);

  // ── QUI-728 — multi-cuenta bancaria para transferencia ───────────────────
  /**
   * Cuentas bancarias configuradas para el método `bank_transfer` seleccionado.
   * Se derivan del `custom_config.accounts` del propio método (shape nuevo
   * `{ accounts: BankAccountRef[] }`), nunca de un endpoint contable.
   */
  readonly bankAccounts = signal<BankAccountSelectOption[]>([]);
  /**
   * Clave estable de la cuenta elegida ({@link BankAccountSelectOption.key}). Es lo
   * que gobierna el `<select>` y la compuerta de cobro, NUNCA el id: una cuenta
   * migrada del legado no tiene id y con el id como valor quedaba inelegible.
   */
  readonly selectedBankAccountKey = signal<string | null>(null);
  /** FK `bank_accounts.id` de la cuenta elegida; `null` si la entrada es legado. */
  readonly selectedBankAccountId = signal<number | null>(null);

  /**
   * True once the operator manually edits the tendered cash (keypad / typing),
   * so the re-seed effect stops overwriting their amount. Reset on method change
   * and on collector reset (context change).
   */
  readonly manuallyEditedCash = signal<boolean>(false);
  /** Guards programmatic cash writes so they don't flip {@link manuallyEditedCash}. */
  private readonly suppressCashEdit = signal<boolean>(false);

  // ── Validation flash ────────────────────────────────────────────────────
  /**
   * Dato faltante que se está señalando ahora mismo (destello de 3s). El CTA del
   * cobro NUNCA se deshabilita: se pulsa, y si falta algo el collector lo nombra
   * — un botón habilitado que no responde es un defecto propio (QUI-561).
   */
  readonly flashSection = signal<PaymentFlashSection | null>(null);
  readonly flashMessage = signal<string>('');
  private flashTimeout: ReturnType<typeof setTimeout> | null = null;

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
        case PaymentMethodType.BANK_TRANSFER:
          // QUI-728 — destado vacío: solo ocultamos la opción cuando CONOCEMOS
          // el `accounts` del método y está vacío. Si la lista no está
          // disponible (método sin `original`, back-compat), se muestra y el
          // destado vacío se maneja inline al seleccionarlo.
          {
            const accounts = (m.original as any)?.custom_config?.accounts;
            if (Array.isArray(accounts) && accounts.length === 0) return false;
            return true;
          }
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
  readonly isBankTransferSelected = computed(
    () => this.selectedMethod()?.type === PaymentMethodType.BANK_TRANSFER,
  );

  /**
   * Cuentas configuradas del método `bank_transfer` en uso (seleccionado). Cada
   * método trae su propio `custom_config.accounts`; solo interesa el del método
   * activo.
   */
  readonly selectedBankAccounts = computed<BankAccountSelectOption[]>(() =>
    this.bankAccounts(),
  );
  /** Conocimiento de que el método `bank_transfer` activo tiene >= 1 cuenta. */
  readonly bankTransferConfigured = computed<boolean>(
    () => this.selectedBankAccounts().length > 0,
  );

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
    // Contra entrega no captura referencia: la orden queda pending.
    if (method.type === PaymentMethodType.CASH_ON_DELIVERY) return false;
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
  /**
   * Gate del COBRO real: única puerta de {@link triggerSubmit}. Exige todo lo de
   * {@link canConfirmAmount} MÁS el cliente cuando `config().requireCustomer`.
   */
  readonly canSubmit = computed<boolean>(() => this.evaluateGate(true));

  /**
   * Gate de la CONFIRMACIÓN DE MONTO (sub-paso "Monto" del layout stepped).
   * Idéntico a {@link canSubmit} salvo que NO aplica `config().requireCustomer`:
   * el cliente obligatorio se exige al cobrar, no al confirmar el monto, porque
   * el orden de pasos del POS puede capturarlo después (QUI-561).
   *
   * Wallet y crédito son la excepción y sí siguen exigiendo cliente aquí: su
   * monto se DERIVA del cliente (saldo disponible / plan de cuotas), así que sin
   * cliente no hay monto que confirmar.
   */
  readonly canConfirmAmount = computed<boolean>(() => this.evaluateGate(false));

  /**
   * Cuerpo compartido por ambos gates — misma validación, una sola fuente.
   * `requireCustomerCheck` gobierna SOLO la guarda genérica
   * `config().requireCustomer`; las guardas de cliente propias de wallet y
   * crédito son incondicionales.
   */
  private evaluateGate(requireCustomerCheck: boolean): boolean {
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

    if (requireCustomerCheck && cfg.requireCustomer && !this.customer()) return false;

    if (type === PaymentMethodType.WOMPI) {
      return this.wompiSlice() != null;
    }

    if (type === PaymentMethodType.CASH) {
      return (this.cashReceived() || 0) >= this.effectiveTotal();
    }

    if (type === PaymentMethodType.CASH_ON_DELIVERY) {
      // Pago contra entrega: la orden queda pending; el processor backend
      // devuelve 'pending'. No exige monto recibido ni referencia.
      return true;
    }

    if (type === PaymentMethodType.BANK_TRANSFER) {
      // QUI-728 — sin cuentas configuradas el cobro debe bloquearse (destado
      // vacío), y aun con cuentas el cajero debe elegir una. Se suma a la
      // referencia: ambas se exigen.
      if (this.selectedBankAccounts().length === 0) return false;
      if (this.selectedBankAccountKey() == null) return false;
    }

    if (this.needsReference()) {
      return this.referenceValue().trim().length >= 1;
    }

    return true;
  }

  constructor() {
    // Single reset effect. Tracks ONLY context(); all writes happen inside
    // untracked() so no cross-slice dependency is created.
    effect(() => {
      this.context();
      untracked(() => this.resetState());
    });

    // Flag genuine operator edits to the cash amount (keypad / typing). Skips
    // programmatic writes guarded by suppressCashEdit. Runs outside any reactive
    // context, so a plain subscription (not an effect) is correct here.
    this.cashReceivedControl.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        if (this.suppressCashEdit()) return;
        this.manuallyEditedCash.set(true);
      });

    // Re-seed the tendered cash with the live total whenever effectiveTotal()
    // changes (e.g. a delivery flete edit upstream lifts amountOverride) — but
    // only while CASH is selected and the operator hasn't manually overridden the
    // amount. Tracks ONLY effectiveTotal(); every cash read/write is inside
    // untracked() and reads the raw control value (never the cashReceived signal),
    // so the effect never re-runs from its own write.
    effect(() => {
      const total = this.effectiveTotal();
      untracked(() => {
        if (this.selectedMethod()?.type !== PaymentMethodType.CASH) return;
        if (this.manuallyEditedCash()) return;
        if ((this.cashReceivedControl.value ?? 0) !== total) {
          this.setCashProgrammatic(total);
        }
      });
    });

    this.destroyRef.onDestroy(() => {
      if (this.flashTimeout) clearTimeout(this.flashTimeout);
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

  /**
   * Nombra el primer dato faltante del cobro y lo destella 3s bajo el sub-paso
   * activo. La invoca el padre cuando un CTA habilitado no pudo avanzar, para que
   * el POS diga QUÉ falta en vez de quedarse mudo (QUI-561). No-op si no falta
   * nada o si el cobro está en curso.
   */
  flashValidation(): void {
    const error = this.getFirstValidationError();
    if (!error) return;
    this.flashSection.set(error.section);
    this.flashMessage.set(error.message);
    // Wallet/crédito sin cliente: el collector no captura clientes, así que se lo
    // pide al padre por el mismo escape que ya usan setMode('credito') y
    // selectMethod(WALLET).
    if (error.requestCustomer) this.requestCustomer.emit();
    if (this.flashTimeout) clearTimeout(this.flashTimeout);
    this.flashTimeout = setTimeout(() => {
      this.flashSection.set(null);
      this.flashMessage.set('');
    }, 3000);
  }

  // ── Interaction handlers ─────────────────────────────────────────────────
  setMode(mode: PaymentMode): void {
    this.amountCollapsed.set(false);
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
    this.amountCollapsed.set(false);
    if (i >= 0 && i < this.subSteps().length) this.subStep.set(i);
  }

  /**
   * Stepped layout: confirm the Monto sub-step. Guarded por
   * {@link canConfirmAmount} — NO por `canSubmit` — porque el cliente obligatorio
   * se exige al cobrar, no al confirmar el monto. Collapses the Total/detail cards
   * (shared green one-shot fill) and emits {@link amountConfirmed} so the shell
   * advances/finalizes after the animation.
   */
  confirmAmount(): void {
    if (!this.canConfirmAmount()) return;
    this.amountCollapsed.set(true);
    this.amountConfirmed.emit();
  }

  /** Re-expand the Monto cards after a collapse (click on the summary row). */
  expandAmount(): void {
    this.amountCollapsed.set(false);
  }

  selectMethod(method: PaymentMethod): void {
    this.amountCollapsed.set(false);
    // Reset per-method slices so a previous method never leaks state.
    this.wompiSlice.set(null);
    this.referenceControl.setValue('');
    // QUI-728 — la cuenta bancaria elegida pertenece al método activo; al cambiar
    // de método se limpia y se recarga desde el `custom_config.accounts` del nuevo.
    this.selectedBankAccountKey.set(null);
    this.selectedBankAccountId.set(null);
    this.bankAccounts.set(this.bankAccountsFor(method));
    // A method switch clears any prior manual cash override.
    this.manuallyEditedCash.set(false);

    if (method.type === PaymentMethodType.WALLET) {
      const customer = this.customer();
      if (!customer) {
        this.requestCustomer.emit();
        return; // do not select until a customer exists
      }
      this.selectedMethod.set(method);
      this.methodSelected.emit(method);
      this.walletLookup.emit({ id: customer.id });
      this.setCashProgrammatic(0);
      // A customer existed → the method was really selected: advance to Monto.
      if (this.layout() === 'stepped') this.subStep.set(this.montoIndex());
      return;
    }

    this.selectedMethod.set(method);
    this.methodSelected.emit(method);

    if (method.type === PaymentMethodType.CASH) {
      this.setCashProgrammatic(this.effectiveTotal());
    } else {
      this.setCashProgrammatic(0);
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

  /**
   * QUI-728 — extrae las cuentas bancarias del `custom_config.accounts` del
   * método. El método `bank_transfer` (shape nuevo `{ accounts: [...] }`) trae
   * su propia lista; si el método no expone `original` o el shape es legacy,
   * devuelve [].
   */
  bankAccountsFor(method: PaymentMethod | null): BankAccountSelectOption[] {
    const cfg = (method?.original as any)?.custom_config;
    const list = Array.isArray(cfg?.accounts) ? cfg.accounts : [];
    return list
      .filter((a: any) => a && typeof a === 'object')
      .map((raw: any, index: number) => this.normalizeBankAccount(raw, index));
  }

  /**
   * Aplana las TRES formas que conviven en `custom_config.accounts` a una sola
   * opción con `key` estable:
   *
   * 1. `{ bank_account_id, … }` — la forma nueva, con FK real.
   * 2. `{ legacy: { bank_name, account_number, … } }` — la que declara DB-04.
   * 3. `{ bank_name, account_number, legacy: true }` — la que la migración
   *    dejó realmente en producción: objeto PLANO, sin anidar y sin id.
   *
   * La tercera es la que rompía el selector: sin `id`, la opción se pintaba con
   * `value="undefined"`, la selección se coaccionaba a `null` y la compuerta de
   * cobro no abría nunca. Se resuelve aquí, sin migración de datos: una entrada
   * sin FK se cobra igual y el pago aparece en "Pagos sin asignar" (E.2).
   */
  private normalizeBankAccount(raw: any, index: number): BankAccountSelectOption {
    const nested =
      raw.legacy && typeof raw.legacy === 'object' ? raw.legacy : raw;
    const rawId = raw.bank_account_id ?? raw.id ?? nested.bank_account_id ?? nested.id;
    const id = Number(rawId);
    const hasId = Number.isFinite(id) && id > 0;
    return {
      key: hasId ? `id:${id}` : `legacy:${index}`,
      id: hasId ? id : null,
      name: nested.name ?? nested.account_holder ?? null,
      bank_name: nested.bank_name,
      account_number: nested.account_number,
    };
  }

  onBankAccountSelect(event: Event): void {
    const key = (event.target as HTMLSelectElement).value;
    const match = this.selectedBankAccounts().find((a) => a.key === key);
    this.selectedBankAccountKey.set(match ? match.key : null);
    this.selectedBankAccountId.set(match?.id ?? null);
  }

  /** Etiqueta visible de una cuenta; nunca cae en `undefined · undefined`. */
  bankAccountLabel(account: BankAccountSelectOption): string {
    const parts = [account.bank_name, account.account_number, account.name].filter(
      (p): p is string => typeof p === 'string' && p.trim().length > 0,
    );
    return parts.length ? parts.join(' · ') : 'Cuenta bancaria';
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
  /**
   * Resuelve el PRIMER dato faltante del cobro, en orden de prioridad, para que
   * el operador sepa qué corregir. Espeja las guardas de {@link evaluateGate}: si
   * el gate está cerrado, alguna rama de aquí debe nombrar el motivo.
   */
  private getFirstValidationError(): PaymentValidationError | null {
    // Cobro en curso: el gate está cerrado a propósito, no falta ningún dato.
    if (this.isProcessing()) return null;

    if (this.mode() === 'credito') {
      // Crédito no elige método; el plan se DERIVA del cliente, así que el
      // cliente es el primer faltante posible.
      if (!this.customer()) {
        return {
          section: 'customer',
          message: 'Selecciona un cliente para este método',
          requestCustomer: true,
        };
      }
      if (this.effectiveBase() <= 0) {
        return { section: null, message: 'El monto a financiar debe ser mayor a cero' };
      }
      if (this.creditTerms() == null) {
        return { section: 'credit', message: 'Completa el plan de crédito' };
      }
      return this.unnamedGateError();
    }

    if (!this.selectedMethod()) {
      return { section: 'method', message: 'Elige un método de pago' };
    }

    if (this.isCashInsufficient()) {
      return { section: 'cash', message: 'El efectivo recibido no cubre el total' };
    }

    // QUI-728 — destado vacío del cajero: método habilitado pero sin cuentas
    // configuradas. Nunca un `<select>` vacío sin explicación.
    if (this.isBankTransferSelected()) {
      if (this.selectedBankAccounts().length === 0) {
        return {
          section: 'reference',
          message: 'Sin cuentas configuradas. Contacta al administrador.',
        };
      }
      if (this.selectedBankAccountKey() == null) {
        return {
          section: 'reference',
          message: 'Selecciona la cuenta bancaria de destino.',
        };
      }
    }

    if (this.needsReference() && this.referenceValue().trim().length < 1) {
      return { section: 'reference', message: 'Ingresa la referencia del pago' };
    }

    if (this.isWalletSelected()) {
      if (!this.customer()) {
        return {
          section: 'customer',
          message: 'Selecciona un cliente para este método',
          requestCustomer: true,
        };
      }
      if (!this.walletSufficient()) {
        return { section: null, message: 'El saldo de la wallet no cubre el total' };
      }
    }

    if (this.isWompiSelected() && this.wompiSlice() == null) {
      return { section: null, message: 'Completa los datos del pago con Wompi' };
    }

    // Cliente exigido por configuración (ventas anónimas deshabilitadas). Se
    // nombra el dato pero NO se emite requestCustomer: aquí el dueño de la
    // captura es el paso Cliente del flujo, y forzar el modal desde el collector
    // competiría con esa navegación.
    if (this.config().requireCustomer && !this.customer()) {
      return { section: 'customer', message: 'Selecciona un cliente para completar la venta' };
    }

    return this.unnamedGateError();
  }

  /**
   * Red de seguridad: el gate sigue cerrado por un motivo que ninguna rama
   * anterior nombró. Se dice algo genérico antes que dejar el CTA mudo.
   */
  private unnamedGateError(): PaymentValidationError | null {
    if (this.canSubmit()) return null;
    return { section: null, message: 'Revisa los datos del pago para continuar' };
  }

  /** Write the cash control programmatically without flagging a manual edit. */
  private setCashProgrammatic(value: number): void {
    this.suppressCashEdit.set(true);
    this.cashReceivedControl.setValue(value);
    this.suppressCashEdit.set(false);
  }

  private resetState(): void {
    // Un cambio de contexto invalida el destello: nunca debe sobrevivir al reset.
    if (this.flashTimeout) clearTimeout(this.flashTimeout);
    this.flashSection.set(null);
    this.flashMessage.set('');
    this.selectedMethod.set(null);
    this.subStep.set(0);
    this.amountCollapsed.set(false);
    this.manuallyEditedCash.set(false);
    // Seed the mode from `initialMode`, but only respect a 'credito' seed when
    // credit is actually enabled; otherwise fall back to 'contado'.
    const seedCredit = this.initialMode() === 'credito' && this.config().allowCredit;
    this.mode.set(seedCredit ? 'credito' : 'contado');
    this.wompiSlice.set(null);
    this.creditTerms.set(null);
    this.setCashProgrammatic(0);
    this.tipControl.setValue(0);
    this.amountOverrideControl.setValue(null);
    this.referenceControl.setValue('');
    // QUI-728 — limpiar el estado de cuenta bancaria al resetear el collector.
    this.selectedBankAccountKey.set(null);
    this.selectedBankAccountId.set(null);
    this.bankAccounts.set([]);
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
    // QUI-728 — cuenta bancaria de destino (bank_transfer). El padre lo traduce
    // a `CreatePosPaymentDto.bank_account_id` / `CreatePaymentDto.bank_account_id`.
    if (method.type === PaymentMethodType.BANK_TRANSFER) {
      // Solo viaja cuando hay FK real. Una cuenta legado (sin fila en
      // `bank_accounts`) se cobra igual y el pago queda sin asignar: mandar un
      // id inventado lo rechazaría el gateway con ERR-04.
      out.bankAccountId = this.selectedBankAccountId() ?? undefined;
    }
    if (method.type === PaymentMethodType.WOMPI && this.wompiSlice()) {
      out.wompi = this.wompiSlice()!;
    }
    if (this.selectedInstallmentId() != null) out.installmentId = this.selectedInstallmentId()!;

    return out;
  }
}
