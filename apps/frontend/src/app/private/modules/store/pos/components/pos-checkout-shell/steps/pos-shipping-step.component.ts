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
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  FormControl,
  ReactiveFormsModule,
  FormsModule,
} from '@angular/forms';
import { Router } from '@angular/router';

import {
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
import { CurrencyInputDirective } from '../../../../../../../shared/directives/currency-input.directive';
import { CountryService } from '../../../../../../../services/country.service';
import { AddressPayload } from '../../../../../../../shared/components/address-form-fields/address-form-fields.component';

import { PosPaymentService } from '../../../services/pos-payment.service';
import { PosShippingService } from '../../../services/pos-shipping.service';
import {
  CustomersService,
  CustomerAddressPayload,
} from '../../../../customers/services/customers.service';
import { CartState } from '../../../models/cart.model';
import {
  PosShippingMethod,
  PosShippingAddress,
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
 * Cuerpo del paso **Envío** del checkout shell. Extrae SOLO la recolección de
 * ENVÍO de `PosPaymentInterfaceComponent`/`PosShippingModalComponent` (método,
 * dirección con depto/ciudad, costo calculado/manual, notas) SIN su UI de pago
 * interna — el cobro lo posee el paso Cobro (`app-pos-payment-step`). La lógica
 * drill-in overview/method/address del modal viejo queda **aplanada** en un
 * único panel scrollable.
 *
 * Ya NO existe el eje "cuándo paga": "contra entrega" es ahora un método de
 * pago canónico (`cash_on_delivery`, `processing_mode=ON_DELIVERY`) que vive en
 * el paso Cobro. La ejecución se dispara desde el shell vía {@link execute}, que
 * arma `shippingAddress` + `deliveryType`, mapea el `PaymentSubmit` del collector
 * a `paymentRequest`/`creditConfig` y llama a
 * `PosPaymentService.processShippingSale` (misma firma 1:1 que el modal viejo).
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
  ],
  templateUrl: './pos-shipping-step.component.html',
  styleUrl: './pos-shipping-step.component.scss',
})
export class PosShippingStepComponent {
  private readonly destroyRef = inject(DestroyRef);

  // ── Inputs / two-way ──────────────────────────────────────────────────────
  readonly cartState = input<CartState | null>(null);
  /**
   * Shipping address captured upstream in the Cliente step (shell-owned
   * `app-address-form-fields`). This step no longer collects the address; it
   * only consumes it to calculate the cost and build the order.
   */
  readonly address = input<AddressPayload | null>(null);
  /**
   * Id of the customer's saved address to reuse. `null` → this step will
   * create the captured address before processing the order.
   */
  readonly addressId = input<number | null>(null);

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
  /** Sub-paso activo del paso Envío: 0=Método · 1=Costo (terminal). */
  readonly shipSubStep = signal<number>(0);
  /** Sub-pasos fijos reflejados en el `app-steps-line` vertical (Costo es terminal). */
  readonly shipSubSteps = computed<StepsLineItem[]>(() => [
    { label: 'Método' },
    { label: 'Costo' },
  ]);

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
  readonly canConfirm = computed<boolean>(() => {
    const method = this.selectedShippingMethod();
    if (!method) return false;
    if (!this.cartState()?.customer) return false;
    if (!this.cartState()?.items?.length) return false;
    if (method.type !== 'pickup') {
      const a = this.address();
      if (!a?.address_line1 || !a?.city) return false;
    }
    return true;
  });

  constructor() {
    this.loadShippingMethods();
    this.currencyService.loadCurrency();

    // Recalculate shipping cost whenever the captured address changes (delivery
    // only, unless the operator overrode the cost manually). Writes to signals
    // happen through calculateShippingCost inside untracked() (zoneless-safe).
    effect(() => {
      this.address();
      untracked(() => {
        if (this.selectedShippingMethod() && !this.manualCostOverride()) {
          this.calculateShippingCost();
        }
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
      .subscribe((methods) => this.shippingMethods.set(methods));
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
  selectShippingMethod(method: PosShippingMethod): void {
    this.selectedShippingMethod.set(method);
    if (method.type === 'pickup') {
      this.shippingCost.set(0);
      this.calculatedShippingCost.set(0);
    } else {
      this.calculateShippingCost();
    }
    // Avanza al sub-paso terminal Costo (índice 1) tras seleccionar método.
    this.goToShipSubStep(1);
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
    const method = this.selectedShippingMethod();
    if (!method || !this.cartState()?.items?.length) return;

    const a = this.address();
    if (method.type !== 'pickup' && !a?.city) return;

    this.isCalculatingShipping.set(true);

    const items = this.cartState()!
      .items.filter((item) => item.itemType !== 'custom')
      .map((item) => ({
        product_id: parseInt(item.product.id),
        quantity: item.quantity,
        price: item.totalPrice,
      }));

    this.shippingService
      .calculateShipping(items, {
        country_code: 'CO',
        city: a?.city || undefined,
        state_province: a?.state_province || undefined,
        address_line1: a?.address_line1 || undefined,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (options) => {
          this.isCalculatingShipping.set(false);
          const matchingOption = options.find((o) => o.method_id === method.id);
          if (matchingOption) {
            this.calculatedShippingCost.set(matchingOption.cost);
            if (!this.manualCostOverride()) this.shippingCost.set(matchingOption.cost);
          } else if (options.length > 0) {
            this.calculatedShippingCost.set(options[0].cost);
            if (!this.manualCostOverride()) this.shippingCost.set(options[0].cost);
          } else {
            this.calculatedShippingCost.set(null);
            this.manualCostOverride.set(true);
            this.shippingCost.set(0);
          }
        },
        error: () => {
          this.isCalculatingShipping.set(false);
          this.calculatedShippingCost.set(null);
          this.manualCostOverride.set(true);
          this.shippingCost.set(0);
        },
      });
  }

  toggleManualCost(): void {
    const next = !this.manualCostOverride();
    this.manualCostOverride.set(next);
    const calc = this.calculatedShippingCost();
    if (!next && calc !== null) this.shippingCost.set(calc);
  }

  onShippingCostChange(): void {
    // shippingCost already updated by the [(ngModel)] binding.
  }

  navigateToShippingSettings(): void {
    this.router.navigate(['/admin/settings/shipping']);
  }

  // ── Validation ────────────────────────────────────────────────────────────
  private getFirstValidationError(): { section: FlashSection; message: string } | null {
    const method = this.selectedShippingMethod();
    if (!method) {
      return { section: 'shipping-method', message: 'Selecciona un método de envío' };
    }
    if (method.type !== 'pickup') {
      const a = this.address();
      if (!a?.address_line1 || !a?.city) {
        return { section: 'address', message: 'Completa la dirección de envío' };
      }
    }
    if (!this.cartState()?.customer) {
      return { section: 'customer', message: 'Selecciona un cliente' };
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

    const deliveryType = method.type === 'pickup' ? 'pickup' : 'home_delivery';

    const a = this.address();
    const shippingAddress: PosShippingAddress = {
      address_line1: a?.address_line1 || '',
      city: a?.city || '',
      state_province: a?.state_province || '',
      country_code: a?.country_code || 'CO',
      recipient_name: this.customerDisplayName,
      recipient_phone: cart.customer?.phone || '',
    };

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

  /**
   * Persiste la dirección del checkout en el address book del cliente (Paso 8)
   * y luego procesa la orden. NO bloqueante: un fallo de persistencia muestra un
   * toast pero la orden continúa (su `shipping_address_snapshot` se guarda igual).
   *
   *  - Sin id guardado + dirección utilizable → CREATE via
   *    `CustomersService.createCustomerAddress` (incluye customer_id, lat/lng,
   *    postal_code) y usa el nuevo id.
   *  - Id guardado + payload distinto al guardado → UPDATE via
   *    `updateCustomerAddress`.
   *  - Id guardado sin cambios / sin cliente / dirección incompleta → procesa
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
    const existingId = this.addressId();

    // Sin cliente o dirección incompleta → procesa sin persistir.
    if (!customer || !a?.address_line1 || !a?.city) {
      this.processOrder(shippingAddress, deliveryType, paymentRequest, existingId, creditConfig);
      return;
    }

    const dto = this.mapAddressToDto(a, Number(customer.id));

    // Caso 1: sin dirección guardada → CREAR y usar el nuevo id.
    if (!existingId) {
      const createDto: CustomerAddressPayload = {
        ...dto,
        is_primary: !customer.addresses?.length,
      };
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

  /** Toast no-bloqueante cuando la persistencia de dirección falla (ej. 403). */
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
      country: p.country_code ?? this.countryService.getDefaultCountry(),
      type: 'shipping',
      customer_id: customerId,
    };
    if (p.address_line2) dto.address_line_2 = p.address_line2;
    if (p.postal_code) dto.postal_code = p.postal_code;
    if (p.latitude != null) dto.latitude = String(p.latitude);
    if (p.longitude != null) dto.longitude = String(p.longitude);
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
          deliveryNotes: this.notesControl.value || undefined,
          shippingAddressId: addressId,
        },
        paymentRequest,
        'current_user',
        creditConfig,
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
