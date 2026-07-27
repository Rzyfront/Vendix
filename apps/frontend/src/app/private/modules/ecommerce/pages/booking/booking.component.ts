import {
  Component,
  OnInit,
  DestroyRef,
  signal,
  computed,
  inject,
  ChangeDetectionStrategy,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';

import {
  EcommerceBookingService,
  AvailabilitySlot,
} from '../../services/ecommerce-booking.service';
import { CatalogService, ProductDetail, ProductVariantDetail } from '../../services/catalog.service';
import { CartService } from '../../services/cart.service';
import { StoreUiService } from '../../services/store-ui.service';
import { AuthFacade } from '../../../../../core/store/auth/auth.facade';
import { StepsLineComponent } from '../../../../../shared/components/steps-line/steps-line.component';
import { ButtonComponent } from '../../../../../shared/components/button/button.component';
import { IconComponent } from '../../../../../shared/components/icon/icon.component';
import { ToastService } from '../../../../../shared/components/toast/toast.service';
import { CurrencyPipe } from '../../../../../shared/pipes/currency';
import { toLocalDateString } from '../../../../../shared/utils/date.util';

import { BookingCalendarComponent } from '../../components/booking/booking-calendar/booking-calendar.component';
import {
  ProviderSelectorComponent,
  BookingProvider,
} from '../../components/booking/provider-selector/provider-selector.component';
import { SlotGridComponent, BookingSlot } from '../../components/booking/slot-grid/slot-grid.component';
import {
  ServiceLocationSelectorComponent,
  ServiceLocation,
} from '../../components/booking/service-location-selector/service-location-selector.component';

@Component({
  selector: 'app-booking',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterModule,
    StepsLineComponent,
    ButtonComponent,
    IconComponent,
    ServiceLocationSelectorComponent,
    CurrencyPipe,
    BookingCalendarComponent,
    ProviderSelectorComponent,
    SlotGridComponent,
  ],
  templateUrl: './booking.component.html',
  styleUrls: ['./booking.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BookingComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private bookingService = inject(EcommerceBookingService);
  private catalogService = inject(CatalogService);
  private cartService = inject(CartService);
  private authFacade = inject(AuthFacade);
  private toast = inject(ToastService);
  private storeUiService = inject(StoreUiService);

  private destroyRef = inject(DestroyRef);

  // State
  currentStep = signal(0);
  loading = signal(true);
  submitting = signal(false);
  errorMessage = signal('');

  // Product
  product = signal<ProductDetail | null>(null);
  productId = signal<number>(0);

  // Variant selection
  readonly variants = signal<ProductVariantDetail[]>([]);
  readonly selectedVariantId = signal<number | null>(null);
  readonly selectedVariant = computed(() => {
    const id = this.selectedVariantId();
    if (!id) return null;
    return this.variants().find((v) => v.id === id) ?? null;
  });

  // Step 1 — Date
  selectedDate = signal<string | null>(null);

  // Step 2 — Provider
  selectedProvider = signal<BookingProvider | null>(null);
  readonly providerId = computed(() => this.selectedProvider()?.id ?? null);

  // Step 3 — Slot
  selectedSlot = signal<BookingSlot | AvailabilitySlot | null>(null);

  // Free-booking fallback (when product has no provider scheduling).
  isFreeBooking = signal(false);
  freeBookingTime = signal<string | null>(null);
  freeBookingEndTime = signal<string | null>(null);
  readonly freeBookingSlots = computed(() => {
    const duration = this.product()?.service_duration_minutes || 60;
    const slots: { time: string; endTime: string }[] = [];
    for (let mins = 480; mins + duration <= 1080; mins += duration) {
      const h = Math.floor(mins / 60);
      const m = mins % 60;
      const eh = Math.floor((mins + duration) / 60);
      const em = (mins + duration) % 60;
      slots.push({
        time: `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`,
        endTime: `${eh.toString().padStart(2, '0')}:${em.toString().padStart(2, '0')}`,
      });
    }
    return slots;
  });

  /**
   * `freeBookingSlots` filtered to hide past start times when the
   * selected day is today. Without this, the synthetic slot list
   * (which starts at 08:00 and walks forward) would still let the
   * customer pick 10:00 AM at 4 PM. We normalize `selectedDate` to
   * YYYY-MM-DD because some call sites forward Prisma's ISO-timestamp
   * shape, others a date-only string.
   */
  readonly visibleFreeBookingSlots = computed(() => {
    const rawDate = this.selectedDate();
    const date = rawDate ? rawDate.split('T')[0] : '';
    const today = toLocalDateString(new Date());
    if (date !== today) return this.freeBookingSlots();
    const now = new Date();
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    return this.freeBookingSlots().filter((s) => {
      const [h, m] = s.time.split(':').map(Number);
      return h * 60 + m > nowMinutes;
    });
  });

  // Steps config — 4 steps when the service has providers, 3 when free_booking
  // (skip the Profesional step because free_booking has no provider assignment).
  readonly steps = computed(() => {
    if (this.isFreeBooking()) {
      return [{ label: 'Fecha' }, { label: 'Horario' }, { label: 'Confirmar' }];
    }
    return [
      { label: 'Fecha' },
      { label: 'Profesional' },
      { label: 'Horario' },
      { label: 'Confirmar' },
    ];
  });

  // Step 3 — Customer details
  isLoggedIn = signal(false);
  currentUser = signal<any>(null);
  guestName = signal('');
  guestEmail = signal('');
  guestPhone = signal('');
  bookingNotes = signal('');

  // Service location (where the technician will perform the work)
  readonly serviceLocation = signal<ServiceLocation | null>(null);
  readonly customerAddresses = signal<any[]>([]);
  readonly storeAddress = signal<any | null>(null);
  readonly selectedAddressId = signal<number | null>(null);
  /**
   * From the store's service config. When false, the ecommerce
   * booking flow hides the 'A domicilio' option.
   */
  readonly offerHomeService = signal<boolean>(true);

  // Confirmation
  bookingResult = signal<any>(null);

  ngOnInit(): void {
    const idParam = this.route.snapshot.paramMap.get('productId');
    if (!idParam) {
      this.router.navigate(['/']);
      return;
    }

    this.productId.set(Number(idParam));
    const variantId = Number(
      this.route.snapshot.queryParamMap.get('variant_id'),
    );
    if (Number.isFinite(variantId) && variantId > 0) {
      this.selectedVariantId.set(variantId);
    }

    // Check auth state
    this.authFacade.isAuthenticated$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((auth) => {
        this.isLoggedIn.set(auth);
      });
    this.authFacade.user$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((user) => {
      this.currentUser.set(user);
      if (user) {
        this.guestName.set(
          `${user.first_name || ''} ${user.last_name || ''}`.trim(),
        );
        this.guestEmail.set(user.email || '');
        this.guestPhone.set(user.phone || '');
      }
    });

    this.loadProduct();
    this.loadServiceLocation();
  }

  /**
   * Preload the customer's saved addresses and the store's primary
   * address so the "Dónde quieres que se preste el servicio?" selector
   * in step 4 (Confirmar) has data ready.
   */
  private loadServiceLocation(): void {
    this.bookingService.getCustomerAddresses().subscribe({
      next: (list) => {
        const safeList = list ?? [];
        this.customerAddresses.set(safeList);
        // Auto-pick the primary address when the user hasn't yet chosen
        // one. The user might have just set a new address as Principal
        // in Mi Cuenta → Mis Direcciones before opening this flow, and
        // we want that selection to flow through without forcing them
        // to click a radio button. Only acts when nothing is selected
        // yet, so an in-progress booking isn't disturbed.
        if (this.selectedAddressId() == null) {
          const primary = safeList.find((a) => a?.is_primary);
          if (primary?.id != null) {
            this.selectedAddressId.set(primary.id);
          }
        }
      },
    });
    this.bookingService.getStoreAddress().subscribe({
      next: (addr) => this.storeAddress.set(addr ?? null),
    });
    this.bookingService.getStoreServices().subscribe({
      next: (svc) => {
        this.offerHomeService.set(svc.offer_home_service);
        // If the store doesn't offer home service, force-pick 'shop'
        // (the only legal value) and clear any previously-picked
        // home address so the booking can't be saved against a
        // disabled option.
        if (!svc.offer_home_service) {
          this.serviceLocation.set('shop');
          if (this.selectedAddressId() != null) {
            this.selectedAddressId.set(null);
          }
        }
      },
    });
  }

  onServiceLocationChange(value: ServiceLocation): void {
    this.serviceLocation.set(value);
  }

  onServiceAddressChange(id: number | null): void {
    this.selectedAddressId.set(id);
  }

  /**
   * Comprime una dirección del cliente a una etiqueta corta legible
   * para mostrar en el resumen del checkout. El modelo real del
   * ecommerce varía entre despliegues (street_line, address_line_1,
   * complement, city, neighborhood), así que armamos el texto con los
   * campos que estén poblados y caemos con gracia al `id` si no
   * encontramos nada.
   */
  private formatAddressLabel(addr: any): string {
    if (!addr || typeof addr !== 'object') return 'Dirección guardada';
    const parts: string[] = [];
    const tryKeys = [
      ['street_line_1', 'street_line_2'],
      ['address_line_1', 'address_line_2'],
      ['street', 'complement'],
    ];
    for (const [a, b] of tryKeys) {
      if (addr[a]) parts.push(String(addr[a]));
      if (addr[b]) parts.push(String(addr[b]));
      if (parts.length) break;
    }
    if (addr.city) parts.push(String(addr.city));
    else if (addr.neighborhood) parts.push(String(addr.neighborhood));
    if (parts.length) return parts.filter(Boolean).join(', ');
    return addr.label
      ? String(addr.label)
      : `Dirección #${addr.id ?? ''}`.trim();
  }

  // --- Data loading ---

  private loadProduct(): void {
    this.loading.set(true);
    this.catalogService
      .getProductBySlug(this.productId().toString())
      .subscribe({
        next: (response) => {
          if (response.success) {
            this.product.set(response.data);
            this.variants.set(response.data.variants ?? []);
            if (!this.selectedVariantId() && response.data.variants?.length) {
              this.selectedVariantId.set(response.data.variants[0].id);
            }
            this.isFreeBooking.set(
              response.data.booking_mode === 'free_booking',
            );
          }
          this.loading.set(false);
        },
        error: () => {
          this.loading.set(false);
          this.toast.error('No se pudo cargar el servicio', 'Error');
        },
      });
  }

  // --- Variant selection ---

  onVariantSelected(variant: ProductVariantDetail): void {
    this.selectedVariantId.set(variant.id);
    this.selectedDate.set(null);
    this.selectedProvider.set(null);
    this.selectedSlot.set(null);
  }

  // --- Step navigation ---

  /**
   * When the service is `free_booking`, the step indices shift: Fecha=0,
   * Horario=1, Confirmar=2. When the service requires a provider, Fecha=0,
   * Profesional=1, Horario=2, Confirmar=3.
   */
  get profesionalStep(): number {
    return this.isFreeBooking() ? 1 : 1; // always 1 — Profesional is step 1
    // When free_booking, the step indicator shows 3 steps and step 1 is
    // Horario. We hide the Profesional section via @if (currentStep() === 1
    // && !isFreeBooking()).
  }

  get horarioStep(): number {
    return this.isFreeBooking() ? 1 : 2;
  }

  get confirmStep(): number {
    return this.isFreeBooking() ? 2 : 3;
  }

  // --- Step 1: Date selection ---

  onDateSelected(date: string): void {
    if (this.isPastDate(date)) return;
    this.selectedDate.set(date);
    this.selectedSlot.set(null);
    this.freeBookingTime.set(null);
    this.freeBookingEndTime.set(null);
    // Skip Profesional step when free_booking (no provider scheduling).
    this.currentStep.set(1);
  }

  // --- Step 2: Provider selection ---

  onProviderSelected(provider: BookingProvider): void {
    this.selectedProvider.set(provider);
    this.selectedSlot.set(null);
    this.currentStep.set(2);
  }

  // --- Step 3: Slot selection ---

  onSlotSelected(slot: BookingSlot): void {
    this.selectedSlot.set(slot);
    this.currentStep.set(3);
  }

  selectFreeBookingTime(slot: { time: string; endTime: string }): void {
    this.freeBookingTime.set(slot.time);
    this.freeBookingEndTime.set(slot.endTime);
    this.currentStep.set(2);
  }

  // --- Step 4: Confirm ---

  confirmBooking(): void {
    if (!this.isLoggedIn()) {
      this.errorMessage.set('Debes iniciar sesion para reservar');
      return;
    }

    // The customer must pick where the service will be performed before
    // we can persist the booking. This blocks the submit and surfaces a
    // toast so the user knows what to do.
    if (this.serviceLocation() == null) {
      this.toast.error('Elige dónde quieres que se presente el servicio');
      return;
    }

    const date = this.selectedDate();
    if (!date) return;

    let startTime: string;
    let endTime: string;

    if (this.isFreeBooking()) {
      startTime = this.freeBookingTime()!;
      endTime = this.freeBookingEndTime()!;
      if (!startTime || !endTime) return;
    } else {
      const slot = this.selectedSlot();
      if (!slot) return;
      startTime = slot.start_time;
      endTime = slot.end_time;
    }

    const variantId = this.selectedVariantId();
    const bookingSelection: Record<string, any> = {
      product_id: this.productId(),
      date,
      start_time: startTime,
      end_time: endTime,
    };
    if (variantId) {
      bookingSelection['product_variant_id'] = variantId;
    }
    // Persistimos también el proveedor seleccionado (cuando aplica) para
    // que el resumen del checkout pueda mostrarlo al lado de la fecha
    // y el horario, sin obligar al cliente a re-picar.
    const providerId = this.providerId();
    if (providerId) {
      bookingSelection['provider_id'] = providerId;
    }
    const provider = this.selectedProvider();
    if (provider?.display_name) {
      bookingSelection['provider_name'] = provider.display_name;
    }
    // Persist the service-location choice so the checkout (which calls
    // /ecommerce/reservations/ POST) can forward it.
    const svcLocation = this.serviceLocation();
    if (svcLocation) {
      bookingSelection['service_location_type'] = svcLocation;
    }
    if (svcLocation === 'home' && this.selectedAddressId() != null) {
      bookingSelection['service_address_id'] = this.selectedAddressId();
      // Componemos una etiqueta legible para mostrar en el resumen del
      // checkout (sin obligar al cliente a recordar qué dirección tenía
      // guardada). Probamos varios campos porque el modelo del
      // ecommerce no es uniforme en todos los despliegues.
      const address = this.customerAddresses().find(
        (a: any) => a?.id === this.selectedAddressId(),
      );
      if (address) {
        bookingSelection['service_address_label'] =
          this.formatAddressLabel(address);
      }
    }
    sessionStorage.setItem('pending_booking', JSON.stringify(bookingSelection));

    const product = this.product();
    const variant = this.selectedVariant();
    if (product) {
      // Chokepoint (D3): mesa-vs-cart routing lives in `cartService.addProduct`.
      const result = this.cartService.addProduct(
        product.id,
        1,
        variant?.id,
        variant
          ? { name: variant.name, sku: variant.sku, price: variant.final_price }
          : undefined,
      );
      if (result) {
        result.subscribe(() => {
          this.router.navigate(['/checkout']);
        });
      } else {
        this.router.navigate(['/checkout']);
      }
    } else {
      this.router.navigate(['/checkout']);
    }
  }

  goToStep(step: number): void {
    if (step < this.currentStep()) {
      this.currentStep.set(step);
    }
  }

  goBack(): void {
    const step = this.currentStep();
    if (step > 0) {
      this.currentStep.set(step - 1);
    } else {
      this.router.navigate(['/']);
    }
  }

  goToMyReservations(): void {
    this.router.navigate(['/account/reservations']);
  }

  goToLogin(): void {
    this.storeUiService.openLoginModal();
  }

  // --- Helpers ---

  formatDateISO(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  formatTime(time: string): string {
    const [hours, minutes] = time.split(':');
    const h = parseInt(hours, 10);
    const suffix = h >= 12 ? 'PM' : 'AM';
    const displayH = h > 12 ? h - 12 : h === 0 ? 12 : h;
    return `${displayH}:${minutes} ${suffix}`;
  }

  formatDateDisplay(dateStr: string): string {
    const date = new Date(dateStr + 'T12:00:00');
    const days = [
      'Domingo',
      'Lunes',
      'Martes',
      'Miércoles',
      'Jueves',
      'Viernes',
      'Sábado',
    ];
    const months = [
      'Enero',
      'Febrero',
      'Marzo',
      'Abril',
      'Mayo',
      'Junio',
      'Julio',
      'Agosto',
      'Septiembre',
      'Octubre',
      'Noviembre',
      'Diciembre',
    ];
    return `${days[date.getDay()]} ${date.getDate()} de ${months[date.getMonth()]}`;
  }

  isPastDate(dateStr: string): boolean {
    const date = new Date(dateStr + 'T00:00:00');
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return date < today;
  }
}
