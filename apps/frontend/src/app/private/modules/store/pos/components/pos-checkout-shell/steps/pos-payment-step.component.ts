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
  IconComponent,
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
import {
  PosFulfillmentSelectorComponent,
  FulfillmentType,
} from '../../pos-fulfillment-selector.component';
import { PosOpenTableModalComponent } from '../../pos-open-table-modal.component';
import { OpenTableSessionResult } from '../../../services/pos-restaurant-integration.service';
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
 * (mesa/consumo, cliente, caja, horario), construcción de `payment_request`,
 * `processSaleWithPayment`, manejo asíncrono de Wompi (nextAction + polling),
 * y venta a crédito (fiado libre vs financiado).
 *
 * El shell lee las señales públicas (`canSubmit`, `mode`, `isWompiSelected`,
 * `selectedMethodType`, `isProcessing`, `restaurantConsumoNeedsTable`) para el
 * footer y dispara el cobro vía `triggerSubmit()`.
 */
@Component({
  selector: 'app-pos-payment-step',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    IconComponent,
    SpinnerComponent,
    ButtonComponent,
    PaymentCollectorComponent,
    PosFulfillmentSelectorComponent,
    PosOpenTableModalComponent,
  ],
  templateUrl: './pos-payment-step.component.html',
  styleUrl: './pos-payment-step.component.scss',
})
export class PosPaymentStepComponent implements OnInit {
  private readonly destroyRef = inject(DestroyRef);

  // ── Inputs (from shell) ──────────────────────────────────────────────────
  readonly cartState = input<CartState | null>(null);
  /** Restaurant stores that have at least one `prepared` line in the cart. */
  readonly isRestaurantWithPrepared = input<boolean>(false);
  readonly tableId = input<number | null>(null);
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
  /** Bug 1 (Fase K): emitted when the inline picker opens a session. */
  readonly tableSessionOpened = output<OpenTableSessionResult>();
  /**
   * Deferred-execution channel (autoExecute=false): emits the collected payload
   * without processing it. The shell forwards it to the shipping step.
   */
  readonly paymentReady = output<PaymentSubmit>();

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
    if (provided && provided.length) return provided;
    return this.loadedMethods();
  });

  // ── Internal processing state (was paymentState.isProcessing) ────────────
  private readonly processing = signal<boolean>(false);
  /** Combined processing state (internal cobro + external parent flag). */
  readonly isProcessing = computed<boolean>(
    () => this.processing() || this.externalProcessing(),
  );

  // ── Fulfillment / table (Restaurant + prepared) ──────────────────────────
  readonly fulfillment = signal<FulfillmentType>('entrega');
  /** Local mirror of the picked table id so the step can unblock cobro even
   *  before the parent persists a currentTableSession. */
  readonly pickedTableId = signal<number | null>(null);
  /** Mirror of the opened table_session id forwarded to the backend payload. */
  readonly pickedSessionId = signal<number | null>(null);
  /** Toggles the inline PosOpenTableModalComponent. */
  readonly openTablePicker = signal(false);

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

  /** Restaurant + prepared 'consumo' still requires an open table. */
  readonly restaurantConsumoNeedsTable = computed<boolean>(
    () =>
      this.isRestaurantWithPrepared() &&
      this.fulfillment() === 'consumo' &&
      (this.tableId() ?? this.pickedTableId()) == null,
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

  // ── Fulfillment / table handlers ─────────────────────────────────────────
  onFulfillmentChange(next: FulfillmentType): void {
    this.fulfillment.set(next);
    if (next !== 'consumo') {
      this.pickedTableId.set(null);
    }
  }

  onTableSessionPicked(result: OpenTableSessionResult): void {
    this.openTablePicker.set(false);
    const session = result?.session ?? result;
    const tableId = (session as any)?.table_id ?? null;
    const sessionId = (session as any)?.id ?? null;
    this.pickedTableId.set(tableId);
    this.pickedSessionId.set(sessionId);
    this.tableSessionOpened.emit(result);
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

    // Restaurant + prepared: 'consumo' requires an open table.
    if (this.restaurantConsumoNeedsTable()) return;

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
        this.pickedSessionId() ?? null,
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
              tableId: this.tableId() ?? this.pickedTableId(),
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
            tableId: this.tableId() ?? this.pickedTableId(),
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
      tableId: this.tableId() ?? this.pickedTableId(),
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
