import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
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

  // ── Child references ────────────────────────────────────────────────────
  protected readonly consumoStep = viewChild(PosConsumoStepComponent);
  protected readonly paymentStep = viewChild(PosPaymentStepComponent);
  protected readonly shippingStep = viewChild(PosShippingStepComponent);
  private readonly customerSelector = viewChild(PosCustomerSelectorComponent);

  // ── Pay timing (delivery only; owned here, two-way with the Envío step) ──
  readonly payTiming = signal<'now' | 'later'>('now');

  // ── Address capture (moved from the Envío step into the Cliente step) ────
  /** Live address payload emitted by the shell-mounted `app-address-form-fields`. */
  readonly capturedAddress = signal<AddressPayload | null>(null);
  /** Validity of the captured address (drives whether delivery can proceed). */
  readonly addressValid = signal<boolean>(false);
  /** Id of the selected customer's saved address; null → the Envío step creates it. */
  readonly capturedAddressId = signal<number | null>(null);

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
   * Dynamic steps by intent + "cuándo paga":
   *  - pickup (no restaurante)   → [Cobro, Cliente]
   *  - pickup (restaurante)      → [Consumo, Cobro, Cliente]
   *  - delivery + pagar ahora    → [Cobro, Cliente, Envío]
   *  - delivery + contra-entrega → [Cliente, Envío]  (sin Cobro)
   */
  readonly steps = computed<StepsLineItem[]>(() => {
    if (this.checkoutIntent() === 'delivery') {
      return this.payTiming() === 'now'
        ? [{ label: 'Cobro' }, { label: 'Cliente' }, { label: 'Envío' }]
        : [{ label: 'Cliente' }, { label: 'Envío' }];
    }
    return this.showConsumoStep()
      ? [{ label: 'Consumo' }, { label: 'Cobro' }, { label: 'Cliente' }]
      : [{ label: 'Cobro' }, { label: 'Cliente' }];
  });

  /** Parallel key array (same order/length as {@link steps}) used to render the
   *  active body and gate which step components mount. */
  readonly stepKeys = computed<string[]>(() => {
    if (this.checkoutIntent() === 'delivery') {
      return this.payTiming() === 'now'
        ? ['cobro', 'cliente', 'envio']
        : ['cliente', 'envio'];
    }
    return this.showConsumoStep()
      ? ['consumo', 'cobro', 'cliente']
      : ['cobro', 'cliente'];
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

  // ── Draft-order (Guardar borrador) submission state ──────────────────────
  readonly submittingDraft = signal(false);

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
          this.capturedAddress.set(null);
          this.addressValid.set(false);
          this.capturedAddressId.set(null);
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
      this.addressValid.set(!!(seeded.address_line1 && seeded.city));
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
