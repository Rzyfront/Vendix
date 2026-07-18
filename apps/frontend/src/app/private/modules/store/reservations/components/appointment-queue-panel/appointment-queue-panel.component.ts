import {
  Component,
  computed,
  inject,
  OnDestroy,
  OnInit,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { CardComponent } from '../../../../../../shared/components/card/card.component';
import {
  BadgeComponent,
  EmptyStateComponent,
  IconComponent,
} from '../../../../../../shared/components';
import { ReservationsService } from '../../services/reservations.service';
import { QueueEntry } from '../../interfaces/reservation.interface';

interface QueueRow extends QueueEntry {
  /// Human-friendly description of the score, e.g. "5 min tarde" / "15 min antes".
  score_label: string;
  /// True when the customer is in the live queue (>= 0 rank 0).
  in_queue: boolean;
}

/**
 * Live queue panel for the appointment redesign.
 *
 * Renders every booking in `arriving` / `attending` for the selected day,
 * sorted by ABS(starts_at - arrival_at) with manual priority + created_at
 * as tiebreakers. Polls every 30s (cheap, one indexed query per store).
 *
 * Staff can promote the next customer with "Marcar attending" — that
 * calls `PATCH /:id/mark-attending` and the listener re-renders the queue
 * via `appointment.queued` broadcast.
 */
@Component({
  selector: 'app-appointment-queue-panel',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    CardComponent,
    BadgeComponent,
    EmptyStateComponent,
    IconComponent,
  ],
  templateUrl: './appointment-queue-panel.component.html',
  styleUrls: ['./appointment-queue-panel.component.scss'],
})
export class AppointmentQueuePanelComponent implements OnInit, OnDestroy {
  private readonly reservations = inject(ReservationsService);

  readonly loading = signal(true);
  readonly rows = signal<QueueRow[]>([]);
  readonly selectedDay = signal<string>(this.todayIso());

  private pollHandle: any = null;
  readonly dayOptions = [
    { value: this.todayIso(), label: 'Hoy' },
  ];

  readonly queueSize = computed(() => this.rows().length);
  readonly topEntry = computed(() => this.rows()[0] ?? null);

  ngOnInit(): void {
    this.refresh();
    // 30s polling — the listener writes to the queue but polling is the
    // safe fallback for staff who don't have SSE running.
    this.pollHandle = setInterval(() => this.refresh(), 30_000);
  }

  ngOnDestroy(): void {
    if (this.pollHandle) clearInterval(this.pollHandle);
  }

  refresh(): void {
    this.loading.set(true);
    this.reservations.getQueue(this.selectedDay()).subscribe({
      next: (entries) => {
        this.rows.set(entries.map((e) => this.enrich(e)));
        this.loading.set(false);
      },
      error: () => {
        this.rows.set([]);
        this.loading.set(false);
      },
    });
  }

  /**
   * Mark the next customer in line as `attending` (the staff is calling
   * them to the chair). Backend fires `appointment.queued` notification
   * and the queue reorders.
   */
  promote(row: QueueRow): void {
    this.reservations.markAttending(row.booking_id).subscribe({
      next: () => this.refresh(),
    });
  }

  /**
   * Refresh-on-demand button. Useful when the staff manually re-orders
   * (priority override) and wants to see the effect immediately.
   */
  manualRefresh(): void {
    this.refresh();
  }

  private enrich(entry: QueueEntry): QueueRow {
    const minutes = Math.round(entry.score / 60_000);
    let label = '';
    if (minutes === 0) label = 'A tiempo';
    else if (minutes < 0 || entry.arrival_at > entry.target_time) {
      label = `${Math.abs(minutes)} min tarde`;
    } else {
      label = `${minutes} min antes`;
    }
    return {
      ...entry,
      score_label: label,
      in_queue: true,
    };
  }

  private todayIso(): string {
    return new Date().toISOString().split('T')[0];
  }
}