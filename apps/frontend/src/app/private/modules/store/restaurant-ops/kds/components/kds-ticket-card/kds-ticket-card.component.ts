import {
  Component,
  computed,
  input,
  output,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ButtonComponent } from '../../../../../../../shared/components/button/button.component';
import { BadgeComponent } from '../../../../../../../shared/components/badge/badge.component';
import { IconComponent } from '../../../../../../../shared/components/icon/icon.component';
import { KitchenTicketsService } from '../../services/kitchen-tickets.service';
import {
  KitchenTicket,
  KitchenTicketStatus,
} from '../../interfaces';

/**
 * Single KDS ticket card — shows the order id, optional table id,
 * a countdown since `fired_at`, the items list with notes, and the
 * state-aware action buttons (Start / Ready / Delivered / Cancel).
 *
 * Action buttons emit events to the parent; the page owns the actual
 * service call so the SSE stream can race-free update the cache on
 * completion. The card itself only mutates its own `isMutating` signal
 * to disable buttons while the parent is processing.
 *
 * The elapsed-time clock is driven by a single shared `now` ticker owned
 * by the board (passed in via `[now]`) — there is NO per-card timer, so
 * a board with dozens of tickets still runs exactly one `setInterval`.
 */
@Component({
  selector: 'app-kds-ticket-card',
  standalone: true,
  imports: [CommonModule, ButtonComponent, BadgeComponent, IconComponent],
  templateUrl: './kds-ticket-card.component.html',
  styleUrl: './kds-ticket-card.component.scss',
})
export class KdsTicketCardComponent {
  readonly ticket = input.required<KitchenTicket>();
  readonly isMutating = input<boolean>(false);
  readonly showDelivered = input<boolean>(true);
  /** Shared millisecond clock pushed down by the board's single ticker. */
  readonly now = input<number>(Date.now());

  readonly startClicked = output<KitchenTicket>();
  readonly readyClicked = output<KitchenTicket>();
  readonly deliverClicked = output<KitchenTicket>();
  readonly cancelClicked = output<KitchenTicket>();

  readonly elapsedSeconds = computed(() => {
    const fired = this.toDate(this.ticket().fired_at);
    if (!fired) return 0;
    return Math.max(0, Math.floor((this.now() - fired.getTime()) / 1000));
  });

  readonly elapsedLabel = computed(() => this.formatElapsed(this.elapsedSeconds()));

  readonly isUrgent = computed(() => this.elapsedSeconds() >= 600);

  readonly statusLabel = computed(() =>
    KitchenTicketsService.statusLabel(this.ticket().status),
  );

  readonly statusBadgeVariant = computed<'success' | 'neutral' | 'warning' | 'error' | 'info' | 'primary'>(() => {
    switch (this.ticket().status) {
      case 'pending':
        return 'neutral';
      case 'in_preparation':
        return 'warning';
      case 'ready':
        return 'success';
      case 'delivered':
        return 'info';
      case 'cancelled':
        return 'error';
    }
  });

  /** True while the ticket is being cooked — used to emphasize the badge. */
  readonly isInPreparation = computed(
    () => this.ticket().status === 'in_preparation',
  );

  onStart(): void {
    if (this.isMutating()) return;
    this.startClicked.emit(this.ticket());
  }

  onReady(): void {
    if (this.isMutating()) return;
    this.readyClicked.emit(this.ticket());
  }

  onDeliver(): void {
    if (this.isMutating()) return;
    this.deliverClicked.emit(this.ticket());
  }

  onCancel(): void {
    if (this.isMutating()) return;
    this.cancelClicked.emit(this.ticket());
  }

  trackByItemId(_index: number, item: { id: number }): number {
    return item.id;
  }

  isTerminal(status: KitchenTicketStatus): boolean {
    return status === 'delivered' || status === 'cancelled';
  }

  private toDate(value: string | Date | null | undefined): Date | null {
    if (!value) return null;
    if (value instanceof Date) return value;
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  private formatElapsed(totalSeconds: number): string {
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    const mm = String(minutes).padStart(2, '0');
    const ss = String(seconds).padStart(2, '0');
    return `${mm}:${ss}`;
  }
}
