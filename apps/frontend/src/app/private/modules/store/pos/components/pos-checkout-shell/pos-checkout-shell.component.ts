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
import { StoreOrdersService } from '../../../orders/services/store-orders.service';

export type CheckoutIntent = 'pickup' | 'delivery';

/**
 * Fase 5·B1 — `app-pos-checkout-shell`.
 *
 * SHELL con stepper que unifica el checkout POS. En B1 cubre el flujo
 * NO-delivery (pago sin envío) con dos pasos: **Cobro** (hospeda el
 * `app-pos-payment-step`) y **Cliente** (toggle anónimo/cliente + selector), cuyo
 * ORDEN es dinámico según la matriz documentada en {@link PosCheckoutShellComponent.steps}.
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
  /**
   * CP-POS-MODAL-SCOPE-001 / Phase A.1 — drives stepper, footer CTAs and
   * handler routing. `create-draft` shows only the Cliente step + Guardar;
   * `edit` shows Cliente+Cobro with Actualizar+Cobrar; `create-payment`
   * shows Cliente+Cobro with only Cobrar. Defaults to `create-draft` so
   * the legacy flow keeps working for any caller that forgets to bind it.
   */
  readonly mode = input<'create-draft' | 'edit' | 'create-payment'>(
    'create-draft',
  );

  /**
   * CP-POS-MODAL-SCOPE-001 / Phase F.10 — the effective mode the shell acts
   * on. When the post-edit transition is active (parent sent `mode='edit'`
   * and the cashier successfully PUT /editor'd), this returns
   * `'create-payment'` so the primary CTA relabels to "Cobrar" and
   * onPrimaryConfirm routes through the collector (POST flow/pay). All
   * routing logic reads this instead of `mode()` directly.
   */
  readonly effectiveMode = computed<'create-draft' | 'edit' | 'create-payment'>(
    () => (this.postEditPaymentMode() ? 'create-payment' : this.mode()),
  );
  /** Set when `mode='edit'`; identifies the order being updated. */
  readonly editingOrderId = input<number | null>(null);

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
  /**
   * CP-POS-MODAL-SCOPE-001 / Phase A.3 — emitted when `mode='edit'` and the
   * order is updated via PUT /editor. Payload is the fresh Order returned by
   * the backend. The parent should refresh `readyToPayOrder`, `editingOrder`
   * and `cartState` so the cashier can immediately Cobrar on the updated
   * order without leaving the POS.
   */
  readonly editorUpdated = output<any>();

  private readonly currencyService = inject(CurrencyFormatService);
  private readonly settingsFacade = inject(StoreSettingsFacade);
  private readonly cartService = inject(PosCartService);
  private readonly paymentService = inject(PosPaymentService);
  private readonly integration = inject(PosRestaurantIntegrationService);
  // CP-POS-MODAL-SCOPE-001 / Phase A.2 — orderService for PUT /editor
  // (mode='edit') and for any future order-level operations.
  private readonly ordersService = inject(StoreOrdersService);
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
   * Phase D.2 / ADR-1 — "toda venta lleva cliente": el ajuste canónico es
   * `settings.checkout.require_customer_data`, NO `pos.allow_anonymous_sales`.
   * El primero es la política de checkout (alta en la jerarquía de settings);
   * el segundo es un eje operativo del cashier. Mezclarlos producía órdenes
   * huérfanas porque `allow_anonymous_sales=false` bloqueaba el flujo sin
   * marcar la obligatoriedad del cliente en el editor.
   *
   * QUI-audit-round-1: la rama `checkoutIntent() === 'pickup'` que vivía aquí
   * era POLLUTION — pickup NO fuerza cliente por sí solo; la obligatoriedad
   * viene de la política o de la dirección de envío. Se separan los dos
   * motivos en sendos computed para que el template componga.
   *
   * Lazy-eval: `customerRequired` se declara más abajo, pero este computed solo
   * corre al leerse (ya inicializado).
   */
  readonly customerRequiredByPolicy = computed<boolean>(
    () => this.checkoutRequireCustomerData(),
  );

  /**
   * El cliente es obligatorio PORQUE la venta tiene dirección de envío (no por
   * política): la dirección se ata a un cliente y sin él no se puede capturar
   * un envío. Distinto motivo → distinto computed.
   */
  readonly customerRequiredByAddress = computed<boolean>(
    () => this.requiresAddress(),
  );

  /**
   * Composición que alimenta templates y guards que sólo necesitan "se requiere
   * cliente" sin importar el motivo. Cero rama pickup solapada.
   *
   * Round 8 — el POS-side flag `pos.allow_anonymous_sales` es escape hatch:
   * aunque la política exija cliente, el cashier puede vender sin él desde el
   * POS. Por tanto "obligatorio" sólo cuando la política lo exige Y el POS
   * no tiene la ventana abierta. La dirección de envío sigue exigiendo
   * cliente siempre (no hay forma de atar un envío sin un customer_id).
   */
  readonly customerRequired = computed<boolean>(
    () =>
      (this.customerRequiredByPolicy() && !this.allowAnonymousSales()) ||
      this.customerRequiredByAddress(),
  );

  /**
   * El paso Cliente no se puede abandonar sin cliente, por cualquiera de sus dos
   * razones: hay envío (la dirección lo exige) o la tienda prohíbe ventas
   * anónimas ({@link customerRequiredByPolicy}) sin el escape hatch POS abierto.
   * Alimenta el badge "Obligatorio" y el aviso inline del panel Cliente.
   */
  readonly customerMandatory = computed<boolean>(
    () =>
      this.customerRequiredByAddress() ||
      (this.customerRequiredByPolicy() &&
        !this.allowAnonymousSales() &&
        // QUI-737 (B.4) — el modo alias existe para NO pedir un cliente
        // completo; si la tienda lo permite, "Obligatorio" no debe encenderse
        // solo por la política (que el alias no necesita).
        !this.allowAliasSales()),
  );

  /**
   * Copy del aviso inline cuando falta el cliente. Existe para que el template
   * tenga UN solo bloque de mensaje para las dos razones de obligatoriedad: el
   * texto cambia, el markup no.
   */
  readonly customerErrorMessage = computed<string>(() =>
    this.requiresAddress()
      ? 'Selecciona un cliente para continuar con el envío.'
      : 'Selecciona o crea un cliente para continuar.',
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
   * QUI-535 — mesa que el cobro debe materializar. Fuente ÚNICA de la mesa del
   * checkout: cuando el paso Consumo está montado manda él (respeta la elección
   * del operador y devuelve null en "Para llevar"); si no está montado, cae a la
   * mesa residual del padre. El backend abre/reusa y cierra la sesión de esa mesa
   * dentro de la transacción del pago (`table_id`).
   */
  readonly checkoutTableId = computed<number | null>(() => {
    if (this.showConsumoStep()) {
      return this.consumoStep()?.checkoutTableId() ?? null;
    }
    return this.tableId();
  });

  /**
   * Sesión de mesa PREEXISTENTE contra la cual cobrar (abierta desde el módulo
   * de mesas o por el QR del comensal). Solo se envía cuando la sesión cacheada
   * pertenece a la mesa que se está cobrando: así nunca se cobra la cuenta de una
   * mesa distinta a la que ve el operador. Cuando es null y hay
   * {@link checkoutTableId}, el backend abre la sesión él mismo.
   */
  readonly checkoutSessionId = computed<number | null>(() => {
    const tableId = this.checkoutTableId();
    if (tableId == null) return null;
    const session = this.integration.currentTableSession();
    if (!session || session.table_id !== tableId) return null;
    return session.id ?? null;
  });

  /**
   * Orden dinámico de pasos. `delivery` es fijo — [Cliente, Envío, Cobro], Cobro
   * SIEMPRE al final. Los flujos no-delivery se cruzan con {@link customerRequired}
   * y {@link showConsumoStep}:
   *
   * | customerRequired | showConsumoStep | orden                     |
   * | ---------------- | --------------- | ------------------------- |
   * | false            | false           | [Cobro, Cliente]          |
   * | false            | true            | [Consumo, Cobro, Cliente] |
   * | true             | false           | [Cliente, Cobro]          |
   * | true             | true            | [Consumo, Cliente, Cobro] |
   *
   * QUI-561 — por qué se adelanta Cliente: el paso Cobro exige cliente cuando la
   * venta no es anónima (`[requireCustomer]="!isAnonymous()"` → el collector deja
   * `canSubmit()` en false), y con `allow_anonymous_sales=false` ese cliente no lo
   * había capturado NADIE todavía en pickup, porque Cliente iba DESPUÉS. Resultado:
   * "Siguiente" no hacía nada y no mostraba error (el atasco reportado). Con el
   * cliente obligatorio el paso Cliente va antes, exactamente como delivery.
   *
   * **El orden depende del SETTING ({@link customerRequired}), NO del flag mutable
   * {@link isAnonymousSale}**: {@link currentStep} es un índice numérico y
   * reordenar el arreglo a mitad del checkout lo dejaría apuntando a otro paso.
   *
   * Consecuencia deseada de la matriz: con cliente obligatorio Cobro pasa a ser el
   * ÚLTIMO paso, así que confirmar el monto FINALIZA la venta — el mismo
   * comportamiento que delivery ya tiene hoy.
   *
   * "Contra entrega" ya no es un eje aparte: es el método de pago
   * `cash_on_delivery` (processing_mode ON_DELIVERY) que el paso Cobro ofrece
   * solo cuando la intención es delivery.
   */
  readonly steps = computed<StepsLineItem[]>(() => {
    // CP-POS-MODAL-SCOPE-001 / Phase A.1 — `create-draft` (Crear) renders
    // only the Cliente step. There is no Cobro step in the create-draft
    // flow because the order has not been saved yet and there is nothing
    // to charge. The cashier exits via `Guardar borrador`.
    if (this.effectiveMode() === 'create-draft') {
      return [{ label: 'Cliente' }];
    }
    if (this.checkoutIntent() === 'delivery') {
      return [{ label: 'Cliente' }, { label: 'Envío' }, { label: 'Cobro' }];
    }
    if (this.showConsumoStep()) {
      return [
        { label: 'Consumo' },
        { label: 'Cliente' },
        { label: 'Cobro' },
      ];
    }
    return [{ label: 'Cliente' }, { label: 'Cobro' }];
  });

  /** Parallel key array (same order/length as {@link steps}) used to render the
   *  active body and gate which step components mount. Debe espejar EXACTAMENTE
   *  la matriz documentada en {@link steps}: ambos comparten {@link currentStep}
   *  como índice, así que una discrepancia desalinea la UI del cuerpo activo. */
  readonly stepKeys = computed<string[]>(() => {
    // CP-POS-MODAL-SCOPE-001 / Phase A.1 — same scoping as `steps()`.
    if (this.effectiveMode() === 'create-draft') {
      return ['cliente'];
    }
    if (this.checkoutIntent() === 'delivery') {
      return ['cliente', 'envio', 'cobro'];
    }
    if (this.showConsumoStep()) {
      return ['consumo', 'cliente', 'cobro'];
    }
    return ['cliente', 'cobro'];
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

  // ── Sale mode (tri-state) + Anonymous ownership ─────────────────────────
  /**
   * QUI-737 (B.4) — tri-state de venta: `'anonymous'` (sin cliente), `'alias'`
   * (venta rápida identificada por alias, ej. "Mesa 5"), `'customer'` (cliente
   * real). Es la FUENTE de la verdad del modo; {@link isAnonymousSale} es
   * derivado. El booleano legado queda como computed para no romper los ~15
   * puntos de lectura, pero TODA escritura pasa por {@link saleMode}.
   */
  readonly saleMode = signal<'anonymous' | 'alias' | 'customer'>('customer');
  /**
   * Texto del alias de venta rápida (ej. "Mesa 5", "Juan del taller"). Solo
   * tiene sentido cuando {@link saleMode} === 'alias'. El payload envía
   * `customer_alias: alias || undefined` (nunca `''`).
   */
  readonly customerAlias = signal<string>('');

  readonly isAnonymousSale = computed(() => this.saleMode() === 'anonymous');
  readonly userOverrideAnonymous = signal<boolean | null>(null);
  /** Guard: apply the config-driven anonymous default only on the first render. */
  private readonly anonymousDefaultSynced = signal(false);

  readonly allowAnonymousSales = computed(
    () => this.settingsFacade.pos()?.allow_anonymous_sales ?? false,
  );
  readonly anonymousSalesAsDefault = computed(
    () => this.settingsFacade.pos()?.anonymous_sales_as_default ?? false,
  );
  /**
   * QUI-737 (B.4) — alias opt-in. Leído del POS settings. NOTA: el tipo
   * `PosSettings` (core, fuera de scope) aún no declara estos campos, por eso
   * el cast; cuando se tipen, quitar el `(… as any)`.
   */
  readonly allowAliasSales = computed(
    () => (this.settingsFacade.pos() as any)?.allow_alias_sales ?? false,
  );
  readonly aliasSalesAsDefault = computed(
    () => (this.settingsFacade.pos() as any)?.alias_sales_as_default ?? false,
  );

  /**
   * Phase D.2 / ADR-1 — canonical customer-required source. Defaults to
   * `true` when the settings have not resolved yet: the BACKEND is
   * authoritative, but failing closed in the UI prevents a stale
   * "no customer required" preview while settings load. The backend rejects
   * the request anyway with `POS_CUSTOMER_REQUIRED_001` if the policy is
   * actually false and we let the cashier skip the step.
   */
  readonly checkoutRequireCustomerData = computed<boolean>(
    () => this.settingsFacade.checkout()?.require_customer_data ?? true,
  );

  /** Anonymous option is hidden when the collector is in credit mode.
   *  Round 3 MAJOR #4 — also hidden when the policy requires a customer
   *  (`settings.checkout.require_customer_data=true`): an anonymous sale is
   *  structurally incompatible with the policy, so the toggle is hidden
   *  rather than shown-then-rejected. The legacy `pos-order-create-modal`
   *  used to expose it anyway; the backend then returned 422 with
   *  `POS_CUSTOMER_REQUIRED_001`. */
  /**
   * Whether the "Venta Anónima" toggle is visible. Driven by the POS
   * flag `pos.allow_anonymous_sales` — that flag is the canonical source
   * for whether the cashier can sell without a customer at the POS. We
   * intentionally ignore `settings.checkout.require_customer_data` here
   * because that flag governs electronic invoicing (DIAN/factura
   * electrónica), not POS-terminal walk-in sales. The customer-required
   * gate still fires when the operator tries to save a draft via the
   * "Guardar" button (the POS-side flag is the policy for that path), so
   * both flags stay honored at their respective code paths.
   *
   * `paymentStep.mode === 'credito'` (installment/credit sale) still
   * requires a customer because the credit plan attaches to a person.
   */
  readonly canBeAnonymous = computed<boolean>(
    () =>
      this.allowAnonymousSales() &&
      this.paymentStep()?.mode() !== 'credito',
  );

  /**
   * QUI-737 (B.4) — whether the "Venta con nombre o referencia" option is
   * offered. Mirrors {@link canBeAnonymous}: alias needs `pos.allow_alias_sales`
   * AND is incompatible with a credit sale (fiarse a "Mesa 5" en crédito no
   * tiene sentido — el plan a crédito se ata a una persona). Delivery también lo
   * excluye (la dirección se ata a un cliente real).
   */
  readonly canBeAlias = computed<boolean>(
    () =>
      this.allowAliasSales() &&
      this.paymentStep()?.mode() !== 'credito',
  );

  /**
   * Delivery sales cannot be anonymous: they require a customer with a shipping
   * address. The "Venta Anónima" button stays VISIBLE but DISABLED in this case
   * (with an explanatory legend) — see the template.
   */
  readonly anonymousBlockedByDelivery = computed<boolean>(
    () => this.checkoutIntent() === 'delivery',
  );

  /**
   * QUI-737 (B.4) — delivery sales cannot be alias-based either: the shipping
   * address is bound to a real customer. The alias option is hidden in delivery.
   */
  readonly aliasBlockedByDelivery = computed<boolean>(
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
    // QUI-737 (B.4) — modo alias: sub-paso propio de captura del alias.
    if (this.saleMode() === 'alias') return [{ label: 'Tipo' }, { label: 'Alias' }];
    if (this.requiresAddress()) {
      return [{ label: 'Tipo' }, { label: 'Cliente' }, { label: 'Dirección' }];
    }
    return [{ label: 'Tipo' }, { label: 'Cliente' }];
  });

  // ── Draft-order (Guardar borrador) submission state ──────────────────────
  readonly submittingDraft = signal(false);

  /**
   * CP-POS-MODAL-SCOPE-001 / Phase F.10 — `mode` is an `input()` (parent-driven)
   * so we cannot `set()` it. After a successful PUT /editor in mode='edit'
   * we want the same shell to switch into payment-collection mode (CTA
   * "Cobrar", POST flow/pay). This internal boolean mirrors the
   * `mode` input and overrides it for routing/label/autoExecute decisions
   * without forcing the parent to re-bind the input.
   */
  readonly postEditPaymentMode = signal<boolean>(false);

  /**
   * CP-POS-MODAL-SCOPE-001 / Phase F.10 — when `mode` flips from 'edit' to
   * 'create-payment' after a successful PUT /editor, the Cobro step mounts
   * and `autoExecute=true` would fire the collector immediately with no
   * payment method / amount selected (silent fail). Set this flag in the
   * mode-flip path so autoExecute waits for the cashier to actually pick a
   * method. Cleared the next time the shell opens in mode='create-payment'
   * from a fresh entry (reset by the constructor-effect on `mode` change).
   */
  readonly suppressAutoExecute = signal(false);

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

    // CP-POS-MODAL-SCOPE-001 / Phase A.4 — `create-draft` does not mount the
    // Cobro step (no paymentStep instance exists). The Guardar CTA must gate
    // on the cart contents + customer gate only:
    //   - cart must have ≥1 item
    //   - if `pos.allow_anonymous_sales=false`, customer is required
    //   - if true, customer is optional; the shell still needs *some* customer
    //     OR explicit `isAnonymousSale=true` to honor the policy
    if (this.effectiveMode() === 'create-draft') {
      const state = this.cartState();
      if (!state || !(state.items?.length ?? 0)) return true;
      // QUI-737 (B.4) — el modo alias es una tercera salida legítima de "sin
      // cliente" (además de anónimo), siempre que el alias no esté vacío.
      if (this.isAnonymousSale()) return false;
      if (this.saleMode() === 'alias') return !this.customerAlias().trim();
      if (state.customer?.id != null) return false;
      // No customer picked and not anonymous → block. The shell already
      // surfaces a toast in `createRetailDraft`, so this just keeps the CTA
      // disabled to avoid a round-trip rejection.
      return !this.allowAnonymousSales();
    }

    if (this.checkoutIntent() === 'delivery') {
      // Cobro es el último paso: la validez del envío ya se garantizó por el gate
      // de navegación (onConfirm re-valida y redirige a Envío si falta). Aquí solo
      // gatea el collector — para cash_on_delivery canSubmit() es true sin monto.
      const pay = this.paymentStep();
      if (!pay) return true;
      return !pay.canSubmit();
    }

    // pickup (B1): idéntico al collector + gate de mesa del paso Consumo. Vale
    // para las dos posiciones de Cobro (intermedio → el CTA terminal vive en
    // Cliente; último con cliente obligatorio → vive en Cobro): lo que decide en
    // ambos casos es canSubmit() del collector, no el índice del paso.
    const step = this.paymentStep();
    if (!step) return true;
    return !step.canSubmit() || (this.consumoStep()?.needsTable() ?? false);
  });
  /** Delivery → 'Finalizar venta'. Pickup → replica el label del collector. */
  readonly confirmLabel = computed<string>(() => {
    // CP-POS-MODAL-SCOPE-001 / Phase A.1 — the terminal CTA label varies
    // by mode so the cashier knows which action will fire:
    // - create-draft → "Guardar" (saves draft, no payment)
    // - edit         → "Actualizar" (PUT /editor)
    // - create-payment / delivery / pickup → existing copy
    if (this.effectiveMode() === 'create-draft') return 'Guardar';
    if (this.effectiveMode() === 'edit') return 'Actualizar';
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
   * of the terminal CTA — imprescindible en TODO flujo donde Cobro es el último
   * paso mayor (delivery, y pickup con {@link customerRequired}), porque
   * {@link isLastStep} forzaría el CTA terminal desde el primer sub-paso y dejaría
   * el sub-wizard de pago sin navegación (el bug).
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
    // explicitly overrode it or a customer is already attached to the cart.
    effect(() => {
      const allow = this.allowAnonymousSales();
      const asDefault = this.anonymousSalesAsDefault();
      const override = this.userOverrideAnonymous();
      const hasCartCustomer = !!this.cartState()?.customer;
      const effective = !allow
        ? false
        : (override ?? (hasCartCustomer ? false : asDefault));
      untracked(() => {
        // QUI-737 (B.4) — no pelear una elección explícita de alias.
        if (this.saleMode() === 'alias') return;
        const desired = effective ? 'anonymous' : 'customer';
        if (this.saleMode() !== desired) this.saleMode.set(desired);
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

    // CP-POS-MODAL-SCOPE-001 / Phase A.1 — when `mode` flips (e.g. parent
    // opens the shell again with a different intent), reset the top-level
    // cursor AND the Cliente sub-cursor so we never land on an out-of-range
    // step (e.g. mode='edit' → mode='create-draft' would otherwise leave
    // currentStep=1 on a single-step wizard). Reset is idempotent.
    effect(() => {
      this.mode();
      untracked(() => {
        this.currentStep.set(0);
        this.clienteSubStep.set(0);
        // CP-POS-MODAL-SCOPE-001 / Phase F.10 — clear the post-edit autoExecute
        // suppress + the internal post-edit payment flag when the parent
        // re-opens the shell with a (possibly different) mode, so the NEXT open
        // in mode='create-payment' (fresh sale, not post-edit) keeps the
        // original auto-fire behaviour.
        this.suppressAutoExecute.set(false);
        this.postEditPaymentMode.set(false);
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

    // Credit sales cannot be anonymous (or alias): when the collector enters
    // credito mode, clear both flags so the customer selector is shown. Fiarse
    // a "Mesa 5" en crédito no tiene sentido — el plan a crédito se ata a una
    // persona (QUI-737 B.4; paridad con anónimo).
    effect(() => {
      if (this.paymentStep()?.mode() === 'credito') {
        const mode = this.saleMode();
        if (mode === 'anonymous' || mode === 'alias') {
          untracked(() => this.saleMode.set('customer'));
        }
      }
    });

    // Delivery sales cannot be anonymous or alias-based (they require a
    // customer + address). Force the flag off AND pin the override to false so
    // the config-driven "anonymous as default" sync effect above never flips it
    // back on while the intent stays delivery. Leaves "Con Cliente" selected.
    effect(() => {
      if (this.anonymousBlockedByDelivery()) {
        const mode = this.saleMode();
        if (mode === 'anonymous') {
          untracked(() => {
            this.saleMode.set('customer');
            this.userOverrideAnonymous.set(false);
          });
        } else if (mode === 'alias') {
          untracked(() => this.saleMode.set('customer'));
        }
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
      this.saleMode.set('customer');
      return;
    }
    const override = this.userOverrideAnonymous();
    const hasCartCustomer = !!this.cartState()?.customer;
    const anon =
      override ?? (hasCartCustomer ? false : this.anonymousSalesAsDefault());
    this.saleMode.set(anon ? 'anonymous' : 'customer');
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
    // QUI-737 (B.4) — limpiar el alias para la próxima venta.
    this.customerAlias.set('');
    this.capturedAddress.set(null);
    this.addressValid.set(false);
    this.capturedAddressId.set(null);
    this.showAddressErrors.set(false);
    this.showCustomerError.set(false);
    this.submittingDraft.set(false);
    // CP-POS-MODAL-SCOPE-001 / Phase F.10 — drop the post-edit payment mode
    // override after a successful finalization so the NEXT sale starts in
    // whatever mode the parent binds (not stuck in the implicit 'create-payment'
    // from the previous edit-then-cobrar transition).
    this.postEditPaymentMode.set(false);
    this.suppressAutoExecute.set(false);
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
   *    is required for delivery before the Dirección sub-step, and también para
   *    salir del sub-paso Cliente cuando {@link customerRequired} (QUI-561); a
   *    valid address (with phone) is required before leaving Dirección.
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
        // QUI-737 (B.4) — sub-paso "Alias": falta el texto del alias.
        if (this.saleMode() === 'alias') {
          if (!this.customerAlias().trim()) {
            this.showCustomerError.set(true);
            return;
          }
          // Alias es terminal en pickup (delivery bloquea alias) → avanzamos.
          this.nextStep();
          return;
        }
        // QUI-723 — Sub-step unificado: si no hay cliente seleccionado, el
        // botón "Siguiente" dispara find-or-create desde el formulario del
        // sub-step. Solo avanzamos cuando `resolveIfNeeded()` confirma éxito;
        // si el form está vacío o el backend rechaza, el selector muestra un
        // toast y el sub-step queda visible para que el cajero corrija.
        if (!this.cartState()?.customer) {
          const selector = this.customerSelector();
          if (!selector) {
            // Sin referencia al selector (¿modal cerrado a mitad del flujo?):
            // caemos al fallback legacy para no dejar al cajero trabado.
            this.flagMissingCustomer();
            return;
          }
          selector
            .resolveIfNeeded()
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe((resolved) => {
              if (!resolved) return; // toast ya emitido por el selector.
              // IMPORTANT — DO NOT recurse into `attemptNextStep()` here:
              // the parent's `cartService.setCustomer()` is async (HTTP), so
              // `cartState().customer` is still null when this subscribe
              // fires, and the recursion would re-enter the resolve branch
              // with an empty form (silent failure, no advance). The
              // shell's `onSelectCustomerAndAdvance` already moved the
              // sub-step synchronously (to 2 for delivery, kept at 1 for
              // pickup), so we can advance based on `clienteSubStep()` here.
              if (this.requiresAddress()) {
                // Delivery: stay at sub-step 2 (Dirección). User must fill
                // the address before clicking Siguiente again.
                return;
              }
              // Pickup (no delivery): sub stayed at 1. Advance to Cobro.
              this.nextStep();
            });
          return;
        }

        if (this.requiresAddress()) {
          this.goToClienteSubStep(2);
          return;
        }
        // Pickup con-cliente: Cliente es el sub-paso terminal. Si llegamos
        // acá con cliente cargado, el resolve ya surtió efecto — avanzamos.
        // (La rama customerRequired+!customer ya quedó cubierta arriba con el
        // resolveIfNeeded.)
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
    // antes de saltar al siguiente paso mayor. Cuando Cobro es intermedio
    // (Consumo → Cobro → Cliente, ventas anónimas permitidas) sin esto
    // "Siguiente" saltaba directo a Cliente omitiendo Método y Monto (frames
    // a7mp1 / G0dg6). Cuando Cobro es el último paso (delivery o pickup con
    // cliente obligatorio) el footer solo llega aquí mientras
    // cobroNeedsAdvance(), y el nextStep() final es un no-op inofensivo. El paso
    // confirma el monto en el último sub-paso, cuyo amountConfirmed finaliza
    // (Cobro último) o avanza el paso mayor.
    if (key === 'cobro') {
      if (this.paymentStep()?.advanceSubStepOrConfirm()) return;
      this.nextStep();
      return;
    }

    this.nextStep();
  }

  /**
   * Falta el cliente en el sub-paso Cliente: enciende el aviso inline y lleva el
   * foco/viewport al primer campo inválido (útil cuando el operador dejó el
   * formulario de creación a medias). Único punto de aviso para las dos razones
   * de obligatoriedad — envío y {@link customerRequired} — porque un CTA que no
   * avanza sin decir por qué no cuenta como aviso.
   */
  private flagMissingCustomer(): void {
    this.showCustomerError.set(true);
    focusFirstInvalid(this.host);
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

  /**
   * QUI-739 (B.2) — handler del "Cambiar tipo de servicio" del paso Consumo.
   * DIFERENTE del "Anterior"/"← Atrás" del footer: éste BORRA a propósito la
   * elección de fulfillment + la mesa (vía `resetFulfillment()` del child)
   * antes de volver al paso "Tipo". El rótulo del botón ("Cambiar tipo de
   * servicio") anuncia el reset antes de tocarlo; el footer conserva la
   * semántica QUI-482 (preserva estado). Dos controles, dos comportamientos.
   *
   * `prevStep()` es un no-op cuando Consumo es el paso 0 (el caso normal:
   * Consumo abre el stepper), pero se mantiene por simetría con la
   * navegación y porque la matriz de sub-pasos puede recolocar Consumo.
   */
  onConsumoBack(): void {
    this.consumoStep()?.resetFulfillment();
    this.prevStep();
  }

  /** Navigate by step key; no-op when the key is not part of the current flow. */
  private goToStepKey(key: string): void {
    const index = this.stepKeys().indexOf(key);
    if (index >= 0) this.goToStep(index);
  }

  // ── Footer actions ───────────────────────────────────────────────────────
  /**
   * CP-POS-MODAL-SCOPE-001 / Phase A.2 — single primary CTA handler that
   * routes by `mode()`:
   * - `create-draft`  → saveDraft (no payment, no editor).
   * - `edit`          → ordersService.updateOrderEditor (PUT /editor).
   * - `create-payment` / delivery → existing Cobro step path (kept verbatim).
   *
   * The legacy `onConfirm` continues to be called by template events that
   * need the payment-step flow only (delivery). We keep both methods on the
   * component so existing bindings keep working until the template is
   * migrated.
   */
  onPrimaryConfirm(): void {
    const mode = this.effectiveMode();
    if (mode === 'create-draft') {
      this.onSaveDraft();
      return;
    }
    if (mode === 'edit') {
      this.onUpdateEditor();
      return;
    }
    // create-payment (or any future mode): fall through to the payment-step
    // collector path. Existing semantics preserved.
    this.onConfirm();
  }

  /**
   * CP-POS-MODAL-SCOPE-001 / Phase A.2 — handler for `mode='edit'`. Calls
   * the canonical editor endpoint and emits `editorUpdated` with the fresh
   * Order. Cart re-hydration is the parent's responsibility.
   *
   * TODO(Phase C): wire idempotency_key + dedupe with concurrent pay.
   */
  private onUpdateEditor(): void {
    const state = this.cartState();
    const orderId = this.editingOrderId();
    if (!state || !(state.items?.length ?? 0)) {
      this.toastService.error(
        'El carrito está vacío; agrega productos antes de actualizar.',
      );
      return;
    }
    if (orderId == null) {
      this.toastService.error('No hay una orden seleccionada.');
      return;
    }

    // Phase A.2 minimal payload — Phase C will expand with coupon/promotion
    // recompute. For now we send items + customer_id only; the backend
    // returns the persisted Order, which we re-emit to the parent.
    //
    // CP-POS-MODAL-SCOPE-001 / Phase F.5 — full DTO coverage. The shell's
    // minimal payload omitted fields the backend needs (variant_id,
    // variant_sku, variant_attributes, description, tax_amount_item,
    // promotion_ids, coupon_code, idempotency_key, …). The cashier
    // experienced this as "Actualizar queda en carga infinita y nunca
    // se actualiza": the parent sets `loading=true` waiting for
    // `editorUpdated`, the PUT rejects with 400 on missing required
    // fields, the error branch never emits `editorUpdated`, the
    // spinner stays. We mirror the legacy `buildEditorRequest` shape
    // so the editor endpoint accepts the payload and returns the
    // fresh Order. The shell keeps the footer's own loading guard
    // (`submittingDraft`) and resets it in BOTH next AND error so
    // the cashier is never stuck.
    const stateAny = state as any;
    const pendingBookings = (stateAny?.pendingBookings ?? []) as Array<any>;
    const findBooking = (item: any) => {
      if (item.booking) return item.booking;
      const productId =
        typeof item.product?.id === 'number'
          ? item.product.id
          : Number(item.product?.id);
      const variantId = item.variant_id ?? null;
      return pendingBookings.find(
        (b: any) =>
          b.product_id === productId &&
          (variantId == null || b.product_variant_id == null || b.product_variant_id === variantId),
      );
    };
    /** CP-POS-SVC-BOOKING-001 — build the atomic booking
     *  block for a cart line. Returns undefined when the line has no
     *  pending booking, so the editor payload omits the field and the
     *  backend doesn't try to insert a row.
     *
     *  The backend's `UpdateOrderEditorItemBookingDto` whitelists only:
     *  booking_id, provider_id, date, start_time, end_time, notes,
     *  service_location_type.
     */
    const buildBooking = (it: any): any => {
      const b = findBooking(it);
      if (!b) return undefined;
      const parsedBookingId = Number(b.booking_id ?? b.id);
      return {
        booking_id: Number.isFinite(parsedBookingId) && parsedBookingId > 0 ? parsedBookingId : undefined,
        provider_id: b.provider_id ? Number(b.provider_id) : null,
        date: b.date,
        start_time: b.start_time,
        end_time: b.end_time,
        notes: b.notes ?? '',
        service_location_type: b.service_location_type === 'home' ? 'home' : 'shop',
      };
    };
    const items = state.items.map((it: any) => {
      const booking = buildBooking(it);
      return {
        item_type: it.itemType ?? 'product',
        product_id: it.product?.id ?? null,
        product_variant_id: it.variant_id ?? null,
        product_name: it.product?.name ?? '',
        product_sku: it.product?.sku ?? null,
        variant_sku: it.variant_sku ?? null,
        variant_attributes: it.variant_attributes ?? null,
        description: it.description ?? it.notes ?? null,
        quantity: Number(it.quantity ?? 1),
        unit_price: Number((it.unitPrice ?? 0).toFixed(2)),
        final_unit_price: Number(
          (it.finalPrice ?? it.unitPrice ?? 0).toFixed(2),
        ),
        total_price: Number((it.totalPrice ?? 0).toFixed(2)),
        tax_amount_item: Number((it.taxAmount ?? 0).toFixed(2)),
        tax_rate: typeof it.taxRate === 'number' ? it.taxRate : undefined,
        tax_category_id: it.taxCategoryId ?? undefined,
        applied_price_tier_id: it.appliedPriceTierId ?? undefined,
        ...(booking ? { booking } : {}),
      };
    });
    const customer = state.customer;

    // Idempotency key per edit attempt (defense-in-depth vs double-clicks
    // and network retries; first call wins, retries get the cached Order).
    const idempotencyKey = `editor:${orderId}:${Date.now()}`;

    this.submittingDraft.set(true);
    this.ordersService
      .updateOrderFromEditor(String(orderId), {
        items,
        // QUI-737 (B.4) — el alias y el cliente son mutuamente excluyentes
        // (CHECK orders_customer_xor_alias). En modo alias mandamos el alias y
        // customer_id null, nunca ambos; el @Transform del DTO colapsa '' o un
        // string en blanco a undefined para no persistir una línea vacía.
        customer_id: this.saleMode() === 'alias' ? null : (customer?.id ?? null),
        customer_alias: this.saleMode() === 'alias' ? (this.customerAlias() || undefined) : undefined,
        notes: state.notes || undefined,
        internal_notes: state.internalNotes || undefined,
        promotion_ids: (state.appliedDiscounts ?? [])
          .map((d: any) => d.promotion_id)
          .filter((id: any) => typeof id === 'number'),
        coupon_code: state.appliedCoupon?.code ?? undefined,
        idempotency_key: idempotencyKey,
      } as any)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res: any) => {
          const order = res?.data ?? res?.order ?? res;
          this.submittingDraft.set(false);
          this.editorUpdated.emit(order);
          this.toastService.success('Orden actualizada correctamente');
          // CP-POS-MODAL-SCOPE-001 / Phase F.10 — after a successful PUT /editor
          // the cashier must be able to Cobrar without leaving the shell. Flip
          // the mode so the primary CTA relabels from "Actualizar" to "Cobrar"
          // and onPrimaryConfirm routes through the payment-step collector
          // (POST flow/pay) instead of running PUT /editor again. The shell
          // stays open; resetState / close happens after the actual pay.
          // Note: setting `mode` triggers an effect that resets currentStep to
          // 0; queueing the step-jump in a microtask runs it AFTER the effect
          // so the cashier lands on the Cobro step (not back at Cliente).
          this.postEditPaymentMode.set(true);
          this.suppressAutoExecute.set(true);
          queueMicrotask(() => {
            const idx = this.stepKeys().indexOf('cobro');
            if (idx >= 0) this.currentStep.set(idx);
          });
        },
        error: (err: any) => {
          // Always reset the loading guard so the cashier is not stranded on
          // a spinner forever. The parent also has its own `loading` flag; if
          // the PUT fails, the parent never sees `editorUpdated`, so we emit
          // a no-op `editorUpdated` with `null` to let the parent reset its
          // own state in `onEditorUpdated`.
          this.submittingDraft.set(false);
          this.toastService.error(
            err?.error?.message ?? err?.message ?? 'No se pudo actualizar la orden',
          );
          this.editorUpdated.emit(null);
        },
        // CP-POS-MODAL-SCOPE-001 / Phase F.12 — guarantee the loading guard
        // is released even if neither `next` nor `error` fires (empty 200
        // body, observable complete without next, request cancelled). Without
        // this the cashier sees an infinite spinner after the second edit.
        complete: () => this.submittingDraft.set(false),
      });
  }

  onConfirm(): void {
    // pickup (B1): the Cobro step self-executes (autoExecute=true).
    if (this.checkoutIntent() !== 'delivery') {
      // CP-POS-MODAL-SCOPE-001 / Phase F.10 — the cashier enters the Cobro
      // step and the collector's sub-wizard (Forma → Método → Monto) may
      // still have pending sub-steps, OR the Monto sub-step may hold a
      // value that the operator typed but has not yet collapsed with the
      // in-panel confirm. `triggerSubmit()` early-returns while
      // `canSubmit()` is false in either case, so the first CTA click is
      // silently absorbed — the cashier clicks "Cobrar" and nothing
      // happens. Route through `advanceSubStepOrConfirm` first so the
      // collector collapses the amount (and advances any leftover
      // sub-step) before `triggerSubmit` fires.
      if (this.currentStepKey() === 'cobro') {
        const pay = this.paymentStep();
        if (pay && pay.advanceSubStepOrConfirm()) {
          // Sub-wizard still had work to do (Forma→Método→Monto or
          // amount-not-yet-collapsed). The shell will land back here on
          // the next click with the wizard now terminal — that click
          // will hit the triggerSubmit below.
          return;
        }
      }
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
      // QUI-561: simétrico al gate de envío de arriba. Volver al paso Cobro sin
      // decir qué falta deja al cajero adivinando; el collector ya sabe nombrar
      // el faltante, solo hay que pedírselo.
      this.goToStepKey('cobro');
      pay?.flashValidation();
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
   * finish, then finalize (Cobro es el último paso: delivery, o pickup con
   * {@link customerRequired}) o avanza al siguiente paso mayor (Cobro intermedio).
   * La decisión se toma por {@link isLastStep}, así que sigue siendo correcta en
   * las cuatro variantes de orden documentadas en {@link steps}.
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
   * Tipo de venta (sub-paso Tipo) — TRI-STATE (QUI-737 B.4):
   *  - "Venta Anónima" estando YA anónima → avanza el wizard TOP-LEVEL
   *    (`nextStep()`): anónima solo tiene [Tipo], así que el segundo clic salta
   *    de paso (p.ej. Cliente → Envío en delivery). Si aún no era anónima, la
   *    fija y se queda en [Tipo] listo (un segundo clic avanza top-level).
   *  - "Venta con nombre o referencia" (alias) estando YA en alias → avanza.
   *    De otro modo fija alias y va al sub-paso "Alias" (captura del texto).
   *  - "Con Cliente" → contrae Tipo y avanza al sub-paso Cliente (Buscar).
   *
   *  Round 3 MAJOR #4 — refuse anonymous when the policy requires one: a
   *  silent flip of the flag would just produce a `POS_CUSTOMER_REQUIRED_001`
   *  on submit. Treat the call as a no-op (the UI also hides the option via
   *  {@link canBeAnonymous}, but defending here keeps the invariant under any
   *  caller — including keyboard shortcuts or tests).
   */
  onSelectSaleMode(mode: 'anonymous' | 'alias' | 'customer'): void {
    if (mode === 'anonymous') {
      // Round 8 — `pos.allow_anonymous_sales=true` is the POS-side escape
      // hatch: even when `checkout.require_customer_data=true` (which
      // governs ecommerce + electronic invoicing), the cashier may sell
      // without a customer from the POS. Mirror the backend gate: refuse
      // anonymous ONLY when the policy forbids it AND the POS flag is off.
      if (this.customerRequiredByPolicy() && !this.allowAnonymousSales()) {
        // Policy forbids anonymous AND POS doesn't allow it — force Con Cliente.
        this.toggleAnonymousSale(false);
        this.goToClienteSubStep(1);
        return;
      }
      if (this.isAnonymousSale()) {
        this.nextStep();
        return;
      }
      this.toggleAnonymousSale(true);
      this.goToClienteSubStep(0);
      return;
    }

    if (mode === 'alias') {
      // Delivery no admite alias (la dirección se ata a un cliente real).
      if (this.aliasBlockedByDelivery()) {
        this.toggleAnonymousSale(false);
        this.goToClienteSubStep(1);
        return;
      }
      // Re-clic en alias ya activo → avanza el wizard (alias tiene [Tipo, Alias]).
      if (this.saleMode() === 'alias') {
        this.nextStep();
        return;
      }
      this.userOverrideAnonymous.set(false);
      this.saleMode.set('alias');
      this.goToClienteSubStep(1); // sub-paso Alias (input)
      return;
    }

    // 'customer'
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
    this.saleMode.set(enabled ? 'anonymous' : 'customer');
  }

  /** Cliente elegido/creado en el selector inline. */
  selectCustomer(customer: PosCustomer): void {
    this.userOverrideAnonymous.set(false);
    this.saleMode.set('customer');
    // QUI-737 (B.4) — un cliente real gana: cualquier alias previo se limpia.
    this.customerAlias.set('');
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

  /**
   * QUI-737 (B.4) — write del input de alias al signal. Zoneless-safe: `set()`
   * notifica a `customerAlias` y el template se re-renderiza al vuelo.
   */
  onAliasInput(event: Event): void {
    this.customerAlias.set((event.target as HTMLInputElement).value);
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

    // QUI-535: el picker ya no abre la mesa al elegirla, así que un borrador
    // sobre una mesa elegida debe abrir su cuenta AQUÍ. Guardar el borrador de
    // una mesa ES abrir su cuenta: es una acción explícita del operador, no
    // navegación del wizard, y sin esto los platos quedarían en una orden de
    // mostrador desligada de la mesa.
    const pickedTableId = this.checkoutTableId();
    if (isRestaurant && pickedTableId != null) {
      this.openPickedTableThenAppend(pickedTableId, state);
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
      .createCounterDraftOrder(customerId, lines, undefined, this.customerAliasForPayload())
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

  /**
   * Abre la cuenta de la mesa elegida en el picker y encadena el borrador sobre
   * su orden draft. Solo se llama desde "Guardar borrador" — el cobro NO pasa por
   * aquí (el backend abre y cierra la sesión dentro de su transacción).
   */
  private openPickedTableThenAppend(tableId: number, state: CartState): void {
    const customerId = this.resolveCustomerId(state.customer);
    this.integration
      .openTableSession({
        table_id: tableId,
        // QUI-737 (B.4) — alias aplica también a mesas (FB-21). Mutuamente
        // excluyente con customer_id; nunca '' (el DTO colapsa a undefined).
        ...(customerId > 0 ? { customer_id: customerId } : {}),
        ...(this.saleMode() === 'alias'
          ? { customer_alias: this.customerAlias() || undefined }
          : {}),
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          const session: any = (result as any)?.session ?? result;
          if (!session?.id || !session?.order_id) {
            this.submittingDraft.set(false);
            this.toastService.error('No se pudo abrir la mesa');
            return;
          }
          // Mantiene al POS al día con la sesión recién abierta.
          this.onTableSessionOpened(result);
          this.appendToTableAndFire(state, session);
        },
        error: (err) => {
          this.submittingDraft.set(false);
          this.toastService.error(this.toastError(err, 'No se pudo abrir la mesa'));
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
        // QUI-653 — la decisión "para llevar" viaja desde la línea del carrito
        // hasta `order_items.is_takeaway`. Se propaga aquí y en
        // `pos.component.ts`: son los DOS caminos por los que el POS empuja
        // items a una mesa, y si solo uno lo llevara la marca dependería de qué
        // botón usó el cajero.
        ...(it.isTakeaway && { is_takeaway: true }),
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
          // Solo los ítems recién agregados: la orden draft de la mesa puede
          // arrastrar líneas ya disparadas de una ronda anterior.
          const justAdded = new Set<number>(
            (updated?.order?.order_items ?? [])
              .filter((it: any) =>
                items.some(
                  (i) =>
                    i.product_id === it.product_id &&
                    i.quantity === it.quantity,
                ),
              )
              .map((it: any) => Number(it.id)),
          );
          // …y de esos, solo los `prepared` que el cajero no marcó "usar
          // stock". Mandar un retail al KDS le pondría
          // `inventory_consumed_at_fire=true` y el pago dejaría de descontar
          // su stock (ver skill vendix-restaurant-ops).
          const orderItemIds = this.preparedItemIdsFromOrder(
            updated?.order,
          ).filter((id) => justAdded.has(id));
          this.maybeFireAndFinish(orderId, orderItemIds, state);
        },
        error: (err) => {
          this.submittingDraft.set(false);
          this.toastService.error(this.toastError(err, 'No se pudo agregar ítems a la mesa'));
        },
      });
  }

  private createRetailDraft(state: CartState): void {
    // Phase D.2 — draft path. We DO NOT open payment, we DO NOT navigate to
    // detail, and we emit ONLY `draftSaved` to the parent (never
    // `checkoutCompleted`). The parent already routes on `(draftSaved)` via
    // `onCreateOrderConfirmed`, which surfaces the order-confirmation modal
    // and clears the cart; the cashier can decide to "Cobrar" next or close.
    //
    // The customer-id gate is enforced here as a defensive UI guard: the
    // backend is authoritative and will return `POS_CUSTOMER_REQUIRED_001`,
    // but failing locally saves a round-trip and keeps the cashier oriented.
    // Anonymous sales skip the customer gate when the policy allows them:
    // `pos.allow_anonymous_sales=true` is the POS-side source for the
    // cashier; `settings.checkout.require_customer_data` is enforced by the
    // backend separately.
    if (
      !this.isAnonymousSale() &&
      this.saleMode() !== 'alias' &&
      (!state.customer || state.customer.id == null)
    ) {
      this.submittingDraft.set(false);
      this.toastService.error(
        'Selecciona o crea un cliente antes de guardar la orden.',
      );
      return;
    }

    // Anonymous draft: the shell flags the sale as anonymous but the parent's
    // cartState.customer may still hold a previously-picked customer. We clone
    // the cart with customer=null so the backend stores the draft without a
    // customer row (Consumidor Final), per the existing saveDraft contract.
    //
    // CP-POS-MODAL-SCOPE-001 / Phase F.2 — defensive guard against the
    // `anonymousSalesAsDefault=true` re-sync race: if the cart carries a
    // non-null customer row the cashier picked, the draft MUST save with that
    // customer attached, regardless of the anonymous toggle state. The toggle
    // is a defaulting convenience, not an override of an explicit pick.
    const customerPicked = state.customer?.id != null;
    const draftState =
      (this.isAnonymousSale() || this.saleMode() === 'alias') && !customerPicked
        ? { ...state, customer: null }
        : state;

    this.paymentService
      .saveDraft(draftState, 'current_user', this.customerAliasForPayload())
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
    // La sesión realmente abierta es la verdad de dónde quedó el borrador; si no
    // hay ninguna, la mesa que eligió el operador.
    const tableId =
      this.integration.currentTableSession()?.table_id ??
      this.consumoStep()?.effectiveTableId() ??
      this.tableId() ??
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

  /**
   * QUI-737 (B.4) — alias para el payload, solo en modo alias y nunca `''`.
   * `undefined` en cualquier otro modo (anónimo/cliente) para que el @Transform
   * del DTO no reciba un string vacío.
   */
  private customerAliasForPayload(): string | undefined {
    return this.saleMode() === 'alias'
      ? this.customerAlias().trim() || undefined
      : undefined;
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
