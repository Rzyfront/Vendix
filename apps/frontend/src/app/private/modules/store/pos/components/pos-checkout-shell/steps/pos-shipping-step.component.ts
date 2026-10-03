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
  TemplateRef,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Observable } from 'rxjs';
import {
  FormControl,
  ReactiveFormsModule,
  FormsModule,
} from '@angular/forms';
import { Router } from '@angular/router';

import {
  CurrencyInputDirective,
  IconComponent,
  SelectorComponent,
  StepsLineComponent,
  ToggleComponent,
} from '../../../../../../../shared/components';
import type {
  PaymentSubmit,
  SelectorOption,
  StepsLineItem,
} from '../../../../../../../shared/components';
import { ToastService } from '../../../../../../../shared/components/toast/toast.service';
import {
  CurrencyFormatService,
  CurrencyPipe,
} from '../../../../../../../shared/pipes/currency';
import {
  AddressFormFieldsComponent,
  AddressPayload,
} from '../../../../../../../shared/components/address-form-fields/address-form-fields.component';
import { CountryService } from '../../../../../../../core/services/country.service';
import {
  GeocodingService,
  type GeocodePrecision,
} from '../../../../../ecommerce/services/geocoding.service';

import { PosPaymentService } from '../../../services/pos-payment.service';
import { PosShippingService } from '../../../services/pos-shipping.service';
import { parseApiError } from '../../../../../../../core/utils/parse-api-error';
import {
  CustomersService,
  CustomerAddressPayload,
} from '../../../../customers/services/customers.service';
import { CartState, ShippingContext, hasShipmentContext } from '../../../models/cart.model';
import { PosCustomerAddress } from '../../../models/customer.model';
import {
  PosShippingMethod,
  PosShippingAddress,
  PosShippingOption,
  PosShippingSaleData,
} from '../../../models/shipping.model';
import { PaymentRequest } from '../../../models/payment.model';
import type { PaymentLeg } from '../../../../../../../shared/components/payment-collector/payment-collector.model';
import type { PosPaymentLeg } from '../../../services/pos-payment.service';

/**
 * B11 — el collector emite tramos en camelCase (`PaymentLeg`); el backend
 * espera snake_case exacto (`PaymentLegDto`, `forbidNonWhitelisted`). Espeja
 * el helper homónimo de `pos-payment-step.component.ts` (mismo contrato, sin
 * exportarlo desde allá para no tocar un archivo fuera de las 5 asignadas
 * salvo necesidad).
 */
function toPosPaymentLegs(legs: PaymentLeg[]): PosPaymentLeg[] {
  return legs.map((leg) => ({
    store_payment_method_id: leg.storePaymentMethodId,
    amount: leg.amount,
    ...(leg.amountReceived != null ? { amount_received: leg.amountReceived } : {}),
    ...(leg.reference ? { payment_reference: leg.reference } : {}),
    ...(leg.bankAccountId != null ? { bank_account_id: leg.bankAccountId } : {}),
  }));
}

type FlashSection = 'shipping-method' | 'address' | 'customer';

/** Installment-shaped credit plan forwarded to `processShippingSale`. */
type ShippingCreditConfig = {
  num_installments: number;
  frequency: 'weekly' | 'biweekly' | 'monthly';
  first_installment_date: string;
  interest_rate: number;
  initial_payment: number;
  initial_payment_method_id?: number;
};

/**
 * Paso 15b (lote C) — desglose fiscal de la ÚLTIMA cotización aceptada para
 * el método seleccionado. Copia tal cual el bloque del backend
 * (`ShippingOption.base`, `shipping_tax_amount`, `tax_is_inclusive`); nunca
 * se deriva en floats desde el costo.
 */
type QuotedShippingTax = {
  base: number;
  tax: number;
  taxIsInclusive: boolean;
};

/**
 * Normaliza el bloque fiscal de la opción cotizada. Cualquier campo ausente,
 * no numérico o incoherente (impuesto ≤ 0, base ≤ 0) ⇒ null: sin respaldo no
 * hay desglose. El modo ausente se lee como incluido (default del backend).
 */
function toQuotedShippingTax(option: {
  base?: unknown;
  shipping_tax_amount?: unknown;
  tax_is_inclusive?: unknown;
}): QuotedShippingTax | null {
  const base = Number(option.base);
  const tax = Number(option.shipping_tax_amount);
  if (!Number.isFinite(base) || !Number.isFinite(tax)) return null;
  if (tax <= 0 || base <= 0) return null;
  return { base, tax, taxIsInclusive: option.tax_is_inclusive !== false };
}

/**
 * Fase 5·B2b — `app-pos-shipping-step`.
 *
 * Cuerpo del paso **Envío** del checkout shell. Recolecta el método de envío,
 * la dirección de entrega (solo cuando el método lo requiere, omitiendo dirección
 * si es recoger en tienda), costo y notas.
 */
@Component({
  selector: 'app-pos-shipping-step',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    FormsModule,
    IconComponent,
    CurrencyPipe,
    CurrencyInputDirective,
    SelectorComponent,
    StepsLineComponent,
    ToggleComponent,
    AddressFormFieldsComponent,
  ],
  templateUrl: './pos-shipping-step.component.html',
  styleUrl: './pos-shipping-step.component.scss',
})
export class PosShippingStepComponent {
  private readonly destroyRef = inject(DestroyRef);

  // ── Inputs / two-way ──────────────────────────────────────────────────────
  readonly cartState = input<CartState | null>(null);
  readonly customerAlias = input<string>('');
  readonly editingOrderId = input<number | null>(null);
  /** The Cliente step renders delivery details from this component's template. */
  readonly detailsInCliente = input(false);
  readonly clientDeliveryDetails = viewChild<TemplateRef<unknown>>('clientDeliveryDetails');
  // ── Address capture (owned by shipping step according to method type) ───
  readonly address = signal<AddressPayload | null>(null);
  readonly addressValid = signal<boolean>(false);
  readonly showAddressErrors = signal<boolean>(false);
  readonly addressId = signal<number | null>(null);
  private readonly addressCustomerId = signal<number | null>(null);
  /**
   * Geocode precision + pin-confirmation state for the address currently in
   * view, mirroring `app-address-form-fields`' own signals (its emitted
   * `geocode_precision`/`pin_confirmed` for a freshly-typed address, or the
   * result of {@link ensureSavedAddressCoords} for a saved address that had
   * no coordinates yet). Non-blocking — only feeds `addressPrecisionBadge`.
   */
  readonly addressGeocodePrecision = signal<GeocodePrecision | null>(null);
  readonly addressPinConfirmed = signal<boolean>(false);
  readonly addressPrecisionBadge = computed<
    { text: string; tone: 'success' | 'warning'; icon: string } | null
  >(() => {
    if (this.addressPinConfirmed()) {
      return { text: 'Punto confirmado en el mapa', tone: 'success', icon: 'check-circle' };
    }
    switch (this.addressGeocodePrecision()) {
      case 'exact':
        return { text: 'Ubicación exacta', tone: 'success', icon: 'check-circle' };
      case 'interpolated':
        return { text: 'Ubicación aproximada a la placa', tone: 'success', icon: 'map-pin' };
      case 'intersection':
        return { text: 'Ubicada en la esquina', tone: 'success', icon: 'map-pin' };
      case 'street':
        return {
          text: 'Solo encontramos la calle — confirma el punto en el mapa',
          tone: 'warning',
          icon: 'alert-triangle',
        };
      case 'area':
        return {
          text: 'Solo encontramos el barrio o sector — confirma el punto en el mapa',
          tone: 'warning',
          icon: 'alert-triangle',
        };
      default:
        return null;
    }
  });

  /** Stable form seed; emitted form values must never feed their own input. */
  readonly initialAddress = signal<AddressPayload | null>(null);
  readonly addressEditing = signal(false);
  private readonly addressForm = viewChild(AddressFormFieldsComponent);
  private readonly shippingEdited = signal(false);
  private readonly freeAddressEdited = signal(false);
  private quoteGeneration = 0;
  /** Manual tax quotes depend on amount/rate, not on address requotes. */
  private manualQuoteGeneration = 0;
  private walletMultiAttemptKey: string | null = null;
  private walletMultiAttemptSignature: string | null = null;
  readonly shippingRateId = signal<number | null>(null);
  readonly quoteError = signal<string | null>(null);
  readonly methodsLoaded = signal(false);
  readonly originalShipping = computed(() => {
    const original = this.cartState()?.shippingContext;
    return original && (hasShipmentContext(original) || original.shippingAddressId != null ||
      original.deliveryType === 'home_delivery') ? original : null;
  });
  readonly customerChanged = computed(() => {
    const original = this.originalShipping();
    return !!original && original.customerId !== undefined &&
      original.customerId !== (this.cartState()?.customer?.id ?? null);
  });
  readonly hasShippingChanges = computed(() => {
    if (!this.shippingEdited()) return false;
    const original = this.originalShipping();
    return !original || this.customerChanged() || this.freeAddressEdited() ||
      this.selectedShippingMethod()?.id !== original.shippingMethodId ||
      (this.isPickupMethod() ? null : this.addressId()) !== original.shippingAddressId ||
      this.shippingCost() !== Number(original.shippingCost ?? 0);
  });
  readonly preservationWarning = computed<string | null>(() => {
    const original = this.originalShipping();
    if (!original || this.hasShippingChanges()) return null;
    if (this.methodsLoaded() && !this.shippingMethods().some(
      (m) => m.id === original.shippingMethodId && m.is_active !== false,
    )) return 'El método original ya no está disponible. Se conservará el envío de la orden si no lo cambias.';
    if (!original.shippingAddress && original.deliveryType !== 'pickup') {
      return 'No se pudo cargar la dirección original. Se conservará sin sustituirla por la dirección principal del cliente.';
    }
    return null;
  });
  /** Untouched snapshots may be saved even if a historical method is inactive. */
  readonly editorValidationError = computed<string | null>(() => {
    if (this.customerChanged() && (!this.addressId() ||
      this.addressCustomerId() !== this.cartState()?.customer?.id)) {
      return 'Cambiaste el cliente. Selecciona una dirección guardada de este cliente antes de actualizar.';
    }
    if (this.originalShipping() && !this.hasShippingChanges()) return null;
    const error = this.getFirstValidationError();
    if (error) return error.message;
    if (!this.isPickupMethod() && (!this.addressId() || this.freeAddressEdited())) {
      return 'Guarda la dirección en la ficha del cliente y selecciónala aquí antes de actualizar. El editor no guarda cambios en la libreta de direcciones.';
    }
    return null;
  });

  readonly isPickupMethod = computed<boolean>(
    () => this.selectedShippingMethod()?.type === 'pickup',
  );

  readonly requiresAddress = computed<boolean>(() => {
    const m = this.selectedShippingMethod();
    return !!m && m.type !== 'pickup';
  });

  /**
   * Coordinator directive (requirement 3, 2026-09): a delivery method may
   * NEVER quote/charge a default rate for an address that has no resolved
   * point — neither a forward-geocode hit nor a confirmed map pin. This is
   * the single source of truth `getFirstValidationError`/`calculateShippingCost`
   * key off. The cashier's own device sits at the store, so the POS never
   * offers GPS (`[allowGeolocation]="false"` on both `app-address-form-fields`
   * usages below) — marking the pin on the map is the only path to a location
   * once geocoding fails.
   */
  readonly hasResolvedLocation = computed<boolean>(() => {
    const a = this.address();
    return !!a && Number.isFinite(a.latitude) && Number.isFinite(a.longitude);
  });

  /** Keep the missing-method reason visible for a delivery address, not only
   * during the short validation flash shown after an attempted charge. */
  readonly missingShippingMethodReason = computed<string | null>(() =>
    this.address()?.address_line1 && !this.selectedShippingMethod()
      ? 'Selecciona un método de envío antes de guardar o cobrar esta entrega a domicilio.'
      : null,
  );

  readonly addressSummary = computed<string>(() => {
    const a = this.address();
    if (!a) return 'Sin dirección';
    return [a.address_line1, a.city].filter(Boolean).join(', ') || 'Sin dirección';
  });

  /**
   * H6 — nombra los campos nullable de `addresses` (Prisma: `state_province`,
   * `phone_number`) que faltan en la dirección guardada actual, para el aviso
   * que precede el formulario precargado en `#clientDeliveryDetails`.
   */
  readonly missingAddressFieldsLabel = computed<string>(() => {
    const a = this.address();
    if (!a) return '';
    const missing: string[] = [];
    if (!a.state_province) missing.push('el departamento');
    if (!a.phone_number) missing.push('el teléfono');
    return missing.join(' y ');
  });

  // ── Outputs ───────────────────────────────────────────────────────────────
  readonly shippingCompleted = output<any>();

  private readonly router = inject(Router);
  private readonly paymentService = inject(PosPaymentService);
  private readonly shippingService = inject(PosShippingService);
  private readonly customersService = inject(CustomersService);
  private readonly toastService = inject(ToastService);
  private readonly currencyService = inject(CurrencyFormatService);
  private readonly countryService = inject(CountryService);
  private readonly geocodingService = inject(GeocodingService);
  /** Addresses currently being backfilled by {@link ensureSavedAddressCoords}. */
  private readonly savedAddressGeocodeInFlight = new Set<number>();

  readonly currencySymbol = this.currencyService.currencySymbol;

  // ── Shipping state ────────────────────────────────────────────────────────
  readonly shippingMethods = signal<PosShippingMethod[]>([]);
  /**
   * QUI-844 — lo que ve el cajero al elegir envío a domicilio: solo métodos
   * activos. La lista completa se conserva para la preservación de snapshots
   * históricos (un original inactivo intacto sigue guardable).
   */
  readonly activeShippingMethods = computed<PosShippingMethod[]>(() =>
    this.shippingMethods().filter((m) => m.is_active !== false),
  );
  readonly selectedShippingMethod = signal<PosShippingMethod | null>(null);
  readonly shippingCost = signal<number>(0);
  readonly calculatedShippingCost = signal<number | null>(null);
  readonly manualCostOverride = signal<boolean>(false);
  /** Cashier input: gross for inclusive rates, base for additive rates. */
  readonly manualShippingPrice = signal<number>(0);
  readonly manualQuotedShippingTax = signal<QuotedShippingTax | null>(null);
  readonly isCalculatingShipping = signal<boolean>(false);
  /**
   * Paso 15b — bloque fiscal de la última cotización aceptada. Solo lo
   * escribe el handler de `calculateShippingCost`; lo limpian los cambios de
   * insumos de cotización (vía `invalidateQuote`, salvo el toggle manual que
   * lo preserva para poder restaurar el desglose al volver a automático).
   */
  readonly quotedShippingTax = signal<QuotedShippingTax | null>(null);

  /**
   * B6 — todas las tarifas devueltas por el backend para el método
   * seleccionado (antes se descartaban todas menos la primera). Vacío o
   * un solo elemento ⇒ sin selector visible (comportamiento igual a hoy).
   */
  readonly rateOptions = signal<PosShippingOption[]>([]);
  readonly rateSelectorOptions = computed<SelectorOption[]>(() =>
    this.rateOptions().map((o) => ({
      value: o.rate_id ?? o.id,
      label: [o.rate_name || o.method_name, o.zone_name]
        .filter(Boolean)
        .join(' · '),
      description: this.currencyService.format(o.cost),
    })),
  );

  // ── Envío sub-wizard (presentación; espeja el patrón de Cobro) ────────────
  /** Sub-paso activo del paso Envío: 0=Método · 1=Dirección (si no pickup) · Costo (terminal). */
  readonly shipSubStep = signal<number>(0);
  /** Sub-pasos dinámicos reflejados en el `app-steps-line` vertical. */
  readonly shipSubSteps = computed<StepsLineItem[]>(() => {
    if (this.detailsInCliente()) return [{ label: 'Costo' }];
    if (this.requiresAddress()) {
      return [
        { label: 'Método' },
        { label: 'Dirección' },
        { label: 'Costo' },
      ];
    }
    return [
      { label: 'Método' },
      { label: 'Costo' },
    ];
  });

  /** True cuando el sub-paso activo es el sub-paso terminal de Costo. */
  readonly isCostSubStep = computed<boolean>(
    () => this.detailsInCliente() || this.shipSubStep() === (this.requiresAddress() ? 2 : 1),
  );

  // ── Processing ────────────────────────────────────────────────────────────
  readonly isProcessing = signal<boolean>(false);

  // ── Validation flash ──────────────────────────────────────────────────────
  readonly flashSection = signal<FlashSection | null>(null);
  readonly flashMessage = signal<string>('');
  private flashTimeout: ReturnType<typeof setTimeout> | null = null;

  // ── Forms ─────────────────────────────────────────────────────────────────
  /**
   * Delivery notes are the only free-text field still owned here; the address
   * itself is captured upstream by `app-address-form-fields` and arrives via
   * the `address` input.
   */
  readonly notesControl = new FormControl<string>('', { nonNullable: true });

  get deliveryNotesControl(): FormControl {
    return this.notesControl;
  }

  get customerDisplayName(): string {
    const alias = this.customerAlias().trim();
    if (alias) return alias;
    const customer = this.cartState()?.customer;
    if (!customer) return 'Seleccionar cliente';
    const firstName = customer.first_name || '';
    const lastName = customer.last_name || '';
    return `${firstName} ${lastName}`.trim() || 'Cliente sin nombre';
  }

  /**
   * Cart total before shipping — the "Subtotal" line of the totals card. Mirrors
   * the base used by {@link totalWithShipping} (`summary.total` = subtotal + tax
   * − discount, i.e. the grand total pre-envío).
   */
  readonly subtotal = computed<number>(() => this.cartState()?.summary?.total || 0);

  readonly totalWithShipping = computed<number>(
    () => this.subtotal() + this.shippingCost(),
  );

  /**
   * Paso 15b — desglose visible al cajero (base + impuesto del envío). Solo
   * cuando la cotización trae impuesto > 0 para el método actual: pickup no
   * muestra desglose en esta superficie, y costo manual o sin respaldo fiscal
   * tampoco produce filas.
   */
  readonly shippingTaxBreakdown = computed<QuotedShippingTax | null>(() => {
    if (this.isPickupMethod()) return null;
    return this.manualCostOverride()
      ? this.manualQuotedShippingTax()
      : this.quotedShippingTax();
  });

  /** Etiqueta del modo de la tarifa para el desglose: Incluido/Agregado. */
  readonly shippingTaxModeLabel = computed<string>(() =>
    this.shippingTaxBreakdown()?.taxIsInclusive === false ? 'Agregado' : 'Incluido',
  );

  readonly manualInputIsBase = computed<boolean>(() =>
    this.rateOptions().find((o) => (o.rate_id ?? o.id) === this.shippingRateId())
      ?.tax_is_inclusive === false,
  );

  /**
   * El costo manual pierde la tarifa y su impuesto: avisar al cajero, pero
   * solo cuando la cotización vigente sí traía impuesto (si la tarifa no
   * tiene impuesto no hay nada que perder y el aviso sería ruido).
   */
  readonly manualTaxUnavailable = computed<boolean>(() =>
    this.manualCostOverride() &&
    !this.isPickupMethod() &&
    !this.shippingRateId(),
  );

  /**
   * Reactive confirm gate (signal-based so the shell footer recomputes). Mirrors
   * the shipping half of the legacy `canConfirm` (the payment half is validated
   * by the Cobro step / collector, not here). The address now arrives via the
   * `address` input captured in the Cliente step.
   */
  readonly canConfirm = computed<boolean>(() =>
    !!this.cartState()?.items?.length && !this.getFirstValidationError(),
  );

  constructor() {
    this.loadShippingMethods();
    this.currencyService.loadCurrency();

    // Hydration only depends on order identity/snapshot and customer identity.
    // Cart totals, navigation and asynchronous method responses must not reset edits.
    let lastSnapshot: ShippingContext | null | undefined;
    let lastOrderId: number | null | undefined;
    let lastCustomerId: number | null | undefined;
    effect(() => {
      const cart = this.cartState();
      const snapshot = cart?.shippingContext;
      const orderId = cart?.linkedOrderId;
      const customerId = cart?.customer?.id ?? null;
      untracked(() => {
        if (snapshot !== lastSnapshot || orderId !== lastOrderId) {
          lastSnapshot = snapshot;
          lastOrderId = orderId;
          lastCustomerId = customerId;
          this.hydrateShipping();
        } else if (customerId !== lastCustomerId) {
          lastCustomerId = customerId;
          this.invalidateQuote();
          this.freeAddressEdited.set(false);
          // A new customer never silently receives the former customer's address.
          const original = this.originalShipping();
          this.setAddress(!this.customerChanged() && original ? original.shippingAddress ?? null : null,
            !this.customerChanged() && original ? original.shippingAddressId : null);
          if (!original) this.loadDefaultAddress();
        }
      });
    });

    // Only fresh shipping flows use the keyboard-friendly first active method.
    effect(() => {
      const methods = this.shippingMethods();
      const original = this.originalShipping();
      const selected = this.selectedShippingMethod();
      untracked(() => {
        if (original) {
          if (!this.shippingEdited()) {
            const method = methods.find((m) => m.id === original.shippingMethodId);
            if (method) this.selectedShippingMethod.set(method);
          }
        } else if (!selected) {
          const first = this.activeShippingMethods()[0];
          if (first) this.selectShippingMethod(first, { advance: false, userInitiated: false });
        }
      });
    });

    // Auto-clear address errors when valid
    effect(() => {
      if (this.addressValid()) {
        untracked(() => this.showAddressErrors.set(false));
      }
    });

    // Clamp sub-step when shipSubSteps changes
    effect(() => {
      const len = this.shipSubSteps().length;
      untracked(() => {
        if (this.shipSubStep() >= len) {
          this.shipSubStep.set(Math.max(0, len - 1));
        }
      });
    });

    // Existing snapshots are never re-quoted on mount. After an intentional
    // edit, changes to the quote inputs invalidate every older HTTP response.
    effect(() => {
      this.address();
      this.selectedShippingMethod();
      this.cartState()?.items;
      const edited = this.hasShippingChanges();
      const original = this.originalShipping();
      const manual = this.manualCostOverride();
      untracked(() => {
        if ((!original || edited) && !manual) this.calculateShippingCost();
      });
    });

    inject(DestroyRef).onDestroy(() => {
      if (this.flashTimeout) clearTimeout(this.flashTimeout);
    });
  }

  // ── Loaders ──────────────────────────────────────────────────────────────
  private loadShippingMethods(): void {
    this.shippingService
      .getShippingMethods()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (methods) => {
          this.shippingMethods.set(methods);
          this.methodsLoaded.set(true);
        },
        error: () => this.methodsLoaded.set(true),
      });
  }

  // ── Envío sub-wizard (navegación presentacional) ──────────────────────────
  /**
   * Salta el sub-wizard de Envío a un sub-paso (clamp al rango). Presentacional:
   * volver atrás NO resetea método/costo — el estado vive en sus propios
   * signals; el colapso solo cambia el índice activo.
   */
  goToShipSubStep(i: number): void {
    if (i >= 0 && i < this.shipSubSteps().length) this.shipSubStep.set(i);
  }

  // ── Shipping methods ──────────────────────────────────────────────────────
  selectShippingMethod(
    method: PosShippingMethod,
    opts?: { advance?: boolean; userInitiated?: boolean },
  ): void {
    if (method.is_active === false) return;
    const changed = this.selectedShippingMethod()?.id !== method.id;
    if (changed) {
      this.invalidateQuote();
      this.selectedShippingMethod.set(method);
      this.manualCostOverride.set(false);
      this.shippingRateId.set(null);
      if (opts?.userInitiated !== false) this.shippingEdited.set(true);
      const original = this.originalShipping();
      if (original && method.id === original.shippingMethodId &&
        this.addressId() === original.shippingAddressId && !this.freeAddressEdited() && !this.customerChanged()) {
        this.shippingCost.set(Number(original.shippingCost ?? 0));
        this.calculatedShippingCost.set(Number(original.shippingCost ?? 0));
        this.shippingRateId.set(original.shippingRateId);
      } else if (method.type === 'pickup') {
        this.shippingCost.set(0);
        this.calculatedShippingCost.set(null);
        this.isCalculatingShipping.set(true);
      } else {
        this.isCalculatingShipping.set(true);
      }
    }
    if (opts?.advance !== false) this.goToShipSubStep(1);
  }

  private hydrateShipping(): void {
    this.invalidateQuote();
    this.shippingEdited.set(false);
    this.freeAddressEdited.set(false);
    this.addressEditing.set(false);
    this.manualCostOverride.set(false);
    this.shipSubStep.set(0);
    const original = this.originalShipping();
    this.shippingCost.set(Number(original?.shippingCost ?? 0));
    this.calculatedShippingCost.set(original ? Number(original.shippingCost ?? 0) : null);
    this.shippingRateId.set(original?.shippingRateId ?? null);
    this.selectedShippingMethod.set(original
      ? this.shippingMethods().find((m) => m.id === original.shippingMethodId)
        ?? original.shippingMethod ?? null
      : null);
    if (original) {
      this.setAddress(this.customerChanged() ? null : original.shippingAddress ?? null,
        this.customerChanged() ? null : original.shippingAddressId);
    } else {
      this.loadDefaultAddress();
    }
  }

  private loadDefaultAddress(): void {
    const addresses = this.cartState()?.customer?.addresses;
    const address = addresses?.find((a) => a.is_primary) ?? addresses?.[0];
    if (address) {
      const payload = this.toAddressPayload(address);
      this.setAddress(payload, address.id);
      this.ensureSavedAddressCoords(address.id, payload);
      // H6 — la dirección principal guardada puede tener `state_province` o
      // `phone_number` nulos (columnas nullable en Prisma): abrir el
      // formulario precargado en vez de solo un resumen sin vía de completarla.
      this.addressEditing.set(!this.addressValid());
    } else {
      this.setAddress(null, null);
      // Prefill contact once, without making a blank address look valid.
      this.initialAddress.set({
        address_line1: null, address_line2: null, city: null,
        state_province: null, country_code: 'CO', postal_code: null,
        phone_number: this.cartState()?.customer?.phone ?? null,
        latitude: null, longitude: null,
      });
    }
  }

  private setAddress(address: AddressPayload | null, id: number | null): void {
    this.address.set(address);
    this.initialAddress.set(address);
    this.addressId.set(id);
    this.addressCustomerId.set(id ? this.cartState()?.customer?.id ?? null : null);
    this.addressValid.set(!!(address?.address_line1 && address.city &&
      address.state_province && address.country_code && address.phone_number));
    this.addressGeocodePrecision.set(address?.geocode_precision ?? null);
    this.addressPinConfirmed.set(!!address?.pin_confirmed);
  }

  /**
   * Backfills coordinates for a saved address that has none, so a
   * distance-priced shipping method quotes against a real point instead of
   * silently bailing (`calculateShippingCost` requires `a?.city` and only
   * sends lat/lng when finite — an address book entry saved before this
   * feature existed has neither). Mirrors the ecommerce checkout's own
   * `ensureSavedAddressCoords`: forward-geocodes through the backend proxy
   * (never Nominatim/Google directly) using the address's own city/state,
   * then best-effort persists the result back to the address book so the
   * next load skips this call entirely. Failures are silent — the address
   * simply stays without coords, exactly as it already could before this
   * feature existed; this never blocks the quote or the sale.
   */
  private ensureSavedAddressCoords(id: number, address: AddressPayload): void {
    if (address.latitude != null && address.longitude != null &&
      Number.isFinite(address.latitude) && Number.isFinite(address.longitude)) return;
    if (!address.address_line1 || !address.city) return;
    if (this.savedAddressGeocodeInFlight.has(id)) return;
    this.savedAddressGeocodeInFlight.add(id);
    const country = (address.country_code ?? '').trim().toUpperCase();
    const query = !country || country === 'CO'
      ? [address.address_line1, address.city, 'Colombia'].filter(Boolean).join(', ')
      : [address.address_line1, address.city, address.state_province].filter(Boolean).join(', ');
    this.geocodingService.forward(query, {
      city: address.city || undefined,
      state: address.state_province || undefined,
    }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (res) => {
        this.savedAddressGeocodeInFlight.delete(id);
        if (res?.lat == null || res?.lng == null) return;
        // 'area' = city/neighbourhood centroid — NOT a resolved point (GAP 1,
        // 2026-09-27, mirrors the ecommerce checkout's own
        // `ensureSavedAddressCoords` and commit 28947e899). Never persisted:
        // writing a centroid into the customer's saved address would poison
        // it permanently. Leaving `latitude`/`longitude` untouched keeps
        // `hasResolvedLocation()` false, so the cashier marks the map
        // instead of silently charging/shipping from a city centroid.
        if (res.precision === 'area') return;
        // The cashier may have switched to a different address while the
        // request was in flight — never apply a stale geocode result.
        if (this.addressId() !== id) return;
        const updated: AddressPayload = { ...address, latitude: res.lat, longitude: res.lng };
        this.address.set(updated);
        this.initialAddress.set(updated);
        this.addressGeocodePrecision.set(res.precision ?? null);
        this.invalidateQuote();
        if (!this.manualCostOverride() && !this.isPickupMethod()) this.isCalculatingShipping.set(true);
        // Best-effort: a failed PATCH just means the next load re-geocodes.
        this.customersService.updateCustomerAddress(id, {
          latitude: String(res.lat),
          longitude: String(res.lng),
        }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
          error: (err) => console.error('updateCustomerAddress (coords backfill) failed', err),
        });
      },
      error: () => {
        this.savedAddressGeocodeInFlight.delete(id);
      },
    });
  }

  private toAddressPayload(address: PosCustomerAddress): AddressPayload {
    return {
      address_line1: address.address_line1 ?? null,
      address_line2: address.address_line2 ?? null,
      city: address.city ?? null,
      state_province: address.state_province ?? null,
      country_code: address.country_code ?? 'CO',
      postal_code: address.postal_code ?? null,
      phone_number: address.phone_number ?? this.cartState()?.customer?.phone ?? null,
      latitude: address.latitude != null && Number.isFinite(Number(address.latitude))
        ? Number(address.latitude) : null,
      longitude: address.longitude != null && Number.isFinite(Number(address.longitude))
        ? Number(address.longitude) : null,
    };
  }

  selectSavedAddress(id: number): void {
    const address = this.cartState()?.customer?.addresses?.find((a) => a.id === id);
    if (!address) return;
    if (id === this.addressId() && !this.freeAddressEdited()) return;
    this.invalidateQuote();
    this.manualCostOverride.set(false);
    this.shippingRateId.set(null);
    this.isCalculatingShipping.set(!this.isPickupMethod());
    this.shippingEdited.set(true);
    this.freeAddressEdited.set(false);
    this.addressEditing.set(false);
    const payload = this.toAddressPayload(address);
    this.setAddress(payload, id);
    this.ensureSavedAddressCoords(id, payload);
    // H6 — una dirección guardada distinta puede resultar igual de incompleta;
    // reabre el formulario precargado en vez de dejar el resumen sin salida.
    this.addressEditing.set(!this.addressValid());
  }

  onAddressChange(payload: AddressPayload, formDirty = this.addressForm()?.form.dirty ?? true): void {
    // Country/municipality lookup and initial form hydration also emit. Only
    // a dirty form opened deliberately can author an existing order's address.
    if (this.originalShipping() &&
      (!this.addressEditing() || !formDirty)) return;
    if (!formDirty) return;
    this.invalidateQuote();
    this.address.set(payload);
    this.addressGeocodePrecision.set(payload.geocode_precision ?? null);
    this.addressPinConfirmed.set(!!payload.pin_confirmed);
    if (!this.manualCostOverride() && !this.isPickupMethod()) this.isCalculatingShipping.set(true);
    if (formDirty) {
      this.shippingEdited.set(true);
      this.freeAddressEdited.set(this.addressKey(payload) !== this.addressKey(this.initialAddress()));
    }
  }

  /**
   * Includes lat/lng so a coords-only change (pin moved, or a re-geocode
   * that resolved a new point without touching any text field) counts as an
   * edit against an existing order's original address — otherwise
   * `hasShippingChanges()` would stay false and the shipping-cost recompute
   * effect (gated by `!original || edited`) would never re-quote a
   * distance-priced method after the coordinates changed.
   */
  private addressKey(address: AddressPayload | null): string {
    const norm = (value: unknown) => String(value ?? '').trim().toLocaleLowerCase();
    const coord = (value: number | null | undefined) =>
      value != null && Number.isFinite(value) ? value.toFixed(6) : '';
    return JSON.stringify([
      address?.address_line1, address?.address_line2, address?.city,
      address?.state_province, address?.country_code ?? 'CO', address?.postal_code,
      address?.phone_number,
    ].map(norm).concat([coord(address?.latitude), coord(address?.longitude)]));
  }

  private invalidateQuote(preserveBreakdown = false): void {
    this.quoteGeneration++;
    this.isCalculatingShipping.set(false);
    this.quoteError.set(null);
    if (!preserveBreakdown) {
      this.quotedShippingTax.set(null);
      this.manualQuotedShippingTax.set(null);
      this.rateOptions.set([]);
    }
  }

  onAddressValidChange(valid: boolean): void {
    this.addressValid.set(valid);
  }

  /** Gate the delivery details while the cashier is still beside Cliente. */
  validateDetailsForCliente(): boolean {
    // Historical orders keep their original destination when nothing was
    // edited, even if that snapshot cannot be hydrated into today's form.
    if (this.originalShipping() && !this.hasShippingChanges() && !this.customerChanged()) {
      return true;
    }
    if (!this.selectedShippingMethod()) {
      this.flashDeliveryDetail('shipping-method', 'Selecciona cómo llegará el pedido');
      return false;
    }
    if (this.requiresAddress() && (!this.addressValid() ||
      !this.address()?.address_line1 || !this.address()?.city)) {
      this.showAddressErrors.set(true);
      this.flashDeliveryDetail('address', 'Completa la dirección de entrega');
      return false;
    }
    return true;
  }

  /** A new destination must not mutate the customer's selected saved address. */
  beginNewAddress(): void {
    this.invalidateQuote();
    this.addressEditing.set(true);
    this.shippingEdited.set(true);
    this.freeAddressEdited.set(true);
    this.shippingRateId.set(null);
    this.setAddress(null, null);
    this.initialAddress.set({
      address_line1: null, address_line2: null, city: null,
      state_province: null, country_code: 'CO', postal_code: null,
      phone_number: this.cartState()?.customer?.phone ?? null,
      latitude: null, longitude: null,
    });
  }

  private flashDeliveryDetail(section: FlashSection, message: string): void {
    this.flashSection.set(section);
    this.flashMessage.set(message);
    if (this.flashTimeout) clearTimeout(this.flashTimeout);
    this.flashTimeout = setTimeout(() => {
      this.flashSection.set(null);
      this.flashMessage.set('');
    }, 3000);
  }

  /**
   * Intenta avanzar un sub-paso dentro del paso Envío:
   *  - Método (0) → Dirección (1) si requiresAddress(), o Costo (1) si pickup.
   *  - Dirección (1) → Costo (2), validando la dirección primero.
   *  - Costo (terminal) → devuelve true para que el shell avance a Cobro.
   */
  attemptNextSubStep(): boolean {
    if (this.detailsInCliente()) return true;
    if (this.originalShipping() && !this.hasShippingChanges() && !this.customerChanged()) return true;
    const current = this.shipSubStep();
    if (current === 0) {
      if (!this.selectedShippingMethod()) {
        this.flashValidation();
        return false;
      }
      this.goToShipSubStep(1);
      return false;
    }

    if (this.requiresAddress() && current === 1) {
      const a = this.address();
      if (!a?.address_line1 || !a?.city || !this.addressValid()) {
        this.showAddressErrors.set(true);
        this.flashSection.set('address');
        this.flashMessage.set('Completa la dirección de entrega');
        if (this.flashTimeout) clearTimeout(this.flashTimeout);
        this.flashTimeout = setTimeout(() => {
          this.flashSection.set(null);
          this.flashMessage.set('');
        }, 3000);
        return false;
      }
      this.goToShipSubStep(2);
      return false;
    }

    // Costo sub-step reached (terminal for shipping)
    return true;
  }

  /**
   * Retrocede un sub-paso dentro del paso Envío si no está en el primero (0).
   * Devuelve true si retrocedió internamente, false si ya estaba en 0 (el shell maneja).
   */
  attemptPrevSubStep(): boolean {
    if (this.detailsInCliente()) return false;
    if (this.shipSubStep() > 0) {
      this.goToShipSubStep(this.shipSubStep() - 1);
      return true;
    }
    return false;
  }

  getShippingIcon(type: string): string {
    const iconMap: Record<string, string> = {
      own_fleet: 'bike',
      carrier: 'truck',
      pickup: 'store',
      custom: 'settings',
      third_party_provider: 'truck',
    };
    return iconMap[type] || 'truck';
  }

  private calculateShippingCost(): void {
    this.invalidateQuote();
    const generation = this.quoteGeneration;
    const method = this.selectedShippingMethod();
    if (!method || !this.cartState()?.items?.length) return;

    let quote$: Observable<PosShippingOption[]>;
    if (method.type === 'pickup') {
      quote$ = this.shippingService.quotePickupShipping(method.id);
    } else {
      const a = this.address();
      if (!a?.city) return;
      // A delivery method must never quote/default a rate without coordinates.
      if (!this.hasResolvedLocation()) {
        this.calculatedShippingCost.set(null);
        this.shippingRateId.set(null);
        if (!this.manualCostOverride()) this.shippingCost.set(0);
        return;
      }
      const items = this.cartState()!.items.filter((item) => item.itemType !== 'custom')
        .map((item) => ({
          product_id: parseInt(item.product.id), quantity: item.quantity, price: item.totalPrice,
        }));
      quote$ = this.shippingService.calculateShipping(items, {
        country_code: a.country_code || 'CO', city: a.city,
        state_province: a.state_province || undefined,
        municipality_code: a.municipality_code || undefined,
        address_line1: a.address_line1 || undefined,
        postal_code: a.postal_code || undefined,
        ...(a.latitude != null && a.longitude != null &&
          Number.isFinite(a.latitude) && Number.isFinite(a.longitude)
          ? { latitude: a.latitude, longitude: a.longitude }
          : {}),
      });
    }

    this.isCalculatingShipping.set(true);
    quote$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (options) => {
        if (generation !== this.quoteGeneration) return;
        this.isCalculatingShipping.set(false);
        // B6 — el backend devuelve TODAS las tarifas del método (zona/tipo
        // variados), no solo una. Antes `.find` se quedaba con la primera y
        // descartaba el resto; ahora se conservan todas para el selector y
        // se preselecciona la tarifa original (si sigue vigente) o la primera.
        const matches = options.filter((o) => o.method_id === method.id);
        this.rateOptions.set(matches);
        if (matches.length > 0) {
          const original = this.originalShipping();
          const preferred =
            original?.shippingRateId != null
              ? matches.find((o) => (o.rate_id ?? o.id) === original.shippingRateId)
              : undefined;
          this.applyRateSelection(preferred ?? matches[0]);
        } else {
          this.calculatedShippingCost.set(null);
          this.shippingRateId.set(null);
          if (method.type === 'pickup' && !this.manualCostOverride()) this.shippingCost.set(0);
          this.quoteError.set(method.type === 'pickup'
            ? 'No hay tarifa activa para recoger en tienda'
            : `No hay una tarifa disponible para "${method.name}".`);
        }
      },
      error: (error) => {
        if (generation !== this.quoteGeneration) return;
        this.isCalculatingShipping.set(false);
        this.calculatedShippingCost.set(null);
        this.shippingRateId.set(null);
        this.quoteError.set(parseApiError(error).userMessage || (method.type === 'pickup'
          ? 'No se pudo cotizar la tarifa de recogida en tienda.'
          : 'No se pudo cotizar el método seleccionado. Intenta de nuevo.'));
      },
    });
  }

  /** B6 — aplica una tarifa (de la cotización) al costo/impuesto/tarifa activos. */
  private applyRateSelection(option: PosShippingOption): void {
    this.calculatedShippingCost.set(option.cost);
    this.shippingRateId.set(option.rate_id ?? option.id);
    this.quotedShippingTax.set(toQuotedShippingTax(option));
    if (!this.manualCostOverride()) this.shippingCost.set(option.cost);
  }

  /** B6 — el cajero cambia de tarifa en el selector (solo visible con 2+ opciones). */
  onRateSelected(rateId: string | number | null): void {
    if (rateId == null) return;
    const option = this.rateOptions().find(
      (o) => (o.rate_id ?? o.id) === Number(rateId),
    );
    if (option) this.applyRateSelection(option);
  }

  toggleManualCost(): void {
    // Keep the selected automatic quote so switching back restores its gross.
    this.invalidateQuote(true);
    this.manualCostOverride.update((value) => !value);
    const calc = this.calculatedShippingCost();
    if (this.manualCostOverride()) {
      const option = this.rateOptions().find((o) => (o.rate_id ?? o.id) === this.shippingRateId());
      this.manualShippingPrice.set(option?.tax_is_inclusive === false
        ? (option.base ?? option.cost) : (option?.cost ?? this.shippingCost()));
      this.quoteManualCost();
    } else {
      this.manualQuotedShippingTax.set(null);
      if (calc !== null) this.shippingCost.set(calc);
    }
    this.shippingEdited.set(true);
  }

  onShippingCostChange(value = this.shippingCost()): void {
    this.manualShippingPrice.set(Number(value));
    this.manualCostOverride.set(true);
    this.shippingEdited.set(true);
    this.quoteManualCost();
  }

  private quoteManualCost(): void {
    this.invalidateQuote(true);
    this.manualQuotedShippingTax.set(null);
    const generation = ++this.manualQuoteGeneration;
    const amount = this.manualShippingPrice();
    const rateId = this.shippingRateId();
    const methodId = this.selectedShippingMethod()?.id;
    if (!Number.isFinite(amount) || amount < 0) {
      this.quoteError.set('Ingresa un costo de envío válido.');
      return;
    }
    // No applicable rate: retain the historical no-tax manual path, visibly
    // labelled in the wizard instead of pretending the amount inherits IVA.
    if (!rateId || !methodId) {
      this.shippingCost.set(amount);
      return;
    }
    this.isCalculatingShipping.set(true);
    this.shippingService.quoteManualShipping(methodId, rateId, amount)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (quote) => {
          if (generation !== this.manualQuoteGeneration || !this.manualCostOverride()) return;
          this.isCalculatingShipping.set(false);
          this.shippingCost.set(quote.shipping_cost);
          this.manualQuotedShippingTax.set(toQuotedShippingTax(quote));
        },
        error: (error) => {
          if (generation !== this.manualQuoteGeneration || !this.manualCostOverride()) return;
          this.isCalculatingShipping.set(false);
          this.quoteError.set(parseApiError(error).userMessage ||
            'No se pudo calcular el impuesto del envío. Inténtalo nuevamente.');
        },
      });
  }

  navigateToShippingSettings(): void {
    this.router.navigate(['/admin/settings/shipping']);
  }

  // ── Validation ────────────────────────────────────────────────────────────
  private getFirstValidationError(): { section: FlashSection; message: string } | null {
    const method = this.selectedShippingMethod();
    if (!method || method.is_active === false || (this.methodsLoaded() &&
      !this.shippingMethods().some((m) => m.id === method.id && m.is_active !== false))) {
      return { section: 'shipping-method', message: this.missingShippingMethodReason() ?? 'Selecciona un método de envío activo' };
    }
    if (this.isCalculatingShipping()) {
      return { section: 'shipping-method', message: 'Espera a que termine el cálculo del envío' };
    }
    if (this.quoteError()) {
      return { section: 'shipping-method', message: this.quoteError()! };
    }
    const original = this.originalShipping();
    const untouchedPickupSnapshot = this.isPickupMethod() && !!original &&
      (original.deliveryType === 'pickup' || original.shippingMethod?.type === 'pickup') &&
      original.shippingMethodId === method.id && !this.hasShippingChanges();
    if (this.isPickupMethod() && !this.shippingRateId() && !untouchedPickupSnapshot) {
      return { section: 'shipping-method', message: 'Selecciona una tarifa activa para recoger en tienda' };
    }
    // Requirement 3 (coordinator, 2026-09): hard gate, no manual-cost escape
    // hatch — a delivery method must never confirm/charge a default rate for
    // an address with no resolved point (neither a forward-geocode hit nor a
    // confirmed map pin). Placed before the generic shippingCost-finite check
    // on purpose: a manually typed shipping cost
    // (`onShippingCostChange`/`quoteManualCost`) sets `shippingCost` to a
    // finite value regardless of location, which would otherwise slip past
    // that check and let the cashier confirm a made-up cost for a location
    // that was never resolved.
    //
    // Deliberately keyed on `hasResolvedLocation()`, NOT `shippingRateId()`:
    // a `null` `shippingRateId` also covers the pre-existing, unrelated
    // "manual cost, no automated rate table at all" path (alias deliveries,
    // methods with no configured `shipping_rates`) — see `quoteManualCost`'s
    // own comment. That path has real coords and is a legitimate cashier
    // override, not the "no default rate" case this gate targets.
    if (this.requiresAddress() && !this.hasResolvedLocation()) {
      return { section: 'address', message: 'Marca la ubicación en el mapa para calcular el envío' };
    }
    if (!Number.isFinite(this.shippingCost()) || this.shippingCost() < 0) {
      return { section: 'shipping-method', message: 'Ingresa un costo de envío válido' };
    }
    if (this.requiresAddress()) {
      const a = this.address();
      if (!a?.address_line1 || !a?.city || !this.addressValid()) {
        return { section: 'address', message: 'Completa la dirección de envío' };
      }
    }
    if (!this.cartState()?.customer && !this.customerAlias().trim()) {
      return { section: 'customer', message: 'Indica un cliente o un nombre de referencia' };
    }
    return null;
  }

  /** Public: run validation and flash the first offending section (used when the
   *  shell routes the operator here without a valid shipping config). */
  flashValidation(): void {
    const error = this.getFirstValidationError();
    if (!error) return;
    this.flashSection.set(error.section);
    this.flashMessage.set(error.message);
    if (this.flashTimeout) clearTimeout(this.flashTimeout);
    this.flashTimeout = setTimeout(() => {
      this.flashSection.set(null);
      this.flashMessage.set('');
    }, 3000);
  }

  // ── Execution (shell-driven) ──────────────────────────────────────────────
  /**
   * Builds the shipping order and processes it via `processShippingSale`.
   *
   * @param paymentSubmit the collector's payload (siempre presente). `contado` →
   *   un `PaymentRequest` cobrado por `totalWithShipping`; para `cash_on_delivery`
   *   el request lleva el `store_payment_method_id` del método ON_DELIVERY y el
   *   processor backend devuelve 'pending' (orden `pending_payment`). `credito` →
   *   un `creditConfig` plan.
   *
   * Limitation: the legacy `processShippingSale` credit path only models a
   * financed installment plan. A `credito` submit whose `credit.type === 'free'`
   * (fiado libre) is still forwarded through this same installment-shaped
   * `creditConfig` — the free-vs-installments distinction is NOT preserved for
   * delivery orders (unlike the pickup Cobro step, which routes 'free' to
   * `processCreditSale`). This mirrors the pre-existing modal behavior.
   */
  execute(paymentSubmit: PaymentSubmit): void {
    if (this.isProcessing()) return;

    if (!this.canConfirm()) {
      this.flashValidation();
      return;
    }

    const cart = this.cartState();
    const method = this.selectedShippingMethod();
    if (!cart || !method) return;

    this.isProcessing.set(true);

    const deliveryType = this.resolveDeliveryType(method);

    const a = this.address();
    const shippingAddress = this.buildShippingAddress();

    let paymentRequest: PaymentRequest | null = null;
    let creditConfig: ShippingCreditConfig | undefined = undefined;

    if (paymentSubmit.mode === 'contado') {
      // Siempre se ejecuta con el pago del collector (incluye cash_on_delivery,
      // cuyo `method.id` es el store_payment_method_id del método ON_DELIVERY).
      paymentRequest = {
        orderId: 'ORDER_' + Date.now(),
        amount: this.totalWithShipping(),
        paymentMethod: paymentSubmit.method,
        cashReceived: paymentSubmit.amountReceived,
        reference: paymentSubmit.reference,
        // QUI-728 (E.1) — la cuenta de destino elegida en el collector viaja
        // también en la venta con envío; sin esto el pago por transferencia de
        // una venta a domicilio queda sin `payments.bank_account_id`.
        bank_account_id: paymentSubmit.bankAccountId,
        ...(paymentSubmit.tip != null && paymentSubmit.tip > 0
          ? {
              tip_amount: paymentSubmit.tip,
              tip_type: paymentSubmit.tipType ?? 'fixed',
              tip_value: paymentSubmit.tipValue ?? paymentSubmit.tip,
              ...(paymentSubmit.tipWaiterId != null
                ? { tip_waiter_id: paymentSubmit.tipWaiterId }
                : {}),
            }
          : {}),
      };
      // B11 — cobro multimétodo de contado: el collector ya excluye
      // cash_on_delivery de los tramos elegibles (`directMethods`), así que
      // ningún tramo aquí puede ser ON_DELIVERY. Con 2+ tramos se adjunta
      // `payments[]`; `processShippingSale` decide si lo envía en vez del
      // escalar (mismo patrón que `processSaleWithPayment`).
      if (paymentSubmit.legs && paymentSubmit.legs.length >= 2) {
        (paymentRequest as PaymentRequest & { payments?: PosPaymentLeg[] }).payments =
          toPosPaymentLegs(paymentSubmit.legs);
        if (paymentSubmit.legs.some((leg) => leg.methodType === 'wallet')) {
          const signature = JSON.stringify({
            customerId: cart.customer?.id ?? null,
            orderId: this.editingOrderId() ?? cart.linkedOrderId ?? null,
            items: cart.items.map((item) => [item.product.id, item.quantity, item.totalPrice]),
            shippingRateId: this.shippingRateId(), shippingCost: this.shippingCost(),
            legs: (paymentRequest as PaymentRequest & { payments?: PosPaymentLeg[] }).payments,
          });
          if (signature !== this.walletMultiAttemptSignature) {
            this.walletMultiAttemptSignature = signature;
            this.walletMultiAttemptKey = crypto.randomUUID();
          }
          paymentRequest.idempotencyKey = this.walletMultiAttemptKey ?? undefined;
        }
      }
    } else {
      // credito: build the installment-shaped plan (see limitation above).
      const credit = paymentSubmit.credit;
      creditConfig = credit
        ? {
            num_installments: credit.numInstallments,
            frequency: credit.frequency,
            first_installment_date: credit.firstInstallmentDate,
            interest_rate: credit.interestRate,
            initial_payment: credit.initialPayment,
            initial_payment_method_id: credit.initialPaymentMethodId,
          }
        : undefined;
    }

    this.persistAddressThenProcess(
      a,
      shippingAddress,
      deliveryType,
      paymentRequest,
      creditConfig,
    );
  }

  /** `pickup` retira en tienda; cualquier otro método es envío a domicilio. */
  private resolveDeliveryType(method: PosShippingMethod): string {
    return method.type === 'pickup' ? 'pickup' : 'home_delivery';
  }

  /** Snapshot de dirección que viaja con la orden (venta o borrador). */
  private buildShippingAddress(): PosShippingAddress {
    if (this.isPickupMethod()) {
      return {
        address_line1: 'Recogida en tienda',
        city: '',
        state_province: '',
        country_code: 'CO',
        recipient_name: this.customerDisplayName,
        recipient_phone: this.cartState()?.customer?.phone || '',
      };
    }
    const a = this.address();
    const coordinates = a && typeof a.latitude === 'number' && typeof a.longitude === 'number' &&
      Number.isFinite(a.latitude) && Number.isFinite(a.longitude) &&
      a.latitude >= -90 && a.latitude <= 90 && a.longitude >= -180 && a.longitude <= 180
      ? { latitude: a.latitude, longitude: a.longitude }
      : {};
    return {
      address_line1: a?.address_line1 || '',
      ...(this.customerAlias().trim() && a?.address_line2
        ? { address_line2: a.address_line2 }
        : {}),
      city: a?.city || '',
      state_province: a?.state_province || '',
      ...(this.customerAlias().trim() && a?.postal_code
        ? { postal_code: a.postal_code }
        : {}),
      country_code: a?.country_code || 'CO',
      ...coordinates,
      ...(a?.municipality_code?.trim()
        ? { municipality_code: a.municipality_code.trim() }
        : {}),
      recipient_name: this.customerDisplayName,
      recipient_phone: a?.phone_number || this.cartState()?.customer?.phone || '',
    };
  }

  /**
   * Contexto de envío ya capturado en el wizard, para las salidas que NO son
   * el cobro — hoy "Guardar borrador". Devuelve null mientras no haya método
   * elegido: sin método no hay envío que persistir, y el borrador debe
   * guardarse como orden normal en vez de inventar uno.
   */
  buildShippingContext(): (PosShippingSaleData & { shippingRateId: number | null }) | null {
    const method = this.selectedShippingMethod();
    if (!method) return null;
    return {
      shippingMethodId: method.id,
      shippingRateId: this.shippingRateId(),
      shippingCost: this.shippingCost(),
      ...(this.manualCostOverride() && this.shippingRateId()
        ? { manualShippingPrice: this.manualShippingPrice() }
        : {}),
      deliveryType: method.id === this.originalShipping()?.shippingMethodId
        ? this.originalShipping()!.deliveryType ?? this.resolveDeliveryType(method)
        : this.resolveDeliveryType(method),
      shippingAddress: this.buildShippingAddress(),
      customerAlias: this.customerAlias().trim() || undefined,
      deliveryNotes: this.notesControl.value || undefined,
      shippingAddressId: this.isPickupMethod() || this.customerAlias().trim()
        ? undefined : (this.addressId() ?? undefined),
      // El borrador aplica `posShippingRateIdForPayload`; el editor lee
      // `shippingRateId` crudo (su backend ya rechaza costo manual vs tarifa).
      manualCostOverride: this.manualCostOverride(),
    };
  }

  /**
   * Para venta con alias, envía solo snapshot: el backend crea la fila huérfana
   * y la enlaza dentro de la transacción POS. Para cliente registrado se conserva
   * el antiguo best-effort del address book.
   *
   *  - Sin id guardado + dirección utilizable → CREATE via
   *    `CustomersService.createCustomerAddress` (incluye customer_id, lat/lng,
   *    postal_code) y usa el nuevo id.
   *  - Id guardado + payload distinto al guardado → UPDATE via
   *    `updateCustomerAddress`.
   *  - Id guardado sin cambios / dirección incompleta → procesa
   *    sin persistir.
   */
  private persistAddressThenProcess(
    a: AddressPayload | null,
    shippingAddress: PosShippingAddress,
    deliveryType: string,
    paymentRequest: PaymentRequest | null,
    creditConfig?: ShippingCreditConfig,
  ): void {
    const customer = this.cartState()?.customer;
    const customerId = Number(customer?.id);
    const alias = this.customerAlias().trim();
    if (alias) {
      this.processOrder(shippingAddress, deliveryType, paymentRequest, null, creditConfig);
      return;
    }
    const existingId = this.addressId();

    if (
      this.isPickupMethod() || !Number.isInteger(customerId) || customerId <= 0 ||
      !a?.address_line1 || !a?.city
    ) {
      this.processOrder(
        shippingAddress,
        deliveryType,
        paymentRequest,
        this.isPickupMethod() ? null : existingId,
        creditConfig,
      );
      return;
    }

    const dto = this.mapAddressToDto(a, customerId);

    // Caso 1: sin dirección guardada → CREAR y usar el nuevo id.
    if (!existingId) {
      const createDto: CustomerAddressPayload = { ...dto, is_primary: !customer?.addresses?.length };
      this.customersService
        .createCustomerAddress(createDto)
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (created) => {
            const newId = Number(created?.id) || null;
            this.processOrder(shippingAddress, deliveryType, paymentRequest, newId, creditConfig);
          },
          error: (err) => {
            this.notifyAddressPersistFailed('No se pudo guardar la dirección');
            console.error('createCustomerAddress failed', err);
            this.processOrder(shippingAddress, deliveryType, paymentRequest, null, creditConfig);
          },
        });
      return;
    }

    // Caso 2: dirección guardada EDITADA → UPDATE antes de procesar.
    if (this.addressDiffersFromSaved(a, existingId)) {
      this.customersService
        .updateCustomerAddress(existingId, dto)
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: () =>
            this.processOrder(shippingAddress, deliveryType, paymentRequest, existingId, creditConfig),
          error: (err) => {
            this.notifyAddressPersistFailed('No se pudo actualizar la dirección');
            console.error('updateCustomerAddress failed', err);
            this.processOrder(shippingAddress, deliveryType, paymentRequest, existingId, creditConfig);
          },
        });
      return;
    }

    // Caso 3: sin cambios → procesa con el id existente.
    this.processOrder(shippingAddress, deliveryType, paymentRequest, existingId, creditConfig);
  }

  /** Registered-customer address book persistence remains best-effort. */
  private notifyAddressPersistFailed(title: string): void {
    this.toastService.show({
      variant: 'warning',
      title,
      description: 'La orden continúa con la dirección de esta venta.',
    });
  }

  /**
   * Mapea `AddressPayload` (claves schema Prisma) al DTO del backend
   * (`address_line_1`, `state`, `country`), incluyendo GPS. Réplica del mapper
   * `customer-modal.mapAddressToDto` (mismo contrato `POST/PATCH /store/addresses`).
   */
  private mapAddressToDto(
    p: AddressPayload,
    customerId: number,
  ): CustomerAddressPayload {
    const dto: CustomerAddressPayload = {
      address_line_1: p.address_line1 ?? '',
      city: p.city ?? '',
      state: p.state_province ?? '',
      country: p.country_code ?? this.countryService.getDefaultCountry().code ?? 'CO',
      type: 'shipping',
      customer_id: customerId,
    };
    if (p.address_line2) dto.address_line_2 = p.address_line2;
    if (p.postal_code) dto.postal_code = p.postal_code;
    if (p.latitude != null) dto.latitude = String(p.latitude);
    if (p.longitude != null) dto.longitude = String(p.longitude);
    if (p.municipality_code) dto.municipality_code = p.municipality_code;
    return dto;
  }

  /**
   * True cuando la dirección capturada difiere de la guardada del cliente
   * (comparación de campos textuales; lat/lng se omiten porque el seed inicial
   * llega sin coords y su ausencia no implica una edición del operador).
   */
  private addressDiffersFromSaved(a: AddressPayload, savedId: number): boolean {
    const saved = this.cartState()?.customer?.addresses?.find(
      (x) => x.id === savedId,
    );
    if (!saved) return false; // sin referencia para comparar → sin cambios
    const norm = (v: unknown) => (v == null ? '' : String(v).trim());
    return (
      norm(a.address_line1) !== norm(saved.address_line1) ||
      norm(a.city) !== norm(saved.city) ||
      norm(a.state_province) !== norm(saved.state_province) ||
      norm(a.postal_code) !== norm(saved.postal_code)
    );
  }

  private processOrder(
    shippingAddress: PosShippingAddress,
    deliveryType: string,
    paymentRequest: PaymentRequest | null,
    addressId: number | null,
    creditConfig?: ShippingCreditConfig,
  ): void {
    this.paymentService
      .processShippingSale(
        this.cartState()!,
        {
          shippingMethodId: this.selectedShippingMethod()!.id,
          shippingCost: this.shippingCost(),
          deliveryType,
          shippingAddress,
          customerAlias: this.customerAlias().trim() || undefined,
          deliveryNotes: this.notesControl.value || undefined,
          shippingAddressId: addressId,
          shippingRateId: this.shippingRateId(),
          ...(this.manualCostOverride() && this.shippingRateId()
            ? { manualShippingPrice: this.manualShippingPrice() }
            : {}),
          manualCostOverride: this.manualCostOverride(),
        },
        paymentRequest,
        'current_user',
        creditConfig,
        this.editingOrderId(),
      )
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          this.isProcessing.set(false);
          if (response.success) {
            this.walletMultiAttemptKey = null;
            this.walletMultiAttemptSignature = null;
            this.shippingCompleted.emit({
              success: true,
              order: response.order,
              payment: response.payment,
              change: response.change,
              message: response.message,
              isShippingOrder: true,
            });
          } else {
            this.toastService.show({
              variant: 'error',
              title: 'Error',
              description: response.message || 'Error al procesar el envío',
            });
          }
        },
        error: (error) => {
          this.isProcessing.set(false);
          this.toastService.show({
            variant: 'error',
            title: 'Error',
            description: error.message || 'Error al procesar el envío',
          });
        },
      });
  }
}
