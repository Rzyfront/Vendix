import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  computed,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subscription, firstValueFrom } from 'rxjs';

import {
  SpinnerComponent,
  ButtonComponent,
  PaymentCollectorComponent,
} from '../../../../../../../shared/components';
import type {
  PaymentSubmit,
  CreditTerms,
  PaymentMode,
} from '../../../../../../../shared/components';
import { ToastService } from '../../../../../../../shared/components/toast/toast.service';
import {
  PosPaymentService,
  PaymentMethod,
} from '../../../services/pos-payment.service';
import { PaymentMethodType } from '../../../../../../../shared/models/payment-method.model';
import { FulfillmentType } from '../../pos-fulfillment-selector.component';
import type { CheckoutIntent } from '../pos-checkout-shell.component';
import { PosWalletService, WalletInfo } from '../../../services/pos-wallet.service';
import {
  WompiService,
  WompiSubMethod,
  WompiPaymentStatusUpdate,
} from '../../../../../../../shared/services/wompi.service';
import { CartState } from '../../../models/cart.model';
import { StoreSettingsFacade } from '../../../../../../../core/store/store-settings/store-settings.facade';
import type { BusinessHours } from '../../../../../../../core/models/store-settings.interface';

/**
 * Fase 5·B1 — `app-pos-payment-step`.
 *
 * Step-child HEADLESS que hospeda el {@link PaymentCollectorComponent} y toda
 * la ORQUESTACIÓN de cobro que antes vivía en `PosPaymentInterfaceComponent`,
 * SIN su `<app-modal>` ni las secciones Resumen / Cliente (esas viven en el
 * shell). El comportamiento se preserva 1:1: gates de `onCollectorSubmit`
 * (cliente, caja, horario), construcción de `payment_request`,
 * `processSaleWithPayment`, manejo asíncrono de Wompi (nextAction + polling),
 * y venta a crédito (fiado libre vs financiado). El tipo de servicio
 * (fulfillment) y la mesa ahora los posee el paso Consumo y llegan por input
 * (`fulfillment`, `sessionId`, `tableId`).
 *
 * El shell lee las señales públicas (`canSubmit`, `mode`, `isWompiSelected`,
 * `selectedMethodType`, `isProcessing`) para el footer y dispara el cobro vía
 * `triggerSubmit()`.
 */
@Component({
  selector: 'app-pos-payment-step',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    SpinnerComponent,
    ButtonComponent,
    PaymentCollectorComponent,
  ],
  templateUrl: './pos-payment-step.component.html',
  styleUrl: './pos-payment-step.component.scss',
})
export class PosPaymentStepComponent implements OnInit {
  private readonly destroyRef = inject(DestroyRef);

  // ── Inputs (from shell) ──────────────────────────────────────────────────
  readonly cartState = input<CartState | null>(null);
  /**
   * Intención del checkout. Gatea `cash_on_delivery` (processing_mode
   * ON_DELIVERY): solo se ofrece en `delivery`; en entrega directa (mostrador) y
   * consumo en mesa se oculta aunque la tienda lo tenga activado.
   */
  readonly checkoutIntent = input<CheckoutIntent>('pickup');
  /** Restaurant stores that have at least one `prepared` line in the cart. */
  readonly isRestaurantWithPrepared = input<boolean>(false);
  readonly tableId = input<number | null>(null);
  /**
   * Fulfillment type — now OWNED by the Consumo step and passed in by the shell.
   * Forwarded onto the payment payloads (`paymentCompleted.emit(... fulfillment)`).
   */
  readonly fulfillment = input<FulfillmentType>('entrega');
  /**
   * Opened table_session id — OWNED by the Consumo step and passed in by the
   * shell. Forwarded to `processSaleWithPayment` so the sale binds to the table.
   */
  readonly sessionId = input<number | null>(null);
  /** Anonymous-sale flag owned by the shell (drives collector requireCustomer). */
  readonly isAnonymous = input<boolean>(false);
  /**
   * Payment methods supplied by the shell/parent. When null/empty the step
   * self-loads them (behavior-preserving fallback, mirrors the legacy
   * interface `loadPaymentMethods()`).
   */
  readonly paymentMethodsInput = input<PaymentMethod[] | null>(null, {
    alias: 'paymentMethods',
  });
  /** External processing flag OR-combined with the step's internal state. */
  readonly externalProcessing = input<boolean>(false, { alias: 'isProcessing' });
  /**
   * When false, the step does NOT execute the sale on collector submit; it only
   * runs the collector gate and emits {@link paymentReady} with the raw
   * {@link PaymentSubmit}. Used by the delivery flow, where the shell/shipping
   * step combines this payload into a single `processShippingSale` call. Pickup
   * keeps the default `true` (self-executes via `processSaleWithPayment`).
   */
  readonly autoExecute = input<boolean>(true);
  /**
   * Overrides the amount charged by the collector. Delivery passes
   * `cartTotal + shippingCost` here so the cash/change math reflects the real
   * charge; null → falls back to the cart total.
   */
  readonly amountOverride = input<number | null>(null);

  // ── Outputs (same contract the legacy interface emitted) ─────────────────
  readonly paymentCompleted = output<any>();
  readonly requestCustomer = output<void>();
  readonly walletLookup = output<{ id: number | string }>();
  /**
   * Deferred-execution channel (autoExecute=false): emits the collected payload
   * without processing it. The shell forwards it to the shipping step.
   */
  readonly paymentReady = output<PaymentSubmit>();
  /**
   * Bubbled from the collector's in-panel "Aceptar" (Monto sub-step). The shell
   * owns the advance/finalize timing (it waits for the green collapse animation).
   */
  readonly amountConfirmed = output<void>();

  /** The headless collector — the shell drives it through this step's API. */
  protected readonly collector = viewChild(PaymentCollectorComponent);

  private readonly paymentService = inject(PosPaymentService);
  private readonly toastService = inject(ToastService);
  private readonly walletService = inject(PosWalletService);
  private readonly wompiService = inject(WompiService);
  private readonly settingsFacade = inject(StoreSettingsFacade);

  // ── Self-loaded payment methods (fallback) ───────────────────────────────
  private readonly loadedMethods = signal<PaymentMethod[]>([]);
  readonly paymentMethods = computed<PaymentMethod[]>(() => {
    const provided = this.paymentMethodsInput();
    const base = provided && provided.length ? provided : this.loadedMethods();
    // Gating por processing_mode (réplica de checkout.service.getPaymentMethods):
    // delivery expone todos los modos (DIRECT + ONLINE + ON_DELIVERY); pickup /
    // mostrador / consumo en mesa ocultan ON_DELIVERY (cash_on_delivery).
    if (this.checkoutIntent() === 'delivery') return base;
    return base.filter(
      (m) =>
        m.processingMode !== 'ON_DELIVERY' &&
        m.type !== PaymentMethodType.CASH_ON_DELIVERY,
    );
  });

  // ── Internal processing state (was paymentState.isProcessing) ────────────
  private readonly processing = signal<boolean>(false);
  /** Combined processing state (internal cobro + external parent flag). */
  readonly isProcessing = computed<boolean>(
    () => this.processing() || this.externalProcessing(),
  );

  // ── Wallet ───────────────────────────────────────────────────────────────
  // Full WalletInfo kept locally to forward `wallet_id`; collector only needs
  // the available balance.
  readonly walletInfo = signal<WalletInfo | null>(null);

  // ── Wompi POST-submit polling state ──────────────────────────────────────
  private readonly submittedWompiSubMethod = signal<WompiSubMethod | null>(null);
  readonly wompiAwaitingPayment = signal(false);
  readonly wompiAwaitingMessage = signal('');
  private wompiPollingSubscription: Subscription | null = null;
  private wompiPaymentId: string | null = null;
  private wompiPaymentDbId: number | null = null;
  readonly wompiPollingState = signal<{
    active: boolean;
    attempts: number;
    maxAttempts: number;
  }>({ active: false, attempts: 0, maxAttempts: 60 });
  private wompiConfirmIntervalId: ReturnType<typeof setInterval> | null = null;

  // ── Settings-derived config (copied from the legacy interface) ───────────
  readonly cashRegisterEnabled = computed(
    () => this.settingsFacade.pos()?.cash_register?.enabled ?? false,
  );
  readonly autoCreateDefaultRegister = computed(
    () =>
      this.settingsFacade.pos()?.cash_register?.auto_create_default_register ??
      false,
  );
  readonly enableScheduleValidation = computed(
    () => this.settingsFacade.pos()?.enable_schedule_validation ?? false,
  );
  readonly showOnscreenKeypad = computed(
    () => this.settingsFacade.pos()?.show_onscreen_keypad !== false,
  );
  /**
   * Legacy `settings.pos.default_payment_form` ('contado' | 'credito'). Seeds
   * the collector's `initialMode`. `PosSettings` doesn't type this key, so we
   * read it defensively.
   */
  readonly defaultPaymentForm = computed<PaymentMode>(() => {
    const form = (
      this.settingsFacade.pos() as { default_payment_form?: string } | null
    )?.default_payment_form;
    return form === 'credito' ? 'credito' : 'contado';
  });
  readonly businessHours = computed<Record<string, BusinessHours>>(
    () => (this.settingsFacade.pos()?.business_hours as any) ?? {},
  );

  // ── Collector input adapters ─────────────────────────────────────────────
  /** Customer shape the collector expects (id only). */
  readonly collectorCustomer = computed<{ id: number | string } | null>(() => {
    const c = this.cartState()?.customer;
    return c ? { id: c.id } : null;
  });
  /** Wallet balance forwarded to the collector (available balance). */
  readonly collectorWalletInfo = computed<{ balance: number } | null>(() => {
    const w = this.walletInfo();
    return w ? { balance: w.available } : null;
  });
  /** Amount charged by the collector: override (delivery total+shipping) ?? cart total. */
  readonly effectiveAmount = computed<number>(
    () => this.amountOverride() ?? (this.cartState()?.summary?.total || 0),
  );

  // ── Footer-facing collector projections (read by the shell) ──────────────
  readonly mode = computed<PaymentMode | undefined>(() => this.collector()?.mode());
  readonly isWompiSelected = computed<boolean>(
    () => this.collector()?.isWompiSelected() ?? false,
  );
  readonly selectedMethodType = computed<string | null>(
    () => this.collector()?.selectedMethod()?.type ?? null,
  );
  readonly canSubmit = computed<boolean>(
    () => this.collector()?.canSubmit() ?? false,
  );

  // ── Sub-wizard (stepped) projections + footer driver ─────────────────────
  /** Current collector sub-step index (0-based; 0 while unmounted). */
  readonly subStep = computed<number>(() => this.collector()?.subStep() ?? 0);
  /** Index of the first sub-step after the mode picker (Método / Plan). */
  readonly modoOffset = computed<number>(() => this.collector()?.modoOffset() ?? 0);
  /** Index of the Monto sub-step (contado). */
  readonly montoIndex = computed<number>(() => this.collector()?.montoIndex() ?? 1);
  /** Display name of the selected payment method (null until one is picked). */
  readonly selectedMethodName = computed<string | null>(
    () => this.collector()?.selectedMethod()?.name ?? null,
  );

  /**
   * True while the collector sub-wizard still has sub-steps BEFORE Monto
   * (`subStep < montoIndex`). The shell footer reads this to keep showing
   * "Siguiente" (instead of the terminal CTA) even when Cobro is the last major
   * step (delivery), so the operator can walk Forma de pago → Método → Monto.
   */
  readonly hasPendingSubSteps = computed<boolean>(
    () => this.subStep() < this.montoIndex(),
  );
  /**
   * Whether the CURRENT sub-step can advance from the footer "Siguiente":
   * Forma de pago (`subStep < modoOffset`) always advances; Método
   * (`subStep === modoOffset`) requires a chosen method; at/after Monto it no
   * longer advances (it confirms). Mirrors {@link advanceSubStepOrConfirm}'s
   * per-sub-step gate so the footer's disabled state matches the driver.
   */
  readonly canAdvanceSubStep = computed<boolean>(() => {
    const cur = this.subStep();
    if (cur < this.modoOffset()) return true; // Forma de pago → siempre avanza
    if (cur === this.modoOffset()) return this.collector()?.selectedMethod() != null; // Método → requiere selección
    return false; // en/paso Monto ya no avanza; se confirma
  });

  /**
   * Footer "Siguiente" driver for the stepped Cobro sub-wizard (pickup flows,
   * where Cobro is NOT the last major step). Advances Forma de pago → Método →
   * Monto using the current selection — mirroring the auto-advance-on-tap model
   * so a user who leaves the default selected still moves forward. Returns:
   *  - `true`  → handled internally (an intermediate sub-step advanced, a
   *              required method is missing, or the amount was confirmed); the
   *              shell must NOT advance the major step now.
   *  - `false` → the collector is done for this footer press (credito plan,
   *              which finalizes at a later step); the shell may advance.
   * On the last contado sub-step it confirms the amount (guarded by canSubmit),
   * which bubbles `amountConfirmed` so the shell advances after the collapse.
   */
  advanceSubStepOrConfirm(): boolean {
    const c = this.collector();
    if (!c) return false;
    const last = c.subSteps().length - 1;
    const cur = c.subStep();
    if (cur < last) {
      if (cur < c.modoOffset()) {
        c.goToSubStep(c.modoOffset()); // Forma de pago → Método / Plan
      } else if (!c.selectedMethod()) {
        return true; // Método sub-step, no method chosen → stay on the grid
      } else {
        c.goToSubStep(c.montoIndex()); // Método → Monto
      }
      return true;
    }
    // Last sub-step:
    if (c.amountCollapsed()) return true; // already confirmed; advance is pending
    if (c.mode() === 'credito') return false; // credit finalizes at a later step
    if (!c.canSubmit()) return true; // amount still invalid → stay put
    c.confirmAmount(); // → amountConfirmed → shell advances after the collapse
    return true;
  }

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.wompiPollingSubscription?.unsubscribe();
      this.stopWompiConfirmPolling();
    });
    // Credit sales cannot be anonymous — that flag is owned by the shell; the
    // step only reads `isAnonymous` as an input, so no local effect is needed.
  }

  ngOnInit(): void {
    const provided = this.paymentMethodsInput();
    if (!provided || provided.length === 0) {
      this.loadPaymentMethods();
    }
  }

  private loadPaymentMethods(): void {
    this.paymentService
      .getPaymentMethods()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((methods) => this.loadedMethods.set(methods));
  }

  // ── Public API used by the shell footer ──────────────────────────────────
  triggerSubmit(): void {
    this.collector()?.triggerSubmit();
  }

  // ── Business hours gate (copied verbatim) ────────────────────────────────
  private isWithinBusinessHours(): boolean {
    if (!this.enableScheduleValidation()) {
      return true;
    }

    const now = new Date();
    const dayNames = [
      'sunday',
      'monday',
      'tuesday',
      'wednesday',
      'thursday',
      'friday',
      'saturday',
    ];
    const currentDayName = dayNames[now.getDay()];
    const todayHours = this.businessHours()?.[currentDayName];

    if (!todayHours) {
      return true;
    }

    const currentTime = now.getHours() * 60 + now.getMinutes();

    if (todayHours.blocks && todayHours.blocks.length > 0) {
      for (const block of todayHours.blocks) {
        if (block.open === 'closed' || block.close === 'closed') continue;
        const [oH, oM] = block.open.split(':').map(Number);
        const [cH, cM] = block.close.split(':').map(Number);
        if (currentTime >= oH * 60 + oM && currentTime <= cH * 60 + cM)
          return true;
      }
      return false;
    }

    if (todayHours.open === 'closed' || todayHours.close === 'closed') {
      return false;
    }

    const [openHour, openMinute] = todayHours.open.split(':').map(Number);
    const [closeHour, closeMinute] = todayHours.close.split(':').map(Number);
    const openTime = openHour * 60 + openMinute;
    const closeTime = closeHour * 60 + closeMinute;

    return currentTime >= openTime && currentTime <= closeTime;
  }

  // ── Wallet lookup (collector output) ─────────────────────────────────────
  onWalletLookup(e: { id: number | string }): void {
    this.walletInfo.set(null);
    this.walletService
      .getCustomerWallet(Number(e.id))
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (wallet) => {
          this.walletInfo.set(wallet);
          if (!wallet || wallet.available <= 0) {
            this.toastService.warning(
              'El cliente no tiene saldo disponible en su wallet',
            );
          }
        },
        error: () => {
          this.walletInfo.set(null);
          this.toastService.error('Error al consultar wallet del cliente');
        },
      });
  }

  // ── The single collector submit handler (all POS gates preserved) ────────
  onCollectorSubmit(submit: PaymentSubmit): void {
    if (!this.cartState()) return;

    // Deferred execution (delivery pay-now): don't process here. Emit the raw
    // payload so the shipping step folds it into a single processShippingSale.
    // Business-hours / cash-register gates are intentionally skipped — the
    // legacy shipping flow (confirmShipping) never enforced them.
    if (!this.autoExecute()) {
      this.paymentReady.emit(submit);
      return;
    }

    // Credito plan creation.
    if (submit.mode === 'credito') {
      this.runCreditSale(submit.credit ?? null);
      return;
    }

    // ── Contado (cash / card / transfer / wompi / wallet) ──
    const method = submit.method;

    // Non-anonymous sales require a customer (defensive — the collector gates
    // this via requireCustomer).
    if (!this.isAnonymous() && !this.cartState()!.customer) {
      this.toastService.info('Seleccione un cliente para continuar');
      this.requestCustomer.emit();
      return;
    }

    let register_id = localStorage.getItem('pos_register_id');
    if (
      !register_id &&
      (!this.cashRegisterEnabled() || this.autoCreateDefaultRegister())
    ) {
      register_id = 'DEFAULT-POS';
      localStorage.setItem('pos_register_id', register_id);
    }
    if (!register_id) {
      this.toastService.info('Configure la caja para continuar');
      return;
    }

    if (!this.isWithinBusinessHours()) {
      const dayNames = [
        'Domingo',
        'Lunes',
        'Martes',
        'Miércoles',
        'Jueves',
        'Viernes',
        'Sábado',
      ];
      const today = dayNames[new Date().getDay()];
      this.toastService.show({
        variant: 'error',
        title: 'Fuera del horario de atención',
        description: `El POS está cerrado. Hoy ${today} no se permite realizar ventas fuera del horario configurado.`,
      });
      return;
    }

    this.processing.set(true);

    const isWompi = method.type === 'wompi';
    this.submittedWompiSubMethod.set(submit.wompi?.subMethod ?? null);

    const payment_request: any = {
      orderId: 'ORDER_' + Date.now(),
      amount: this.cartState()!.summary.total,
      paymentMethod: method,
      cashReceived: submit.amountReceived,
      reference: submit.reference,
      isAnonymousSale: this.isAnonymous(),
    };

    if (method.type === 'wallet' && this.walletInfo()) {
      payment_request.metadata = { walletId: this.walletInfo()?.wallet_id };
    }
    if (isWompi && submit.wompi) {
      payment_request.metadata = {
        ...payment_request.metadata,
        wompiPaymentMethod: submit.wompi.payload,
      };
    }

    this.paymentService
      .processSaleWithPayment(
        this.cartState()!,
        payment_request,
        'current_user',
        this.sessionId() ?? null,
      )
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          if (response.success) {
            if (
              isWompi &&
              response.nextAction &&
              response.nextAction.type !== 'none'
            ) {
              this.handleWompiNextAction(response);
              return;
            }

            this.processing.set(false);
            this.paymentCompleted.emit({
              success: true,
              order: response.order,
              payment: response.payment,
              change: response.change,
              message: response.message,
              isAnonymousSale: this.isAnonymous(),
              fulfillment: this.fulfillment(),
              tableId: this.tableId(),
            });
          } else {
            this.processing.set(false);
            console.error('Payment failed:', response.message);
            this.toastService.show({
              variant: 'error',
              title: 'Error',
              description: response.message || 'Error al procesar el pago',
            });
          }
        },
        error: (error) => {
          this.processing.set(false);
          console.error('Payment error:', error);
          this.toastService.show({
            variant: 'error',
            title: 'Error',
            description:
              error.message || 'Error de conexión al procesar el pago',
          });
        },
      });
  }

  /**
   * Creates a credit sale from the collector's {@link CreditTerms}. Routes by
   * `terms.type`: 'free' → fiado libre; 'installments' → financed plan.
   */
  private runCreditSale(terms: CreditTerms | null): void {
    if (!this.cartState() || !this.cartState()!.customer) {
      this.toastService.info('Seleccione un cliente para continuar');
      return;
    }
    if (!terms) return; // collector gates this; defensive.

    let register_id = localStorage.getItem('pos_register_id');
    if (
      !register_id &&
      (!this.cashRegisterEnabled() || this.autoCreateDefaultRegister())
    ) {
      register_id = 'DEFAULT-POS';
      localStorage.setItem('pos_register_id', register_id);
    }

    if (!register_id) {
      this.toastService.info('Configure la caja para continuar');
      return;
    }

    if (!this.isWithinBusinessHours()) {
      const dayNames = [
        'Domingo',
        'Lunes',
        'Martes',
        'Miércoles',
        'Jueves',
        'Viernes',
        'Sábado',
      ];
      const today = dayNames[new Date().getDay()];
      this.toastService.show({
        variant: 'error',
        title: 'Fuera del horario de atención',
        description: `El POS está cerrado. Hoy ${today} no se permite realizar ventas fuera del horario configurado.`,
      });
      return;
    }

    this.processing.set(true);

    const request$ =
      terms.type === 'free'
        ? this.paymentService.processCreditSale(this.cartState()!, 'current_user')
        : this.paymentService.processCreditSaleWithTerms(
            this.cartState()!,
            {
              num_installments: terms.numInstallments,
              frequency: terms.frequency,
              first_installment_date: terms.firstInstallmentDate,
              interest_rate: terms.interestRate,
              interest_type: terms.interestType,
              initial_payment: terms.initialPayment,
              initial_payment_method_id: terms.initialPaymentMethodId,
            },
            'current_user',
            'installments',
          );

    request$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (response) => {
        this.processing.set(false);
        if (response.success) {
          this.paymentCompleted.emit({
            success: true,
            order: response.order,
            message: response.message,
            isCreditSale: true,
            fulfillment: this.fulfillment(),
            tableId: this.tableId(),
          });
        } else {
          this.toastService.show({
            variant: 'error',
            title: 'Error',
            description:
              response.message || 'Error al procesar la venta a crédito',
          });
        }
      },
      error: (error) => {
        this.processing.set(false);
        this.toastService.show({
          variant: 'error',
          title: 'Error',
          description: error.message || 'Error al procesar la venta a crédito',
        });
      },
    });
  }

  // ─── Wompi POST-submit polling ─────────────────────────────────────────
  resetWompiState(): void {
    this.submittedWompiSubMethod.set(null);
    this.wompiAwaitingPayment.set(false);
    this.wompiAwaitingMessage.set('');
    this.wompiPollingSubscription?.unsubscribe();
    this.wompiPollingSubscription = null;
    this.wompiPaymentId = null;
    this.stopWompiConfirmPolling();
    this.wompiPaymentDbId = null;
    this.wompiPollingState.set({ active: false, attempts: 0, maxAttempts: 60 });
  }

  handleWompiNextAction(response: any): void {
    const nextAction = response?.nextAction || response?.data?.nextAction;
    if (!nextAction) return;

    this.wompiPaymentId =
      response?.payment?.transaction_id ||
      response?.transactionId ||
      response?.data?.payment?.transaction_id ||
      response?.data?.transactionId;

    const dbId = response?.payment?.id ?? response?.data?.payment?.id ?? null;
    this.wompiPaymentDbId = typeof dbId === 'number' ? dbId : null;

    switch (nextAction.type) {
      case 'redirect':
        if (nextAction.url) {
          const popup = window.open(nextAction.url, '_blank');
          if (!popup) {
            this.wompiAwaitingMessage.set(
              'No se pudo abrir la ventana del banco. Por favor habilita las ventanas emergentes e intenta de nuevo.',
            );
            this.wompiAwaitingPayment.set(true);
            return;
          }
        }
        this.wompiAwaitingPayment.set(true);
        this.wompiAwaitingMessage.set(
          'Se abrió la página del banco. Completa el pago y regresa aquí.',
        );
        this.startWompiPolling();
        break;
      case 'await':
        this.wompiAwaitingPayment.set(true);
        this.wompiAwaitingMessage.set(
          this.submittedWompiSubMethod() === WompiSubMethod.NEQUI
            ? 'Esperando confirmación en la app de Nequi...'
            : 'Esperando confirmación del pago...',
        );
        this.startWompiPolling();
        break;
      case '3ds':
        if (nextAction.url) {
          const popup3ds = window.open(nextAction.url, '_blank');
          if (!popup3ds) {
            this.wompiAwaitingMessage.set(
              'No se pudo abrir la ventana del banco. Por favor habilita las ventanas emergentes e intenta de nuevo.',
            );
            this.wompiAwaitingPayment.set(true);
            return;
          }
        }
        this.wompiAwaitingPayment.set(true);
        this.wompiAwaitingMessage.set(
          'Completa la verificación 3D Secure en la ventana abierta.',
        );
        this.startWompiPolling();
        break;
      case 'none':
        break;
    }
  }

  startWompiPolling(): void {
    if (!this.wompiPaymentDbId) {
      if (this.wompiPaymentId) {
        this.legacyStartWompiPolling();
      }
      return;
    }

    this.stopWompiConfirmPolling();
    this.wompiPollingState.set({ active: true, attempts: 0, maxAttempts: 60 });

    void this.runWompiConfirmPoll();

    this.wompiConfirmIntervalId = setInterval(() => {
      const current = this.wompiPollingState();
      if (!current.active) {
        this.stopWompiConfirmPolling();
        return;
      }
      if (current.attempts >= current.maxAttempts) {
        this.stopWompiConfirmPolling();
        this.toastService.show({
          variant: 'warning',
          title: 'Pago aún pendiente',
          description:
            'No recibimos confirmación del pago. Verifica manualmente o cancela la espera.',
        });
        return;
      }
      void this.runWompiConfirmPoll();
    }, 5000);
  }

  private async runWompiConfirmPoll(): Promise<void> {
    if (!this.wompiPaymentDbId) return;
    try {
      const result = await firstValueFrom(
        this.paymentService.confirmWompiPayment(this.wompiPaymentDbId),
      );

      this.wompiPollingState.update((s) => ({ ...s, attempts: s.attempts + 1 }));

      const state = result?.state;
      if (state === 'succeeded' || state === 'captured') {
        this.stopWompiConfirmPolling();
        this.onWompiPaymentConfirmed(result);
      } else if (
        state === 'failed' ||
        state === 'cancelled' ||
        state === 'refunded'
      ) {
        this.stopWompiConfirmPolling();
        this.onWompiPaymentFailed(result);
      }
    } catch (err) {
      this.wompiPollingState.update((s) => ({ ...s, attempts: s.attempts + 1 }));
      console.warn('Wompi confirm poll error', err);
    }
  }

  async manualVerifyPayment(): Promise<void> {
    if (!this.wompiPaymentDbId) {
      this.toastService.show({
        variant: 'warning',
        title: 'Sin información de pago',
        description: 'No hay un pago Wompi en curso para verificar.',
      });
      return;
    }
    try {
      const result = await firstValueFrom(
        this.paymentService.confirmWompiPayment(this.wompiPaymentDbId),
      );
      const state = result?.state;
      if (state === 'succeeded' || state === 'captured') {
        this.stopWompiConfirmPolling();
        this.onWompiPaymentConfirmed(result);
      } else if (
        state === 'failed' ||
        state === 'cancelled' ||
        state === 'refunded'
      ) {
        this.stopWompiConfirmPolling();
        this.onWompiPaymentFailed(result);
      } else {
        this.toastService.show({
          variant: 'info',
          title: 'Pago aún pendiente',
          description:
            result?.message ??
            'Wompi todavía no reporta confirmación. Intenta de nuevo en unos segundos.',
        });
      }
    } catch (err: any) {
      console.warn('Manual Wompi verify failed', err);
      this.toastService.show({
        variant: 'error',
        title: 'Error de verificación',
        description: 'No se pudo verificar el estado del pago.',
      });
    }
  }

  private onWompiPaymentConfirmed(result: {
    transactionId?: string | null;
  }): void {
    this.wompiAwaitingPayment.set(false);
    this.wompiAwaitingMessage.set('');
    this.processing.set(false);
    this.paymentCompleted.emit({
      success: true,
      message: 'Pago con Wompi procesado correctamente',
      transactionId: result?.transactionId,
      isAnonymousSale: this.isAnonymous(),
      fulfillment: this.fulfillment(),
      tableId: this.tableId(),
    });
  }

  private onWompiPaymentFailed(result: { state: string; message?: string }): void {
    this.wompiAwaitingPayment.set(false);
    this.wompiAwaitingMessage.set(result?.message || 'El pago fue rechazado.');
    this.processing.set(false);
    this.toastService.show({
      variant: 'error',
      title: 'Pago rechazado',
      description: result?.message || `El pago fue ${result?.state}.`,
    });
  }

  private stopWompiConfirmPolling(): void {
    if (this.wompiConfirmIntervalId !== null) {
      clearInterval(this.wompiConfirmIntervalId);
      this.wompiConfirmIntervalId = null;
    }
    this.wompiPollingState.update((s) => ({ ...s, active: false }));
  }

  private legacyStartWompiPolling(): void {
    if (!this.wompiPaymentId) return;
    this.wompiPollingSubscription?.unsubscribe();
    this.wompiPollingSubscription = this.wompiService
      .pollPaymentStatus(this.wompiPaymentId)
      .subscribe({
        next: (update: WompiPaymentStatusUpdate) => {
          if (update.status === 'succeeded') {
            this.onWompiPaymentConfirmed({ transactionId: update.transactionId });
          } else if (
            update.status === 'failed' ||
            update.status === 'cancelled'
          ) {
            this.onWompiPaymentFailed({
              state: update.status,
              message: update.message,
            });
          }
        },
        error: () => {
          this.wompiAwaitingPayment.set(false);
          this.wompiAwaitingMessage.set('');
          this.processing.set(false);
          this.toastService.show({
            variant: 'error',
            title: 'Error de verificación',
            description:
              'No se pudo verificar el estado del pago. Intenta de nuevo.',
          });
        },
      });
  }

  cancelWompiAwait(): void {
    this.wompiPollingSubscription?.unsubscribe();
    this.wompiPollingSubscription = null;
    this.stopWompiConfirmPolling();
    this.wompiAwaitingPayment.set(false);
    this.wompiAwaitingMessage.set('');
    this.processing.set(false);
  }
}
