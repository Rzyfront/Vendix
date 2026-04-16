import {
  Component,
  OnInit,
  OnDestroy,
  inject,
  output,
  ChangeDetectionStrategy,
  signal,
} from '@angular/core';

import { HttpClient } from '@angular/common/http';
import { environment } from '../../../../../../../environments/environment';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { SpinnerComponent } from '../../../../../../shared/components/spinner/spinner.component';
import { ButtonComponent } from '../../../../../../shared/components/button/button.component';

@Component({
  selector: 'app-pos-reservations-panel',
  standalone: true,
  imports: [IconComponent, SpinnerComponent, ButtonComponent],
  templateUrl: './pos-reservations-panel.component.html',
  styleUrls: ['./pos-reservations-panel.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PosReservationsPanelComponent implements OnInit, OnDestroy {
  close = output<void>();
  quickBook = output<void>();
  walkIn = output<void>();

  private http = inject(HttpClient);

  todayBookings = signal<any[]>([]);
  loading = signal(false);
  expandedBookingId = signal<number | null>(null);
  currentTimePercent = signal(0);

  /** Time slots from 07:00 to 22:00 */
  timeSlots: string[] = [];

  private timeInterval: ReturnType<typeof setInterval> | null = null;

  private readonly apiUrl = `${environment.apiUrl}/store/reservations`;
  private readonly DAY_START_HOUR = 7;
  private readonly DAY_END_HOUR = 22;
  private readonly TOTAL_HOURS = 15; // 22 - 7

  constructor() {
    // Generate time slot labels
    for (let h = this.DAY_START_HOUR; h <= this.DAY_END_HOUR; h++) {
      const label = h.toString().padStart(2, '0') + ':00';
      this.timeSlots.push(label);
    }
  }

  ngOnInit() {
    this.loadTodayBookings();
    this.updateCurrentTime();
    this.timeInterval = setInterval(() => this.updateCurrentTime(), 60_000);
  }

  ngOnDestroy() {
    if (this.timeInterval) {
      clearInterval(this.timeInterval);
      this.timeInterval = null;
    }
  }

  loadTodayBookings() {
    this.loading.set(true);
    this.http.get<any>(`${this.apiUrl}/today`).subscribe({
      next: (response) => {
        this.todayBookings.set(response.data || []);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
      },
    });
  }

  confirm(booking: any) {
    this.http
      .post(`${this.apiUrl}/${booking.id}/confirm`, {})
      .subscribe({
        next: () => this.loadTodayBookings(),
      });
  }

  complete(booking: any) {
    this.http
      .post(`${this.apiUrl}/${booking.id}/complete`, {})
      .subscribe({
        next: () => this.loadTodayBookings(),
      });
  }

  noShow(booking: any) {
    this.http
      .post(`${this.apiUrl}/${booking.id}/no-show`, {})
      .subscribe({
        next: () => this.loadTodayBookings(),
      });
  }

  toggleBookingActions(booking: any) {
    this.expandedBookingId.set(
      this.expandedBookingId() === booking.id ? null : booking.id,
    );
  }

  getStatusLabel(status: string): string {
    const labels: Record<string, string> = {
      pending: 'Pendiente',
      confirmed: 'Confirmada',
      completed: 'Completada',
      cancelled: 'Cancelada',
      no_show: 'No asistio',
    };
    return labels[status] || status;
  }

  getStatusVariant(status: string): 'success' | 'neutral' | 'error' | 'primary' | 'warning' {
    const variants: Record<string, 'success' | 'neutral' | 'error' | 'primary' | 'warning'> = {
      pending: 'warning',
      confirmed: 'primary',
      completed: 'success',
      cancelled: 'error',
      no_show: 'neutral',
    };
    return variants[status] || 'neutral';
  }

  formatTime(time: string): string {
    if (!time) return '';
    // Handle HH:mm:ss or HH:mm format
    const parts = time.split(':');
    const hours = parseInt(parts[0], 10);
    const minutes = parts[1] || '00';
    const ampm = hours >= 12 ? 'PM' : 'AM';
    const displayHours = hours % 12 || 12;
    return `${displayHours}:${minutes} ${ampm}`;
  }

  /** Returns the top position (%) of a booking block in the timeline */
  getBlockTop(booking: any): number {
    const startMinutes = this.timeToMinutes(booking.start_time);
    const dayStartMinutes = this.DAY_START_HOUR * 60;
    const totalMinutes = this.TOTAL_HOURS * 60;
    return ((startMinutes - dayStartMinutes) / totalMinutes) * 100;
  }

  /** Returns the height (%) of a booking block in the timeline */
  getBlockHeight(booking: any): number {
    const startMinutes = this.timeToMinutes(booking.start_time);
    const endMinutes = this.timeToMinutes(booking.end_time);
    const totalMinutes = this.TOTAL_HOURS * 60;
    const duration = Math.max(endMinutes - startMinutes, 30); // minimum 30 min
    return (duration / totalMinutes) * 100;
  }

  private updateCurrentTime(): void {
    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    const dayStartMinutes = this.DAY_START_HOUR * 60;
    const totalMinutes = this.TOTAL_HOURS * 60;
    const percent = ((currentMinutes - dayStartMinutes) / totalMinutes) * 100;
    this.currentTimePercent.set(Math.max(0, Math.min(100, percent)));
  }

  private timeToMinutes(time: string): number {
    if (!time) return 0;
    const parts = time.split(':');
    return parseInt(parts[0], 10) * 60 + parseInt(parts[1] || '0', 10);
  }
}
