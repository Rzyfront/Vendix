import {
  Component,
  ChangeDetectionStrategy,
  OnInit,
  DestroyRef,
  signal,
  computed,
  inject,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { firstValueFrom } from 'rxjs';
import { CommonModule } from '@angular/common';
import { RouterModule, Router } from '@angular/router';
import {
  FormsModule,
  ReactiveFormsModule,
  FormBuilder,
  FormGroup,
  Validators,
} from '@angular/forms';
import { CartService, Cart, CartItem } from '../../services/cart.service';
import { environment } from '../../../../../../environments/environment';
import {
  CheckoutService,
  PaymentMethod,
  CheckoutRequest,
  GuestCheckoutCustomer,
  BookingSelection,
  WompiWidgetConfig,
} from '../../services/checkout.service';
import { WompiService } from '../../../../../shared/services/wompi.service';
import { AccountService, Address } from '../../services/account.service';
import {
  CatalogService,
  EcommerceProduct,
} from '../../services/catalog.service';
import {
  CountryService,
  Country,
  Department,
  City,
} from '../../../../../services/country.service';

import { ProductCarouselComponent } from '../../components/product-carousel/product-carousel.component';
import { ProductQuickViewModalComponent } from '../../components/product-quick-view-modal/product-quick-view-modal.component';
import { BookingSlotPickerComponent } from '../../components/booking-slot-picker/booking-slot-picker.component';
import { InputComponent } from '../../../../../shared/components/input/input.component';
import {
  CurrencyPipe,
  CurrencyFormatService,
} from '../../../../../shared/pipes/currency';
import { ButtonComponent } from '../../../../../shared/components/button/button.component';
import { IconComponent } from '../../../../../shared/components/icon/icon.component';
import {
  SelectorComponent,
  SelectorOption,
} from '../../../../../shared/components/selector/selector.component';
import { ToastService } from '../../../../../shared/components/toast/toast.service';
import { AuthFacade } from '../../../../../core/store';
import {
  GuestCheckoutData,
  GuestCheckoutDataModalComponent,
} from '../../components/guest-checkout-data-modal/guest-checkout-data-modal.component';

@Component({
  selector: 'app-checkout',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    FormsModule,
    ReactiveFormsModule,
    ProductCarouselComponent,
    ProductQuickViewModalComponent,
    InputComponent,
    CurrencyPipe,
    ButtonComponent,
    IconComponent,
    SelectorComponent,
    BookingSlotPickerComponent,
    GuestCheckoutDataModalComponent,
  ],
  templateUrl: './checkout.component.html',
  styleUrls: ['./checkout.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CheckoutComponent implements OnInit {
  readonly cart = signal<Cart | null>(null);
  readonly payment_methods = signal<PaymentMethod[]>([]);
  readonly addresses = signal<Address[]>([]);

  readonly selected_payment_method_id = signal<number | null>(null);
  readonly selected_address_id = signal<number | null>(null);
  readonly use_new_address = signal(false);
  readonly save_new_address = signal(true);
  readonly is_authenticated = signal(false);

  address_form!: FormGroup;
  readonly notes = signal('');

  readonly etaPreview = signal<{
    readyAt: string;
    deliveredAt: string;
    prepMinutes: number;
    transitMinutes: number;
  } | null>(null);
  readonly etaLabel = computed(() => {
    const eta = this.etaPreview();
    if (!eta) return '';
    if (this.selected_shipping_method_id) {
      const totalMin = eta.prepMinutes + eta.transitMinutes;
      return `Entrega estimada: ~${totalMin} min`;
    }
    return `Listo en ~${eta.prepMinutes} min`;
  });

  readonly is_loading = signal(true);
  readonly is_submitting = signal(false);
  readonly error_message = signal('');

  // Wompi Widget
  readonly isWompiPayment = signal(false);
  readonly wompiWidgetLoading = signal(false);

  // Flag to prevent cart-empty redirect after successful checkout
  private orderPlaced = false;

  readonly step = signal(1);

  // ========== BOOKING ==========
  /** Booking selections keyed by product and variant, so variant services do not overwrite each other. */
  bookingSelections = new Map<string, BookingSelection>();

  /** True when cart has at least one bookable service */
  get cartHasBookableServices(): boolean {
    return this.cart_service.hasBookableServices();
  }

  /** Returns the bookable cart items */
  get bookableItems(): CartItem[] {
    return this.cart_service.getBookableItems();
  }

  /**
   * Dynamic step calculation:
   * - Services-only + no booking: Payment(1), Confirm(2)
   * - Services-only + booking: Booking(1), Payment(2), Confirm(3)
   * - Physical + no booking: Address(1), Payment(2), Confirm(3)
   * - Physical + booking: Address(1), Booking(2), Payment(3), Confirm(4)
   */
  get bookingStep(): number | null {
    if (!this.cartHasBookableServices) return null;
    return this.cartHasOnlyServices ? 1 : 2;
  }

  get totalSteps(): number {
    let steps = this.cartHasOnlyServices ? 2 : 3; // base steps
    if (this.cartHasBookableServices) steps++;
    return steps;
  }

  /** True when all bookable items have a slot selected */
  get allBookingSlotsSelected(): boolean {
    if (!this.cartHasBookableServices) return true;
    const bookableItems = this.bookableItems;
    return bookableItems.every((item) =>
      this.bookingSelections.has(this.getBookingKey(item)),
    );
  }

  /** True when all cart items are services (no physical products) */
  get cartHasOnlyServices(): boolean {
    return this.cart_service.hasOnlyServices();
  }

  /** True when the cart has at least one physical product */
  get cartHasPhysicalItems(): boolean {
    return this.cart_service.hasPhysicalItems();
  }

  // Recommendations
  readonly recommendedProducts = signal<EcommerceProduct[]>([]);
  readonly quickViewOpen = signal(false);
  readonly selectedProductSlug = signal<string | null>(null);

  // Location data (Country API)
  readonly countries = signal<Country[]>([]);
  readonly departments = signal<Department[]>([]);
  readonly cities = signal<City[]>([]);
  readonly loading_departments = signal(false);
  readonly loading_cities = signal(false);

  private destroyRef = inject(DestroyRef);
  private catalogService = inject(CatalogService);
  private countryService = inject(CountryService);
  private currencyService = inject(CurrencyFormatService);
  private toast = inject(ToastService);
  private wompiService = inject(WompiService);
  private auth_facade = inject(AuthFacade);
  readonly guestDataModal = viewChild(GuestCheckoutDataModalComponent);
  private guest_data_decision_made = false;
  private guest_checkout_data: GuestCheckoutData | null = null;

  constructor(
    private cart_service: CartService,
    private checkout_service: CheckoutService,
    private account_service: AccountService,
    private router: Router,
    private fb: FormBuilder,
  ) {
    this.initForm();
  }

  ngOnInit(): void {
    // Asegurar que la moneda esté cargada para mostrar precios correctamente
    this.currencyService.loadCurrency();

    this.auth_facade.isAuthenticated$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((isAuthenticated) =>
        this.is_authenticated.set(isAuthenticated),
      );

    this.setupLocationData();
    this.loadData();
    this.loadRecommendations();
  }

  /**
   * Restores a pending booking selection from sessionStorage (set by BookingComponent).
   * Automatically pre-fills the booking slot for the bookable service in the cart.
   */
  private restorePendingBooking(): void {
    try {
      const stored = sessionStorage.getItem('pending_booking');
      if (!stored) return;

      const booking = JSON.parse(stored);
      if (
        booking.product_id &&
        booking.date &&
        booking.start_time &&
        booking.end_time
      ) {
        // Verify the product/variant is actually in the current cart.
        const cartItem = this.cart()?.items?.find(
          (item) =>
            item.product_id === booking.product_id &&
            (booking.product_variant_id
              ? item.product_variant_id === booking.product_variant_id
              : true),
        );
        if (!cartItem) {
          sessionStorage.removeItem('pending_booking');
          return;
        }
        this.bookingSelections.set(this.getBookingKey(cartItem), {
          product_id: booking.product_id,
          product_variant_id: booking.product_variant_id,
          date: booking.date,
          start_time: booking.start_time,
          end_time: booking.end_time,
        });
        // Clean up after reading
        sessionStorage.removeItem('pending_booking');
      }
    } catch {
      sessionStorage.removeItem('pending_booking');
    }
  }

  initForm(): void {
    this.address_form = this.fb.group({
      address_line1: ['', Validators.required],
      address_line2: [''],
      city: ['', Validators.required],
      state_province: [''],
      country_code: ['CO', Validators.required],
      postal_code: [''],
      phone_number: [
        '',
        [Validators.required, Validators.pattern(/^[\d+#*\s()-]*$/)],
      ],
    });
  }

  private setupLocationData(): void {
    // Load countries
    this.countries.set(this.countryService.getCountries());

    // Setup listeners
    const countryControl = this.address_form.get('country_code');
    const depControl = this.address_form.get('state_province');
    const cityControl = this.address_form.get('city');

    countryControl?.valueChanges.subscribe((code: string) => {
      if (code === 'CO') {
        this.loadDepartments();
      } else {
        // Clear downstream data for non-Colombia countries
        this.departments.set([]);
        this.cities.set([]);
        depControl?.setValue('');
        cityControl?.setValue('');
      }
    });

    depControl?.valueChanges.subscribe((depId: any) => {
      if (depId) {
        const numericDepId = Number(depId);
        if (!isNaN(numericDepId)) {
          this.loadCities(numericDepId);
        }
      } else {
        this.cities.set([]);
        cityControl?.setValue('');
      }
    });

    // Load departments for default country
    this.loadDepartments();
  }

  private async loadDepartments(): Promise<void> {
    this.loading_departments.set(true);
    this.departments.set(await this.countryService.getDepartments());
    this.loading_departments.set(false);
  }

  private async loadCities(depId: number): Promise<void> {
    this.loading_cities.set(true);
    this.cities.set(await this.countryService.getCitiesByDepartment(depId));
    this.loading_cities.set(false);
  }

  loadData(): void {
    this.is_loading.set(true);
    const isAuthenticated = this.auth_facade.isAuthenticated();
    this.is_authenticated.set(isAuthenticated);

    // Load cart
    this.cart_service.cart$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((cart) => {
        this.cart.set(cart);
        this.restorePendingBooking();
        if (cart && cart.items.length > 0) {
          this.loadEtaPreview();
        }
        if (!this.orderPlaced && (!cart || cart.items.length === 0)) {
          this.router.navigate(['/cart']);
        }
      });

    if (isAuthenticated) {
      this.cart_service.getCart().subscribe();
    } else {
      this.use_new_address.set(true);
      this.save_new_address.set(false);
    }

    // Load payment methods (initially without shipping type filter)
    this.loadPaymentMethods();

    if (!isAuthenticated) {
      this.is_loading.set(false);
      return;
    }

    // Load addresses
    this.account_service.getAddresses().subscribe({
      next: (response: any) => {
        if (response.success) {
          this.addresses.set(response.data);
          if (response.data.length > 0) {
            this.selected_address_id.set(response.data[0].id);
          } else {
            this.use_new_address.set(true);
          }
        }
        this.is_loading.set(false);
      },
      error: () => {
        this.is_loading.set(false);
        this.use_new_address.set(true);
        this.toast.warning(
          'No pudimos cargar tus direcciones guardadas. Puedes ingresar una nueva.',
          'Aviso',
        );
      },
    });
  }

  loadRecommendations(): void {
    this.catalogService
      .getProducts({ limit: 10, sort_by: 'newest', has_discount: true })
      .subscribe({
        next: (response) => {
          if (response.data.length > 0) {
            this.recommendedProducts.set(response.data);
          } else {
            // Fallback if no sales
            this.catalogService
              .getProducts({ limit: 10, sort_by: 'newest' })
              .subscribe((res) => {
                this.recommendedProducts.set(res.data);
              });
          }
        },
      });
  }

  selectAddress(address_id: number): void {
    this.selected_address_id.set(address_id);
    this.use_new_address.set(false);
  }

  selectNewAddress(): void {
    this.selected_address_id.set(null);
    this.use_new_address.set(true);
  }

  selectPaymentMethod(method_id: number): void {
    this.selected_payment_method_id.set(method_id);

    // Check if selected method is Wompi
    const selectedMethod = this.payment_methods().find(
      (m) => m.id === method_id,
    );
    this.isWompiPayment.set(
      selectedMethod?.type === 'wompi' || selectedMethod?.provider === 'wompi',
    );
  }

  // Shipping
  shipping_options: any[] = [];
  selected_shipping_method_id: number | null = null;
  selected_shipping_option_id: number | null = null;
  selected_shipping_method_type: string | null = null;
  shipping_cost = 0;
  loading_payment_methods = false;

  // ... (existing methods)

  // Modified logic: call this when address is finalized (e.g. Next from Address step)
  loadShippingOptions(): void {
    if (this.use_new_address() && this.address_form.valid) {
      // Convert form to address object
      const address = this.mapFormToCalcAddress(this.address_form.value);
      this.fetchShipping(address);
    } else if (this.selected_address_id()) {
      const address = this.addresses().find(
        (a) => a.id === this.selected_address_id(),
      );
      if (address) {
        this.fetchShipping(this.mapAddressToCalc(address));
      }
    }
  }

  private mapFormToCalcAddress(formValue: any): any {
    const address = { ...formValue };

    // For Colombia, convert department and city IDs to names
    if (address.country_code === 'CO') {
      // Convert department ID to name
      if (address.state_province) {
        const depId = Number(address.state_province);
        const department = this.departments().find((d) => d.id === depId);
        if (department) {
          address.state_province = department.name;
        }
      }

      // Convert city ID to name
      if (address.city) {
        const cityId = Number(address.city);
        const city = this.cities().find((c) => c.id === cityId);
        if (city) {
          address.city = city.name;
        }
      }
    }
    return address;
  }

  fetchShipping(address: any) {
    this.is_loading.set(true);
    this.cart_service.getShippingEstimates(address).subscribe({
      next: (options) => {
        this.shipping_options = options;
        if (options.length > 0) {
          // Default select first or cheapest?
          // Select first
          this.selectShippingMethod(options[0], options[0].cost);
        } else {
          this.selected_shipping_method_id = null;
          this.selected_shipping_option_id = null;
          this.shipping_cost = 0;
        }
        this.is_loading.set(false);
      },
      error: () => {
        this.is_loading.set(false);
        this.toast.error(
          'No pudimos cargar las opciones de envío. Intenta de nuevo.',
          'Error de envío',
        );
      },
    });
  }

  selectShippingMethod(option: any, cost: number) {
    this.selected_shipping_option_id = option.id;
    this.selected_shipping_method_id = option.method_id;
    this.selected_shipping_method_type = option.method_type || null;
    this.shipping_cost = cost;

    this.loadPaymentMethods(option.method_type);
    this.loadEtaPreview(option.method_id);
  }

  async loadEtaPreview(shippingMethodId?: number) {
    const cartId = this.cart()?.id;
    if (!cartId) return;
    try {
      const params = new URLSearchParams({ cart_id: String(cartId) });
      if (shippingMethodId)
        params.set('shipping_method_id', String(shippingMethodId));
      const response = await fetch(
        `${environment.apiUrl}/store/orders/preview-eta?${params}`,
        {
          headers: {
            Authorization: `Bearer ${localStorage.getItem('token')}`,
            'Content-Type': 'application/json',
          },
        },
      );
      if (response.ok) {
        const data = await response.json();
        this.etaPreview.set(data);
      }
    } catch {
      // silently fail - ETA is non-critical
    }
  }

  loadPaymentMethods(shippingType?: string): void {
    this.loading_payment_methods = true;
    this.checkout_service.getPaymentMethods(shippingType).subscribe({
      next: (response) => {
        if (response.success) {
          this.payment_methods.set(response.data);

          // Reset selection if current method is no longer available
          if (this.selected_payment_method_id()) {
            const stillAvailable = this.payment_methods().find(
              (m) => m.id === this.selected_payment_method_id(),
            );
            if (!stillAvailable) {
              this.selected_payment_method_id.set(
                this.payment_methods()[0]?.id || null,
              );
            }
          } else if (this.payment_methods().length > 0) {
            this.selected_payment_method_id.set(this.payment_methods()[0].id);
          }

          // Update Wompi flag based on current selection
          if (this.selected_payment_method_id()) {
            const selectedMethod = this.payment_methods().find(
              (m) => m.id === this.selected_payment_method_id(),
            );
            this.isWompiPayment.set(
              selectedMethod?.type === 'wompi' ||
                selectedMethod?.provider === 'wompi',
            );
          } else {
            this.isWompiPayment.set(false);
          }
        }
        this.loading_payment_methods = false;
      },
      error: () => {
        this.loading_payment_methods = false;
        this.toast.error(
          'No pudimos cargar los métodos de pago. Intenta de nuevo.',
          'Error',
        );
      },
    });
  }

  mapAddressToCalc(addr: Address) {
    return {
      country_code: addr.country_code,
      state_province: addr.state_province,
      city: addr.city,
      postal_code: addr.postal_code || undefined,
    };
  }

  /** The step number that corresponds to Payment in the current flow */
  get paymentStep(): number {
    let step = this.cartHasOnlyServices ? 1 : 2;
    if (this.cartHasBookableServices) step++;
    return step;
  }

  /** The step number that corresponds to Confirm in the current flow */
  get confirmStep(): number {
    return this.paymentStep + 1;
  }

  // Override nextStep to load shipping if moving from Step 1
  nextStep(): void {
    // Address step (only for carts with physical items)
    if (this.step() === 1 && !this.cartHasOnlyServices) {
      if (this.use_new_address() && !this.address_form.valid) {
        this.error_message.set('Por favor completa la dirección de envío');
        this.address_form.markAllAsTouched();
        return;
      }
      if (!this.use_new_address() && !this.selected_address_id()) {
        this.error_message.set('Por favor selecciona una dirección');
        return;
      }

      // If using new address and save_new_address is checked, save it first
      if (
        this.is_authenticated() &&
        this.use_new_address() &&
        this.save_new_address()
      ) {
        this.saveNewAddressAndContinue();
        return;
      }

      // Load shipping before moving
      this.loadShippingOptions();
      this.error_message.set('');
      this.step.set(this.step() + 1);
      return;
    }

    // Booking step validation
    if (this.bookingStep !== null && this.step() === this.bookingStep) {
      if (!this.allBookingSlotsSelected) {
        this.error_message.set(
          'Por favor selecciona un horario para todos los servicios',
        );
        return;
      }
      this.error_message.set('');
      this.step.set(this.step() + 1);
      return;
    }

    // Payment step validation
    if (this.step() === this.paymentStep) {
      if (!this.selected_payment_method_id()) {
        this.error_message.set('Por favor selecciona un método de pago');
        return;
      }

      // Check shipping selection (only for physical items)
      if (
        !this.cartHasOnlyServices &&
        this.shipping_options.length > 0 &&
        !this.selected_shipping_method_id
      ) {
        this.error_message.set('Por favor selecciona un método de envío');
        return;
      }
    }

    this.error_message.set('');
    this.step.set(this.step() + 1);
  }

  /** Handle booking slot selection from the picker */
  onBookingSlotSelected(
    item: CartItem,
    slot: { date: string; start_time: string; end_time: string },
  ): void {
    this.bookingSelections.set(this.getBookingKey(item), {
      product_id: item.product_id,
      product_variant_id: item.product_variant_id || undefined,
      date: slot.date,
      start_time: slot.start_time,
      end_time: slot.end_time,
    });
  }

  /** Check if a specific product has a booking selection */
  hasBookingForItem(item: CartItem): boolean {
    return this.bookingSelections.has(this.getBookingKey(item));
  }

  /** Get the booking selection summary for a product */
  getBookingSummary(item: CartItem): string {
    const booking = this.bookingSelections.get(this.getBookingKey(item));
    if (!booking) return '';
    const date = new Date(booking.date + 'T12:00:00');
    const formatted = date.toLocaleDateString('es-CO', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    });
    return `${formatted}, ${booking.start_time} - ${booking.end_time}`;
  }

  getBookingKey(item: CartItem): string {
    return `${item.product_id}:${item.product_variant_id ?? 'base'}`;
  }

  /**
   * Saves the new address to the customer's account, then continues to the next step
   */
  private saveNewAddressAndContinue(): void {
    this.is_loading.set(true);

    // Prepare address payload with converted names
    const addressPayload = this.prepareAddressPayload();

    this.account_service.createAddress(addressPayload).subscribe({
      next: (response) => {
        if (response.success) {
          // Add the new address to the list and select it
          this.addresses.update((addresses) => [...addresses, response.data]);
          this.selected_address_id.set(response.data.id);
          this.use_new_address.set(false);
          this.toast.success(
            'Dirección guardada correctamente',
            'Dirección guardada',
          );
        }
        // Continue with shipping options
        this.loadShippingOptions();
        this.error_message.set('');
        this.step.set(this.step() + 1);
        this.is_loading.set(false);
      },
      error: (err) => {
        this.is_loading.set(false);
        // Still continue even if save fails, but notify user
        this.toast.warning(
          'La dirección no pudo guardarse, pero puedes continuar con tu compra',
          'Aviso',
        );
        this.loadShippingOptions();
        this.error_message.set('');
        this.step.set(this.step() + 1);
      },
    });
  }

  /**
   * Prepares the address payload with converted department/city names for Colombia
   */
  private prepareAddressPayload(): any {
    let addressValue = { ...this.address_form.value };

    // For Colombia, convert department and city IDs to names
    if (addressValue.country_code === 'CO') {
      if (addressValue.state_province) {
        const depId = Number(addressValue.state_province);
        const department = this.departments().find((d) => d.id === depId);
        if (department) {
          addressValue.state_province = department.name;
        }
      }

      if (addressValue.city) {
        const cityId = Number(addressValue.city);
        const city = this.cities().find((c) => c.id === cityId);
        if (city) {
          addressValue.city = city.name;
        }
      }
    }

    // Add required fields for the API
    return {
      ...addressValue,
      type: 'shipping',
      is_primary: this.addresses().length === 0, // Make it primary if it's the first address
    };
  }

  prevStep(): void {
    this.step.set(this.step() - 1);
  }

  placeOrder(): void {
    if (!this.selected_payment_method_id()) {
      this.error_message.set('Por favor selecciona un método de pago');
      return;
    }

    if (!this.is_authenticated() && !this.guest_data_decision_made) {
      this.guestDataModal()?.open();
      return;
    }

    this.is_submitting.set(true);
    this.error_message.set('');

    const request: CheckoutRequest = {
      payment_method_id: this.selected_payment_method_id()!,
      notes: this.notes() || undefined,
      // Only include shipping fields when cart has physical items
      ...(!this.cartHasOnlyServices
        ? {
            shipping_method_id: this.selected_shipping_method_id || undefined,
            shipping_rate_id: this.selected_shipping_option_id || undefined,
          }
        : {}),
      // Include booking data if there are bookable services
      ...(this.cartHasBookableServices && this.bookingSelections.size > 0
        ? {
            bookings: Array.from(this.bookingSelections.values()),
          }
        : {}),
      // Always send cart items as fallback (in case backend cart is empty/not synced)
      items: this.cart()?.items?.map((item: CartItem) => ({
        product_id: item.product_id,
        product_variant_id: item.product_variant_id || undefined,
        quantity: item.quantity,
      })),
      guest_customer: this.toGuestCustomer(this.guest_checkout_data),
    };

    if (!this.cartHasOnlyServices && this.use_new_address()) {
      // Convert IDs to names for backend compatibility
      let addressValue = { ...this.address_form.value };

      // For Colombia, convert department and city IDs to names
      if (addressValue.country_code === 'CO') {
        // Convert department ID to name
        if (addressValue.state_province) {
          const depId = Number(addressValue.state_province);
          const department = this.departments().find((d) => d.id === depId);
          if (department) {
            addressValue.state_province = department.name;
          }
        }

        // Convert city ID to name
        if (addressValue.city) {
          const cityId = Number(addressValue.city);
          const city = this.cities().find((c) => c.id === cityId);
          if (city) {
            addressValue.city = city.name;
          }
        }
      }

      request.shipping_address = addressValue;
    } else if (!this.cartHasOnlyServices && this.selected_address_id()) {
      request.shipping_address_id = this.selected_address_id() ?? undefined;
    }

    // Wompi payment flow: create order first, then open widget
    if (this.isWompiPayment()) {
      this.wompiWidgetLoading.set(true);
      this.is_submitting.set(false);

      this.checkout_service.checkout(request).subscribe({
        next: (response) => {
          if (response.success) {
            this.orderPlaced = true;
            const orderId = response.data.order_id;
            const publicOrderToken = response.data.public_order_token;
            const totalAmount =
              (this.cart()?.subtotal ?? 0) + this.shipping_cost;

            this.checkout_service
              .prepareWompiPayment(
                orderId,
                totalAmount,
                undefined,
                publicOrderToken
                  ? `${window.location.origin}/pedido/${publicOrderToken}?wompi_callback=true`
                  : `${window.location.origin}/account/orders/${orderId}?wompi_callback=true`,
                publicOrderToken,
              )
              .subscribe({
                next: (res) => {
                  this.wompiWidgetLoading.set(false);
                  this.openWompiWidget(res.data, orderId, publicOrderToken);
                },
                error: (err) => {
                  this.wompiWidgetLoading.set(false);
                  const msg = this.extractErrorMessage(err);
                  this.error_message.set(msg);
                  this.toast.error(msg, 'Error al preparar pago');
                },
              });
          }
        },
        error: (err) => {
          this.wompiWidgetLoading.set(false);
          const msg = this.extractErrorMessage(err);
          this.error_message.set(msg);
          this.toast.error(msg, 'Error al procesar el pedido');
        },
      });

      return;
    }

    this.checkout_service.checkout(request).subscribe({
      next: (response) => {
        if (response.success) {
          this.orderPlaced = true;
          this.is_submitting.set(false);
          if (!this.is_authenticated() && response.data.public_order_token) {
            this.cart_service.clearAllCart();
            this.router.navigate(
              ['/pedido', response.data.public_order_token],
              {
                queryParams: { success: true },
              },
            );
          } else {
            this.router.navigate(['/account/orders', response.data.order_id], {
              queryParams: { success: true },
            });
          }
        }
      },
      error: (err) => {
        this.is_submitting.set(false);
        const msg = this.extractErrorMessage(err);
        this.error_message.set(msg);
        this.toast.error(msg, 'Error al procesar el pedido');
      },
    });
  }

  onGuestDataCompleted(data: GuestCheckoutData | null): void {
    this.guest_checkout_data = data;
    this.guest_data_decision_made = true;
    this.placeOrder();
  }

  private toGuestCustomer(
    data: GuestCheckoutData | null,
  ): GuestCheckoutCustomer | undefined {
    if (!data) return undefined;
    return {
      first_name: data.first_name,
      last_name: data.last_name,
      email: data.email,
      phone: data.phone,
      document_type: data.document_type,
      document_number: data.document_number,
    };
  }

  async openWompiWidget(
    config: WompiWidgetConfig,
    orderId: number,
    publicOrderToken?: string | null,
  ): Promise<void> {
    try {
      await this.wompiService.loadWidgetScript();

      const checkout = new (window as any).WidgetCheckout({
        currency: config.currency,
        amountInCents: config.amount_in_cents,
        reference: config.reference,
        publicKey: config.public_key,
        signature: { integrity: config.signature_integrity },
        redirectUrl:
          config.redirect_url ||
          `${window.location.origin}/account/orders/${orderId}?wompi_callback=true`,
        customerData: {
          email: config.customer_email,
        },
      });

      checkout.open(async (result: any) => {
        const transaction = result?.transaction;
        if (transaction) {
          // Force-confirm against Wompi via backend so the order/payment
          // state is correct on return — the webhook is still the canonical
          // path; this is a UX fallback. NEVER block the redirect on failure.
          if (
            transaction.status === 'APPROVED' ||
            transaction.status === 'DECLINED' ||
            transaction.status === 'ERROR'
          ) {
            try {
              await firstValueFrom(
                this.checkout_service.confirmWompiPayment(
                  orderId,
                  publicOrderToken,
                ),
              );
            } catch (err) {
              console.warn('confirm-wompi-payment failed', err);
            }
          }

          if (transaction.status === 'APPROVED') {
            this.orderPlaced = true;
            if (publicOrderToken) {
              this.cart_service.clearAllCart();
            }
            this.router.navigate(
              publicOrderToken
                ? ['/pedido', publicOrderToken]
                : ['/account/orders', orderId],
              {
                queryParams: { success: true },
              },
            );
          } else if (
            transaction.status === 'DECLINED' ||
            transaction.status === 'ERROR'
          ) {
            this.toast.error(
              'El pago fue rechazado. Intenta con otro método de pago.',
              'Pago rechazado',
            );
          } else {
            // PENDING — redirect to order detail for status check
            this.router.navigate(
              publicOrderToken
                ? ['/pedido', publicOrderToken]
                : ['/account/orders', orderId],
              {
                queryParams: { wompi_callback: true },
              },
            );
          }
        } else {
          // User closed widget without paying
          this.toast.warning(
            'El pago fue cancelado. Tu pedido está pendiente de pago.',
            'Pago cancelado',
          );
        }
      });
    } catch (error) {
      this.wompiWidgetLoading.set(false);
      this.is_submitting.set(false);
      console.error('Failed to open Wompi widget:', error);
      this.toast.error(
        'No se pudo abrir el widget de pago. Intenta de nuevo.',
        'Error',
      );
    }
  }

  private extractErrorMessage(err: any): string {
    const msg = err?.error?.message;
    if (typeof msg === 'string') return msg;
    if (msg?.message) return msg.message;
    return 'Ocurrió un error inesperado';
  }

  goToCart(): void {
    this.router.navigate(['/cart']);
  }

  onQuickView(product: EcommerceProduct): void {
    this.selectedProductSlug.set(product.slug);
    this.quickViewOpen.set(true);
  }

  onAddToCartFromSlider(product: EcommerceProduct): void {
    const result = this.cart_service.addToCart(product.id, 1);
    if (result) result.subscribe();
  }

  // Helper getters for displaying selected location names in confirmation
  getSelectedCountryName(): string {
    const code = this.address_form.get('country_code')?.value;
    const country = this.countries().find((c) => c.code === code);
    return country?.name || code || '';
  }

  getSelectedDepartmentName(): string {
    const depId = Number(this.address_form.get('state_province')?.value);
    const department = this.departments().find((d) => d.id === depId);
    return (
      department?.name || this.address_form.get('state_province')?.value || ''
    );
  }

  getSelectedCityName(): string {
    const cityId = Number(this.address_form.get('city')?.value);
    const city = this.cities().find((c) => c.id === cityId);
    return city?.name || this.address_form.get('city')?.value || '';
  }

  // Transform location data to SelectorOption format
  get countryOptions(): SelectorOption[] {
    return this.countries().map((c) => ({ value: c.code, label: c.name }));
  }

  get departmentOptions(): SelectorOption[] {
    return this.departments().map((d) => ({ value: d.id, label: d.name }));
  }

  get cityOptions(): SelectorOption[] {
    return this.cities().map((c) => ({ value: c.id, label: c.name }));
  }

  // Helper method for field validation errors
  getFieldError(fieldName: string): string {
    const control = this.address_form.get(fieldName);
    if (!control || !control.touched || !control.errors) {
      return '';
    }

    const errors = control.errors;
    if (errors['required']) {
      return 'Este campo es requerido';
    }
    if (errors['minlength']) {
      return `Mínimo ${errors['minlength'].requiredLength} caracteres`;
    }
    if (errors['pattern']) {
      return 'Formato inválido';
    }

    return '';
  }
}
