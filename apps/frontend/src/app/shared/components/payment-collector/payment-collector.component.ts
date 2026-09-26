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
import { FormArray, FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { map, startWith } from 'rxjs';

import { IconComponent } from '../icon/icon.component';
import type { IconName } from '../icon/icons.registry';
import { CurrencyInputDirective } from '../../directives/currency-input.directive';
import { CurrencyFormatService, CurrencyPipe } from '../../pipes/currency';
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
  type PaymentLeg,
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
 * Controles tipados de un tramo multi-tender (5a2). Los montos viajan en
 * FormControls para que la UI de tramos bindee inputs `[currency]`; todo se
 * lee a través de la señal `legs`, nunca desde los controles directamente.
 */
interface MultiLegFormControls {
  storePaymentMethodId: FormControl<number>;
  amount: FormControl<number>;
  amountReceived: FormControl<number | null>;
  reference: FormControl<string>;
  bankAccountId: FormControl<number | null>;
}

/**
 * Fila cruda de valor de un grupo de tramo. Todo-optional porque
 * `FormArray.valueChanges` emite `Partial` (ver TS2345 del watch).
 */
interface MultiLegRowValue {
  storePaymentMethodId?: number | null;
  amount?: number | null;
  amountReceived?: number | null;
  reference?: string | null;
  bankAccountId?: number | null;
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
  /**
   * T1 — símbolo de la moneda del tenant (no del locale del browser).
   * Mismo origen que el resto del repo: el CurrencyFormatService
   * resuelve primero la moneda del dominio y luego la de la tienda.
   * El sufijo visible del input de propina lo consume la plantilla
   * via el computed `tipSuffix` (no cableamos `$` aquí).
   */
  private readonly currencyFormat = inject(CurrencyFormatService);
  readonly currencySymbol = this.currencyFormat.currencySymbol;

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
  /** 5a2 — split-contado (legs) mode. Undefined → context default. */
  readonly allowMultiTenderIn = input<boolean | undefined>(undefined, { alias: 'allowMultiTender' });
  /** Incremented by parent shells to explicitly trigger a state reset (e.g. on intent flip) */
  readonly paymentResetKey = input<number>(0);

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

  // T1 — metadatos de la propina. `tipControl` lleva el monto crudo
  // que tipea el operador; `tipType` decide si ese valor se interpreta
  // como porcentaje (0-100) o como monto libre. `tipWaiterId` es
  // opcional: el mostrador sin meseros puede cobrar sin este dato.
  // Los tres viven como signals independientes (zoneless) y se
  // serializan al PaymentSubmit via `buildSubmit` con camelCase
  // (tipType / tipValue / tipWaiterId); el consumidor los traduce
  // a snake_case al backend.
  readonly tipType = signal<'percentage' | 'fixed'>('fixed');
  readonly tipWaiterId = signal<number | null>(null);
  /**
   * Monto final que viaja en `PaymentSubmit.tip` (y se espeja en
   * `tipValue` cuando es 'fixed'). Cuando `tipType='percentage'`,
   * el porcentaje se resuelve contra `effectiveBase()` — la base
   * gravable real (override ?? restante ?? amount) — y el resultado
   * redondeado a 2 decimales es el monto que se persiste. El %
   * crudo se descarta después del cálculo (regla del dueño: la
   * propina pactada no puede moverse si cambia el subtotal).
   */
  readonly tipAmount = computed<number>(() => {
    const raw = this.tip() || 0;
    if (raw <= 0) return 0;
    if (this.tipType() === 'percentage') {
      return Math.round((this.effectiveBase() * raw) / 100 * 100) / 100;
    }
    return Math.round(raw * 100) / 100;
  });
  /**
   * Texto que muestra el input según el modo. En 'percentage' el
   * placeholder es `0 %`; en 'fixed' queda `0`. El sufijo visible
   * al lado del input (`%` vs símbolo de moneda) lo consume la
   * plantilla via computed.
   */
  readonly tipSuffix = computed<string>(() =>
    this.tipType() === 'percentage' ? '%' : this.currencySymbol(),
  );

  /**
   * T1 — cambio del id del mesero desde el input. Acepta string
   * crudo del DOM (`$any($event.target).value`) y normaliza a
   * `number | null`: vacío → null, valor no-numérico → null,
   * valor <= 0 → null. El mesero es opcional, por lo que un valor
   * inválido NO bloquea el submit; simplemente queda sin atribución.
   */
  onTipWaiterInput(value: string | number | null | undefined): void {
    if (value === null || value === undefined || value === '') {
      this.tipWaiterId.set(null);
      return;
    }
    const n = Number(value);
    this.tipWaiterId.set(Number.isFinite(n) && n > 0 ? n : null);
  }

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
      allowMultiTender: this.allowMultiTenderIn() ?? base.allowMultiTender,
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
    (this.installments() ?? []).map((inst: any, index: number) => {
      const id = Number(inst?.id ?? inst?.installment_id ?? 0);
      const st = String(inst?.state ?? inst?.status ?? '').toLowerCase();
      const isPaid = st === 'paid' || Boolean(inst?.paid_at);
      const isForgiven = st === 'forgiven';
      const isPartial = st === 'partial';
      const disabled = isPaid || isForgiven;

      let label = inst?.label;
      if (!label) {
        const num = inst?.installment_number ?? inst?.number ?? index + 1;
        const parts: string[] = [`Cuota ${num}`];

        const dateStr = this.formatInstallmentDate(inst?.due_date ?? inst?.date);
        if (dateStr) {
          parts.push(dateStr);
        }

        const rawAmount =
          inst?.remaining_balance != null && Number(inst.remaining_balance) > 0
            ? Number(inst.remaining_balance)
            : Number(inst?.amount ?? 0);

        const formattedAmount = this.currencyFormat.format(rawAmount);

        let amountText = `(${formattedAmount})`;
        if (isPaid) {
          amountText = `(${formattedAmount} - Pagada)`;
        } else if (isForgiven) {
          amountText = `(${formattedAmount} - Condonada)`;
        } else if (isPartial) {
          amountText = `(${formattedAmount} pendiente)`;
        }

        label = `${parts.join(' - ')} ${amountText}`;
      }

      return {
        value: id,
        label,
        amount: Number(inst?.amount ?? 0),
        disabled,
      };
    }),
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

  // ── Multi-tender legs (5a2) ──────────────────────────────────────────────
  // Split-contado mode: the total is covered by 1..maxMultiLegs direct-method
  // legs instead of a single method. Active only while `multiEnabled()`; the
  // single-method state (selectedMethod, cash control, …) is left untouched so
  // toggling multi off restores it. Gate + submit read ONLY the `legs` signal.
  readonly multiEnabled = signal<boolean>(false);
  /** Backend cap mirrored: `payments[]` accepts 2..5 legs (`@ArrayMaxSize(5)`). */
  readonly maxMultiLegs = 5;

  /**
   * Per-leg controls. Created/destroyed ONLY from event-handler methods
   * (`setMultiEnabled`/`addLeg`/`removeLeg`/`resetState`, the last inside
   * `untracked`) — never inside a computed/effect body.
   */
  readonly legsForm = new FormArray<FormGroup<MultiLegFormControls>>([]);

  /** Multi legs derived from the form (method resolved against the catalog). */
  readonly legs = toSignal(
    this.legsForm.valueChanges.pipe(
      startWith(this.legsForm.getRawValue()),
      map((rows: MultiLegRowValue[]) => rows.map((row) => this.toPaymentLeg(row))),
    ),
    { initialValue: [] as PaymentLeg[] },
  );

  /** Σ of leg amounts (display; validity compares in cents via `remaining`). */
  readonly legsTotal = computed<number>(() =>
    this.legs().reduce((sum, leg) => sum + (Number(leg.amount) || 0), 0),
  );

  /**
   * Signed remainder in favor of the total: >0 = "Falta", <0 = "Sobra", 0 =
   * exact. Computed in cents so float dust never blocks the gate.
   */
  readonly remaining = computed<number>(
    () => (this.toCents(this.effectiveTotal()) - this.toCents(this.legsTotal())) / 100,
  );

  /** Multi gate body: non-empty, ≤ cap, Σ == total, every leg valid on its own. */
  readonly isMultiValid = computed<boolean>(() => {
    const legs = this.legs();
    if (legs.length === 0 || legs.length > this.maxMultiLegs) return false;
    if (this.remaining() !== 0) return false;
    if (legs.filter((l) => l.methodType === PaymentMethodType.CASH).length > 1) return false;
    return legs.every((leg) => this.isLegValid(leg));
  });

  /**
   * Catalog methods allowed as legs: the direct five (cash, card,
   * bank_transfer, voucher, paypal) with a numeric row id. Cash drops out once
   * any leg uses it (single-cash rule); per-leg pickers use
   * {@link directMethodsForLeg} so a leg keeps its own method selectable.
   */
  readonly directMethods = computed<PaymentMethod[]>(() => {
    const cashUsed = this.legs().some((l) => l.methodType === PaymentMethodType.CASH);
    return this.resolvedMethods().filter((m) => {
      if (this.methodRowId(m) == null) return false;
      switch (m.type) {
        case PaymentMethodType.CASH:
          return !cashUsed;
        case PaymentMethodType.CARD:
        case PaymentMethodType.BANK_TRANSFER:
        case PaymentMethodType.VOUCHER:
        case PaymentMethodType.PAYPAL:
          return true;
        default:
          return false;
      }
    });
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

    // 5a2 — multi-tender contado: the legs carry the whole validation.
    if (this.multiEnabled()) {
      if (!cfg.allowMultiTender) return false;
      if (requireCustomerCheck && cfg.requireCustomer && !this.customer()) return false;
      return this.isMultiValid();
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
    // Single reset effect. Tracks context() and paymentResetKey(); all writes happen inside
    // untracked() so no cross-slice dependency is created.
    effect(() => {
      this.context();
      this.paymentResetKey();
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

    // 5a2 — late seed of leg 1: when multi was enabled before the catalog
    // arrived (autoLoad), the first leg appears as soon as methods exist.
    effect(() => {
      if (!this.multiEnabled()) return;
      const methodCount = this.directMethods().length;
      untracked(() => {
        if (this.legsForm.length === 0 && methodCount > 0) this.seedFirstLeg();
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

  /**
   * CP-pos-checkout-enter-focus (step A.1) — Enter dedicado del collector,
   * invocado desde los inputs del sub-paso Monto/detalle con stopPropagation
   * para que el shell no lo procese dos veces. Un Enter = máximo un submit:
   * stepped+credito → submit directo (o flash); stepped contado pre-Monto →
   * mismo avance que `advanceSubStepOrConfirm` del payment-step (Forma→
   * modoOffset, Método con método elegido→montoIndex, Método sin elegir→
   * flash); stepped en Monto → confirmAmount (o flash); flat → submit (o flash).
   */
  handleEnter(event?: Event): void {
    void event;
    if (this.layout() === 'stepped') {
      if (this.mode() === 'credito') {
        if (this.canSubmit()) this.triggerSubmit();
        else this.flashValidation();
        return;
      }
      if (this.subStep() < this.montoIndex()) {
        if (this.subStep() < this.modoOffset()) {
          this.goToSubStep(this.modoOffset());
          // 5c — en multi el paso Método muestra tramos y selectedMethod() es
          // residual: el avance exige tramos (la validez total sigue en los gates).
        } else if (this.multiEnabled() ? this.legs().length === 0 : !this.selectedMethod()) {
          this.flashValidation();
        } else {
          this.goToSubStep(this.montoIndex());
        }
        return;
      }
      if (this.canConfirmAmount()) this.confirmAmount();
      else this.flashValidation();
      return;
    }
    if (this.canSubmit()) this.triggerSubmit();
    else this.flashValidation();
  }

  selectMethod(method: PaymentMethod, opts?: { advance?: boolean }): void {
    const advance = opts?.advance !== false;
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
      if (advance && this.layout() === 'stepped') this.subStep.set(this.montoIndex());
      return;
    }

    this.selectedMethod.set(method);
    this.methodSelected.emit(method);

    if (method.type === PaymentMethodType.CASH) {
      this.setCashProgrammatic(this.effectiveTotal());
    } else {
      this.setCashProgrammatic(0);
    }
    // In the stepped layout, picking a method advances to the Monto sub-step,
    // unless the caller preselects a default (advance:false keeps Método visible).
    if (advance && this.layout() === 'stepped') this.subStep.set(this.montoIndex());
  }

  isSelected(method: PaymentMethod): boolean {
    return this.selectedMethod()?.id === method.id;
  }

  isManual(method: PaymentMethod): boolean {
    return typeof method.id === 'string' && method.id.startsWith('manual:');
  }

  // ── Multi-tender legs (public API for the legs UI) ───────────────────────
  /**
   * Enter/exit split mode. Entering seeds leg 1 with the live total (cash
   * preferred, received pre-filled); exiting discards the legs. Ignored unless
   * the consumer passed `allowMultiTender`.
   */
  setMultiEnabled(on: boolean): void {
    if (on && !this.config().allowMultiTender) return;
    if (on === this.multiEnabled()) return;
    this.multiEnabled.set(on);
    if (on) this.seedFirstLeg();
    else this.legsForm.clear();
  }

  /** Append a leg pre-filled with the remaining balance (no-op at the cap). */
  addLeg(): void {
    if (!this.multiEnabled()) return;
    if (this.legsForm.length >= this.maxMultiLegs) return;
    const options = this.directMethods();
    if (options.length === 0) return;
    const method = options[0];
    const rowId = this.methodRowId(method);
    if (rowId == null) return;
    const amount = Math.max(0, this.remaining());
    this.legsForm.push(
      this.createLegGroup({
        storePaymentMethodId: rowId,
        amount,
        amountReceived: method.type === PaymentMethodType.CASH ? amount : null,
      }),
    );
  }

  /** Drop leg `index`. The last leg cannot be removed (toggle multi off). */
  removeLeg(index: number): void {
    if (!this.multiEnabled()) return;
    if (this.legsForm.length <= 1) return;
    if (index < 0 || index >= this.legsForm.length) return;
    this.legsForm.removeAt(index);
  }

  /** Group accessor for `[formGroup]` binding in the legs UI. */
  legGroup(index: number): FormGroup<MultiLegFormControls> | null {
    return this.legGroupOrNull(index);
  }

  /** Catalog method behind leg `index` (null when unresolved). */
  legMethod(index: number): PaymentMethod | null {
    const group = this.legGroupOrNull(index);
    if (!group) return null;
    return this.legMethodById(group.controls.storePaymentMethodId.value);
  }

  /**
   * Method options for the leg-`index` picker: {@link directMethods} plus the
   * leg's own method when cash-exclusion would hide it.
   */
  directMethodsForLeg(index: number): PaymentMethod[] {
    const ownId = this.legGroupOrNull(index)?.controls.storePaymentMethodId.value;
    const legs = this.legs();
    const cashUsedElsewhere = legs.some(
      (l, i) => i !== index && l.methodType === PaymentMethodType.CASH,
    );
    return this.resolvedMethods().filter((m) => {
      if (this.methodRowId(m) == null) return false;
      switch (m.type) {
        case PaymentMethodType.CASH:
          return !cashUsedElsewhere || this.methodRowId(m) === ownId;
        case PaymentMethodType.CARD:
        case PaymentMethodType.BANK_TRANSFER:
        case PaymentMethodType.VOUCHER:
        case PaymentMethodType.PAYPAL:
          return true;
        default:
          return false;
      }
    });
  }

  /**
   * Switch the method of leg `index`. Amount is kept; received/reference/bank
   * account reset (same contract as {@link selectMethod}); switching TO cash
   * pre-fills received with the leg amount.
   */
  setLegMethod(index: number, method: PaymentMethod): void {
    const group = this.legGroupOrNull(index);
    if (!group) return;
    const rowId = this.methodRowId(method);
    if (rowId == null) return;
    const amount = group.controls.amount.value;
    group.setValue({
      storePaymentMethodId: rowId,
      amount,
      amountReceived: method.type === PaymentMethodType.CASH ? amount : null,
      reference: '',
      bankAccountId: null,
    });
  }

  /** Write the leg amount (clamped at zero; negatives never validate). */
  setLegAmount(index: number, amount: number): void {
    const group = this.legGroupOrNull(index);
    if (!group) return;
    group.controls.amount.setValue(Math.max(0, Number(amount) || 0));
  }

  /** Write the cash tendered on leg `index` (cash legs only, clamped at zero). */
  setLegReceived(index: number, amount: number): void {
    const group = this.legGroupOrNull(index);
    if (!group) return;
    group.controls.amountReceived.setValue(Math.max(0, Number(amount) || 0));
  }

  /** Write the manual reference of leg `index` (trimmed on read). */
  setLegReference(index: number, reference: string): void {
    const group = this.legGroupOrNull(index);
    if (!group) return;
    group.controls.reference.setValue(String(reference ?? ''));
  }

  /**
   * Pick the destination bank account of leg `index` by stable key (same
   * semantics as {@link onBankAccountSelect}). Only real-FK accounts are
   * eligible as legs (see {@link legBankAccounts}); legacy entries resolve to
   * null and keep the gate closed.
   */
  setLegBankAccount(index: number, key: string | null): void {
    const group = this.legGroupOrNull(index);
    if (!group) return;
    const match = key == null ? undefined : this.legBankAccounts(index).find((a) => a.key === key);
    group.controls.bankAccountId.setValue(match?.id ?? null);
  }

  /**
   * Destination accounts eligible for leg `index`: the leg method's
   * `custom_config.accounts` restricted to entries with a real FK. Legs cannot
   * carry the legacy key-only shape (`PaymentLeg` has no key field), so legacy
   * accounts are not offered in multi.
   */
  legBankAccounts(index: number): BankAccountSelectOption[] {
    const method = this.legMethod(index);
    if (!method || method.type !== PaymentMethodType.BANK_TRANSFER) return [];
    return this.bankAccountsFor(method).filter((a) => a.id != null);
  }

  /** True when the leg's method needs a manual reference string. */
  legNeedsReference(leg: PaymentLeg): boolean {
    if (!this.config().allowReference) return false;
    const method = this.legMethodById(leg.storePaymentMethodId);
    if (method) return method.requiresReference ?? requiresReferenceFor(leg.methodType);
    return requiresReferenceFor(leg.methodType);
  }

  /** Reference input label for the leg (method override or canonical label). */
  legReferenceLabel(leg: PaymentLeg): string {
    const method = this.legMethodById(leg.storePaymentMethodId);
    if (method?.referenceLabel) return method.referenceLabel;
    return resolveReferenceLabel(leg.methodType);
  }

  /** Change owed back on the leg (cash legs only, otherwise zero). */
  legChange(leg: PaymentLeg): number {
    if (leg.methodType !== PaymentMethodType.CASH) return 0;
    return Math.max(0, (Number(leg.amountReceived) || 0) - (Number(leg.amount) || 0));
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

  formatInstallmentDate(rawDate?: string | Date | null): string {
    if (!rawDate) return '';
    try {
      const d = new Date(rawDate);
      if (isNaN(d.getTime())) return '';
      return d.toLocaleDateString('es-CO', {
        timeZone: 'UTC',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      });
    } catch {
      return '';
    }
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
      if (bal > 0) {
        this.amountOverrideControl.setValue(bal);
      }
    } else if (!valid && this.config().allowAmountOverride) {
      this.amountOverrideControl.setValue(null);
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
  // ── Multi-tender internals (5a2) ─────────────────────────────────────────
  /** Numeric `store_payment_method` row id, or null when the id is not an FK. */
  private methodRowId(method: PaymentMethod): number | null {
    const id = Number(method.id);
    return Number.isFinite(id) && id > 0 ? id : null;
  }

  /** Catalog method behind a leg row id (null when it no longer resolves). */
  private legMethodById(storePaymentMethodId: number): PaymentMethod | null {
    return (
      this.resolvedMethods().find((m) => this.methodRowId(m) === storePaymentMethodId) ?? null
    );
  }

  /** Leg group at `index`, or null when out of range. */
  private legGroupOrNull(index: number): FormGroup<MultiLegFormControls> | null {
    if (index < 0 || index >= this.legsForm.length) return null;
    return this.legsForm.controls[index];
  }

  private toCents(value: number): number {
    return Math.round((Number(value) || 0) * 100);
  }

  private createLegGroup(seed: {
    storePaymentMethodId: number;
    amount: number;
    amountReceived?: number | null;
  }): FormGroup<MultiLegFormControls> {
    return new FormGroup<MultiLegFormControls>({
      storePaymentMethodId: new FormControl(seed.storePaymentMethodId, { nonNullable: true }),
      amount: new FormControl(seed.amount, { nonNullable: true }),
      amountReceived: new FormControl<number | null>(seed.amountReceived ?? null),
      reference: new FormControl('', { nonNullable: true }),
      bankAccountId: new FormControl<number | null>(null),
    });
  }

  /** Seed leg 1 with the live total (cash preferred, received pre-filled). */
  private seedFirstLeg(): void {
    if (this.legsForm.length > 0) return;
    const methods = this.directMethods();
    if (methods.length === 0) return;
    const first = methods[0];
    const method = methods.find((m) => m.type === PaymentMethodType.CASH) ?? first;
    const rowId = this.methodRowId(method);
    if (rowId == null) return;
    const total = this.effectiveTotal();
    this.legsForm.push(
      this.createLegGroup({
        storePaymentMethodId: rowId,
        amount: total,
        amountReceived: method.type === PaymentMethodType.CASH ? total : null,
      }),
    );
  }

  /** Map one form row to its `PaymentLeg` (method resolved, change derived). */
  private toPaymentLeg(row: MultiLegRowValue): PaymentLeg {
    const storePaymentMethodId = Number(row.storePaymentMethodId) || 0;
    const method = this.legMethodById(storePaymentMethodId);
    const leg: PaymentLeg = {
      storePaymentMethodId,
      methodType: method ? String(method.type) : '',
      amount: Number(row.amount) || 0,
      amountReceived: row.amountReceived ?? undefined,
      reference: (row.reference || '').trim() || undefined,
      bankAccountId: row.bankAccountId ?? undefined,
      method: { label: method?.name },
    };
    if (leg.methodType === PaymentMethodType.CASH) leg.change = this.legChange(leg);
    return leg;
  }

  /** Per-leg validity: positive amount, known method, cash/reference/account. */
  private isLegValid(leg: PaymentLeg): boolean {
    if (!(leg.amount > 0)) return false;
    if (!leg.methodType) return false;
    if (!(leg.storePaymentMethodId > 0)) return false;
    if (leg.methodType === PaymentMethodType.CASH && (leg.amountReceived ?? 0) < leg.amount) {
      return false;
    }
    if (leg.methodType === PaymentMethodType.BANK_TRANSFER && leg.bankAccountId == null) {
      return false;
    }
    if (this.legNeedsReference(leg) && !leg.reference?.trim()) return false;
    return true;
  }

  /** Synthetic echo when a leg method no longer resolves against the catalog. */
  private syntheticLegMethod(leg: PaymentLeg): PaymentMethod {
    return {
      id: String(leg.storePaymentMethodId),
      type: leg.methodType,
      name: leg.method?.label ?? leg.methodType,
      icon: resolvePaymentIcon(leg.methodType),
      enabled: true,
    };
  }

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

    // 5a2 — multi-tender contado. Section contract for the legs UI: 'method'
    // highlights the legs block (sum/empty problems), 'cash' a cash-leg
    // tender shortfall, 'reference' a missing reference/bank account.
    if (this.multiEnabled()) {
      const legs = this.legs();
      if (legs.length === 0) {
        return { section: 'method', message: 'Agrega un método de pago' };
      }
      const remainder = this.remaining();
      if (remainder > 0) {
        return { section: 'method', message: `Falta ${this.currencyFormat.format(remainder)}` };
      }
      if (remainder < 0) {
        return { section: 'method', message: `Sobra ${this.currencyFormat.format(-remainder)}` };
      }
      if (legs.some((l) => !(l.amount > 0))) {
        return { section: 'method', message: 'Cada tramo debe ser mayor a cero' };
      }
      if (legs.some((l) => !l.methodType)) {
        return { section: 'method', message: 'Un tramo tiene un método no disponible' };
      }
      if (legs.filter((l) => l.methodType === PaymentMethodType.CASH).length > 1) {
        return { section: 'method', message: 'El efectivo solo puede usarse en un tramo' };
      }
      const shortCash = legs.find(
        (l) => l.methodType === PaymentMethodType.CASH && (l.amountReceived ?? 0) < l.amount,
      );
      if (shortCash) {
        return { section: 'cash', message: 'El efectivo recibido no cubre el tramo' };
      }
      for (const [i, leg] of legs.entries()) {
        if (leg.methodType !== PaymentMethodType.BANK_TRANSFER) continue;
        if (this.legBankAccounts(i).length === 0) {
          return {
            section: 'reference',
            message: 'Sin cuentas configuradas. Contacta al administrador.',
          };
        }
        if (leg.bankAccountId == null) {
          return {
            section: 'reference',
            message: 'Selecciona la cuenta bancaria de destino.',
          };
        }
      }
      if (legs.some((l) => this.legNeedsReference(l) && !l.reference?.trim())) {
        return { section: 'reference', message: 'Ingresa la referencia del pago' };
      }
      if (this.config().requireCustomer && !this.customer()) {
        return { section: 'customer', message: 'Selecciona un cliente para completar la venta' };
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
    // 5a2 — salir del modo multi y destruir sus controles (fuera del contexto
    // reactivo: resetState corre dentro de untracked).
    this.multiEnabled.set(false);
    this.legsForm.clear();
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
    // T1 — resetear los metadatos de propina junto con el monto.
    // Si no, un cambio de contexto dejaba `tipType` y `tipWaiterId`
    // colgados del cobro anterior y el siguiente submit los enviaba
    // al backend sin que el operador los hubiera pedido.
    this.tipType.set('fixed');
    this.tipWaiterId.set(null);
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

    // 5a2 — multi-tender contado.
    if (this.multiEnabled() && this.legs().length > 0) {
      const legs = this.legs();
      if (legs.length === 1) {
        // Un tramo: payload clásico, sin `legs` (valor por valor idéntico al
        // que emitiría la rama single para el mismo método).
        return this.buildSingleLegSubmit(legs[0], base, customerId);
      }
      const first = legs[0];
      const cashLeg = legs.find((l) => l.methodType === PaymentMethodType.CASH);
      const out: PaymentSubmit = {
        storePaymentMethodId: first.storePaymentMethodId,
        methodType: first.methodType,
        amount: this.effectiveTotal(),
        mode: 'contado',
        customerId,
        method: this.legMethodById(first.storePaymentMethodId) ?? this.syntheticLegMethod(first),
        legs,
      };
      // Compat: recibido/vuelto del tramo en efectivo a nivel escalar.
      if (cashLeg) {
        out.amountReceived = cashLeg.amountReceived ?? 0;
        out.change = cashLeg.change ?? 0;
      }
      if (cfg.allowTip && (this.tip() || 0) > 0) {
        const tipResolved = this.tipAmount();
        out.tip = tipResolved;
        out.tipType = this.tipType();
        out.tipValue = tipResolved;
        const waiter = this.tipWaiterId();
        if (waiter != null) out.tipWaiterId = waiter;
      }
      if (this.selectedInstallmentId() != null) out.installmentId = this.selectedInstallmentId()!;
      return out;
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

    if (cfg.allowTip && (this.tip() || 0) > 0) {
      // T1 — el monto de la propina que viaja al backend es el RESUELTO
      // (porcentaje → monto calculado), no el % crudo. El consumidor
      // (pos-payment-step, table-payment-modal) traduce camelCase → snake_case
      // al DTO. `tipValue` lleva el mismo monto que `tip` cuando el
      // modo es 'fixed'; cuando el operador eligió porcentaje, también
      // lleva el monto resuelto (regla del dueño: la propina pactada
      // no puede moverse si cambia el subtotal).
      const tipResolved = this.tipAmount();
      out.tip = tipResolved;
      out.tipType = this.tipType();
      out.tipValue = tipResolved;
      const waiter = this.tipWaiterId();
      if (waiter != null) out.tipWaiterId = waiter;
    }
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

  /**
   * 5a2 — payload clásico reconstruido desde un tramo único. Valor por valor
   * idéntico al que emite la rama single para el mismo método (monto = base,
   * propina separada, sin `legs`).
   */
  private buildSingleLegSubmit(
    leg: PaymentLeg,
    base: number,
    customerId: number | string | null,
  ): PaymentSubmit {
    const method = this.legMethodById(leg.storePaymentMethodId) ?? this.syntheticLegMethod(leg);
    const out: PaymentSubmit = {
      storePaymentMethodId: leg.storePaymentMethodId,
      methodType: leg.methodType,
      amount: base,
      mode: 'contado',
      customerId,
      method,
    };
    if (this.config().allowTip && (this.tip() || 0) > 0) {
      const tipResolved = this.tipAmount();
      out.tip = tipResolved;
      out.tipType = this.tipType();
      out.tipValue = tipResolved;
      const waiter = this.tipWaiterId();
      if (waiter != null) out.tipWaiterId = waiter;
    }
    if (leg.methodType === PaymentMethodType.CASH) {
      out.amountReceived = leg.amountReceived ?? 0;
      out.change = leg.change ?? 0;
    }
    if (this.legNeedsReference(leg)) out.reference = leg.reference ?? '';
    if (leg.methodType === PaymentMethodType.BANK_TRANSFER) {
      out.bankAccountId = leg.bankAccountId ?? undefined;
    }
    if (this.selectedInstallmentId() != null) out.installmentId = this.selectedInstallmentId()!;
    return out;
  }
}
