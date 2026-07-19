import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';

import {
  ModalComponent,
  IconComponent,
  StepsLineComponent,
} from '../../../../../../shared/components';
import type { StepsLineItem, PaymentSubmit } from '../../../../../../shared/components';
import { CurrencyPipe, CurrencyFormatService } from '../../../../../../shared/pipes/currency';
import { PosCustomerSelectorComponent } from '../pos-customer-selector/pos-customer-selector.component';
import { PosPaymentStepComponent } from './steps/pos-payment-step.component';
import { PosShippingStepComponent } from './steps/pos-shipping-step.component';
import { OpenTableSessionResult } from '../../services/pos-restaurant-integration.service';
import { PaymentMethod } from '../../services/pos-payment.service';
import { CartState } from '../../models/cart.model';
import { PosCustomer } from '../../models/customer.model';
import { StoreSettingsFacade } from '../../../../../../core/store/store-settings/store-settings.facade';

export type CheckoutIntent = 'pickup' | 'delivery';

/**
 * Fase 5·B1 — `app-pos-checkout-shell`.
 *
 * SHELL con stepper que unifica el checkout POS. En B1 cubre el flujo
 * NO-delivery (pago sin envío) con dos pasos: **Cobro** (hospeda el
 * `app-pos-payment-step`) y **Cliente** (toggle anónimo/cliente + selector).
 * El Resumen es un rail fijo. El shell es dueño del flag `isAnonymousSale` y lo
 * comparte con el paso Cobro; la verdad del cliente/carrito la posee el padre
 * (POS) vía `customerSelected` → `onPaymentCustomerSelected`.
 *
 * Los 3 modales viejos siguen vivos; este shell no borra nada.
 */
@Component({
  selector: 'app-pos-checkout-shell',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ModalComponent,
    IconComponent,
    StepsLineComponent,
    CurrencyPipe,
    PosCustomerSelectorComponent,
    PosPaymentStepComponent,
    PosShippingStepComponent,
  ],
  templateUrl: './pos-checkout-shell.component.html',
  styleUrl: './pos-checkout-shell.component.scss',
})
export class PosCheckoutShellComponent {
  // ── Inputs ────────────────────────────────────────────────────────────────
  readonly isOpen = input<boolean>(false);
  readonly cartState = input<CartState | null>(null);
  readonly checkoutIntent = input<CheckoutIntent>('pickup');
  readonly isRestaurantWithPrepared = input<boolean>(false);
  readonly tableId = input<number | null>(null);
  readonly paymentMethods = input<PaymentMethod[] | null>(null);
  readonly isProcessing = input<boolean>(false);

  // ── Outputs ───────────────────────────────────────────────────────────────
  readonly isOpenChange = output<boolean>();
  readonly closed = output<void>();
  /** Re-emits the paymentData produced by the Cobro step (step.paymentCompleted). */
  readonly checkoutCompleted = output<any>();
  /** Re-emits the shippingData produced by the Envío step (delivery flow). */
  readonly shippingCompleted = output<any>();
  readonly requestCustomer = output<void>();
  readonly customerSelected = output<PosCustomer>();
  readonly tableSessionOpened = output<OpenTableSessionResult>();

  private readonly currencyService = inject(CurrencyFormatService);
  private readonly settingsFacade = inject(StoreSettingsFacade);

  // ── Child references ────────────────────────────────────────────────────
  protected readonly paymentStep = viewChild(PosPaymentStepComponent);
  protected readonly shippingStep = viewChild(PosShippingStepComponent);
  private readonly customerSelector = viewChild(PosCustomerSelectorComponent);

  // ── Pay timing (delivery only; owned here, two-way with the Envío step) ──
  readonly payTiming = signal<'now' | 'later'>('now');

  // ── Stepper state ──────────────────────────────────────────────────────
  readonly currentStep = signal(0);

  /**
   * Dynamic steps by intent + "cuándo paga":
   *  - pickup                    → [Cobro, Cliente]
   *  - delivery + pagar ahora    → [Cobro, Cliente, Envío]
   *  - delivery + contra-entrega → [Cliente, Envío]  (sin Cobro)
   */
  readonly steps = computed<StepsLineItem[]>(() => {
    if (this.checkoutIntent() === 'delivery') {
      return this.payTiming() === 'now'
        ? [{ label: 'Cobro' }, { label: 'Cliente' }, { label: 'Envío' }]
        : [{ label: 'Cliente' }, { label: 'Envío' }];
    }
    return [{ label: 'Cobro' }, { label: 'Cliente' }];
  });

  /** Parallel key array (same order/length as {@link steps}) used to render the
   *  active body and gate which step components mount. */
  readonly stepKeys = computed<string[]>(() => {
    if (this.checkoutIntent() === 'delivery') {
      return this.payTiming() === 'now'
        ? ['cobro', 'cliente', 'envio']
        : ['cliente', 'envio'];
    }
    return ['cobro', 'cliente'];
  });

  readonly currentStepKey = computed<string>(
    () => this.stepKeys()[this.currentStep()] ?? '',
  );

  /** Live shipping cost projected from the Envío step (0 when not mounted). */
  readonly shippingCost = computed<number>(
    () => this.shippingStep()?.shippingCost() ?? 0,
  );

  /** Amount the Cobro collector must charge on a pay-now delivery: cart + flete. */
  readonly deliveryAmount = computed<number | null>(() =>
    this.checkoutIntent() === 'delivery' && this.payTiming() === 'now'
      ? (this.cartState()?.summary?.total || 0) + this.shippingCost()
      : null,
  );

  /** Total shown in the Resumen rail / footer (adds flete on delivery). */
  readonly totalToPay = computed<number>(() => {
    const base = this.cartState()?.summary?.total || 0;
    return this.checkoutIntent() === 'delivery' ? base + this.shippingCost() : base;
  });

  // ── Anonymous-sale ownership (moved from the legacy interface) ───────────
  readonly isAnonymousSale = signal<boolean>(false);
  readonly userOverrideAnonymous = signal<boolean | null>(null);

  readonly allowAnonymousSales = computed(
    () => this.settingsFacade.pos()?.allow_anonymous_sales ?? false,
  );
  readonly anonymousSalesAsDefault = computed(
    () => this.settingsFacade.pos()?.anonymous_sales_as_default ?? false,
  );

  /** Anonymous option is hidden when the collector is in credit mode. */
  readonly canBeAnonymous = computed<boolean>(
    () => this.allowAnonymousSales() && this.paymentStep()?.mode() !== 'credito',
  );

  get customerDisplayName(): string {
    const customer = this.cartState()?.customer;
    if (!customer) return 'Seleccionar cliente';
    const firstName = customer.first_name || '';
    const lastName = customer.last_name || '';
    return `${firstName} ${lastName}`.trim() || 'Cliente sin nombre';
  }

  // ── Footer projections (read from the Cobro + Envío steps) ───────────────
  readonly footerProcessing = computed<boolean>(
    () =>
      (this.paymentStep()?.isProcessing() ?? false) ||
      (this.shippingStep()?.isProcessing() ?? false),
  );
  readonly confirmDisabled = computed<boolean>(() => {
    if (this.footerProcessing()) return true;

    if (this.checkoutIntent() === 'delivery') {
      const ship = this.shippingStep();
      if (!ship) return true;
      if (this.payTiming() === 'now') {
        const pay = this.paymentStep();
        if (!pay) return true;
        return !pay.canSubmit() || !ship.canConfirm();
      }
      // contra-entrega: solo requiere envío válido.
      return !ship.canConfirm();
    }

    // pickup (B1): idéntico al collector.
    const step = this.paymentStep();
    if (!step) return true;
    return !step.canSubmit() || step.restaurantConsumoNeedsTable();
  });
  /** Delivery → 'Finalizar venta'. Pickup → replica el label del collector. */
  readonly confirmLabel = computed<string>(() => {
    if (this.checkoutIntent() === 'delivery') return 'Finalizar venta';
    const step = this.paymentStep();
    if (!step) return 'Confirmar Pago';
    if (step.mode() === 'credito') return 'Crear Venta a Crédito';
    if (step.isWompiSelected()) return 'Pagar con Wompi';
    const type = step.selectedMethodType();
    if (type === 'cash') return 'Cobrar';
    if (type === 'wallet') return 'Pagar con Wallet';
    return 'Confirmar Pago';
  });

  constructor() {
    // Ensure currency is loaded for the Resumen rail (| currency pipe).
    this.currencyService.loadCurrency();

    // Reactive sync: derive the anonymous flag from settings unless the user
    // explicitly overrode it. Writes wrapped in untracked() (zoneless-safe).
    effect(() => {
      const allow = this.allowAnonymousSales();
      const asDefault = this.anonymousSalesAsDefault();
      const override = this.userOverrideAnonymous();
      const effective = !allow ? false : (override ?? asDefault);
      untracked(() => {
        if (this.isAnonymousSale() !== effective) {
          this.isAnonymousSale.set(effective);
        }
      });
    });

    // Reset-on-open (Fase 1 pattern): reset the stepper cursor, the pay-timing
    // toggle and the anonymous state whenever the shell opens.
    effect(() => {
      if (this.isOpen()) {
        untracked(() => {
          this.currentStep.set(0);
          this.payTiming.set('now');
          this.userOverrideAnonymous.set(null);
          this.syncAnonymousSaleState();
        });
      }
    });

    // Clamp the cursor when the steps array shrinks (intent / pay-timing change).
    effect(() => {
      const len = this.stepKeys().length;
      untracked(() => {
        if (this.currentStep() >= len) {
          this.currentStep.set(Math.max(0, len - 1));
        }
      });
    });

    // Credit sales cannot be anonymous: when the collector enters credito mode,
    // clear the anonymous flag so the customer selector is shown.
    effect(() => {
      if (this.paymentStep()?.mode() === 'credito' && this.isAnonymousSale()) {
        untracked(() => this.isAnonymousSale.set(false));
      }
    });
  }

  private syncAnonymousSaleState(): void {
    if (!this.allowAnonymousSales()) {
      this.isAnonymousSale.set(false);
      return;
    }
    const override = this.userOverrideAnonymous();
    this.isAnonymousSale.set(override ?? this.anonymousSalesAsDefault());
  }

  // ── Stepper navigation (non-blocking) ────────────────────────────────────
  goToStep(index: number): void {
    if (index < 0 || index >= this.stepKeys().length) return;
    this.currentStep.set(index);
    // Lazily prefill the delivery address when the operator enters the Envío
    // step (user action → not an effect, keeps HTTP out of reactive contexts).
    if (this.stepKeys()[index] === 'envio') {
      this.shippingStep()?.prefillFromCart();
    }
  }

  /** Navigate by step key; no-op when the key is not part of the current flow. */
  private goToStepKey(key: string): void {
    const index = this.stepKeys().indexOf(key);
    if (index >= 0) this.goToStep(index);
  }

  // ── Footer actions ───────────────────────────────────────────────────────
  onConfirm(): void {
    // pickup (B1): the Cobro step self-executes (autoExecute=true).
    if (this.checkoutIntent() !== 'delivery') {
      this.paymentStep()?.triggerSubmit();
      return;
    }

    // delivery: shipping must be valid first, regardless of pay timing.
    const ship = this.shippingStep();
    if (!ship?.canConfirm()) {
      this.goToStepKey('envio');
      ship?.flashValidation();
      return;
    }

    if (this.payTiming() === 'now') {
      // Combine Cobro + Envío: the collector runs deferred (autoExecute=false),
      // emits paymentReady → onPaymentReady → shippingStep.execute(submit).
      const pay = this.paymentStep();
      if (!pay?.canSubmit()) {
        this.goToStepKey('cobro');
        return;
      }
      pay.triggerSubmit();
    } else {
      // contra-entrega: process the shipping order with no payment.
      ship.execute(null);
    }
  }

  /** Deferred-payment channel from the Cobro step (delivery pay-now). */
  onPaymentReady(submit: PaymentSubmit): void {
    this.shippingStep()?.execute(submit);
  }

  /** Re-emit the Envío step result to the parent (POS). */
  onShippingCompleted(shippingData: any): void {
    this.shippingCompleted.emit(shippingData);
  }

  // ── Cliente step handlers ───────────────────────────────────────────────
  toggleAnonymousSale(enabled: boolean): void {
    this.userOverrideAnonymous.set(enabled);
    this.isAnonymousSale.set(enabled);
  }

  /** Cliente elegido/creado en el selector inline. */
  selectCustomer(customer: PosCustomer): void {
    this.userOverrideAnonymous.set(false);
    this.isAnonymousSale.set(false);
    // El padre (POS) es dueño del carrito; solo re-emitimos.
    this.customerSelected.emit(customer);
    // Prefill the delivery address with the fresh selection (the cartState input
    // only updates after the parent re-renders, so pass the object directly).
    this.shippingStep()?.prefillFromCustomer(customer);
  }

  /** "Quitar cliente / venta anónima" desde el selector inline. */
  onCustomerCleared(): void {
    this.toggleAnonymousSale(true);
  }

  // ── Step passthrough outputs ─────────────────────────────────────────────
  onCheckoutCompleted(paymentData: any): void {
    this.checkoutCompleted.emit(paymentData);
  }

  onRequestCustomer(): void {
    this.requestCustomer.emit();
  }

  onTableSessionOpened(result: OpenTableSessionResult): void {
    this.tableSessionOpened.emit(result);
  }

  // ── Close ────────────────────────────────────────────────────────────────
  onModalClosed(): void {
    this.customerSelector()?.reset();
    this.isOpenChange.emit(false);
    this.closed.emit();
  }
}
