import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import {
  ModalComponent,
  IconComponent,
  StepsLineComponent,
  ToastService,
} from '../../../../../../shared/components';
import type { StepsLineItem, PaymentSubmit } from '../../../../../../shared/components';
import { CurrencyPipe, CurrencyFormatService } from '../../../../../../shared/pipes/currency';
import {
  AddressFormFieldsComponent,
  AddressPayload,
} from '../../../../../../shared/components/address-form-fields/address-form-fields.component';
import { PosCustomerSelectorComponent } from '../pos-customer-selector/pos-customer-selector.component';
import { PosConsumoStepComponent } from './steps/pos-consumo-step.component';
import { PosPaymentStepComponent } from './steps/pos-payment-step.component';
import { PosShippingStepComponent } from './steps/pos-shipping-step.component';
import {
  OpenTableSessionResult,
  PosRestaurantIntegrationService,
} from '../../services/pos-restaurant-integration.service';
import { PaymentMethod, PosPaymentService } from '../../services/pos-payment.service';
import { PosCartService } from '../../services/pos-cart.service';
import { CartState, CartItem } from '../../models/cart.model';
import { PosCustomer } from '../../models/customer.model';
import { FulfillmentType } from '../pos-fulfillment-selector.component';
import { PosOrderCreateResult } from '../../models/order.model';
import { extractApiErrorMessage } from '../../../../../../core/utils/api-error-handler';
import { focusFirstInvalid } from '../../../../../../core/utils/focus-first-invalid';
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
    AddressFormFieldsComponent,
    PosCustomerSelectorComponent,
    PosConsumoStepComponent,
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
  /** Emitted when a draft order has been persisted (and KDS fired if applicable). */
  readonly draftSaved = output<PosOrderCreateResult>();

  private readonly currencyService = inject(CurrencyFormatService);
  private readonly settingsFacade = inject(StoreSettingsFacade);
  private readonly cartService = inject(PosCartService);
  private readonly paymentService = inject(PosPaymentService);
  private readonly integration = inject(PosRestaurantIntegrationService);
  private readonly toastService = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly host = inject(ElementRef<HTMLElement>);

  // ── Child references ────────────────────────────────────────────────────
  protected readonly consumoStep = viewChild(PosConsumoStepComponent);
  protected readonly paymentStep = viewChild(PosPaymentStepComponent);
  protected readonly shippingStep = viewChild(PosShippingStepComponent);
  private readonly customerSelector = viewChild(PosCustomerSelectorComponent);

  // ── Address capture (moved from the Envío step into the Cliente step) ────
  /** Live address payload emitted by the shell-mounted `app-address-form-fields`. */
  readonly capturedAddress = signal<AddressPayload | null>(null);
  /** Validity of the captured address (drives whether delivery can proceed). */
  readonly addressValid = signal<boolean>(false);
  /** Id of the selected customer's saved address; null → the Envío step creates it. */
  readonly capturedAddressId = signal<number | null>(null);
  /**
   * Flash flag that forces `app-address-form-fields` to render its inline
   * required-field errors. Set when the operator tries to advance past the
   * Dirección sub-step with an invalid address; auto-cleared once valid.
   */
  readonly showAddressErrors = signal<boolean>(false);
  /**
   * Flash flag for the Cliente sub-step: forces the "selecciona un cliente"
   * hint when the operator tries to leave the Cliente selector without having
   * picked a customer. Cleared once a customer is chosen or on sub-step change.
   */
  readonly showCustomerError = signal<boolean>(false);

  /** Delivery flows must capture a shipping address in the Cliente step. */
  readonly requiresAddress = computed<boolean>(
    () => this.checkoutIntent() === 'delivery',
  );

  /**
   * Seeds `app-address-form-fields` from the current customer's primary saved
   * address (defensive mapping to `AddressPayload`). Null when the customer has
   * no address on file.
   */
  readonly customerInitialAddress = computed<AddressPayload | null>(() => {
    const customer = this.cartState()?.customer;
    const addresses = customer?.addresses;
    const a = addresses?.find((x) => x.is_primary) ?? addresses?.[0];
    if (!a) return null;
    return {
      address_line1: a.address_line1 ?? null,
      address_line2: null,
      city: a.city ?? null,
      state_province: a.state_province ?? null,
      country_code: a.country_code ?? 'CO',
      postal_code: null,
      phone_number: customer?.phone ?? null,
      latitude: null,
      longitude: null,
    };
  });

  // ── Stepper state ──────────────────────────────────────────────────────
  readonly currentStep = signal(0);

  /**
   * The dedicated "Consumo" step (tipo de servicio + mesa) is shown only for
   * restaurant tenants when the intent is NOT delivery. Gating by industry ∧
   * intent (NOT by "hay platos prepared"): consumo/mesa never makes sense on a
   * domicilio. The kitchen fire keeps its own gate (`hasUnfiredPreparedItems`).
   */
  readonly showConsumoStep = computed<boolean>(
    () => this.integration.isRestaurantMode() && this.checkoutIntent() !== 'delivery',
  );

  /**
   * Dynamic steps by intent:
   *  - pickup (no restaurante)   → [Cobro, Cliente]
   *  - pickup (restaurante)      → [Consumo, Cobro, Cliente]
   *  - delivery                  → [Cliente, Envío, Cobro]  (Cobro SIEMPRE al final)
   *
   * "Contra entrega" ya no es un eje aparte: es el método de pago
   * `cash_on_delivery` (processing_mode ON_DELIVERY) que el paso Cobro ofrece
   * solo cuando la intención es delivery.
   */
  readonly steps = computed<StepsLineItem[]>(() => {
    if (this.checkoutIntent() === 'delivery') {
      return [{ label: 'Cliente' }, { label: 'Envío' }, { label: 'Cobro' }];
    }
    return this.showConsumoStep()
      ? [{ label: 'Consumo' }, { label: 'Cobro' }, { label: 'Cliente' }]
      : [{ label: 'Cobro' }, { label: 'Cliente' }];
  });

  /** Parallel key array (same order/length as {@link steps}) used to render the
   *  active body and gate which step components mount. */
  readonly stepKeys = computed<string[]>(() => {
    if (this.checkoutIntent() === 'delivery') {
      return ['cliente', 'envio', 'cobro'];
    }
    return this.showConsumoStep()
      ? ['consumo', 'cobro', 'cliente']
      : ['cobro', 'cliente'];
  });

  readonly currentStepKey = computed<string>(
    () => this.stepKeys()[this.currentStep()] ?? '',
  );

  readonly isFirstStep = computed<boolean>(() => this.currentStep() === 0);
  readonly isLastStep = computed<boolean>(
    () => this.currentStep() === this.stepKeys().length - 1,
  );

  /**
   * Barras de progreso (móvil, estilo Pencil): un item por paso con su estado
   * (done | active | todo). Reemplaza los círculos numerados de `app-steps-line`
   * en <767px; en desktop se sigue usando `app-steps-line`.
   */
  readonly progressBars = computed<{ label: string; done: boolean; active: boolean }[]>(() => {
    const cur = this.currentStep();
    return this.steps().map((s, i) => ({
      label: s.label ?? '',
      done: i < cur,
      active: i === cur,
    }));
  });

  /**
   * Subtítulo dinámico del header (estilo Pencil: "<Paso> · <Sub-paso>"). Los
   * sub-pasos de Cliente/Envío se leen de los childs (señales públicas); Cobro
   * se distingue por modo. Lazy-eval: aunque referencie señales declaradas más
   * abajo, la función solo corre al leerse (ya inicializadas).
   */
  readonly stepSubtitle = computed<string>(() => {
    switch (this.currentStepKey()) {
      case 'consumo':
        return 'Consumo · Tipo de servicio';
      case 'cliente': {
        const sub = this.clienteSubSteps()[this.clienteSubStep()]?.label ?? 'Tipo';
        return `Cliente · ${sub}`;
      }
      case 'envio':
        return `Envío · ${(this.shippingStep()?.shipSubStep() ?? 0) === 0 ? 'Método' : 'Costo'}`;
      case 'cobro': {
        const pay = this.paymentStep();
        if (!pay) return 'Cobro';
        if (pay.mode() === 'credito') return 'Cobro · Crédito';
        // Forma de pago → Método → Monto (frames PyHka / a7mp1 / G0dg6). En el
        // sub-paso Forma se muestra "Forma de pago"; una vez elegido el método,
        // el subtítulo refleja su nombre (p. ej. "Cobro · Efectivo").
        if (pay.subStep() < pay.modoOffset()) return 'Cobro · Forma de pago';
        const method = pay.selectedMethodName();
        return method ? `Cobro · ${method}` : 'Cobro · Método de pago';
      }
      default:
        return 'Finalizar venta';
    }
  });

  /** Live shipping cost projected from the Envío step (0 when not mounted). */
  readonly shippingCost = computed<number>(
    () => this.shippingStep()?.shippingCost() ?? 0,
  );

  /**
   * Amount the Cobro collector must charge on a delivery: cart + flete. Cobro is
   * the LAST delivery step, so the flete is already defined by the time we charge
   * (the monto is correct on first render — no longer depends on pay timing).
   */
  readonly deliveryAmount = computed<number | null>(() =>
    this.checkoutIntent() === 'delivery'
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
  /** Guard: apply the config-driven anonymous default only on the first render. */
  private readonly anonymousDefaultSynced = signal(false);

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

  /**
   * Delivery sales cannot be anonymous: they require a customer with a shipping
   * address. The "Venta Anónima" button stays VISIBLE but DISABLED in this case
   * (with an explanatory legend) — see the template.
   */
  readonly anonymousBlockedByDelivery = computed<boolean>(
    () => this.checkoutIntent() === 'delivery',
  );

  get customerDisplayName(): string {
    const customer = this.cartState()?.customer;
    if (!customer) return 'Seleccionar cliente';
    const firstName = customer.first_name || '';
    const lastName = customer.last_name || '';
    return `${firstName} ${lastName}`.trim() || 'Cliente sin nombre';
  }

  // ── Cliente sub-wizard (presentación; espeja Cobro/Envío) ────────────────
  /** Sub-paso activo del paso Cliente: 0=Tipo · 1=Cliente · 2=Dirección. */
  readonly clienteSubStep = signal<number>(0);
  /**
   * Sub-pasos DINÁMICOS del paso Cliente:
   *  - anónima                    → [Tipo]
   *  - con cliente (no delivery)  → [Tipo, Cliente]
   *  - con cliente (delivery)     → [Tipo, Cliente, Dirección]  (Dirección terminal)
   */
  readonly clienteSubSteps = computed<StepsLineItem[]>(() => {
    if (this.isAnonymousSale()) return [{ label: 'Tipo' }];
    if (this.requiresAddress()) {
      return [{ label: 'Tipo' }, { label: 'Cliente' }, { label: 'Dirección' }];
    }
    return [{ label: 'Tipo' }, { label: 'Cliente' }];
  });

  // ── Draft-order (Guardar borrador) submission state ──────────────────────
  readonly submittingDraft = signal(false);

  // ── Mobile summary accordion (Resumen colapsable, solo <767px) ───────────
  /** Collapsed by default on mobile; the header chip covers the total. Has
   *  no visual effect on desktop — the CSS collapse rule only applies inside
   *  `@media (max-width: 767px)`, so the rail stays always-expanded there. */
  readonly summaryExpanded = signal<boolean>(false);

  toggleSummary(): void {
    this.summaryExpanded.update((v) => !v);
  }

  // ── Footer projections (read from the Cobro + Envío steps) ───────────────
  readonly footerProcessing = computed<boolean>(
    () =>
      this.submittingDraft() ||
      (this.paymentStep()?.isProcessing() ?? false) ||
      (this.shippingStep()?.isProcessing() ?? false),
  );
  readonly confirmDisabled = computed<boolean>(() => {
    if (this.footerProcessing()) return true;

    if (this.checkoutIntent() === 'delivery') {
      // Cobro es el último paso: la validez del envío ya se garantizó por el gate
      // de navegación (onConfirm re-valida y redirige a Envío si falta). Aquí solo
      // gatea el collector — para cash_on_delivery canSubmit() es true sin monto.
      const pay = this.paymentStep();
      if (!pay) return true;
      return !pay.canSubmit();
    }

    // pickup (B1): idéntico al collector + gate de mesa del paso Consumo.
    const step = this.paymentStep();
    if (!step) return true;
    return !step.canSubmit() || (this.consumoStep()?.needsTable() ?? false);
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

  /**
   * True while the major step is 'cobro' AND the Cobro sub-wizard still has
   * sub-steps pending before Monto. Lets the footer keep showing "Siguiente"
   * (driving Forma de pago → Método → Monto via {@link attemptNextStep}) instead
   * of the terminal CTA — even in delivery, where Cobro is the LAST major step
   * and {@link isLastStep} would otherwise force "Finalizar venta" from the very
   * first sub-step, leaving the payment sub-wizard un-navigable (the bug).
   */
  readonly cobroNeedsAdvance = computed<boolean>(
    () =>
      this.currentStepKey() === 'cobro' &&
      (this.paymentStep()?.hasPendingSubSteps() ?? false),
  );

  /**
   * Remount key for the projected checkout content. Incremented ONLY by
   * {@link resetState} (successful finalization) to force Angular to destroy +
   * recreate the payment-step/collector, shipping-step and consumo-step with a
   * pristine internal state. Projected content inside <app-modal> is NOT
   * destroyed on close (only detached from the DOM), and the collector only
   * resets on `context()` change (fires once), so without this its selected
   * method / cash amount / mode leak into the next sale — including across
   * cobro↔envío flows. Cancel never bumps it, so a mid-checkout close preserves
   * the operator's selections (QUI-482 invariant).
   */
  readonly contentEpoch = signal(0);

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

    // First-render only: apply the config-driven "Venta Anónima" default once,
    // as soon as the POS settings resolve and the operator has NOT overridden the
    // toggle. This REPLACES the retired reset-on-open effect — opening the modal no
    // longer resets ANY shell signal, so closing mid-checkout and reopening
    // preserves the operator's selections (QUI-482 invariant). The pristine reset
    // now happens only on a successful finalization (see resetState()).
    effect(() => {
      const allow = this.allowAnonymousSales();
      // Read the default too so the effect re-evaluates when settings resolve.
      void this.anonymousSalesAsDefault();
      if (this.anonymousDefaultSynced()) return;
      if (!allow) return; // settings not resolved yet (or anonymous disabled)
      untracked(() => {
        if (this.userOverrideAnonymous() === null) {
          this.syncAnonymousSaleState();
        }
        this.anonymousDefaultSynced.set(true);
      });
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

    // Clamp the Cliente sub-cursor when its dynamic sub-steps shrink (e.g. the
    // operator switches to an anonymous sale, or the intent flips to pickup).
    effect(() => {
      const len = this.clienteSubSteps().length;
      untracked(() => {
        if (this.clienteSubStep() >= len) {
          this.clienteSubStep.set(Math.max(0, len - 1));
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

    // Delivery sales cannot be anonymous (they require a customer + address).
    // Force the flag off AND pin the override to false so the config-driven
    // "anonymous as default" sync effect above never flips it back on while the
    // intent stays delivery. Leaves "Con Cliente" selected in the UI.
    effect(() => {
      if (this.anonymousBlockedByDelivery() && this.isAnonymousSale()) {
        untracked(() => {
          this.isAnonymousSale.set(false);
          this.userOverrideAnonymous.set(false);
        });
      }
    });

    // Auto-clear the address-error flash once the captured address becomes valid.
    effect(() => {
      if (this.addressValid()) {
        untracked(() => this.showAddressErrors.set(false));
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

  /**
   * Restore every shell signal to its declared initial value. Invoked ONLY after
   * a successful finalization (direct sale → {@link onCheckoutCompleted}, delivery
   * → {@link onShippingCompleted}) so the NEXT open starts pristine. It is NOT tied
   * to open/close or step navigation (QUI-482): a mid-checkout close preserves
   * state because nothing here runs on reopen. The final `syncAnonymousSaleState()`
   * re-applies the config-driven "Venta Anónima" default for the next sale.
   */
  private resetState(): void {
    this.currentStep.set(0);
    this.clienteSubStep.set(0);
    this.userOverrideAnonymous.set(null);
    this.capturedAddress.set(null);
    this.addressValid.set(false);
    this.capturedAddressId.set(null);
    this.showAddressErrors.set(false);
    this.showCustomerError.set(false);
    this.submittingDraft.set(false);
    this.syncAnonymousSaleState();
    // Remount the projected content so the child components (collector,
    // shipping-step, consumo-step) drop their internal state for the next sale.
    this.contentEpoch.update((n) => n + 1);
  }

  // ── Stepper navigation (non-blocking) ────────────────────────────────────
  goToStep(index: number): void {
    if (index < 0 || index >= this.stepKeys().length) return;
    this.currentStep.set(index);
  }

  /** Wizard: advance one top-level step (no-op past the last; state is preserved). */
  nextStep(): void {
    this.goToStep(this.currentStep() + 1);
  }

  /**
   * Footer "Siguiente" handler. Drives the mandatory sub-flows so NO required
   * step advances while incomplete, flashing in the UI what is missing instead
   * of jumping ahead:
   *  - Cliente (con-cliente): Tipo → Cliente → (delivery) Dirección. A customer
   *    is required for delivery before the Dirección sub-step; a valid address
   *    (with phone) is required before leaving Dirección.
   *  - Envío: a shipping method + address/cost must satisfy `canConfirm()`
   *    before reaching Cobro.
   * Every other step advances normally.
   */
  attemptNextStep(): void {
    const key = this.currentStepKey();

    // ── Cliente: sub-flujo obligatorio (Tipo → Cliente → Dirección) ──────────
    if (key === 'cliente' && !this.isAnonymousSale()) {
      const sub = this.clienteSubStep();
      // Tipo → Cliente (con-cliente ya elegido en este sub-paso).
      if (sub === 0) {
        this.goToClienteSubStep(1);
        return;
      }
      // Cliente → en delivery exige cliente antes de la Dirección.
      if (sub === 1) {
        if (this.requiresAddress()) {
          if (!this.cartState()?.customer) {
            this.showCustomerError.set(true);
            return;
          }
          this.goToClienteSubStep(2);
          return;
        }
        // Pickup con-cliente: Cliente es terminal; el collector valida el resto.
        this.nextStep();
        return;
      }
      // Dirección → exige dirección válida (con teléfono) antes de avanzar.
      if (sub === 2 && this.requiresAddress() && !this.addressValid()) {
        this.showAddressErrors.set(true);
        // Lleva el foco/viewport al primer campo inválido (ej. teléfono, que
        // en pantallas chicas queda fuera de vista). Reusa el utilitario del
        // fiscal-wizard; el navegador hace scroll nativo al enfocar.
        focusFirstInvalid(this.host);
        return;
      }
      this.nextStep();
      return;
    }

    // ── Envío: exige método + dirección/costo válidos antes de Cobro ─────────
    if (key === 'envio') {
      const ship = this.shippingStep();
      if (!ship?.canConfirm()) {
        ship?.flashValidation();
        return;
      }
      this.nextStep();
      return;
    }

    // ── Cobro: conduce el sub-wizard del collector (Forma → Método → Monto)
    // antes de saltar al siguiente paso mayor. En pickup, Cobro NO es el último
    // paso (Consumo → Cobro → Cliente); sin esto, "Siguiente" saltaba directo a
    // Cliente omitiendo Método y Monto (frames a7mp1 / G0dg6). El paso confirma
    // el monto en el último sub-paso, cuyo amountConfirmed avanza el paso mayor.
    if (key === 'cobro') {
      if (this.paymentStep()?.advanceSubStepOrConfirm()) return;
      this.nextStep();
      return;
    }

    this.nextStep();
  }

  /** Wizard: go back one top-level step (no-op before the first; forward state preserved). */
  prevStep(): void {
    this.goToStep(this.currentStep() - 1);
  }

  /**
   * Botón "Atrás" del footer móvil (estilo Pencil): retrocede un paso, o cierra
   * el modal cuando ya está en el primero (equivale a Cancelar). En desktop el
   * footer conserva Cancelar/Anterior por separado.
   */
  onBackMobile(): void {
    if (this.isFirstStep()) {
      this.onModalClosed();
    } else {
      this.prevStep();
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

    // delivery: shipping must be valid first (navigation is non-blocking).
    const ship = this.shippingStep();
    if (!ship?.canConfirm()) {
      this.goToStepKey('envio');
      ship?.flashValidation();
      return;
    }

    // Cobro is the LAST delivery step and runs deferred (autoExecute=false): the
    // collector emits paymentReady → onPaymentReady → shippingStep.execute(submit).
    // For cash_on_delivery the collector still emits a submit (its method carries
    // the store_payment_method_id); the backend processor returns 'pending'.
    const pay = this.paymentStep();
    if (!pay?.canSubmit()) {
      this.goToStepKey('cobro');
      return;
    }
    pay.triggerSubmit();
  }

  /** Deferred-payment channel from the Cobro step (delivery pay-now). */
  onPaymentReady(submit: PaymentSubmit): void {
    this.shippingStep()?.execute(submit);
  }

  /**
   * Bubbled from the Cobro step when the operator confirms the Monto via the
   * collector's in-panel "Aceptar". The collector already collapsed the amount
   * cards with the green one-shot fill (~420ms). We wait for that animation to
   * finish, then finalize (Cobro is the last step) or advance to the next step.
   * setTimeout is zoneless-safe: the signal writes inside onConfirm/attemptNextStep
   * schedule change detection through the signal graph.
   */
  onAmountConfirmed(): void {
    setTimeout(() => {
      if (this.isLastStep()) {
        this.onConfirm();
      } else {
        // El monto ya se confirmó dentro del collector: avanzamos el paso mayor
        // directamente. Usar nextStep() (no attemptNextStep) evita re-entrar en
        // la rama Cobro del sub-wizard, que volvería a confirmar y se colgaría.
        this.nextStep();
      }
    }, 420);
  }

  /** Re-emit the Envío step result to the parent (POS). */
  onShippingCompleted(shippingData: any): void {
    this.shippingCompleted.emit(shippingData);
    // Successful finalization → leave the shell pristine for the next open.
    this.resetState();
  }

  // ── Cliente sub-wizard navegación (presentacional; QUI-482) ──────────────
  /**
   * Salta el sub-wizard de Cliente a un sub-paso (clamp al rango). Presentacional:
   * volver a un sub-paso anterior NO resetea cliente/dirección — el estado vive en
   * `cartState().customer` / `capturedAddress` / `addressValid`; el colapso solo
   * cambia el índice activo.
   */
  goToClienteSubStep(index: number): void {
    const max = Math.max(0, this.clienteSubSteps().length - 1);
    this.clienteSubStep.set(Math.min(Math.max(index, 0), max));
    // Moving between sub-steps clears the flashed "falta cliente" hint.
    this.showCustomerError.set(false);
  }

  /**
   * Tipo de venta (sub-paso Tipo):
   *  - "Venta Anónima" estando YA anónima → avanza el wizard TOP-LEVEL
   *    (`nextStep()`): anónima solo tiene [Tipo], así que el segundo clic salta
   *    de paso (p.ej. Cliente → Envío en delivery). Si aún no era anónima, la
   *    fija y se queda en [Tipo] listo (un segundo clic avanza top-level).
   *  - "Con Cliente" → contrae Tipo y avanza al sub-paso Cliente (Buscar).
   */
  onSelectSaleType(anonymous: boolean): void {
    if (anonymous) {
      if (this.isAnonymousSale()) {
        this.nextStep();
        return;
      }
      this.toggleAnonymousSale(true);
      this.goToClienteSubStep(0);
      return;
    }
    this.toggleAnonymousSale(false);
    this.goToClienteSubStep(1);
  }

  /** Cliente elegido/creado: preserva la lógica de selectCustomer y avanza. */
  onSelectCustomerAndAdvance(customer: PosCustomer): void {
    this.selectCustomer(customer);
    // Delivery → sub-paso Dirección (2); sin delivery Cliente es terminal (clamp a 1).
    this.goToClienteSubStep(this.requiresAddress() ? 2 : 1);
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
    // A customer is now attached → clear any flashed "falta cliente" hint.
    this.showCustomerError.set(false);
    // El padre (POS) es dueño del carrito; solo re-emitimos.
    this.customerSelected.emit(customer);
    // Derive the customer's saved primary-address id so the Envío step reuses it
    // (null → the shipping step will create the captured address).
    const addresses = customer.addresses;
    const primary = addresses?.find((a) => a.is_primary) ?? addresses?.[0];
    this.capturedAddressId.set(primary?.id ?? null);

    // Seed the captured address from the customer's saved primary address so the
    // delivery gate is not blocked before the operator touches the form.
    // `app-address-form-fields` prefills via patchValue({emitEvent:false}) and
    // never emits addressChange/validChange on hydration, so `capturedAddress`
    // would otherwise stay null for an existing customer with a saved address.
    // We derive from the `customer` argument (NOT cartState(), which is still
    // stale here — the parent has not propagated the new customer yet).
    if (this.requiresAddress() && primary) {
      const seeded: AddressPayload = {
        address_line1: primary.address_line1 ?? null,
        address_line2: null,
        city: primary.city ?? null,
        state_province: primary.state_province ?? null,
        country_code: primary.country_code ?? 'CO',
        postal_code: null,
        phone_number: customer.phone ?? null,
        latitude: null,
        longitude: null,
      };
      this.capturedAddress.set(seeded);
      // Delivery requires a phone too (requirePhone on the form-fields). The
      // form prefills silently (no validChange on hydration), so seed the gate
      // consistently — phone included — to avoid a stale "valid" that would let
      // the operator skip an incomplete address.
      this.addressValid.set(
        !!(seeded.address_line1 && seeded.city && seeded.phone_number),
      );
    }
  }

  /** Live address payload from the shell-mounted `app-address-form-fields`. */
  onShellAddressChange(a: AddressPayload): void {
    this.capturedAddress.set(a);
  }

  /** "Quitar cliente / venta anónima" desde el selector inline. */
  onCustomerCleared(): void {
    this.toggleAnonymousSale(true);
  }

  // ── Step passthrough outputs ─────────────────────────────────────────────
  onCheckoutCompleted(paymentData: any): void {
    this.checkoutCompleted.emit(paymentData);
    // Successful finalization → leave the shell pristine for the next open.
    this.resetState();
  }

  onRequestCustomer(): void {
    this.requestCustomer.emit();
  }

  onTableSessionOpened(result: OpenTableSessionResult): void {
    this.tableSessionOpened.emit(result);
  }

  // ── Guardar borrador (folded from the retired pos-order-create-modal) ────
  /**
   * Restaurant + prepared lines that still need to be fired to the kitchen.
   * Copied verbatim from the legacy `pos-order-create-modal`; skipKds lines
   * ("usar stock") are excluded so they don't open the counter-fire /
   * table-append paths for the wrong reason.
   */
  readonly hasUnfiredPreparedItems = computed(() => {
    if (!this.integration.isRestaurantMode()) return false;
    return (this.cartState()?.items ?? []).some(
      (it: CartItem) =>
        it.itemType !== 'custom' &&
        (it.product as any)?.product_type === 'prepared' &&
        it.skipKds !== true,
    );
  });

  /**
   * Footer "Guardar borrador" dispatcher. Replicates the legacy modal's
   * `onConfirm()`: three branches by restaurant mode / open table session /
   * unfired prepared items. The `canConfirm()` gate is replaced by a plain
   * non-empty cart check (the modal's fulfillment/consumo gate lived inside
   * the Cobro step here).
   */
  onSaveDraft(): void {
    if (this.submittingDraft()) return;

    const state = this.cartState();
    if (!state || !(state.items?.length ?? 0)) return;

    this.submittingDraft.set(true);

    const isRestaurant = this.integration.isRestaurantMode();
    const hasPrepared = this.hasUnfiredPreparedItems();
    const session = this.integration.currentTableSession();

    if (isRestaurant && session?.order_id) {
      this.appendToTableAndFire(state, session);
      return;
    }

    if (isRestaurant && hasPrepared && !session) {
      this.createCounterAndFire(state);
      return;
    }

    this.createRetailDraft(state);
  }

  private createCounterAndFire(state: CartState): void {
    const lines = this.toCounterLines(state.items);
    if (lines.length === 0) {
      this.submittingDraft.set(false);
      this.toastService.warning('Agrega productos al carrito antes de crear la orden');
      return;
    }
    const customerId = this.resolveCustomerId(state.customer);
    this.integration
      .createCounterDraftOrder(customerId, lines)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (order) => {
          const orderId = order?.id;
          const preparedIds = this.preparedItemIdsFromOrder(order);
          this.maybeFireAndFinish(orderId, preparedIds, state);
        },
        error: (err) => {
          this.submittingDraft.set(false);
          this.toastService.error(this.toastError(err, 'No se pudo crear la orden'));
        },
      });
  }

  private appendToTableAndFire(state: CartState, session: any): void {
    const items = state.items
      .filter((it) => it.itemType !== 'custom')
      .map((it) => ({
        product_id: Number((it.product as any).id),
        quantity: it.quantity,
        product_variant_id: it.variant_id ?? undefined,
      }));
    if (items.length === 0) {
      this.submittingDraft.set(false);
      this.toastService.warning('Agrega productos al carrito antes de crear la orden');
      return;
    }
    this.integration
      .addItemsToTableSession(session.id, items)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (updated) => {
          const orderId = updated?.order?.id ?? session.order_id;
          const orderItemIds = (updated?.order?.order_items ?? [])
            .filter((it: any) =>
              items.some(
                (i) =>
                  i.product_id === it.product_id && i.quantity === it.quantity,
              ),
            )
            .map((it: any) => it.id);
          this.maybeFireAndFinish(orderId, orderItemIds, state);
        },
        error: (err) => {
          this.submittingDraft.set(false);
          this.toastService.error(this.toastError(err, 'No se pudo agregar ítems a la mesa'));
        },
      });
  }

  private createRetailDraft(state: CartState): void {
    this.paymentService
      .saveDraft(state, 'current_user')
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res: any) => {
          this.submittingDraft.set(false);
          if (!res?.success) {
            this.toastService.error(res?.message || 'Error al crear la orden');
            return;
          }
          this.toastService.success(res.message || 'Orden creada correctamente');
          this.finishDraft(res.order ?? null, [], false);
        },
        error: (err: any) => {
          this.submittingDraft.set(false);
          this.toastService.error(this.toastError(err, 'Error al crear la orden'));
        },
      });
  }

  private maybeFireAndFinish(
    orderId: number | undefined,
    orderItemIds: number[],
    state: CartState,
  ): void {
    if (!orderId) {
      this.finishDraft(null, orderItemIds, false);
      return;
    }
    this.integration
      .maybeFireKitchen(orderId, orderItemIds)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (fireRes) => {
          const fired = !!fireRes && fireRes.fired_item_ids.length > 0;
          if (fired) {
            this.toastService.success('Orden creada y enviada a cocina');
          } else {
            this.toastService.success('Orden creada');
          }
          this.finishDraft({ id: orderId } as any, orderItemIds, fired);
          void state; // keep for future extensions (notes / customer)
        },
        error: (err) => {
          // Order already persisted — surface the error but do not roll back.
          this.toastService.warning(
            'La orden se creó pero no se pudo enviar a cocina. Reintenta desde el panel.',
          );
          console.error('maybeFireKitchen failed', err);
          this.finishDraft({ id: orderId } as any, orderItemIds, false);
        },
      });
  }

  private finishDraft(
    order: any,
    orderItemIds: number[],
    firedToKitchen: boolean,
  ): void {
    const fulfillment: FulfillmentType | null = this.showConsumoStep()
      ? (this.consumoStep()?.fulfillment() ?? null)
      : null;
    const tableId =
      this.integration.currentTableSession()?.table_id ??
      this.tableId() ??
      this.consumoStep()?.pickedTableId?.() ??
      null;

    this.draftSaved.emit({ order, fulfillment, tableId, firedToKitchen });

    this.cartService
      .clearCart()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => this.isOpenChange.emit(false),
        error: () => this.isOpenChange.emit(false),
      });

    this.submittingDraft.set(false);
    void orderItemIds;
  }

  // ─── Draft helpers (copied from the legacy modal) ────────────────────────
  private toCounterLines(items: CartItem[]): Array<{
    product_id: number;
    product_variant_id?: number;
    product_name: string;
    quantity: number;
    unit_price: number;
    total_price: number;
    tax_rate?: number;
  }> {
    return items
      .filter((it) => it.itemType !== 'custom')
      .map((it) => ({
        product_id: Number((it.product as any).id),
        product_variant_id: it.variant_id ?? undefined,
        product_name: it.product.name,
        quantity: it.quantity,
        unit_price: Number(it.unitPrice || 0),
        total_price: Number(it.totalPrice || 0),
        tax_rate: (it.product as any)?.tax_rate ?? undefined,
      }));
  }

  private preparedItemIdsFromOrder(order: any): number[] {
    const items: any[] = order?.order_items ?? [];
    const cart = this.cartState()?.items ?? [];
    const skipKdsKeys = new Set<string>();
    for (const ci of cart) {
      if (ci?.skipKds !== true) continue;
      const pid = Number((ci.product as any)?.id);
      if (!Number.isFinite(pid)) continue;
      const vid = ci.variant_id ?? null;
      skipKdsKeys.add(`${pid}::${vid}`);
    }
    return items
      .filter(
        (it) =>
          it?.product?.product_type === 'prepared' ||
          it?.product_type === 'prepared',
      )
      .map((it) => {
        const pid = Number(it?.product_id);
        const vid = it?.product_variant_id ?? null;
        return {
          id: Number(it.id),
          skip: skipKdsKeys.has(`${pid}::${vid}`),
        };
      })
      .filter((x) => Number.isFinite(x.id) && !x.skip)
      .map((x) => x.id);
  }

  private resolveCustomerId(customer: PosCustomer | null | undefined): number {
    if (!customer) return 0;
    const id = Number((customer as any).id);
    return Number.isFinite(id) && id > 0 ? id : 0;
  }

  private toastError(err: any, fallback: string): string {
    const msg = extractApiErrorMessage(err);
    return msg && msg.length ? msg : fallback;
  }

  // ── Close ────────────────────────────────────────────────────────────────
  onModalClosed(): void {
    this.customerSelector()?.reset();
    this.isOpenChange.emit(false);
    this.closed.emit();
  }
}
