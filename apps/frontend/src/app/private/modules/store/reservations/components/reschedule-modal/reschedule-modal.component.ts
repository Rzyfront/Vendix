import { Component, input, output, signal, inject, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  ModalComponent,
  ButtonComponent,
  IconComponent,
  SpinnerComponent,
} from '../../../../../../shared/components';
import { ReservationsService } from '../../services/reservations.service';
import { ToastService } from '../../../../../../shared/components';
import { Booking, AvailabilitySlot } from '../../interfaces/reservation.interface';
import { finalize } from 'rxjs';

@Component({
  selector: 'app-reschedule-modal',
  standalone: true,
  imports: [CommonModule, ModalComponent, ButtonComponent, IconComponent, SpinnerComponent],
  templateUrl: './reschedule-modal.component.html',
  styleUrls: ['./reschedule-modal.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RescheduleModalComponent {
  private reservationsService = inject(ReservationsService);
  private toastService = inject(ToastService);

  readonly isOpen = input<boolean>(false);
  readonly booking = input<Booking | null>(null);

  readonly closed = output<void>();
  readonly rescheduled = output<void>();

  dates = signal<string[]>([]);
  selectedDate = signal('');
  slots = signal<AvailabilitySlot[]>([]);
  selectedSlot = signal<AvailabilitySlot | null>(null);
  loadingSlots = signal(false);
  submitting = signal(false);

  onOpen(): void {
    this.selectedDate.set('');
    this.selectedSlot.set(null);
    this.slots.set([]);
    this.generateDates();
  }

  generateDates(): void {
    const dates: string[] = [];
    const today = new Date();
    for (let i = 0; i < 14; i++) {
      const d = new Date(today);
      d.setDate(today.getDate() + i);
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      dates.push(`${year}-${month}-${day}`);
    }
    this.dates.set(dates);
    if (dates.length > 0) {
      this.selectDate(dates[0]);
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
      .subscribe({
        next: (slots) => this.slots.set(slots.filter(s => s.total_available > 0)),
        error: () => this.slots.set([]),
      });
  }

  selectSlot(slot: AvailabilitySlot): void {
    this.selectedSlot.set(slot);
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
      .subscribe({
        next: () => {
          this.toastService.success('Reserva reprogramada exitosamente');
          this.rescheduled.emit();
        },
        error: () => {
          this.toastService.error('Error al reprogramar la reserva');
        },
      });
  }

  formatDate(date: string): string {
    const d = new Date(date + 'T12:00:00');
    const days = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
    return `${days[d.getDay()]} ${d.getDate()}`;
  }

  formatTime(time: string): string {
    const [hours, minutes] = time.split(':').map(Number);
    const ampm = hours >= 12 ? 'PM' : 'AM';
    const h = hours % 12 || 12;
    return `${h}:${minutes.toString().padStart(2, '0')} ${ampm}`;
  }
}
