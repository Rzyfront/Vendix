import {
    Component,
    OnInit,
    OnDestroy,
    signal,
    computed,
    inject,
    ChangeDetectionStrategy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { Subject, takeUntil } from 'rxjs';

import { EcommerceBookingService, AvailabilitySlot } from '../../services/ecommerce-booking.service';
import { CatalogService, ProductDetail } from '../../services/catalog.service';
import { CartService } from '../../services/cart.service';
import { AuthFacade } from '../../../../../core/store/auth/auth.facade';
import { StepsLineComponent } from '../../../../../shared/components/steps-line/steps-line.component';
import { ButtonComponent } from '../../../../../shared/components/button/button.component';
import { IconComponent } from '../../../../../shared/components/icon/icon.component';
import { ToastService } from '../../../../../shared/components/toast/toast.service';
import { CurrencyPipe } from '../../../../../shared/pipes/currency';

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
        CurrencyPipe,
    ],
    templateUrl: './booking.component.html',
    styleUrls: ['./booking.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BookingComponent implements OnInit, OnDestroy {
    private route = inject(ActivatedRoute);
    private router = inject(Router);
    private bookingService = inject(EcommerceBookingService);
    private catalogService = inject(CatalogService);
    private cartService = inject(CartService);
    private authFacade = inject(AuthFacade);
    private toast = inject(ToastService);

    private destroy$ = new Subject<void>();

    // State
    currentStep = signal(0);
    loading = signal(true);
    submitting = signal(false);
    errorMessage = signal('');

    // Product
    product = signal<ProductDetail | null>(null);
    productId = signal<number>(0);

    // Step 1 - Calendar
    currentMonth = signal(new Date());
    availableSlots = signal<AvailabilitySlot[]>([]);
    loadingSlots = signal(false);

    // Step 2 - Time selection
    selectedDate = signal<string | null>(null);
    selectedSlot = signal<AvailabilitySlot | null>(null);

    // Step 3 - Customer details
    isLoggedIn = signal(false);
    currentUser = signal<any>(null);
    guestName = signal('');
    guestEmail = signal('');
    guestPhone = signal('');
    bookingNotes = signal('');

    // Confirmation
    bookingResult = signal<any>(null);

    // Steps config
    steps = [
        { label: 'Fecha' },
        { label: 'Horario' },
        { label: 'Confirmar' },
    ];

    // Computed: calendar grid
    calendarDays = computed(() => {
        const month = this.currentMonth();
        const year = month.getFullYear();
        const m = month.getMonth();

        const firstDay = new Date(year, m, 1);
        const lastDay = new Date(year, m + 1, 0);

        const startPad = firstDay.getDay(); // 0=Sun
        const totalDays = lastDay.getDate();

        const days: { date: string; day: number; isCurrentMonth: boolean; hasAvailability: boolean }[] = [];

        // Previous month padding
        const prevMonthLastDay = new Date(year, m, 0).getDate();
        for (let i = startPad - 1; i >= 0; i--) {
            const d = prevMonthLastDay - i;
            const prevMonth = new Date(year, m - 1, d);
            days.push({
                date: this.formatDateISO(prevMonth),
                day: d,
                isCurrentMonth: false,
                hasAvailability: false,
            });
        }

        // Current month
        for (let d = 1; d <= totalDays; d++) {
            const dateObj = new Date(year, m, d);
            const dateStr = this.formatDateISO(dateObj);
            const isPast = dateObj < new Date(new Date().setHours(0, 0, 0, 0));
            days.push({
                date: dateStr,
                day: d,
                isCurrentMonth: true,
                hasAvailability: !isPast && this.dateHasAvailability(dateStr),
            });
        }

        // Next month padding to fill 6 rows
        const remaining = 42 - days.length;
        for (let d = 1; d <= remaining; d++) {
            const nextMonth = new Date(year, m + 1, d);
            days.push({
                date: this.formatDateISO(nextMonth),
                day: d,
                isCurrentMonth: false,
                hasAvailability: false,
            });
        }

        return days;
    });

    // Computed: slots grouped by time of day
    groupedSlots = computed(() => {
        const date = this.selectedDate();
        if (!date) return { morning: [], afternoon: [], evening: [] };

        const slots = this.availableSlots().filter(
            (s) => s.date === date && s.available > 0,
        );

        return {
            morning: slots.filter((s) => {
                const h = parseInt(s.start_time.split(':')[0], 10);
                return h < 12;
            }),
            afternoon: slots.filter((s) => {
                const h = parseInt(s.start_time.split(':')[0], 10);
                return h >= 12 && h < 18;
            }),
            evening: slots.filter((s) => {
                const h = parseInt(s.start_time.split(':')[0], 10);
                return h >= 18;
            }),
        };
    });

    hasGroupedSlots = computed(() => {
        const g = this.groupedSlots();
        return g.morning.length > 0 || g.afternoon.length > 0 || g.evening.length > 0;
    });

    monthLabel = computed(() => {
        const m = this.currentMonth();
        const months = [
            'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
            'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
        ];
        return `${months[m.getMonth()]} ${m.getFullYear()}`;
    });

    ngOnInit(): void {
        const idParam = this.route.snapshot.paramMap.get('productId');
        if (!idParam) {
            this.router.navigate(['/']);
            return;
        }

        this.productId.set(Number(idParam));

        // Check auth state
        this.authFacade.isAuthenticated$.pipe(takeUntil(this.destroy$)).subscribe((auth) => {
            this.isLoggedIn.set(auth);
        });
        this.authFacade.user$.pipe(takeUntil(this.destroy$)).subscribe((user) => {
            this.currentUser.set(user);
            if (user) {
                this.guestName.set(`${user.first_name || ''} ${user.last_name || ''}`.trim());
                this.guestEmail.set(user.email || '');
                this.guestPhone.set(user.phone || '');
            }
        });

        this.loadProduct();
        this.loadAvailabilityForMonth();
    }

    ngOnDestroy(): void {
        this.destroy$.next();
        this.destroy$.complete();
    }

    // --- Data loading ---

    private loadProduct(): void {
        this.loading.set(true);
        // Use product ID to fetch via catalog - try by ID first
        this.catalogService.getProductBySlug(this.productId().toString()).subscribe({
            next: (response) => {
                if (response.success) {
                    this.product.set(response.data);
                }
                this.loading.set(false);
            },
            error: () => {
                this.loading.set(false);
                this.toast.error('No se pudo cargar el servicio', 'Error');
            },
        });
    }

    loadAvailabilityForMonth(): void {
        this.loadingSlots.set(true);
        const month = this.currentMonth();
        const year = month.getFullYear();
        const m = month.getMonth();

        const dateFrom = this.formatDateISO(new Date(year, m, 1));
        const dateTo = this.formatDateISO(new Date(year, m + 1, 0));

        this.bookingService.getAvailability(this.productId(), dateFrom, dateTo).subscribe({
            next: (response) => {
                const rawSlots = response.data || response || [];
                // Map total_available → available for compatibility
                const slots = (rawSlots as any[]).map(s => ({
                    ...s,
                    available: s.available ?? s.total_available ?? 0,
                }));
                this.availableSlots.set(slots as AvailabilitySlot[]);
                this.loadingSlots.set(false);
            },
            error: () => {
                this.loadingSlots.set(false);
                this.toast.error('No se pudo cargar la disponibilidad', 'Error');
            },
        });
    }

    // --- Calendar navigation ---

    prevMonth(): void {
        const curr = this.currentMonth();
        const prev = new Date(curr.getFullYear(), curr.getMonth() - 1, 1);
        // Don't go before current month
        const now = new Date();
        if (prev.getFullYear() < now.getFullYear() ||
            (prev.getFullYear() === now.getFullYear() && prev.getMonth() < now.getMonth())) {
            return;
        }
        this.currentMonth.set(prev);
        this.loadAvailabilityForMonth();
    }

    nextMonth(): void {
        const curr = this.currentMonth();
        this.currentMonth.set(new Date(curr.getFullYear(), curr.getMonth() + 1, 1));
        this.loadAvailabilityForMonth();
    }

    // --- Step 1: Date selection ---

    selectDate(dateStr: string): void {
        if (!this.dateHasAvailability(dateStr)) return;
        this.selectedDate.set(dateStr);
        this.selectedSlot.set(null);
        this.currentStep.set(1);
    }

    // --- Step 2: Slot selection ---

    selectSlot(slot: AvailabilitySlot): void {
        this.selectedSlot.set(slot);
        this.currentStep.set(2);
    }

    // --- Step 3: Confirm ---

    confirmBooking(): void {
        if (!this.isLoggedIn()) {
            this.errorMessage.set('Debes iniciar sesion para reservar');
            return;
        }

        const slot = this.selectedSlot();
        const date = this.selectedDate();
        if (!slot || !date) return;

        // Store booking selection in sessionStorage so checkout can pick it up
        const bookingSelection = {
            product_id: this.productId(),
            date,
            start_time: slot.start_time,
            end_time: slot.end_time,
        };
        sessionStorage.setItem('pending_booking', JSON.stringify(bookingSelection));

        // Add the service to cart and navigate to checkout
        const product = this.product();
        if (product) {
            const result = this.cartService.addToCart(product.id, 1);
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
        this.router.navigate(['/auth/login'], {
            queryParams: { returnUrl: `/book/${this.productId()}` },
        });
    }

    // --- Helpers ---

    private dateHasAvailability(dateStr: string): boolean {
        return this.availableSlots().some((s) => s.date === dateStr && s.available > 0);
    }

    private formatDateISO(date: Date): string {
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
        const days = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
        const months = [
            'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
            'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
        ];
        return `${days[date.getDay()]} ${date.getDate()} de ${months[date.getMonth()]}`;
    }

    isToday(dateStr: string): boolean {
        return dateStr === this.formatDateISO(new Date());
    }

    isPastDate(dateStr: string): boolean {
        const date = new Date(dateStr + 'T00:00:00');
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        return date < today;
    }
}
