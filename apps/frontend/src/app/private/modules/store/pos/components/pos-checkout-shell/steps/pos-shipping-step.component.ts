import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  input,
  model,
  output,
  signal,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import {
  FormBuilder,
  FormControl,
  FormGroup,
  Validators,
  ReactiveFormsModule,
  FormsModule,
} from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { debounceTime, startWith } from 'rxjs';

import {
  IconComponent,
  InputComponent,
  SelectorComponent,
} from '../../../../../../../shared/components';
import type {
  SelectorOption,
  PaymentSubmit,
} from '../../../../../../../shared/components';
import { ToastService } from '../../../../../../../shared/components/toast/toast.service';
import {
  CurrencyFormatService,
  CurrencyPipe,
} from '../../../../../../../shared/pipes/currency';
import { CurrencyInputDirective } from '../../../../../../../shared/directives/currency-input.directive';
import {
  CountryService,
  Department,
  City,
} from '../../../../../../../services/country.service';
import { environment } from '../../../../../../../../environments/environment';

import { PosPaymentService } from '../../../services/pos-payment.service';
import { PosShippingService } from '../../../services/pos-shipping.service';
import { PosCustomerService } from '../../../services/pos-customer.service';
import { CartState } from '../../../models/cart.model';
import { PosCustomer } from '../../../models/customer.model';
import {
  PosShippingMethod,
  PosShippingAddress,
} from '../../../models/shipping.model';
import { PaymentRequest } from '../../../models/payment.model';

type FlashSection = 'shipping-method' | 'address' | 'customer';

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
 * El toggle "cuándo paga" (`payTiming`: 'now' | 'later') vive aquí como
 * `model()` two-way con el shell. La ejecución se dispara desde el shell vía
 * {@link execute}, que arma `shippingAddress` + `deliveryType`, mapea el
 * `PaymentSubmit` del collector a `paymentRequest`/`creditConfig` y llama a
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
    InputComponent,
    SelectorComponent,
    CurrencyPipe,
    CurrencyInputDirective,
  ],
  templateUrl: './pos-shipping-step.component.html',
  styleUrl: './pos-shipping-step.component.scss',
})
export class PosShippingStepComponent {
  private readonly destroyRef = inject(DestroyRef);

  // ── Inputs / two-way ──────────────────────────────────────────────────────
  readonly cartState = input<CartState | null>(null);
  /** Toggle "cuándo paga": 'now' (pagar ahora) | 'later' (contra entrega). */
  readonly payTiming = model<'now' | 'later'>('now');

  // ── Outputs ───────────────────────────────────────────────────────────────
  readonly shippingCompleted = output<any>();

  private readonly fb = inject(FormBuilder);
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly paymentService = inject(PosPaymentService);
  private readonly shippingService = inject(PosShippingService);
  private readonly customerService = inject(PosCustomerService);
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

  // ── Processing ────────────────────────────────────────────────────────────
  readonly isProcessing = signal<boolean>(false);

  // ── Address auto-fill state ───────────────────────────────────────────────
  readonly selectedCustomerAddressId = signal<number | null>(null);

  // ── Location dropdowns (API Colombia) ─────────────────────────────────────
  readonly departments = signal<Department[]>([]);
  readonly cities = signal<City[]>([]);
  readonly selectedDepartmentId = signal<number | null>(null);
  readonly selectedCityId = signal<number | null>(null);

  // ── Validation flash ──────────────────────────────────────────────────────
  readonly flashSection = signal<FlashSection | null>(null);
  readonly flashMessage = signal<string>('');
  private flashTimeout: ReturnType<typeof setTimeout> | null = null;

  // ── Forms ─────────────────────────────────────────────────────────────────
  readonly addressForm: FormGroup = this.fb.group({
    address_line1: ['', Validators.required],
    city: ['', Validators.required],
    state_province: [''],
    delivery_notes: [''],
  });

  /**
   * Zoneless bridge: `addressForm.value` is a plain property, NOT a signal, so
   * reading it inside a `computed()` never recomputes. We mirror it through a
   * signal so {@link canConfirm} (consumed by the shell's `confirmDisabled`
   * computed) reacts to address edits.
   */
  private readonly addressValue = toSignal(
    this.addressForm.valueChanges.pipe(startWith(this.addressForm.value)),
    { initialValue: this.addressForm.value },
  );

  get addressLine1Control(): FormControl {
    return this.addressForm.get('address_line1') as FormControl;
  }
  get cityControl(): FormControl {
    return this.addressForm.get('city') as FormControl;
  }
  get deliveryNotesControl(): FormControl {
    return this.addressForm.get('delivery_notes') as FormControl;
  }

  get customerDisplayName(): string {
    const customer = this.cartState()?.customer;
    if (!customer) return 'Seleccionar cliente';
    const firstName = customer.first_name || '';
    const lastName = customer.last_name || '';
    return `${firstName} ${lastName}`.trim() || 'Cliente sin nombre';
  }

  readonly totalWithShipping = computed<number>(
    () => (this.cartState()?.summary?.total || 0) + this.shippingCost(),
  );

  readonly departmentOptions = computed<SelectorOption[]>(() =>
    this.departments().map((d) => ({ value: d.id, label: d.name })),
  );
  readonly cityOptions = computed<SelectorOption[]>(() =>
    this.cities().map((c) => ({ value: c.id, label: c.name })),
  );

  /**
   * Reactive confirm gate (signal-based so the shell footer recomputes). Mirrors
   * the shipping half of the legacy `canConfirm` (the payment half is validated
   * by the Cobro step / collector, not here).
   */
  readonly canConfirm = computed<boolean>(() => {
    const method = this.selectedShippingMethod();
    if (!method) return false;
    if (!this.cartState()?.customer) return false;
    if (!this.cartState()?.items?.length) return false;
    if (method.type !== 'pickup') {
      const addr = this.addressValue() as
        | { address_line1?: string; city?: string }
        | null;
      if (!addr?.address_line1 || !addr?.city) return false;
    }
    return true;
  });

  constructor() {
    this.loadShippingMethods();
    this.setupFormListeners();
    this.currencyService.loadCurrency();
    void this.loadDepartments();

    inject(DestroyRef).onDestroy(() => {
      if (this.flashTimeout) clearTimeout(this.flashTimeout);
    });
  }

  // ── Loaders / listeners ───────────────────────────────────────────────────
  private loadShippingMethods(): void {
    this.shippingService
      .getShippingMethods()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((methods) => this.shippingMethods.set(methods));
  }

  private setupFormListeners(): void {
    // Recalculate shipping cost when the address changes (delivery only).
    this.addressForm.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef), debounceTime(500))
      .subscribe(() => {
        if (this.selectedShippingMethod() && !this.manualCostOverride()) {
          this.calculateShippingCost();
        }
      });
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
  }

  getShippingIcon(type: string): string {
    const iconMap: Record<string, string> = {
      own_fleet: 'truck',
      carrier: 'package',
      pickup: 'store',
      custom: 'settings',
      third_party_provider: 'globe',
    };
    return iconMap[type] || 'truck';
  }

  private calculateShippingCost(): void {
    const method = this.selectedShippingMethod();
    if (!method || !this.cartState()?.items?.length) return;

    const address = this.addressForm.value;
    if (method.type !== 'pickup' && !address.city) return;

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
        city: address.city || undefined,
        state_province: address.state_province || undefined,
        address_line1: address.address_line1 || undefined,
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

  // ── Location dropdowns (API Colombia) ─────────────────────────────────────
  private async loadDepartments(): Promise<void> {
    this.departments.set(await this.countryService.getDepartments());
  }

  async onDepartmentChange(departmentId: number): Promise<void> {
    this.selectedDepartmentId.set(departmentId || null);
    const dept = this.departments().find((d) => d.id === departmentId);
    this.addressForm.patchValue({ state_province: dept?.name || '' });

    this.cities.set([]);
    this.selectedCityId.set(null);
    this.addressForm.patchValue({ city: '' });

    if (departmentId) {
      this.cities.set(await this.countryService.getCitiesByDepartment(departmentId));
    }
  }

  onCityChange(cityId: number): void {
    this.selectedCityId.set(cityId || null);
    const city = this.cities().find((c) => c.id === cityId);
    this.addressForm.patchValue({ city: city?.name || '' });
  }

  // ── Customer address prefill (shell-driven, user-action triggered) ─────────
  /** Public hook: prefill the address form from the cart's current customer. */
  prefillFromCart(): void {
    void this.prefillFromCustomer(this.cartState()?.customer ?? null);
  }

  /**
   * Public hook: prefill from a specific customer object (the shell passes the
   * fresh selection before it flows back through the `cartState` input). Fetches
   * the full customer when its addresses are not yet hydrated.
   */
  async prefillFromCustomer(customer: PosCustomer | null | undefined): Promise<void> {
    if (!customer) return;
    if (this.departments().length === 0) await this.loadDepartments();

    if (customer.addresses && customer.addresses.length > 0) {
      await this.applyCustomerAddress(customer);
      return;
    }

    this.customerService
      .fetchCustomerById(customer.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((refreshed) => {
        if (refreshed) void this.applyCustomerAddress(refreshed);
      });
  }

  private async applyCustomerAddress(customer: PosCustomer): Promise<void> {
    const shippingAddress =
      customer.addresses?.find((a) => a.is_primary) || customer.addresses?.[0];

    if (!shippingAddress) {
      this.addressForm.reset();
      this.selectedCustomerAddressId.set(null);
      this.selectedDepartmentId.set(null);
      this.selectedCityId.set(null);
      this.cities.set([]);
      return;
    }

    this.addressForm.patchValue({ address_line1: shippingAddress.address_line1 });
    this.selectedCustomerAddressId.set(shippingAddress.id);

    if (shippingAddress.state_province) {
      const dept = this.departments().find(
        (d) => d.name.toLowerCase() === shippingAddress.state_province!.toLowerCase(),
      );
      if (dept) {
        this.selectedDepartmentId.set(dept.id);
        this.addressForm.patchValue({ state_province: dept.name });
        this.cities.set(await this.countryService.getCitiesByDepartment(dept.id));

        if (shippingAddress.city) {
          const city = this.cities().find(
            (c) => c.name.toLowerCase() === shippingAddress.city!.toLowerCase(),
          );
          if (city) {
            this.selectedCityId.set(city.id);
            this.addressForm.patchValue({ city: city.name });
          }
        }
      } else {
        this.addressForm.patchValue({
          state_province: shippingAddress.state_province || '',
          city: shippingAddress.city || '',
        });
      }
    }

    if (this.selectedShippingMethod() && !this.manualCostOverride()) {
      this.calculateShippingCost();
    }
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
      const addr = this.addressForm.value;
      if (!addr.address_line1 || !addr.city) {
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
   * @param paymentSubmit `null` for contra-entrega (order pending payment,
   *   `paymentRequest = null`); a `contado` submit → a `PaymentRequest` charged
   *   for `totalWithShipping`; a `credito` submit → a `creditConfig` plan.
   *
   * Limitation: the legacy `processShippingSale` credit path only models a
   * financed installment plan. A `credito` submit whose `credit.type === 'free'`
   * (fiado libre) is still forwarded through this same installment-shaped
   * `creditConfig` — the free-vs-installments distinction is NOT preserved for
   * delivery orders (unlike the pickup Cobro step, which routes 'free' to
   * `processCreditSale`). This mirrors the pre-existing modal behavior.
   */
  execute(paymentSubmit: PaymentSubmit | null): void {
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

    const addr = this.addressForm.value;
    const shippingAddress: PosShippingAddress = {
      address_line1: addr.address_line1 || '',
      city: addr.city || '',
      state_province: addr.state_province || '',
      country_code: 'CO',
      recipient_name: this.customerDisplayName,
      recipient_phone: cart.customer?.phone || '',
    };

    let paymentRequest: PaymentRequest | null = null;
    let creditConfig:
      | {
          num_installments: number;
          frequency: 'weekly' | 'biweekly' | 'monthly';
          first_installment_date: string;
          interest_rate: number;
          initial_payment: number;
          initial_payment_method_id?: number;
        }
      | undefined = undefined;

    if (paymentSubmit == null) {
      // Contra-entrega: no payment now.
      paymentRequest = null;
      creditConfig = undefined;
    } else if (paymentSubmit.mode === 'contado') {
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

    const customerAddressId = this.selectedCustomerAddressId();
    if (!customerAddressId && addr.address_line1 && addr.city && cart.customer) {
      this.createAddressThenProcessOrder(
        addr,
        shippingAddress,
        deliveryType,
        paymentRequest,
        creditConfig,
      );
    } else {
      this.processOrder(
        shippingAddress,
        deliveryType,
        paymentRequest,
        customerAddressId,
        creditConfig,
      );
    }
  }

  private createAddressThenProcessOrder(
    address: any,
    shippingAddress: PosShippingAddress,
    deliveryType: string,
    paymentRequest: PaymentRequest | null,
    creditConfig?: any,
  ): void {
    const customer = this.cartState()!.customer!;
    const defaultCountryCode = this.countryService.getDefaultCountry();

    this.http
      .post<any>(`${environment.apiUrl}/store/addresses`, {
        customer_id: customer.id,
        address_line_1: address.address_line1,
        city: address.city,
        state: address.state_province || '',
        country: defaultCountryCode,
        type: 'shipping',
        is_primary: !customer.addresses?.length,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          const newAddressId = response?.data?.id || response?.id || null;
          this.processOrder(
            shippingAddress,
            deliveryType,
            paymentRequest,
            newAddressId,
            creditConfig,
          );
        },
        error: () => {
          this.processOrder(shippingAddress, deliveryType, paymentRequest, null, creditConfig);
        },
      });
  }

  private processOrder(
    shippingAddress: PosShippingAddress,
    deliveryType: string,
    paymentRequest: PaymentRequest | null,
    addressId: number | null,
    creditConfig?: any,
  ): void {
    const address = this.addressForm.value;

    this.paymentService
      .processShippingSale(
        this.cartState()!,
        {
          shippingMethodId: this.selectedShippingMethod()!.id,
          shippingCost: this.shippingCost(),
          deliveryType,
          shippingAddress,
          deliveryNotes: address.delivery_notes || undefined,
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
