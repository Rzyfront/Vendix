import {
  Component,
  ChangeDetectionStrategy,
  OnInit,
  DestroyRef,
  signal,
  computed,
  inject,
  viewChild,
  effect,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { firstValueFrom, debounceTime, distinctUntilChanged, filter } from 'rxjs';
import { CommonModule } from '@angular/common';
import { RouterModule, Router, ActivatedRoute } from '@angular/router';
import {
  FormsModule,
  ReactiveFormsModule,
  FormBuilder,
  FormGroup,
  Validators,
} from '@angular/forms';
import { CartService, Cart, CartItem } from '../../services/cart.service';
import { cartLineKey } from '../../utils/cart-line-key.util';
import { TableContextService } from '../../services/table-context.service';
import { environment } from '../../../../../../environments/environment';
import {
  CheckoutService,
  PaymentMethod,
  CheckoutRequest,
  GuestCheckoutCustomer,
  BookingSelection,
  WompiWidgetConfig,
  BankAccountOption,
  DeliveryOption,
} from '../../services/checkout.service';
import { EcommerceBookingService } from '../../services/ecommerce-booking.service';
import { WompiService } from '../../../../../shared/services/wompi.service';
import { AccountService, Address } from '../../services/account.service';
import { CustomerAddressPickerComponent } from '../../../../../shared/components/customer-address-picker/customer-address-picker.component';
import { extractApiErrorMessage } from '../../../../../core/utils/api-error-handler';
import { ERROR_MESSAGES } from '../../../../../core/utils/error-messages';
import { phoneDigitsValidator } from '../../utils/address-validators';
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
import { CartPromotionsComponent } from '../../components/cart-promotions/cart-promotions.component';
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
import { TenantFacade } from '../../../../../core/store/tenant/tenant.facade';
import {
  GuestCheckoutData,
  GuestCheckoutDataModalComponent,
} from '../../components/guest-checkout-data-modal/guest-checkout-data-modal.component';
import { PaymentInstructionsModalComponent } from '../../components/payment-instructions-modal/payment-instructions-modal.component';
import { LocationPermissionModalComponent } from '../../components/location-permission-modal/location-permission-modal.component';
import { AddressMapPickerComponent } from '../../components/address-map-picker/address-map-picker.component';
import { GeolocationService } from '../../services/geolocation.service';
import {
  GeocodingService,
  NormalizedAddress,
} from '../../services/geocoding.service';

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
    PaymentInstructionsModalComponent,
    CustomerAddressPickerComponent,
    CartPromotionsComponent,
    LocationPermissionModalComponent,
    AddressMapPickerComponent,
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

  // ========== GEO-LOCATION (opt-in map address) ==========
  /** True once the location opt-in modal has been offered (show only once). */
  readonly location_prompt_shown = signal(false);
  /** Controls the location-permission modal visibility. */
  readonly show_location_modal = signal(false);
  /** Current map center / captured coordinate (never rendered as text). */
  readonly map_center = signal<{ lat: number; lng: number } | null>(null);

  /** Mirror of the selected country code so the template can branch reactively (zoneless). */
  readonly selected_country_code = signal('CO');
  /** True when Colombia is selected — drives department/city dropdowns vs free-text. */
  readonly isColombia = computed(() => this.selected_country_code() === 'CO');
  /** Signal mirror of address_form.validity (FormGroup.valid is not reactive in zoneless). */
  readonly addressFormValid = signal(false);

  /**
   * Whether the user may leave the address step. Either a saved address is
   * selected, or the new-address form is fully valid. Service-only carts skip
   * the address step entirely. This GATES THE CONTINUE BUTTON without adding a
   * new hard block to any other flow.
   */
  readonly canProceedFromAddress = computed(() => {
    if (this.cartHasOnlyServices) return true;
    // Paso 1 delivery-first: sin modo elegido no se avanza.
    if (this.selected_delivery() == null) return false;
    // Recoger: la opción de retiro se autocotiza al elegir el modo; el click
    // de Continuar espera la promesa si sigue en vuelo (ver `nextStep`).
    if (this.selected_delivery() === 'pickup') return true;
    if (!this.use_new_address()) return this.selected_address_id() != null;
    return this.addressFormValid();
  });

  /**
   * Identidad de la línea (producto:variante:tarifa) para el `track` del
   * resumen. `CartService` ya la rellena en `line_key`; el fallback la
   * recalcula para que el `@for` nunca reciba `undefined`.
   */
  lineKey(item: CartItem): string {
    return (
      item.line_key ??
      cartLineKey(
        item.product_id,
        item.product_variant_id,
        item.price_tier?.id ?? null,
      )
    );
  }

  address_form!: FormGroup;
  readonly notes = signal('');
  /**
   * Optional coupon code typed by the customer. We only send the raw string
   * to the backend; totals are recomputed there. Empty string = no coupon.
   */
  readonly coupon_code = signal('');

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
  readonly invoicingEnabled = signal(false);

  /**
   * CP-tienda-checkout-whatsapp (anotación 2): `true` cuando se llega con
   * `?channel=whatsapp` desde "Finalizar por WhatsApp". El flujo es el MISMO
   * (misma validación, cálculo y orden); solo el post-éxito cambia: resumen
   * + deep-link a `wa.me` con automensaje de la compra.
   */
  readonly is_whatsapp_channel = signal(false);

  // Wompi Widget
  readonly isWompiPayment = signal(false);
  readonly wompiWidgetLoading = signal(false);

  // Payment instructions modal + receipt file (bank_transfer / voucher)
  readonly show_payment_instructions_modal = signal(false);
  readonly payment_receipt_file = signal<File | null>(null);
  readonly payment_instructions_acknowledged = signal(false);
  readonly selectedPaymentMethodObj = computed(
    () =>
      this.payment_methods().find(
        (m) => m.id === this.selected_payment_method_id(),
      ) ?? null,
  );
  readonly requiresPaymentInstructions = computed(() => {
    const t = this.selectedPaymentMethodObj()?.type;
    return t === 'bank_transfer' || t === 'voucher';
  });

  // ====== Cuentas bancarias (bank_transfer / voucher) ======
  /**
   * Cuenta bancaria destino seleccionada por el cliente. Se inicializa al
   * cargar el catálogo del método y se persiste en el `CheckoutRequest` para
   * que el backend la valide con `resolveAndValidateBankAccount`.
   *
   * Permanece en `null` cuando el método no requiere cuenta o cuando el
   * backend devuelve `[]` (caso legacy: la tienda aún no configuró cuentas).
   * En ese último escenario el modal sigue mostrando `payment_instructions`
   * para no romper el flujo existente.
   */
  readonly selected_bank_account_id = signal<number | null>(null);

  /**
   * Cache de cuentas por método (`method_id → accounts[]`). La entrada se
   * setea al cargar y se conserva durante toda la sesión de checkout para
   * que cambiar de método y volver no dispare un refetch. El modal abre
   * instantáneamente con las cuentas cacheadas.
   */
  readonly bankAccountsByMethod = signal<Map<number, BankAccountOption[]>>(
    new Map(),
  );

  /**
   * Lista de cuentas correspondiente al método actualmente seleccionado.
   * Devuelve `[]` cuando el método no es `bank_transfer`/`voucher`, cuando
   * aún no se cargaron las cuentas, o cuando el backend devolvió catálogo
   * vacío.
   */
  readonly currentBankAccounts = computed<BankAccountOption[]>(() => {
    const methodId = this.selected_payment_method_id();
    if (methodId == null) return [];
    return this.bankAccountsByMethod().get(methodId) ?? [];
  });

  /** True mientras se carga el catálogo de cuentas del método actual. */
  readonly loadingBankAccounts = signal(false);

  /**
   * Disables the "Confirmar Pedido" button when the order cannot be placed
   * in a valid state. For physical-item carts the user must have a shipping
   * method selected; when no shipping options come back from the calculator
   * (e.g. the tenant has no shipping zone configured for the picked city),
   * we block the button so the user does not hit a 400 from the backend.
   */
  readonly canConfirmOrder = computed(() => {
    if (this.is_submitting() || this.wompiWidgetLoading()) return false;
    if (!this.cartHasOnlyServices) {
      // Carrito tiene ítems físicos: necesita método de envío seleccionado
      // y al menos una opción de la zona correspondiente.
      if (this.shipping_options().length === 0) return false;
      if (this.selected_shipping_method_id == null) return false;
    }
    return true;
  });

  // Flag to prevent cart-empty redirect after successful checkout
  private orderPlaced = false;

  readonly step = signal(1);

  /**
   * Progreso del checkout en % (0–100) para el relleno verde del header.
   * step / totalSteps → el paso final (Confirmar) llega a 100%. Depende del
   * signal step(), por lo que recalcula en cada avance/retroceso.
   */
  readonly checkoutProgress = computed(() => {
    const total = this.totalSteps;
    const current = Math.min(this.step(), total);
    return Math.round((current / total) * 100);
  });

  /** True al alcanzar el paso final (Confirmar): header se pone 100% verde. */
  readonly isCheckoutComplete = computed(() => this.step() >= this.totalSteps);

  // ========== BOOKING ==========
  /** Booking selections keyed by product and variant, so variant services do not overwrite each other. */
  /**
   * Mapa de selección de reserva por cart item (`product_id:variant_id`).
   * Envuelto en `signal` para que los `@let _bookingForItem =
   * preBookedSelectionFor(item)` del template y la tarjeta resumen
   * "Reserva confirmada" se re-rendericen cuando el cliente cambia la
   * modalidad desde el toggle inline. Sin el signal, el Map mutaba
   * silenciosamente y el resumen quedaba con el `service_location_type`
   * viejo.
   */
  bookingSelections = signal<Map<string, BookingSelection>>(new Map());

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
      this.bookingSelections().has(this.getBookingKey(item)),
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
  private tenant_facade = inject(TenantFacade);
  private geolocation = inject(GeolocationService);
  private geocoding = inject(GeocodingService);
  // QR dine-in (Step 8): slider must NOT re-add in mesa-mode — the
  // originating product-card has already routed via the mesa chokepoint.
  private tableContext = inject(TableContextService);
  private booking_service = inject(EcommerceBookingService);
  readonly guestDataModal = viewChild(GuestCheckoutDataModalComponent);
  private guest_data_decision_made = false;
  private guest_checkout_data: GuestCheckoutData | null = null;

  constructor(
    private cart_service: CartService,
    private checkout_service: CheckoutService,
    private account_service: AccountService,
    private router: Router,
    private route: ActivatedRoute,
    private fb: FormBuilder,
  ) {
    // Limpieza del debounce de recotización al salir del checkout.
    this.destroyRef.onDestroy(() => {
      if (this.shipping_fetch_timer) clearTimeout(this.shipping_fetch_timer);
    });
    this.initForm();

    // Offer location capture ONCE — the first time the customer is on the
    // address step of a physical-item cart with the new-address form open, and
    // only when the browser supports geolocation. Reads step/cart/use_new as
    // reactive deps; the guard runs untracked so writing the flag signals does
    // not re-trigger the effect. The actual decision (use GPS directly vs. show
    // the opt-in modal vs. stay manual) is delegated to maybeOfferLocation()
    // based on the current permission state.
    effect(() => {
      const isAddressStep = this.step() === 1;
      const cart = this.cart();
      const useNew = this.use_new_address();
      untracked(() => {
        if (
          isAddressStep &&
          cart != null &&
          !this.cartHasOnlyServices &&
          useNew &&
          !this.location_prompt_shown() &&
          this.geolocation.isSupported()
        ) {
          this.location_prompt_shown.set(true);
          void this.maybeOfferLocation();
        }
      });
    });

    // CP-tienda-checkout-whatsapp (C.2): recotización de fondo del domicilio.
    // Cuando el modo es domicilio y hay una dirección válida, cotiza con
    // debounce para que la lista de opciones viva en el paso 1 (donde el
    // comprador la elige) y no en el paso de pago. Lee como deps reactivas
    // solo signals; el valor del formulario se lee untracked vía la clave.
    effect(() => {
      const mode = this.selected_delivery();
      const valid = this.addressFormValid();
      const savedId = this.selected_address_id();
      const fresh = this.use_new_address();
      const onStep1 = this.step() === 1;
      untracked(() => {
        if (mode !== 'home' || this.cartHasOnlyServices || !onStep1) return;
        void valid;
        void savedId;
        void fresh;
        const key = this.currentAddressKey();
        if (!key || key === this.shipping_quote_key) return;
        // Anti-carrera A→B→A (auditoría D.3): solo la última clave programa;
        // al disparar se revalida que siga vigente antes de cotizar.
        if (this.shipping_fetch_timer) clearTimeout(this.shipping_fetch_timer);
        this.shipping_fetch_timer = setTimeout(() => {
          if (this.currentAddressKey() !== key) return;
          void this.refreshShippingQuote(key);
        }, 600);
      });
    });
  }

  ngOnInit(): void {
    // Asegurar que la moneda esté cargada para mostrar precios correctamente
    this.currencyService.loadCurrency();

    // Canal reactivo (no solo snapshot): si el componente se reutiliza entre
    // navegaciones carrito→checkout, el snapshot quedaría obsoleto y el
    // wa.me se abriría (o no) en el flujo equivocado (auditoría D.3).
    this.route.queryParamMap
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((params) => {
        this.is_whatsapp_channel.set(params.get('channel') === 'whatsapp');
      });

    this.auth_facade.isAuthenticated$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((isAuthenticated) =>
        this.is_authenticated.set(isAuthenticated),
      );

    this.setupLocationData();
    this.loadData();
    if (this.relatedProductsEnabled()) {
      this.loadRecommendations();
    }

    // FormGroup.valid no es reactivo en zoneless: reflejamos su estado en una
    // signal para que `canProceedFromAddress` y el botón "Continuar" reaccionen.
    this.address_form.statusChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(() => this.addressFormValid.set(this.address_form.valid));
    this.addressFormValid.set(this.address_form.valid);

    this.checkout_service
      .getInvoicingEligibility()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((r) => this.invoicingEnabled.set(r.invoicing_enabled));
  }

  /**
   * Restores a pending booking selection from sessionStorage (set by BookingComponent).
   * Automatically pre-fills the booking slot for the bookable service in the cart.
   */
  private restorePendingBooking(): void {
    try {
      // Buscamos primero el formato nuevo (`pending_bookings` Map); si no
      // existe, caemos al legacy (`pending_booking` single) — sesiones
      // anteriores al fix siguen teniendo entries válidos bajo la clave
      // vieja y la migración las trae al Map nuevo.
      let stored = sessionStorage.getItem('pending_bookings');
      if (!stored) {
        stored = sessionStorage.getItem('pending_booking');
        if (!stored) return;
      }

      const parsed = JSON.parse(stored);
      // El formato nuevo es un Map keyed por `${product_id}:${variant_id}`.
      // Si sessionStorage tiene el formato viejo (un único objeto bajo la
      // clave legacy `pending_booking`), lo migramos al Map y borramos
      // la clave vieja.
      const bookingsMap: Record<string, Record<string, any>> | null =
        this.isBookingMap(parsed)
          ? parsed
          : this.migrateLegacyPendingBooking();
      if (!bookingsMap) {
        sessionStorage.removeItem('pending_bookings');
        return;
      }

      // CRITICAL: bail out if the cart is empty. The cart service may still
      // be hydrating from the backend (race condition). The subscribe in
      // loadData() will call us again on the next emission with the real cart.
      const cartItems = this.cart()?.items ?? [];
      if (cartItems.length === 0) return;

      const newSelections = new Map(this.bookingSelections());
      const validKeys = new Set<string>();

      for (const [key, booking] of Object.entries(bookingsMap)) {
        if (
          !booking['product_id'] ||
          !booking['date'] ||
          !booking['start_time'] ||
          !booking['end_time']
        ) {
          // Entry malformada — la saltamos (no la borramos, podrían
          // haber otras válidas en el Map).
          continue;
        }

        const cartItem = cartItems.find(
          (item) =>
            item.product_id === booking['product_id'] &&
            (booking['product_variant_id']
              ? item.product_variant_id === booking['product_variant_id']
              : true),
        );
        if (!cartItem) {
          // El producto no está en el carrito — entry stale, la dejamos
          // (puede re-emerger si el cliente vuelve a agregarlo).
          continue;
        }

        newSelections.set(this.getBookingKey(cartItem), {
          product_id: booking['product_id'],
          product_variant_id: booking['product_variant_id'],
          date: booking['date'],
          start_time: booking['start_time'],
          end_time: booking['end_time'],
          provider_id: booking['provider_id'],
          provider_name: booking['provider_name'],
          service_location_type: booking['service_location_type'],
          service_address_id: booking['service_address_id'],
          service_address_label: booking['service_address_label'],
        });
        validKeys.add(key);
      }

      this.bookingSelections.set(newSelections);

      // NO borramos `pending_bookings` después de restaurar — si el cliente
      // sale a /cart y vuelve, queremos volver a poblar `bookingSelections`
      // desde el mismo origen. Solo limpiamos en el catch (JSON corrupto)
      // o cuando TODAS las entries son inválidas/stale. La señal
      // `bookingSelections` es la fuente de verdad DURANTE la sesión del
      // checkout; `pending_bookings` es el backup que persiste entre tabs.
      if (validKeys.size === 0) {
        sessionStorage.removeItem('pending_bookings');
      }
    } catch {
      sessionStorage.removeItem('pending_bookings');
    }
  }

  /**
   * Type guard: el Map nuevo es un objeto plano cuyas keys son
   * `${product_id}:${variant_id}` y cuyos values son objetos con
   * `product_id`. El formato legacy era un objeto único con `product_id`
   * directamente.
   */
  private isBookingMap(value: unknown): value is Record<string, Record<string, any>> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return false;
    }
    const entries = Object.values(value as Record<string, unknown>);
    if (entries.length === 0) return true; // Map vacío es válido
    // Tomamos la primera entry y verificamos que sea un objeto con product_id
    // (no un objeto con campos del booking directo).
    const first = entries[0] as Record<string, unknown>;
    return !!(first && typeof first === 'object' && 'product_id' in first);
  }

  /**
   * Migra el formato legacy `pending_booking` (objeto único) al nuevo
   * `pending_bookings` (Map). Devuelve el Map migrado o null si no hay
   * legacy entry válido.
   */
  private migrateLegacyPendingBooking(): Record<string, Record<string, any>> | null {
    try {
      const legacy = sessionStorage.getItem('pending_booking');
      if (!legacy) return null;
      const booking = JSON.parse(legacy);
      if (
        !booking['product_id'] ||
        !booking['date'] ||
        !booking['start_time'] ||
        !booking['end_time']
      ) {
        sessionStorage.removeItem('pending_booking');
        return null;
      }
      const key = `${booking['product_id']}:${booking['product_variant_id'] ?? 'base'}`;
      sessionStorage.setItem(
        'pending_bookings',
        JSON.stringify({ [key]: booking }),
      );
      sessionStorage.removeItem('pending_booking');
      return { [key]: booking };
    } catch {
      sessionStorage.removeItem('pending_booking');
      return null;
    }
  }

  initForm(): void {
    this.address_form = this.fb.group({
      address_line1: [
        '',
        [
          Validators.required,
          Validators.minLength(5),
          Validators.maxLength(150),
        ],
      ],
      address_line2: ['', [Validators.maxLength(100)]],
      city: [{ value: '', disabled: true }, Validators.required],
      state_province: [{ value: '', disabled: true }, Validators.required],
      country_code: ['CO', Validators.required],
      postal_code: ['', [Validators.maxLength(20)]],
      phone_number: [
        '',
        [
          Validators.required,
          Validators.pattern(/^[\d+#*\s()-]*$/),
          phoneDigitsValidator(),
        ],
      ],
      // Hidden coordinates captured via the opt-in map picker. No validators so
      // they never affect address_form.valid nor canProceedFromAddress.
      latitude: [null as number | null],
      longitude: [null as number | null],
    });
  }

  private setupLocationData(): void {
    // Load countries
    this.countries.set(this.countryService.getCountries());

    // Setup listeners
    const countryControl = this.address_form.get('country_code');
    const depControl = this.address_form.get('state_province');
    const cityControl = this.address_form.get('city');

    countryControl?.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((code: string) => {
        this.selected_country_code.set(code || '');
        if (code === 'CO') {
          // Flujo con dropdowns (API Colombia)
          this.cities.set([]);
          depControl?.setValue('');
          cityControl?.setValue('');
          cityControl?.disable({ emitEvent: false });
          this.loadDepartments();
        } else {
          // Países sin API de dep/ciudad: inputs de texto libre, requeridos.
          this.departments.set([]);
          this.cities.set([]);
          depControl?.setValue('');
          cityControl?.setValue('');
          depControl?.enable({ emitEvent: false });
          cityControl?.enable({ emitEvent: false });
        }
      });

    depControl?.valueChanges
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((depId: any) => {
        if (depId) {
          const numericDepId = Number(depId);
          if (!isNaN(numericDepId)) {
            this.loadCities(numericDepId);
          }
        } else {
          this.cities.set([]);
          cityControl?.setValue('');
          cityControl?.disable({ emitEvent: false });
        }
      });

    // Re-fetch shipping options when the user picks a new city. The
    // `nextStep` flow still calls loadShippingOptions on Address→Payment,
    // but this lets the "no options" state show up in real time without
    // requiring the user to advance steps. The 300ms debounce coalesces
    // rapid clicks on the city dropdown.
    cityControl?.valueChanges
      .pipe(
        debounceTime(300),
        distinctUntilChanged(),
        filter(() => !this.cartHasOnlyServices && this.address_form.valid),
        takeUntilDestroyed(this.destroyRef),
      )
      // `notify: false` — esto corre mientras el comprador todavía está
      // eligiendo la ciudad. Actualiza el estado de cobertura en silencio; el
      // aviso explícito se da al intentar avanzar, no mientras tipea.
      .subscribe(() => this.loadShippingOptions(false));

    // Forward-geocode what the customer TYPES so the map re-centers on it. The
    // reverse-geocode fill uses `emitEvent: false`, so only genuine typing
    // reaches here — a map/GPS result never re-triggers this. 800ms debounce
    // coalesces keystrokes; the backend proxy caches per query.
    this.address_form
      .get('address_line1')
      ?.valueChanges.pipe(
        debounceTime(800),
        distinctUntilChanged(),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((line1: string) => this.forwardGeocodeFromForm(line1));

    // Load departments for default country
    this.loadDepartments();
  }

  /**
   * Geocodes the free-text address being typed → coordinate, and re-centers the
   * map on it (dropping the marker). Query = line1 + selected city name +
   * "Colombia". Moving the map this way does NOT emit `located`, so it never
   * fights the reverse-geocode that fills the form when the marker is dragged.
   * The resolved point is stored silently on the hidden lat/lng controls.
   */
  private forwardGeocodeFromForm(line1: string | null): void {
    const base = (line1 ?? '').trim();
    if (base.length < 5) return;

    const cityId = this.address_form.get('city')?.value;
    const cityName =
      this.cities().find((c) => c.id === Number(cityId))?.name ?? '';
    const query = [base, cityName, 'Colombia'].filter(Boolean).join(', ');

    this.geocoding
      .forward(query)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          if (res?.lat == null || res?.lng == null) return;
          const coords = { lat: res.lat, lng: res.lng };
          this.map_center.set(coords);
          // Persist the point silently (never shown as text). Dragging the
          // marker afterward re-geocodes it precisely.
          this.address_form
            .get('latitude')
            ?.setValue(coords.lat, { emitEvent: false });
          this.address_form
            .get('longitude')
            ?.setValue(coords.lng, { emitEvent: false });
        },
        error: () => {
          // Forward-geocode failed → leave the map as-is; manual form works.
        },
      });
  }

  private async loadDepartments(): Promise<void> {
    const ctrl = this.address_form.get('state_province');
    ctrl?.disable({ emitEvent: false });
    this.loading_departments.set(true);
    this.departments.set(await this.countryService.getDepartments());
    this.loading_departments.set(false);
    if (this.departments().length > 0) ctrl?.enable({ emitEvent: false });
  }

  private async loadCities(depId: number): Promise<void> {
    const ctrl = this.address_form.get('city');
    ctrl?.disable({ emitEvent: false });
    this.loading_cities.set(true);
    this.cities.set(await this.countryService.getCitiesByDepartment(depId));
    this.loading_cities.set(false);
    if (this.cities().length > 0) ctrl?.enable({ emitEvent: false });
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

    // Paso 1 delivery-first: tipos de entrega de la tienda. La dirección
    // para "recoger" es lazy (la carga `preparePickupQuote` al elegir el
    // modo) para no pagar un HTTP que la mayoría no usa (auditoría D.3).
    this.loadDeliveryOptions();

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

  relatedProductsEnabled(): boolean {
    return (
      this.tenant_facade.getCurrentDomainConfig()?.customConfig?.ecommerce
        ?.catalog?.show_related_products === true
    );
  }

  selectAddress(address_id: number): void {
    this.selected_address_id.set(address_id);
    this.use_new_address.set(false);
  }

  /**
   * Wired to the shared <app-customer-address-picker>'s
   * (addressSelected) event. Same effect as the legacy selectAddress
   * — kept as a separate method so the template reads as a thin
   * pass-through and the parent keeps the option to do per-consumer
   * extra work in the future.
   */
  onServiceAddressPicked(id: number): void {
    this.selectAddress(id);
  }

  selectNewAddress(): void {
    this.selected_address_id.set(null);
    this.use_new_address.set(true);
  }

  /**
   * Wired to the shared <app-customer-address-picker>'s
   * (addNewClicked) event. The picker emits a generic event; this
   * parent decides what "add new" means in the checkout context.
   * Here we flip the inline-form flag to show the map picker and
   * the full address form below.
   */
  onServiceNewAddressClicked(): void {
    this.selectNewAddress();
  }

  // ========== GEO-LOCATION HANDLERS ==========

  /**
   * Decides how to capture location based on the current permission state:
   * - `granted` → the customer already allowed it, so use GPS directly (no
   *   modal) and prefill the form.
   * - `denied`  → previously blocked; do not show the modal (keep manual form).
   * - `prompt`/unknown → offer the opt-in modal so the browser prompt fires on
   *   accept.
   */
  private async maybeOfferLocation(): Promise<void> {
    const state = await this.geolocation.getPermissionState();
    if (state === 'granted') {
      void this.onLocationAccept();
    } else if (state === 'denied' || state === 'unsupported') {
      // No modal: nagging a blocked customer is pointless — stay on manual form.
      this.show_location_modal.set(false);
    } else {
      this.show_location_modal.set(true);
    }
  }

  /** Customer accepted the prompt: request GPS, enable the map, prefill form. */
  async onLocationAccept(): Promise<void> {
    this.show_location_modal.set(false);
    try {
      const coords = await this.geolocation.getPrecisePosition();
      this.map_center.set(coords);
      this.applyReverseGeocode(coords);
    } catch {
      // Permission denied / unsupported / timeout → stay on the manual form.
      this.toast.info(
        'No pudimos obtener tu ubicación. Puedes ingresar la dirección manualmente.',
        'Ubicación no disponible',
      );
    }
  }

  /** Customer declined: close the prompt and keep the manual form flow. */
  onLocationDecline(): void {
    this.show_location_modal.set(false);
  }

  /**
   * Marker moved by the user (drag/click): re-geocode and refresh the exact
   * coordinate + address fields. We deliberately do NOT push `map_center` here —
   * the marker is already where the user put it, and re-centering would fight the
   * drag. `map_center` is reserved for programmatic locates (GPS / typed address).
   */
  onMapLocated(coords: { lat: number; lng: number }): void {
    this.applyReverseGeocode(coords);
  }

  /** Stores the exact coordinate on the form and prefills the address fields. */
  private applyReverseGeocode(coords: { lat: number; lng: number }): void {
    this.address_form.get('latitude')?.setValue(coords.lat);
    this.address_form.get('longitude')?.setValue(coords.lng);

    this.geocoding
      .reverse(coords.lat, coords.lng)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (address) => this.prefillFromGeocode(address),
        error: () => {
          // Reverse geocoding failed: keep the exact coordinate; the customer
          // fills the textual address manually.
        },
      });
  }

  /**
   * Fills the address form from a normalized geocode result. For Colombia it
   * maps the department/city NAMES to the api-colombia IDs the selectors use
   * (department → load cities → city), mirroring the existing ID/name mapping.
   * For other countries the free-text controls receive the names directly.
   */
  private async prefillFromGeocode(address: NormalizedAddress): Promise<void> {
    const form = this.address_form;

    if (address.address_line1) {
      // emitEvent:false → this reverse fill must NOT re-trigger the forward
      // geocode watcher on address_line1 (that would fight the map).
      form.get('address_line1')?.setValue(address.address_line1, {
        emitEvent: false,
      });
    }
    if (address.address_line2) {
      form.get('address_line2')?.setValue(address.address_line2, {
        emitEvent: false,
      });
    }
    if (address.postal_code) {
      form.get('postal_code')?.setValue(address.postal_code, {
        emitEvent: false,
      });
    }

    const cc = (address.country_code || '').toUpperCase();
    const known = this.countries().some((c) => c.code === cc);
    const targetCountry = known ? cc : 'CO';

    if (targetCountry === 'CO') {
      // Ensure CO is selected without clobbering an already-CO selection
      // (setValue would re-trigger the reset + department reload cascade).
      if (form.get('country_code')?.value !== 'CO') {
        form.get('country_code')?.setValue('CO');
      }
      if (this.departments().length === 0) {
        await this.loadDepartments();
      }
      const department = this.matchByName(
        this.departments(),
        address.state_province,
      );
      if (department) {
        form
          .get('state_province')
          ?.setValue(department.id, { emitEvent: false });
        await this.loadCities(department.id);
        const city = this.matchByName(this.cities(), address.city);
        if (city) {
          form.get('city')?.setValue(city.id, { emitEvent: false });
        }
      }
    } else {
      // Non-CO: switch to free-text mode, then fill the names directly.
      form.get('country_code')?.setValue(targetCountry);
      if (address.state_province) {
        form.get('state_province')?.setValue(address.state_province);
      }
      if (address.city) {
        form.get('city')?.setValue(address.city);
      }
    }

    form.markAsDirty();
    // setValue with emitEvent:false above does not push statusChanges, so
    // refresh the validity mirror that gates canProceedFromAddress.
    this.addressFormValid.set(this.address_form.valid);
  }

  /** Case/accent-insensitive best-effort match of a named option. */
  private matchByName<T extends { id: number; name: string }>(
    options: T[],
    name: string | null,
  ): T | undefined {
    if (!name) return undefined;
    const normalize = (value: string) =>
      value
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .trim();
    const target = normalize(name);
    if (!target) return undefined;
    return (
      options.find((o) => normalize(o.name) === target) ??
      options.find((o) => {
        const candidate = normalize(o.name);
        return candidate.includes(target) || target.includes(candidate);
      })
    );
  }

  selectPaymentMethod(method_id: number): void {
    // Guarda de "mismo método": si el cliente ya está en este método (re-click
    // del pill desde el picker) NO reiniciamos nada — preservamos su elección
    // de cuenta, el comprobante ya cargado y el flag de acuse. Antes este
    // handler re-ejecutaba el bloque completo en cada clic, lo que pisaba la
    // selección del usuario con la primera cuenta cacheada y descartaba el
    // `payment_receipt_file` sin aviso. Patrón silencioso de "compré
    // transferencia y terminé pagando a la cuenta equivocada".
    const isSameMethod = method_id === this.selected_payment_method_id();

    this.selected_payment_method_id.set(method_id);

    // Check if selected method is Wompi
    const selectedMethod = this.payment_methods().find(
      (m) => m.id === method_id,
    );
    this.isWompiPayment.set(
      selectedMethod?.type === 'wompi' || selectedMethod?.provider === 'wompi',
    );

    const t = selectedMethod?.type;
    if (t === 'bank_transfer' || t === 'voucher') {
      if (isSameMethod) {
        // Mismo método: re-abrimos el modal y salimos. Estado preservado.
        this.show_payment_instructions_modal.set(true);
        return;
      }

      // Cambio real desde otro método: descartar comprobante y acuse del
      // método anterior. NO tocamos `selected_bank_account_id`: la elección
      // previa se conserva si sigue siendo válida para este método (la
      // validez se chequea contra la lista cacheada del método destino, así
      // no se arrastra una cuenta ajena). Esto resuelve el round trip
      // Transferencia → Efectivo → Transferencia sin re-pisar la elección.
      this.payment_receipt_file.set(null);
      this.payment_instructions_acknowledged.set(false);

      // Carga lazy de cuentas. Si ya están cacheadas, no refetch — el modal
      // las resuelve instantáneamente desde `bankAccountsByMethod`.
      if (!this.bankAccountsByMethod().has(method_id)) {
        this.loadBankAccountsForMethod(method_id);
      } else {
        // Cache hit: default a la primera cuenta SOLO si la elección actual
        // no es válida para este método (cuenta borrada, método nuevo que
        // nunca tuvo elección previa, etc.). Misma guarda que
        // `loadBankAccountsForMethod` (líneas 1126-1131): respeta elecciones
        // previas válidas y solo rellena el hueco. El predicado vive en
        // `isBankAccountStillValid` para no divergir entre los dos sitios.
        const cached = this.bankAccountsByMethod().get(method_id) ?? [];
        if (!this.isBankAccountStillValid(cached)) {
          this.selected_bank_account_id.set(cached[0]?.id ?? null);
        }
      }

      this.show_payment_instructions_modal.set(true);
    } else {
      // Cambio a un método no-transferencia: descartar comprobante y acuse
      // del método anterior. La cuenta seleccionada NO se descarta — si el
      // usuario vuelve a Transferencia/Voucher, la preservamos mientras siga
      // siendo válida (la guarda del cache hit de arriba se encarga). Esto
      // es lo que faltaba para que el round trip del repro original no
      // re-pise la elección.
      this.payment_receipt_file.set(null);
      this.payment_instructions_acknowledged.set(false);
    }
  }

  /**
   * Predicado compartido: ¿la cuenta seleccionada actualmente sigue siendo
   * válida para esta lista de cuentas? Vive en un método privado porque el
   * mismo predicado se usa en dos sitios (cache hit y cache miss de
   * `loadBankAccountsForMethod`) — si dos implementaciones del mismo
   * predicado divergen, una paga a la cuenta equivocada (QUI-756).
   */
  private isBankAccountStillValid(
    accounts: ReadonlyArray<{ id: number }>,
  ): boolean {
    const current = this.selected_bank_account_id();
    return current != null && accounts.some((a) => a.id === current);
  }

  /**
   * Carga las cuentas activas para un método `bank_transfer`/`voucher` desde
   * el endpoint del storefront. El resultado se cachea en
   * `bankAccountsByMethod` por método para evitar refetch al alternar.
   *
   * QUI-728 — el servicio ahora exige JSON (Content-Type `application/json`)
   * y cuerpo `{success:true, data:Array}`. Si la respuesta NO es JSON
   * (típico cuando un vhost sirviendo la SPA contesta con `index.html` y
   * status 200), el servicio lanza un error con mensaje legible. Acá
   * propagamos al `console.error` para que al menos haya telemetría, y
   * guardamos `null` en el cache (distinto de `[]`) para que la UI pueda
   * diferenciar «sin cuentas configuradas» de «fallo de carga». El modal
   * sigue cayendo al fallback de `payment_instructions`, pero ya no de
   * forma silenciosa.
   */
  private loadBankAccountsForMethod(method_id: number): void {
    this.loadingBankAccounts.set(true);
    this.checkout_service.getBankAccountsForMethod(method_id).subscribe({
      next: (accounts) => {
        const next = new Map(this.bankAccountsByMethod());
        next.set(method_id, accounts);
        this.bankAccountsByMethod.set(next);
        // Default a la primera cuenta SOLO si la elección actual no es válida
        // para esta lista. Mismo predicado que el cache hit de arriba
        // (`isBankAccountStillValid`): chequea validez contra la lista del
        // método destino, no solo null. Antes este chequeo era `== null`,
        // pero ahora `selectPaymentMethod` ya no nulifica la cuenta al
        // cambiar entre métodos — así que un cliente que eligió cuenta 19 en
        // Transferencia y pasa a Vouchers (otro método de tipo transferencia,
        // también cache miss) podía terminar con la cuenta 19 seleccionada
        // aunque 19 no estuviera en la lista de Vouchers. El predicado
        // extraído evita ese hueco y mantiene los dos sitios sincronizados.
        // El chequeo `selected_payment_method_id() === method_id` se
        // conserva: protege contra una respuesta tardía que pisa la elección
        // de un método que el usuario ya abandonó.
        if (
          this.selected_payment_method_id() === method_id &&
          !this.isBankAccountStillValid(accounts)
        ) {
          this.selected_bank_account_id.set(accounts[0]?.id ?? null);
        }
        this.loadingBankAccounts.set(false);
      },
      error: (err: unknown) => {
        // Error de carga: lo logueamos para que al menos haya telemetría.
        // El bug original era tragar errores como `[]` sin log, haciendo
        // imposible distinguir «endpoint sano, sin cuentas activas» de
        // «endpoint roto / vhost sirviendo HTML». Con este log el siguiente
        // reporte al soporte llega con el stack, mientras el modal sigue
        // cayendo al fallback de `payment_instructions`.
        // eslint-disable-next-line no-console
        console.error(
          `[QUI-728] getBankAccountsForMethod(${method_id}) failed:`,
          err,
        );
        const next = new Map(this.bankAccountsByMethod());
        next.set(method_id, []);
        this.bankAccountsByMethod.set(next);
        this.loadingBankAccounts.set(false);
      },
    });
  }

  onReceiptFile(file: File | null): void {
    this.payment_receipt_file.set(file);
  }

  onPaymentInstructionsConfirmed(): void {
    this.payment_instructions_acknowledged.set(true);
    this.show_payment_instructions_modal.set(false);
  }

  // Shipping
  readonly shipping_options = signal<any[]>([]);
  selected_shipping_method_id: number | null = null;
  selected_shipping_option_id: number | null = null;
  selected_shipping_method_type: string | null = null;
  // `shipping_cost` se eleva a signal para que el resumen del checkout
  // re-renderice bajo zoneless cuando se elige/limpia una opción de envío.
  // Antes era propiedad plana y los cambios no refrescaban el total.
  readonly shipping_cost = signal(0);

  /**
   * Costo de envío reactivo. Computed perezoso: lee la signal `shipping_cost`
   * y nada más — toda la lógica de selección vive en `selectShippingMethod`.
   */
  readonly shippingCost = computed(() => this.shipping_cost());

  /** Texto del envío: "Gratis" cuando es 0, formato moneda cuando no. */
  readonly shippingDisplay = computed(() => {
    const cost = this.shippingCost();
    return cost === 0 ? 'Gratis' : cost.toString();
  });

  /**
   * Cupón actual del carrito: prioriza el que el cliente tipeó en el input
   * (signal local). Como el backend lo aplica al confirmar (no en el
   * summary), aquí sólo reflejamos la INTENCIÓN del cliente.
   */
  readonly cartCouponCode = computed<string | null>(() => {
    const typed = this.coupon_code().trim();
    return typed.length > 0 ? typed : null;
  });

  /**
   * Monto del cupón actual. El backend todavía lo calcula al confirmar la
   * compra (no en el summary), así que aquí reportamos 0 hasta entonces.
   * El resumen del checkout sigue mostrando el descuento promocional
   * automático en `cart.promotion_discount`, que es reactivo y fiable.
   */
  readonly couponDiscount = computed(() => 0);

  /** Promociones aplicadas con scope preservado para el breakdown. */
  readonly appliedPromotionsWithScope = computed(
    () => this.cart()?.applied_promotions ?? [],
  );

  /**
   * Icono por scope de promoción (CP-ECOM-PROMO-UX-001 F.2):
   * - `order`    → shopping-cart (afecta toda la orden)
   * - `category` → layers (agrupa por categoría)
   * - `product`  → tag (etiqueta de producto individual)
   */
  scopeIcon(scope: 'order' | 'product' | 'category' | undefined): string {
    if (scope === 'order') return 'shopping-cart';
    if (scope === 'category') return 'layers';
    return 'tag';
  }

  /** Color del icono según el scope. */
  scopeColor(scope: 'order' | 'product' | 'category' | undefined): string {
    if (scope === 'order') return 'text-primary';
    if (scope === 'category') return 'text-warning';
    return 'text-success';
  }

  /** Etiqueta humana en español del scope. */
  scopeLabel(scope: 'order' | 'product' | 'category' | undefined): string {
    if (scope === 'order') return 'Orden completa';
    if (scope === 'category') return 'Por categoría';
    return 'Por producto';
  }

  /**
   * Qué tipo de cobertura devolvió el calculador para la dirección actual.
   *
   * - `unknown`: todavía no se consultó (o está en vuelo).
   * - `zone`: hay una zona de envío que cubre la dirección.
   * - `pickup_only`: NO hay despacho a la dirección; la tienda opera en esa
   *   ciudad y lo único posible es retirar en el local.
   * - `none`: no hay ninguna forma de entregar el pedido a esa dirección.
   *
   * Es una señal (no una propiedad plana) porque el template ramifica sobre
   * ella y bajo zoneless una propiedad no dispara render.
   */
  readonly shipping_coverage = signal<
    'unknown' | 'zone' | 'pickup_only' | 'none'
  >('unknown');

  /** True mientras se están recalculando las opciones de envío. */
  readonly loading_shipping = signal(false);

  /** True cuando la única forma de entrega es retirar en tienda. */
  readonly isPickupOnlyCoverage = computed(
    () => this.shipping_coverage() === 'pickup_only',
  );

  /**
   * True cuando ya se consultó al calculador y no hay ninguna opción. Se usa
   * para mostrar el estado vacío accionable en vez de un cartel sin salida.
   */
  readonly hasNoShippingCoverage = computed(
    () => this.shipping_coverage() === 'none',
  );
  loading_payment_methods = false;

  // ========== ENTREGA delivery-first (CP-tienda-checkout-whatsapp) ==========
  /** Tipos de entrega que la tienda expone (FB-13 `delivery-options`). */
  readonly delivery_options = signal<DeliveryOption[]>([]);
  readonly loading_delivery_options = signal(false);
  /** 'home' = envío a domicilio · 'pickup' = recoger en tienda. */
  readonly selected_delivery = signal<'home' | 'pickup' | null>(null);
  /** Dirección de la tienda para "recoger" (endpoint público de reservas). */
  readonly store_address = signal<any | null>(null);
  readonly loading_store_address = signal(false);

  /** ¿La tienda expone domicilio? (`other`/custom cotiza como domicilio.) */
  readonly offersHomeDelivery = computed(() =>
    this.delivery_options().some((o) => o.delivery_type !== 'pickup'),
  );
  /** ¿La tienda expone recoger en tienda? */
  readonly offersPickup = computed(() =>
    this.delivery_options().some((o) => o.delivery_type === 'pickup'),
  );

  /**
   * Clave de la dirección con la que se cotizó lo que hoy muestra
   * `shipping_options`. Si el comprador la cambia, la cotización queda
   * obsoleta y hay que recotizar antes de avanzar (ver `nextStep`).
   */
  private shipping_quote_key: string | null = null;
  private shipping_fetch_promise: Promise<void> | null = null;
  private shipping_fetch_timer: ReturnType<typeof setTimeout> | null = null;

  /** Identidad de la dirección activa de domicilio, o null si no hay. */
  private currentAddressKey(): string | null {
    if (this.selected_delivery() !== 'home') return null;
    if (this.use_new_address()) {
      if (!this.address_form.valid) return null;
      const v = this.address_form.value;
      return `new:${v.country_code}|${v.state_province}|${v.city}|${v.address_line1}|${v.postal_code}`;
    }
    const id = this.selected_address_id();
    return id != null ? `saved:${id}` : null;
  }

  /** Elige el modo de entrega. Recoger limpia la dirección del comprador. */
  selectDelivery(mode: 'home' | 'pickup'): void {
    if (this.selected_delivery() === mode) return;
    this.selected_delivery.set(mode);
    this.error_message.set('');
    // Toda selección de envío anterior queda obsoleta al cambiar de modo.
    this.shipping_quote_key = null;
    this.shipping_options.set([]);
    this.selected_shipping_method_id = null;
    this.selected_shipping_option_id = null;
    this.selected_shipping_method_type = null;
    this.shipping_cost.set(0);
    if (mode === 'pickup') {
      this.selected_address_id.set(null);
      // Se rastrea la promesa para que Continuar la espere si sigue en vuelo.
      this.shipping_fetch_promise = this.preparePickupQuote();
    }
  }

  /** Carga los tipos de entrega de la tienda y preselecciona si hay uno solo. */
  private loadDeliveryOptions(): void {
    if (this.cartHasOnlyServices) return;
    this.loading_delivery_options.set(true);
    this.checkout_service.getDeliveryOptions().subscribe({
      next: (response) => {
        this.loading_delivery_options.set(false);
        if (!response.success) return;
        this.delivery_options.set(response.data ?? []);
        if (this.delivery_options().length === 0) {
          // Tienda sin métodos de envío activos: el paso 0 quedaría vacío
          // sin explicación (auditoría D.3).
          this.error_message.set(
            'Esta tienda aún no tiene formas de entrega configuradas. Comunícate con la tienda para coordinar.',
          );
          return;
        }
        const hasHome = this.offersHomeDelivery();
        const hasPickup = this.offersPickup();
        if (hasHome && !hasPickup) this.selectDelivery('home');
        else if (hasPickup && !hasHome) this.selectDelivery('pickup');
      },
      error: (err) => {
        this.loading_delivery_options.set(false);
        // Telemetría como el resto del checkout (patrón QUI-728).
        // eslint-disable-next-line no-console
        console.error('[checkout] getDeliveryOptions() failed:', err);
        // Paso 0 vacío sin mensaje = comprador bloqueado sin acción
        // (auditoría D.3): se informa y se puede reintentar al reentrar.
        this.error_message.set(
          'No pudimos cargar las formas de entrega. Revisa tu conexión e intenta de nuevo.',
        );
        this.toast.error(
          'No pudimos cargar las formas de entrega',
          'Error de entrega',
        );
      },
    });
  }

  /** Vuelo único de la dirección de la tienda (single-flight por sesión). */
  private store_address_request: Promise<any | null> | null = null;

  /** Dirección de la tienda (tarjeta "recoger"). Resuelve null sin reintentar. */
  private loadStoreAddress(): Promise<any | null> {
    if (this.store_address()) return Promise.resolve(this.store_address());
    if (!this.store_address_request) {
      this.loading_store_address.set(true);
      this.store_address_request = firstValueFrom(
        this.booking_service.getStoreAddress(),
      )
        .then((addr) => {
          this.store_address.set(addr ?? null);
          return addr ?? null;
        })
        .catch(() => null)
        .finally(() => this.loading_store_address.set(false));
    }
    return this.store_address_request;
  }

  /**
   * Cotiza el retiro con la dirección de LA TIENDA y autoselecciona la opción
   * `pickup` (o la primera si no hay). El comprador nunca elige tarifa al
   * recoger: solo confirma el modo.
   */
  private async preparePickupQuote(): Promise<void> {
    const addr = await this.loadStoreAddress();
    if (!addr) {
      this.shipping_coverage.set('none');
      this.error_message.set(
        'La tienda aún no tiene dirección de retiro. Elige otra forma de entrega.',
      );
      return;
    }
    this.loading_shipping.set(true);
    return new Promise<void>((resolve) => {
      this.cart_service
        .getShippingEstimates({
          country_code: addr.country_code ?? 'CO',
          state_province: addr.state_province,
          city: addr.city,
          postal_code: addr.postal_code,
        })
        .subscribe({
          next: (options) => {
            this.loading_shipping.set(false);
            this.shipping_options.set(options ?? []);
            const pickup =
              (options ?? []).find((o: any) => o.method_type === 'pickup') ??
              (options ?? [])[0];
            if (pickup) {
              this.shipping_coverage.set('unknown');
              this.selectShippingMethod(pickup, pickup.cost);
            } else {
              this.shipping_coverage.set('none');
              this.error_message.set(
                'La tienda no tiene retiro configurado. Elige otra forma de entrega.',
              );
            }
            resolve();
          },
          error: () => {
            this.loading_shipping.set(false);
            this.shipping_coverage.set('unknown');
            this.error_message.set(
              'No pudimos cargar el retiro en tienda. Intenta de nuevo.',
            );
            resolve();
          },
        });
    });
  }

  /**
   * Recotiza el domicilio en segundo plano para la dirección indicada.
   * Lo dispara el effect del constructor cuando la dirección queda válida;
   * `nextStep` lo espera antes de avanzar.
   */
  private refreshShippingQuote(key: string): Promise<void> {
    let address: any | null = null;
    if (this.use_new_address()) {
      address = this.mapFormToCalcAddress(this.address_form.value);
    } else if (this.selected_address_id() != null) {
      const saved = this.addresses().find(
        (a) => a.id === this.selected_address_id(),
      );
      address = saved ? this.mapAddressToCalc(saved) : null;
    }
    if (!address) return Promise.resolve();
    const p = this.fetchShipping(address, false, true, key).then(() => {
      // Solo sella si la dirección no cambió durante el vuelo (la respuesta
      // lenta de una clave vieja nunca pisa la cotización vigente).
      if (this.currentAddressKey() === key) {
        this.shipping_quote_key = key;
      }
    });
    this.shipping_fetch_promise = p;
    return p;
  }

  // ... (existing methods)

  // Modified logic: call this when address is finalized (e.g. Next from Address step)
  /**
   * Recalcula las opciones de envío para la dirección activa.
   *
   * Devuelve una promesa que resuelve cuando la respuesta llegó, para que el
   * avance de paso pueda esperarla en vez de dejar al comprador aterrizando en
   * el paso de Pago con la lista todavía vacía y creyendo que no hay cobertura.
   */
  loadShippingOptions(notify = true): Promise<void> {
    if (this.use_new_address() && this.address_form.valid) {
      const address = this.mapFormToCalcAddress(this.address_form.value);
      if (!address) {
        this.shipping_options.set([]);
        this.shipping_coverage.set('none');
        if (notify) {
          this.error_message.set(ERROR_MESSAGES['ORD_SHIP_CITY_UNRESOLVED_001']);
        }
        return Promise.resolve();
      }
      return this.fetchShipping(address, notify);
    }

    if (this.selected_address_id()) {
      const address = this.addresses().find(
        (a) => a.id === this.selected_address_id(),
      );
      if (address) {
        return this.fetchShipping(this.mapAddressToCalc(address), notify);
      }
    }

    return Promise.resolve();
  }

  /**
   * Traduce los IDs del catálogo de api-colombia a NOMBRES de departamento y
   * ciudad, que es lo único que el backend sabe comparar contra las zonas de
   * envío.
   *
   * Fallar acá en silencio es caro: si el catálogo todavía no cargó (cambio de
   * departamento que resetea la lista, o `api-colombia` caído devolviendo `[]`),
   * la conversión no ocurre y se termina mandando el ID crudo como si fuera el
   * nombre de la ciudad. Eso ya pasó: hay direcciones guardadas con
   * `city = "694"` y `state_province = "19"`. Ninguna zona matchea nunca contra
   * eso, y el comprador ve un checkout roto sin explicación.
   *
   * Por eso devolvemos también qué campos NO se pudieron resolver, para que
   * quien llame decida si aborta o avisa.
   */
  private resolveGeoNames(source: any): { value: any; unresolved: string[] } {
    const value = { ...source };
    const unresolved: string[] = [];

    // Sólo Colombia usa selectores por ID; el resto de los países captura
    // departamento y ciudad como texto libre y llega ya resuelto.
    if (value.country_code !== 'CO') return { value, unresolved };

    if (value.state_province) {
      const depId = Number(value.state_province);
      if (Number.isFinite(depId)) {
        const department = this.departments().find((d) => d.id === depId);
        if (department) value.state_province = department.name;
        else unresolved.push('state_province');
      }
    }

    if (value.city) {
      const cityId = Number(value.city);
      if (Number.isFinite(cityId)) {
        const city = this.cities().find((c) => c.id === cityId);
        if (city) {
          value.city = city.name;
          // DANE 5 dígitos. Sin él el emisor cae a "Bogotá/11001" y la
          // DIAN rechaza por incoherencia geográfica (FAJ32/FAK32).
          // El id interno del catálogo ES el código Divipola.
          value.municipality_code = String(cityId);
        } else unresolved.push('city');
      }
    }

    return { value, unresolved };
  }

  private mapFormToCalcAddress(formValue: any): any | null {
    const { value, unresolved } = this.resolveGeoNames(formValue);
    if (unresolved.length > 0) {
      console.warn(
        '[checkout] No se pudo resolver el nombre de',
        unresolved.join(', '),
        '— no se consulta el envío con un ID crudo.',
      );
      return null;
    }
    return value;
  }

  fetchShipping(
    address: any,
    notify = true,
    quiet = false,
    quoteKey?: string,
  ): Promise<void> {
    // `quiet` = recotización de fondo del paso 1 delivery-first: no tapa la
    // pantalla con el spinner global ni spamea toasts (el estado vive en
    // `loading_shipping()` junto a la lista de opciones).
    if (!quiet) this.is_loading.set(true);
    this.loading_shipping.set(true);

    return new Promise<void>((resolve) => {
      this.cart_service.getShippingEstimates(address).subscribe({
        next: (options) => {
          // Anti-carrera: la respuesta lenta de una dirección vieja se
          // descarta antes de tocar signals (auditoría D.3).
          if (quoteKey && this.currentAddressKey() !== quoteKey) {
            resolve();
            return;
          }
          this.shipping_options.set(options);

          if (options.length > 0) {
            // El backend marca `is_fallback` cuando la dirección NO tiene
            // cobertura de despacho y lo único ofrecido es retirar en tienda.
            const isFallbackOnly = options.every((o: any) => o.is_fallback);
            this.shipping_coverage.set(isFallbackOnly ? 'pickup_only' : 'zone');

            // No pisar la elección del comprador en cada recotización: si la
            // opción elegida sigue existiendo se conserva; solo se
            // autoselecciona cuando no hay selección válida. Se prefiere la
            // primera opción de despacho y se cae a `pickup` cuando es lo
            // único que hay (el modo "recoger" la filtra por su cuenta).
            const stillValid = options.some(
              (o: any) => o.id === this.selected_shipping_option_id,
            );
            if (!stillValid) {
              const preferred =
                options.find((o: any) => o.method_type !== 'pickup') ??
                options[0];
              this.selectShippingMethod(preferred, preferred.cost);
            }

            if (isFallbackOnly) {
              this.error_message.set('');
            }
          } else {
            this.selected_shipping_method_id = null;
            this.selected_shipping_option_id = null;
            this.selected_shipping_method_type = null;
            this.shipping_cost.set(0);
            this.shipping_coverage.set('none');

            // Antes esto era silencioso: la lista quedaba vacía, el botón se
            // deshabilitaba y el comprador no sabía por qué.
            if (notify) {
              this.error_message.set(ERROR_MESSAGES['ORD_SHIP_NO_ZONE_001']);
              this.toast.error(
                ERROR_MESSAGES['ORD_SHIP_NO_ZONE_001'],
                'Sin cobertura de envío',
              );
            }
          }

          if (!quiet) this.is_loading.set(false);
          this.loading_shipping.set(false);
          resolve();
        },
        error: () => {
          if (!quiet) this.is_loading.set(false);
          this.loading_shipping.set(false);
          this.shipping_coverage.set('unknown');
          if (!quiet) {
            this.toast.error(
              'No pudimos cargar las opciones de envío. Intenta de nuevo.',
              'Error de envío',
            );
          }
          resolve();
        },
      });
    });
  }

  /** Nombre de la tarifa elegida para el resumen del paso de pago (C.4). */
  selectedShippingOptionName(): string {
    const found = this.shipping_options().find(
      (o: any) => o.id === this.selected_shipping_option_id,
    );
    return found?.method_name ?? 'Envío';
  }

  selectShippingMethod(option: any, cost: number) {
    this.selected_shipping_option_id = option.id;
    this.selected_shipping_method_id = option.method_id;
    this.selected_shipping_method_type = option.method_type || null;
    this.shipping_cost.set(cost);

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

  /**
   * Defensa en profundidad (auditoría D.3): aunque el backend ya excluye
   * `cash` del ecommerce, la UI nunca lo renderiza aunque regresara por
   * error. El único freno real sigue siendo el POST (ECOM_CHECKOUT_002).
   */
  private withoutCash(methods: PaymentMethod[]): PaymentMethod[] {
    return (methods ?? []).filter((m) => m?.type !== 'cash');
  }

  loadPaymentMethods(shippingType?: string): void {
    this.loading_payment_methods = true;
    this.checkout_service.getPaymentMethods(shippingType).subscribe({
      next: (response) => {
        if (response.success) {
          this.payment_methods.set(this.withoutCash(response.data));

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
  async nextStep(): Promise<void> {
    // Paso 1 delivery-first (solo carritos con físicos): primero el modo de
    // entrega; domicilio pide dirección y cotiza; recoger autocotiza el retiro.
    if (this.step() === 1 && !this.cartHasOnlyServices) {
      const mode = this.selected_delivery();
      if (!mode) {
        this.error_message.set('Elige cómo quieres recibir tu pedido');
        return;
      }

      if (mode === 'pickup') {
        // Esperar la autocotización del retiro si sigue en vuelo.
        if (this.loading_shipping()) {
          await this.shipping_fetch_promise;
        }
        if (this.selected_shipping_method_id == null) {
          await this.preparePickupQuote();
        }
        if (this.selected_shipping_method_id == null) {
          // preparePickupQuote ya fijó el mensaje concreto.
          return;
        }
        this.error_message.set('');
        this.step.set(this.step() + 1);
        return;
      }

      if (this.use_new_address() && !this.address_form.valid) {
        this.error_message.set(
          ERROR_MESSAGES['ECOM_CHECKOUT_ADDR_REQUIRED_001'],
        );
        this.address_form.markAllAsTouched();
        return;
      }
      if (!this.use_new_address() && !this.selected_address_id()) {
        this.error_message.set(ERROR_MESSAGES['ECOM_CHECKOUT_ADDR_SAVED_001']);
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

      // La cotización vive en el paso 1 (la lista se elige aquí, no en Pago).
      // Si la dirección cambió tras la última cotización (o nunca se cotizó),
      // se recotiza y el comprador revisa la lista antes de avanzar: NO se
      // avanza a ciegas con la preferencia automática.
      this.error_message.set('');
      const key = this.currentAddressKey();
      if (
        key &&
        (key !== this.shipping_quote_key ||
          this.selected_shipping_option_id == null)
      ) {
        await this.refreshShippingQuote(key);
        if (
          this.shipping_options().length === 0 ||
          this.selected_shipping_option_id == null
        ) {
          // Sin opciones no hay a dónde avanzar: el paso 1 ya muestra el
          // estado vacío accionable (otra dirección o recoger).
          return;
        }
      }
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
      // Sin opciones de envío para esta ubicación (carrito físico): el pedido
      // no se puede despachar, así que bloqueamos el avance. Espejo del botón
      // "Continuar" deshabilitado, como defensa en profundidad.
      if (!this.cartHasOnlyServices && this.shipping_options().length === 0) {
        this.error_message.set(
          'No hay opciones de envío disponibles para esta ubicación. Por favor revisa tu dirección.',
        );
        return;
      }

      if (!this.selected_payment_method_id()) {
        this.error_message.set('Por favor selecciona un método de pago');
        return;
      }

      // Check shipping selection (only for physical items)
      if (
        !this.cartHasOnlyServices &&
        this.shipping_options().length > 0 &&
        !this.selected_shipping_method_id
      ) {
        this.error_message.set('Por favor selecciona un método de envío');
        return;
      }

      // bank_transfer / voucher require the customer to see the
      // payment-instructions modal at least once before advancing. Catches
      // the case where the method is pre-selected (default) and the user
      // never clicked the card to trigger selectPaymentMethod.
      if (
        this.requiresPaymentInstructions() &&
        !this.payment_instructions_acknowledged()
      ) {
        this.error_message.set('');
        this.show_payment_instructions_modal.set(true);
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
    const newMap = new Map(this.bookingSelections());
    newMap.set(this.getBookingKey(item), {
      product_id: item.product_id,
      product_variant_id: item.product_variant_id || undefined,
      date: slot.date,
      start_time: slot.start_time,
      end_time: slot.end_time,
    });
    this.bookingSelections.set(newMap);
  }

  /** Check if a specific product has a booking selection */
  hasBookingForItem(item: CartItem): boolean {
    return this.bookingSelections().has(this.getBookingKey(item));
  }

  /** Get the booking selection summary for a product */
  getBookingSummary(item: CartItem): string {
    const booking = this.bookingSelections().get(this.getBookingKey(item));
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
   * Lookup de la reserva pre-cargada (`bookingSelections`) por item del
   * carrito. El template lo usa para pasar `initialDate/initialStartTime/
   * initialEndTime` al `BookingSlotPickerComponent` cuando el usuario
   * recién salió del flujo `BookingComponent` y ya eligió fecha + slot.
   * Sin esto, la sección "Reserva de Horario" del checkout mostraba el
   * picker vacío y el cliente tenía que re-elegir todo (lo que generaba
   * también órdenes huérfanas en la práctica).
   */
  preBookedSelectionFor(item: CartItem): BookingSelection | undefined {
    return this.bookingSelections().get(this.getBookingKey(item));
  }

  /**
   * True si al menos uno de los bookings reservados requiere "A
   * domicilio" — leído del Map de selecciones (signal). Usado por el
   * template para renderizar el bloque `<customer-address-picker>` +
   * mapa + form DENTRO del step "Reserva". La modalidad se eligió en
   * el BookingComponent, no en el checkout.
   */
  hasHomeBooking(): boolean {
    for (const item of this.bookableItems) {
      const sel = this.preBookedSelectionFor(item);
      if (sel?.service_location_type === 'home') return true;
    }
    return false;
  }

  /**
   * Saves the new address to the customer's account, then continues to the next step
   */
  private saveNewAddressAndContinue(): void {
    // Prepare address payload with converted names
    const addressPayload = this.prepareAddressPayload();

    // Ciudad o departamento sin resolver: `prepareAddressPayload` ya avisó.
    // No guardamos una dirección que nunca podrá cotizar envío.
    if (!addressPayload) return;

    this.is_loading.set(true);

    this.account_service.createAddress(addressPayload).subscribe({
      next: async (response) => {
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
        this.error_message.set('');
        await this.loadShippingOptions();
        this.step.set(this.step() + 1);
        this.is_loading.set(false);
      },
      error: async () => {
        this.is_loading.set(false);
        // Still continue even if save fails, but notify user
        this.toast.warning(
          'La dirección no pudo guardarse, pero puedes continuar con tu compra',
          'Aviso',
        );
        this.error_message.set('');
        await this.loadShippingOptions();
        this.step.set(this.step() + 1);
      },
    });
  }

  /**
   * Prepares the address payload with converted department/city names for Colombia
   */
  private prepareAddressPayload(): any | null {
    const { value, unresolved } = this.resolveGeoNames(this.address_form.value);

    // Guardar la dirección con el ID del catálogo en el campo `city` la deja
    // permanentemente inservible para calcular envíos. Preferimos no guardarla.
    if (unresolved.length > 0) {
      this.error_message.set(ERROR_MESSAGES['ORD_SHIP_CITY_UNRESOLVED_001']);
      this.toast.error(ERROR_MESSAGES['ORD_SHIP_CITY_UNRESOLVED_001']);
      return null;
    }

    // Add required fields for the API
    return {
      ...value,
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

    // Guard: if the cart has service items but no booking was selected
    // (e.g. user went straight to checkout without the BookingComponent flow),
    // block the order so we don't create another orphan. The error message
    // points them back to the product page to reserve properly.
    if (this.cartHasBookableServices && this.bookingSelections().size === 0) {
      const firstService = this.bookableItems[0];
      const productId = firstService?.product_id;
      this.error_message.set(
        productId
          ? 'Debes seleccionar fecha y hora para reservar el servicio. Vuelve al producto para reservar.'
          : 'Debes seleccionar fecha y hora para reservar el servicio.',
      );
      this.toast.error(this.error_message());
      if (productId) {
        // Defer the redirect so the toast is visible first.
        setTimeout(() => this.router.navigate(['/products', productId]), 1500);
      }
      return;
    }

    if (!this.is_authenticated() && !this.guest_data_decision_made) {
      this.guestDataModal()?.open();
      return;
    }

    this.is_submitting.set(true);
    this.error_message.set('');

    // LAST-RESORT FALLBACK: also peek at sessionStorage in case the
    // cart$ subscription + restorePendingBooking() race-condition still
    // hasn't populated bookingSelections by the time the user hits "Pagar".
    // We merge any pending_booking found there into the payload so the
    // booking always travels with the order. Cleanup happens at the end
    // of placeOrder() (success or failure).
    const pendingBookings: Array<{
      product_id: number;
      product_variant_id?: number;
      date: string;
      start_time: string;
      end_time: string;
    }> = [...this.bookingSelections().values()];
    try {
      const stored = sessionStorage.getItem('pending_booking');
      if (stored) {
        const parsed = JSON.parse(stored);
        if (
          parsed?.product_id &&
          parsed?.date &&
          parsed?.start_time &&
          parsed?.end_time
        ) {
          // Only add if not already represented in bookingSelections
          const alreadyIn =
            pendingBookings.find(
              (b) =>
                b.product_id === parsed.product_id &&
                b.date === parsed.date &&
                b.start_time === parsed.start_time,
            );
          if (!alreadyIn) {
            pendingBookings.push({
              product_id: parsed.product_id,
              product_variant_id: parsed.product_variant_id,
              date: parsed.date,
              start_time: parsed.start_time,
              end_time: parsed.end_time,
            });
          }
        }
      }
    } catch {
      // Ignore parse errors; the bookingSelections path still works.
    }

    const request: CheckoutRequest = {
      payment_method_id: this.selected_payment_method_id()!,
      notes: this.notes() || undefined,
      // Canal unificado: "Finalizar por WhatsApp" crea la orden por este
      // mismo núcleo; el backend la marca channel='whatsapp'.
      ...(this.is_whatsapp_channel() ? { channel: 'whatsapp' as const } : {}),
      // Only include shipping fields when cart has physical items
      ...(!this.cartHasOnlyServices
        ? {
            shipping_method_id: this.selected_shipping_method_id || undefined,
            shipping_rate_id: this.selected_shipping_option_id || undefined,
          }
        : {}),
      // Include booking data if there are bookable services
      ...(this.cartHasBookableServices && this.bookingSelections().size > 0
        ? {
            bookings: Array.from(this.bookingSelections().values()),
          }
        : {}),
      // Always send cart items as fallback (in case backend cart is empty/not synced)
      items: this.cart()?.items?.map((item: CartItem) => ({
        product_id: item.product_id,
        product_variant_id: item.product_variant_id || undefined,
        quantity: item.quantity,
        // La presentación elegida viaja al backend: sin ella el pedido sale
        // al precio de la presentación por defecto (típicamente la unitaria)
        // y el comprador paga otra cosa de la que eligió.
        price_tier_id: item.price_tier?.id ?? undefined,
      })),
      guest_customer: this.toGuestCustomer(this.guest_checkout_data),
      // Send coupon code as raw string; backend validates and recomputes
      // the total. Frontend never sends a precomputed grand_total.
      coupon_code: this.coupon_code().trim() || undefined,
      // bank_transfer / voucher: backend resuelve y valida la cuenta con
      // `resolveAndValidateBankAccount`. Solo viajamos el id cuando el
      // método actual lo soporta y el cliente eligió una cuenta. Para el
      // resto de métodos omitimos el campo (undefined) para que el backend
      // no lo inspeccione.
      ...(this.requiresPaymentInstructions() &&
      this.selected_bank_account_id() != null
        ? { bank_account_id: this.selected_bank_account_id() }
        : {}),
    };

    if (!this.cartHasOnlyServices && this.use_new_address()) {
      // Convert IDs to names for backend compatibility
      const { value: addressValue, unresolved } = this.resolveGeoNames(
        this.address_form.value,
      );

      // Mandar el ID del catálogo como nombre de ciudad deja la orden con una
      // dirección de envío inservible para despacho. Abortamos.
      if (unresolved.length > 0) {
        this.is_submitting.set(false);
        this.error_message.set(ERROR_MESSAGES['ORD_SHIP_CITY_UNRESOLVED_001']);
        this.toast.error(ERROR_MESSAGES['ORD_SHIP_CITY_UNRESOLVED_001']);
        return;
      }

      request.shipping_address = addressValue;
    } else if (!this.cartHasOnlyServices && this.selected_address_id()) {
      request.shipping_address_id = this.selected_address_id() ?? undefined;
    }

    // Wompi payment flow: create order first, then open widget.
    // En canal WhatsApp NO se abre wa.me antes del pago: el mensaje de
    // confirmación saldría con una orden aún impaga. La consulta post-pago
    // vive en "Consultar por WhatsApp" de la página del pedido.
    if (this.isWompiPayment()) {
      this.wompiWidgetLoading.set(true);
      this.is_submitting.set(false);

      this.checkout_service
        .checkout(request, this.payment_receipt_file())
        .subscribe({
        next: (response) => {
          if (response.success) {
            this.orderPlaced = true;
            const orderId = response.data.order_id;
            const publicOrderToken = response.data.public_order_token;
            // Use the backend-authoritative total returned in the order
            // creation response — never recompute on the client because
            // promotions + coupon discounts only exist server-side.
            const totalAmount = Number(response.data.total);

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
                  const msg = extractApiErrorMessage(err);
                  this.error_message.set(msg);
                  this.toast.error(msg, 'Error al preparar pago');
                },
              });
          }
        },
        error: (err) => {
          this.wompiWidgetLoading.set(false);
          const msg = extractApiErrorMessage(err);
          this.error_message.set(msg);
          this.toast.error(msg, 'Error al procesar el pedido');
        },
      });

      return;
    }

    this.checkout_service
      .checkout(request, this.payment_receipt_file())
      .subscribe({
      next: (response) => {
        if (response.success) {
          this.orderPlaced = true;
          this.is_submitting.set(false);
          // Canal WhatsApp: mismo flujo, pero al finalizar muestra el resumen
          // y abre el WhatsApp de la tienda con el automensaje de la compra.
          if (this.is_whatsapp_channel()) {
            this.openWhatsAppFromResponse(response.data);
          }
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
        const msg = extractApiErrorMessage(err);
        this.error_message.set(msg);
        this.toast.error(msg, 'Error al procesar el pedido');
        // La decisión guest que llevó a un pedido fallido se deshace: al
        // pulsar "Finalizar" de nuevo el modal vuelve a abrirse en vez de
        // reintentar a ciegas contra el mismo 400 (auditoría D.3).
        if (!this.is_authenticated()) {
          this.guest_data_decision_made = false;
        }
      },
    });
  }

  onGuestDataCompleted(data: GuestCheckoutData | null): void {
    // `null` = el invitado canceló el modal: se aborta, sin reintentar solo.
    // Al pulsar "Finalizar" de nuevo el modal vuelve a abrirse.
    if (!data) return;
    this.guest_checkout_data = data;
    this.guest_data_decision_made = true;
    this.placeOrder();
  }

  /**
   * CP-tienda-checkout-whatsapp (C.7): texto plano de la dirección de la
   * tienda para copiar y para el enlace de Google Maps.
   */
  private storeAddressText(): string {
    const addr = this.store_address();
    if (!addr) return '';
    return [
      addr.address_line1,
      addr.address_line2,
      [addr.city, addr.state_province].filter(Boolean).join(', '),
      addr.phone_number ? `Tel: ${addr.phone_number}` : '',
    ]
      .filter(Boolean)
      .join('\n');
  }

  /** Copia la dirección de la tienda (con fallback sin Clipboard API). */
  copyStoreAddress(): void {
    const text = this.storeAddressText();
    if (!text) return;
    const done = () => this.toast.success('Dirección copiada', 'Listo');
    const fallback = () => {
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        done();
      } catch {
        this.toast.warning(text, 'Copia la dirección');
      }
    };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(done, fallback);
    } else {
      fallback();
    }
  }

  /**
   * Abre la dirección de la tienda en Google Maps en pestaña nueva, sin
   * tocar el router ni el estado del checkout (anotación 3).
   */
  openStoreInMaps(): void {
    const addr = this.store_address();
    if (!addr) return;
    const query = encodeURIComponent(
      [addr.address_line1, addr.city, addr.state_province]
        .filter(Boolean)
        .join(', '),
    );
    window.open(
      `https://www.google.com/maps/search/?api=1&query=${query}`,
      '_blank',
      'noopener',
    );
  }

  /**
   * CP-tienda-checkout-whatsapp (anotación 2): automensaje con TODOS los datos
   * de la compra recién creada. Se arma desde la respuesta del backend (lo
   * realmente comprado), nunca desde el carrito local. Si el navegador
   * bloquea el popup, se informa para que el comprador lo abra manualmente
   * (la orden YA existe: nunca se pierde la venta por un popup bloqueado).
   */
  private openWhatsAppFromResponse(order: {
    order_number: string;
    total: number;
    items?: Array<{
      name: string;
      variant_sku: string | null;
      quantity: number;
      total_price: number;
    }>;
  }): void {
    const config = this.tenant_facade.getCurrentDomainConfig();
    const phone = (
      config?.customConfig?.ecommerce?.checkout?.whatsapp_number || ''
    ).replace(/\D/g, '');
    if (!phone) {
      this.toast.warning(
        'La tienda no tiene un WhatsApp configurado. Tu pedido quedó registrado.',
        'Pedido creado',
      );
      return;
    }
    const storeName =
      config?.customConfig?.branding?.name ||
      config?.store_name ||
      'la tienda';
    const fmt = (v: number) => this.currencyService.format(v);
    const itemLines = (order.items ?? [])
      .map(
        (i) =>
          `  - ${i.name}${i.variant_sku ? ' (' + i.variant_sku + ')' : ''} x${i.quantity} — ${fmt(Number(i.total_price))}`,
      )
      .join('\n');
    const guest = this.guest_checkout_data;
    const customerName =
      this.is_authenticated() || !guest
        ? ''
        : `${guest.first_name ?? ''} ${guest.last_name ?? ''}`.trim();
    const header = customerName
      ? `Hola, soy *${customerName}*! Acabo de comprar en *${storeName}* 🛒`
      : `Hola! Acabo de comprar en *${storeName}* 🛒`;
    const message = encodeURIComponent(
      `${header}\n\n` +
        `*Pedido:* ${order.order_number}\n\n` +
        (itemLines ? `*Productos:*\n${itemLines}\n\n` : '') +
        `*Total:* ${fmt(Number(order.total))}\n\n` +
        `Quedo atento para coordinar el pago y la entrega!`,
    );
    const popup = window.open(`https://wa.me/${phone}?text=${message}`, '_blank');
    if (!popup) {
      this.toast.warning(
        'Tu pedido quedó registrado. Permite ventanas emergentes para abrir WhatsApp.',
        'Pedido creado',
      );
    }
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

  goToCart(): void {
    this.router.navigate(['/cart']);
  }

  /**
   * Navega al wizard de booking para que el cliente pueda modificar el
   * horario, profesional o modalidad sin tener que pasar por el carrito.
   * Prioridad: (1) el primer bookable item sin booking en el carrito,
   * (2) si todos tienen booking, el primero del carrito. Esto evita
   * que con múltiples items se sobreescriban las selecciones existentes
   * al navegar al wizard.
   */
  changeSchedule(): void {
    const firstMissing = this.bookableItems.find(
      (i) => !this.preBookedSelectionFor(i),
    );
    const target = firstMissing ?? this.bookableItems[0];
    if (!target) {
      this.toast.warning(
        'No hay servicios con reserva para modificar en el carrito.',
      );
      return;
    }
    this.router.navigate(['/book', target.product_id]);
  }

  onQuickView(product: EcommerceProduct): void {
    this.selectedProductSlug.set(product.slug);
    this.quickViewOpen.set(true);
  }

  /**
   * Reacción POSTERIOR a una adición que YA ocurrió. NO agrega nada.
   *
   * Este handler cuelga de DOS fuentes y ambas agregan por su cuenta antes de
   * emitir, así que volver a llamar `addProduct` duplicaba la línea:
   *
   *  1. `(add_to_cart)` del `app-product-card` dentro del carrusel: la card ya
   *     llamó `cartService.addProduct(id, qtyToAdd())` (chokepoint D3).
   *  2. `(addedToCart)` del `app-product-quick-view-modal`: el modal ya llamó
   *     `addProduct(id, quantity(), variantId, variantInfo)`. Aquí era peor que
   *     una simple duplicación — el segundo `addProduct(product.id, 1)` perdía
   *     la variante elegida y la cantidad, creando una línea espuria del
   *     producto base. Home y catálogo ya lo resolvían bien con un handler
   *     aparte (`onModalAddedToCart`, que solo cierra el modal).
   *
   * El guard `tableContext.isActive()` solo cubría mesa QR, de modo que en
   * tienda normal la duplicación nunca estuvo protegida.
   *
   * La página se refresca sola: lee `cart_service.cart$`, que la adición del
   * chokepoint ya actualiza. NO restaurar `addProduct` aquí.
   */
  onAddToCartFromSlider(_product: EcommerceProduct): void {
    // Sin efectos por ahora: la adición ya ocurrió en la card o en el modal.
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

  /** Maps (field, first validation error key) → client error code. */
  private static readonly ADDRESS_ERROR_CODES: Record<
    string,
    Record<string, string>
  > = {
    address_line1: {
      required: 'ECOM_CHECKOUT_ADDR_LINE1_001',
      minlength: 'ECOM_CHECKOUT_ADDR_LINE1_001',
      maxlength: 'ECOM_CHECKOUT_ADDR_LINE1_001',
    },
    address_line2: { maxlength: 'ECOM_CHECKOUT_ADDR_LINE2_001' },
    state_province: { required: 'ECOM_CHECKOUT_ADDR_STATE_001' },
    city: { required: 'ECOM_CHECKOUT_ADDR_CITY_001' },
    country_code: { required: 'ECOM_CHECKOUT_ADDR_COUNTRY_001' },
    postal_code: {
      maxlength: 'ECOM_CHECKOUT_ADDR_POSTAL_001',
      pattern: 'ECOM_CHECKOUT_ADDR_POSTAL_001',
    },
    phone_number: {
      required: 'ECOM_CHECKOUT_ADDR_PHONE_001',
      pattern: 'ECOM_CHECKOUT_ADDR_PHONE_001',
      phoneDigits: 'ECOM_CHECKOUT_ADDR_PHONE_001',
    },
  };

  // Helper method for field validation errors (coded messages)
  getFieldError(fieldName: string): string {
    const control = this.address_form.get(fieldName);
    if (!control || control.disabled || !control.touched || !control.errors) {
      return '';
    }
    const map = CheckoutComponent.ADDRESS_ERROR_CODES[fieldName];
    if (!map) return '';
    const errorKey = Object.keys(control.errors)[0];
    const code = map[errorKey];
    return code ? (ERROR_MESSAGES[code] ?? '') : '';
  }
}
