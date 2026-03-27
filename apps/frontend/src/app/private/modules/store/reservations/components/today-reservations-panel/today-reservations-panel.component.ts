import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';

import { CardComponent } from '../../../../../../shared/components/card/card.component';
import { BadgeComponent, IconComponent } from '../../../../../../shared/components';
import { BadgeVariant } from '../../../../../../shared/components/badge/badge.component';
import { Booking, BookingStatus } from '../../interfaces/reservation.interface';

const SPANISH_MONTHS = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

@Component({
  selector: 'app-today-reservations-panel',
  standalone: true,
  imports: [CommonModule, CardComponent, BadgeComponent, IconComponent],
  templateUrl: './today-reservations-panel.component.html',
  styleUrls: ['./today-reservations-panel.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TodayReservationsPanelComponent {
  bookings = input<Booking[]>([]);
  loading = input(false);

  bookingClicked = output<Booking>();
  viewAllClicked = output<void>();

  todayLabel = computed(() => {
    const now = new Date();
    const day = now.getDate();
    const month = SPANISH_MONTHS[now.getMonth()];
    return `Hoy, ${day} de ${month}`;
  });

  bookingsCount = computed(() => this.bookings().length);

  getStatusColor(status: BookingStatus): string {
    const map: Record<BookingStatus, string> = {
      pending: 'border-l-amber-500',
      confirmed: 'border-l-blue-500',
      in_progress: 'border-l-indigo-500',
      completed: 'border-l-emerald-500',
      cancelled: 'border-l-red-500',
      no_show: 'border-l-gray-400',
    };
    return map[status] ?? 'border-l-gray-300';
  }

  getStatusBadgeVariant(status: BookingStatus): BadgeVariant {
    const map: Record<BookingStatus, BadgeVariant> = {
      pending: 'warning',
      confirmed: 'primary',
      in_progress: 'primary',
      completed: 'success',
      cancelled: 'error',
      no_show: 'error',
    };
    return map[status] ?? 'neutral';
  }

  getStatusLabel(status: BookingStatus): string {
    const map: Record<BookingStatus, string> = {
      pending: 'Pendiente',
      confirmed: 'Confirmada',
      in_progress: 'En progreso',
      completed: 'Completada',
      cancelled: 'Cancelada',
      no_show: 'No show',
    };
    return map[status] ?? status;
  }

  formatTime(time: string): string {
    const [hoursStr, minutesStr] = time.split(':');
    let hours = parseInt(hoursStr, 10);
    const minutes = minutesStr || '00';
    const period = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12 || 12;
    return `${hours}:${minutes} ${period}`;
  }
}
