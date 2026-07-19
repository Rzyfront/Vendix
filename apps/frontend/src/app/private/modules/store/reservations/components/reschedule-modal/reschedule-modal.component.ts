import {Component, input, output, signal, inject, DestroyRef} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import {
  ModalComponent,
  ButtonComponent,
  IconComponent,
  SpinnerComponent,
} from '../../../../../../shared/components';
import { ReservationsService } from '../../services/reservations.service';
import { ToastService } from '../../../../../../shared/components';
import { Booking, AvailabilitySlot, ProviderDateInfo } from '../../interfaces/reservation.interface';
import { finalize } from 'rxjs';

@Component({
  selector: 'app-reschedule-modal',
  standalone: true,
  imports: [ModalComponent, ButtonComponent, IconComponent, SpinnerComponent],
  templateUrl: './reschedule-modal.component.html',
  styleUrls: ['./reschedule-modal.component.scss'],
})
export class RescheduleModalComponent {
  private destroyRef = inject(DestroyRef);
  private reservationsService = inject(ReservationsService);
  private toastService = inject(ToastService);

  readonly isOpen = input<boolean>(false);
  readonly booking = input<Booking | null>(null);

  readonly closed = output<void>();
  readonly rescheduled = output<void>();

  dates = signal<ProviderDateInfo[]>([]);
  selectedDate = signal('');
  slots = signal<AvailabilitySlot[]>([]);
  selectedSlot = signal<AvailabilitySlot | null>(null);
  loadingDates = signal(false);
  loadingSlots = signal(false);
  submitting = signal(false);

  onOpen(): void {
    this.selectedDate.set('');
    this.selectedSlot.set(null);
    this.slots.set([]);
    this.dates.set([]);
    this.loadProviderDates();
  }

  loadProviderDates(): void {
    const b = this.booking();
    if (!b?.provider_id) {
      this.generateFallbackDates();
      return;
    }

    this.loadingDates.set(true);
    const today = new Date();
    const endDate = new Date(today);
    endDate.setDate(today.getDate() + 30);
    const dateFrom = this.formatDateISO(today);
    const dateTo = this.formatDateISO(endDate);

    this.reservationsService
      .getProviderDates(b.provider_id, dateFrom, dateTo, b.product_id)
      .pipe(finalize(() => this.loadingDates.set(false)))
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (providerDates) => {
          const availableDates = providerDates.filter((d) => d.has_schedule);
          this.dates.set(availableDates);
          if (availableDates.length > 0) {
            this.selectDate(availableDates[0].date);
          }
        },
        error: () => this.generateFallbackDates(),
      });
  }

  private generateFallbackDates(): void {
    const dates: ProviderDateInfo[] = [];
    const today = new Date();
    for (let i = 0; i < 14; i++) {
      const d = new Date(today);
      d.setDate(today.getDate() + i);
      dates.push({
        date: this.formatDateISO(d),
        day_of_week: d.getDay(),
        has_schedule: true,
        booking_count: 0,
        bookings: [],
      });
    }
    this.dates.set(dates);
    if (dates.length > 0) {
      this.selectDate(dates[0].date);
    }
  }

  selectDate(date: string): void {
    this.selectedDate.set(date);
    this.selectedSlot.set(null);
    this.loadSlots(date);
  }

  loadSlots(date: string): void {
    const b = this.booking();
    if (!b) return;

    this.loadingSlots.set(true);
    this.reservationsService.getAvailability(b.product_id, date, date, b.provider_id)
      .pipe(finalize(() => this.loadingSlots.set(false)))
      .pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
        next: (slots) => this.slots.set(slots.filter(s => s.total_available > 0)),
        error: () => this.slots.set([]),
      });
  }

  selectSlot(slot: AvailabilitySlot): void {
    this.selectedSlot.set(slot);
  }

  getSelectedDateBookings(): Array<{
    id: number;
    start_time: string;
    end_time: string;
    status: string;
    customer_name: string;
    service_name: string;
  }> {
    const selected = this.selectedDate();
    const dateInfo = this.dates().find((d) => d.date === selected);
    return dateInfo?.bookings || [];
  }

  submit(): void {
    const slot = this.selectedSlot();
    const b = this.booking();
    if (!slot || !b) return;

    this.submitting.set(true);
    this.reservationsService.rescheduleReservation(b.id, {
      date: slot.date,
      start_time: slot.start_time,
      end_time: slot.end_time,
    }).pipe(finalize(() => this.submitting.set(false)))
      .pipe(takeUntilDestroyed(this.destroyRef)).subscribe({
        next: () => {
          this.toastService.success('Reserva reprogramada exitosamente');
          this.rescheduled.emit();
        },
        error: () => {
          this.toastService.error('Error al reprogramar la reserva');
        },
      });
  }

  formatDate(dateStr: string): string {
    const d = new Date(dateStr + 'T12:00:00');
    const days = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
    return `${days[d.getDay()]} ${d.getDate()}`;
  }

  formatTime(time: string): string {
    const [hours, minutes] = time.split(':').map(Number);
    const ampm = hours >= 12 ? 'PM' : 'AM';
    const h = hours % 12 || 12;
    return `${h}:${minutes.toString().padStart(2, '0')} ${ampm}`;
  }

  getStatusLabel(status: string): string {
    const labels: Record<string, string> = {
      pending: 'Pendiente',
      confirmed: 'Confirmada',
      in_progress: 'En curso',
      arriving: 'Llegando',
    };
    return labels[status] || status;
  }

  getStatusClass(status: string): string {
    const classes: Record<string, string> = {
      pending: 'status-pending',
      confirmed: 'status-confirmed',
      in_progress: 'status-progress',
      arriving: 'status-arriving',
    };
    return classes[status] || '';
  }

  private formatDateISO(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
}
