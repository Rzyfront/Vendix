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
import { Router, RouterModule } from '@angular/router';
import { Subject, takeUntil } from 'rxjs';

import {
    EcommerceBookingService,
    CustomerBooking,
    AvailabilitySlot,
    RescheduleBookingDto,
} from '../../services/ecommerce-booking.service';
import { ButtonComponent } from '../../../../../shared/components/button/button.component';
import { IconComponent } from '../../../../../shared/components/icon/icon.component';
import { ToastService } from '../../../../../shared/components/toast/toast.service';

type BookingStatus = CustomerBooking['status'];

interface StatusConfig {
    label: string;
    color: string;
    bgColor: string;
}

const STATUS_MAP: Record<BookingStatus, StatusConfig> = {
    pending: { label: 'Pendiente', color: '#92400e', bgColor: '#fef3c7' },
    confirmed: { label: 'Confirmada', color: 'var(--color-primary)', bgColor: 'color-mix(in srgb, var(--color-primary) 12%, transparent)' },
    in_progress: { label: 'En Progreso', color: '#1d4ed8', bgColor: '#dbeafe' },
    completed: { label: 'Completada', color: '#065f46', bgColor: '#d1fae5' },
    cancelled: { label: 'Cancelada', color: '#991b1b', bgColor: '#fee2e2' },
    no_show: { label: 'No Asistió', color: '#4b5563', bgColor: '#f3f4f6' },
};

@Component({
    selector: 'app-my-reservations',
    standalone: true,
    imports: [CommonModule, FormsModule, RouterModule, ButtonComponent, IconComponent],
    templateUrl: './my-reservations.component.html',
    styleUrls: ['./my-reservations.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MyReservationsComponent implements OnInit, OnDestroy {
    private bookingService = inject(EcommerceBookingService);
    private toast = inject(ToastService);
    private router = inject(Router);
    private destroy$ = new Subject<void>();

    // State
    bookings = signal<CustomerBooking[]>([]);
    loading = signal(true);
    error = signal(false);

    // Cancel dialog
    cancelDialogOpen = signal(false);
    cancellingBookingId = signal<number | null>(null);
    cancelling = signal(false);

    // Reschedule
    rescheduleDialogOpen = signal(false);
    reschedulingBooking = signal<CustomerBooking | null>(null);
    rescheduleSlots = signal<AvailabilitySlot[]>([]);
    rescheduleSelectedDate = signal<string>('');
    rescheduleSelectedSlot = signal<AvailabilitySlot | null>(null);
    loadingRescheduleSlots = signal(false);
    rescheduling = signal(false);

    // Reschedule available dates (next 14 days)
    rescheduleDates = computed(() => {
        const dates: string[] = [];
        const today = new Date();
        for (let i = 1; i <= 14; i++) {
            const d = new Date(today);
            d.setDate(d.getDate() + i);
            dates.push(this.formatDateISO(d));
        }
        return dates;
    });

    rescheduleSlotsForDate = computed(() => {
        const date = this.rescheduleSelectedDate();
        if (!date) return [];
        return this.rescheduleSlots().filter((s) => s.date === date && s.available > 0);
    });

    // Sorted bookings: upcoming first
    sortedBookings = computed(() => {
        return [...this.bookings()].sort((a, b) => {
            const dateA = new Date(`${a.date}T${a.start_time}`);
            const dateB = new Date(`${b.date}T${b.start_time}`);
            return dateB.getTime() - dateA.getTime();
        });
    });

    ngOnInit(): void {
        this.loadBookings();
    }

    ngOnDestroy(): void {
        this.destroy$.next();
        this.destroy$.complete();
    }

    loadBookings(): void {
        this.loading.set(true);
        this.error.set(false);

        this.bookingService.getMyBookings().pipe(takeUntil(this.destroy$)).subscribe({
            next: (response) => {
                this.bookings.set(response.data || []);
                this.loading.set(false);
            },
            error: () => {
                this.loading.set(false);
                this.error.set(true);
                this.toast.error('No se pudieron cargar tus reservas', 'Error');
            },
        });
    }

    // --- Cancel ---

    openCancelDialog(bookingId: number): void {
        this.cancellingBookingId.set(bookingId);
        this.cancelDialogOpen.set(true);
    }

    closeCancelDialog(): void {
        this.cancelDialogOpen.set(false);
        this.cancellingBookingId.set(null);
    }

    confirmCancel(): void {
        const id = this.cancellingBookingId();
        if (!id) return;

        this.cancelling.set(true);

        this.bookingService.cancelBooking(id).subscribe({
            next: () => {
                this.cancelling.set(false);
                this.closeCancelDialog();
                this.toast.success('Reserva cancelada', 'Cancelada');
                this.loadBookings();
            },
            error: (err) => {
                this.cancelling.set(false);
                const msg = err?.error?.message || 'Error al cancelar la reserva';
                this.toast.error(msg, 'Error');
            },
        });
    }

    // --- Reschedule ---

    openRescheduleDialog(booking: CustomerBooking): void {
        this.reschedulingBooking.set(booking);
        this.rescheduleSelectedDate.set('');
        this.rescheduleSelectedSlot.set(null);
        this.rescheduleSlots.set([]);
        this.rescheduleDialogOpen.set(true);
        this.loadRescheduleSlots(booking.product_id);
    }

    closeRescheduleDialog(): void {
        this.rescheduleDialogOpen.set(false);
        this.reschedulingBooking.set(null);
    }

    private loadRescheduleSlots(productId: number): void {
        this.loadingRescheduleSlots.set(true);
        const dates = this.rescheduleDates();
        const dateFrom = dates[0];
        const dateTo = dates[dates.length - 1];

        this.bookingService.getAvailability(productId, dateFrom, dateTo).subscribe({
            next: (response) => {
                this.rescheduleSlots.set(response.data || []);
                this.loadingRescheduleSlots.set(false);
            },
            error: () => {
                this.loadingRescheduleSlots.set(false);
                this.toast.error('No se pudo cargar la disponibilidad', 'Error');
            },
        });
    }

    selectRescheduleDate(date: string): void {
        this.rescheduleSelectedDate.set(date);
        this.rescheduleSelectedSlot.set(null);
    }

    selectRescheduleSlot(slot: AvailabilitySlot): void {
        this.rescheduleSelectedSlot.set(slot);
    }

    confirmReschedule(): void {
        const booking = this.reschedulingBooking();
        const slot = this.rescheduleSelectedSlot();
        const date = this.rescheduleSelectedDate();
        if (!booking || !slot || !date) return;

        this.rescheduling.set(true);

        const dto: RescheduleBookingDto = {
            date,
            start_time: slot.start_time,
            end_time: slot.end_time,
        };

        this.bookingService.rescheduleBooking(booking.id, dto).subscribe({
            next: () => {
                this.rescheduling.set(false);
                this.closeRescheduleDialog();
                this.toast.success('Reserva reagendada exitosamente', 'Reagendada');
                this.loadBookings();
            },
            error: (err) => {
                this.rescheduling.set(false);
                const msg = err?.error?.message || 'Error al reagendar la reserva';
                this.toast.error(msg, 'Error');
            },
        });
    }

    dateHasSlots(date: string): boolean {
        return this.rescheduleSlots().some((s) => s.date === date && s.available > 0);
    }

    // --- Helpers ---

    canModify(booking: CustomerBooking): boolean {
        return booking.status === 'pending' || booking.status === 'confirmed';
    }

    getStatusConfig(status: BookingStatus): StatusConfig {
        return STATUS_MAP[status] || STATUS_MAP.pending;
    }

    formatDateDisplay(dateStr: string): string {
        const date = new Date(dateStr + 'T12:00:00');
        const days = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
        const months = [
            'Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun',
            'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic',
        ];
        return `${days[date.getDay()]} ${date.getDate()} ${months[date.getMonth()]}`;
    }

    formatDateLong(dateStr: string): string {
        const date = new Date(dateStr + 'T12:00:00');
        const days = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
        const months = [
            'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
            'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
        ];
        return `${days[date.getDay()]} ${date.getDate()} de ${months[date.getMonth()]}`;
    }

    formatTime(time: string): string {
        const [hours, minutes] = time.split(':');
        const h = parseInt(hours, 10);
        const suffix = h >= 12 ? 'PM' : 'AM';
        const displayH = h > 12 ? h - 12 : h === 0 ? 12 : h;
        return `${displayH}:${minutes} ${suffix}`;
    }

    private formatDateISO(date: Date): string {
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, '0');
        const d = String(date.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    }

    goBack(): void {
        this.router.navigate(['/account']);
    }
}
