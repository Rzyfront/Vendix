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
  FormControl,
  ReactiveFormsModule,
  FormsModule,
} from '@angular/forms';
import { Router } from '@angular/router';

import {
  CurrencyInputDirective,
  IconComponent,
  StepsLineComponent,
  ToggleComponent,
} from '../../../../../../../shared/components';
import type {
  PaymentSubmit,
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

import { PosPaymentService } from '../../../services/pos-payment.service';
import { PosShippingService } from '../../../services/pos-shipping.service';
import {
  CustomersService,
  CustomerAddressPayload,
} from '../../../../customers/services/customers.service';
import { CartState, ShippingContext, hasShipmentContext } from '../../../models/cart.model';
import { PosCustomerAddress } from '../../../models/customer.model';
import {
  PosShippingMethod,
  PosShippingAddress,
  PosShippingSaleData,
} from '../../../models/shipping.model';
import { PaymentRequest } from '../../../models/payment.model';

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
  // ── Address capture (owned by shipping step according to method type) ───
  readonly address = signal<AddressPayload | null>(null);
  readonly addressValid = signal<boolean>(false);
  readonly showAddressErrors = signal<boolean>(false);
  readonly addressId = signal<number | null>(null);
  private readonly addressCustomerId = signal<number | null>(null);

  /** Stable form seed; emitted form values must never feed their own input. */
  readonly initialAddress = signal<AddressPayload | null>(null);
  readonly addressEditing = signal(false);
  private readonly addressForm = viewChild(AddressFormFieldsComponent);
  private readonly shippingEdited = signal(false);
  private readonly freeAddressEdited = signal(false);
  private quoteGeneration = 0;
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

  // ── Outputs ───────────────────────────────────────────────────────────────
  readonly shippingCompleted = output<any>();

  private readonly router = inject(Router);
  private readonly paymentService = inject(PosPaymentService);
  private readonly shippingService = inject(PosShippingService);
  private readonly customersService = inject(CustomersService);
  private readonly toastService = inject(ToastService);
  private readonly currencyService = inject(CurrencyFormatService);
  private readonly countryService = inject(CountryService);

  readonly currencySymbol = this.currencyService.currencySymbol;

  // ── Shipping state ────────────────────────────────────────────────────────
  readonly shippingMethods = signal<PosShippingMethod[]>([]);
  readonly selectedShippingMethod = signal<PosShippingMethod | null>(null);
  readonly shippingCost = signal<number>(0);
  readonly calculatedShippingCost = signal<number | null>(null);
  readonly manualCostOverride = signal<boolean>(false);
  readonly isCalculatingShipping = signal<boolean>(false);

  // ── Envío sub-wizard (presentación; espeja el patrón de Cobro) ────────────
  /** Sub-paso activo del paso Envío: 0=Método · 1=Dirección (si no pickup) · Costo (terminal). */
  readonly shipSubStep = signal<number>(0);
  /** Sub-pasos dinámicos reflejados en el `app-steps-line` vertical. */
  readonly shipSubSteps = computed<StepsLineItem[]>(() => {
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
    () => this.shipSubStep() === (this.requiresAddress() ? 2 : 1),
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
          const first = methods.find((m) => m.is_active !== false);
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
        this.calculatedShippingCost.set(0);
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
    this.setAddress(address ? this.toAddressPayload(address) : null, address?.id ?? null);
  }

  private setAddress(address: AddressPayload | null, id: number | null): void {
    this.address.set(address);
    this.initialAddress.set(address);
    this.addressId.set(id);
    this.addressCustomerId.set(id ? this.cartState()?.customer?.id ?? null : null);
    this.addressValid.set(!!(address?.address_line1 && address.city));
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
      latitude: null, longitude: null,
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
    this.setAddress(this.toAddressPayload(address), id);
  }

  onAddressChange(payload: AddressPayload): void {
    // Country/municipality lookup and initial form hydration also emit. Only
    // a dirty form opened deliberately can author an existing order's address.
    if (this.originalShipping() &&
      (!this.addressEditing() || !this.addressForm()?.form.dirty)) return;
    this.invalidateQuote();
    this.address.set(payload);
    if (!this.manualCostOverride() && !this.isPickupMethod()) this.isCalculatingShipping.set(true);
    if (this.addressForm()?.form.dirty) {
      this.shippingEdited.set(true);
      this.freeAddressEdited.set(this.addressKey(payload) !== this.addressKey(this.initialAddress()));
    }
  }

  private addressKey(address: AddressPayload | null): string {
    const norm = (value: unknown) => String(value ?? '').trim().toLocaleLowerCase();
    return JSON.stringify([
      address?.address_line1, address?.address_line2, address?.city,
      address?.state_province, address?.country_code ?? 'CO', address?.postal_code,
      address?.phone_number,
    ].map(norm));
  }

  private invalidateQuote(): void {
    this.quoteGeneration++;
    this.isCalculatingShipping.set(false);
    this.quoteError.set(null);
  }

  onAddressValidChange(valid: boolean): void {
    this.addressValid.set(valid);
  }

  /**
   * Intenta avanzar un sub-paso dentro del paso Envío:
   *  - Método (0) → Dirección (1) si requiresAddress(), o Costo (1) si pickup.
   *  - Dirección (1) → Costo (2), validando la dirección primero.
   *  - Costo (terminal) → devuelve true para que el shell avance a Cobro.
   */
  attemptNextSubStep(): boolean {
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
    if (!method || !this.cartState()?.items?.length || method.type === 'pickup') return;
    const a = this.address();
    if (!a?.city) return;
    this.isCalculatingShipping.set(true);
    const items = this.cartState()!.items.filter((item) => item.itemType !== 'custom')
      .map((item) => ({
        product_id: parseInt(item.product.id), quantity: item.quantity, price: item.totalPrice,
      }));
    this.shippingService.calculateShipping(items, {
      country_code: a.country_code || 'CO', city: a.city,
      state_province: a.state_province || undefined,
      address_line1: a.address_line1 || undefined,
    }).pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
      next: (options) => {
        if (generation !== this.quoteGeneration) return;
        this.isCalculatingShipping.set(false);
        const matching = options.find((o) => o.method_id === method.id);
        if (matching) {
          this.calculatedShippingCost.set(matching.cost);
          this.shippingRateId.set(matching.rate_id ?? matching.id);
          if (!this.manualCostOverride()) this.shippingCost.set(matching.cost);
        } else {
          this.calculatedShippingCost.set(null);
          this.shippingRateId.set(null);
          this.quoteError.set('No hay tarifa para el método y la dirección elegidos. Selecciona otra opción o ingresa un costo válido.');
        }
      },
      error: () => {
        if (generation !== this.quoteGeneration) return;
        this.isCalculatingShipping.set(false);
        this.calculatedShippingCost.set(null);
        this.shippingRateId.set(null);
        this.quoteError.set('No se pudo calcular el envío. Reintenta o ingresa un costo válido.');
      },
    });
  }

  toggleManualCost(): void {
    this.invalidateQuote();
    this.manualCostOverride.update((value) => !value);
    const calc = this.calculatedShippingCost();
    if (!this.manualCostOverride() && calc !== null) this.shippingCost.set(calc);
  }

  onShippingCostChange(): void {
    this.invalidateQuote();
    this.manualCostOverride.set(true);
    this.shippingEdited.set(true);
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
      };
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
      recipient_phone: this.customerAlias().trim()
        ? a?.phone_number || ''
        : this.cartState()?.customer?.phone || '',
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
