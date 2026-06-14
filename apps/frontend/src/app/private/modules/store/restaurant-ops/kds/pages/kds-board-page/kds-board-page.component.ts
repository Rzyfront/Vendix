import {
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  OnDestroy,
  OnInit,
  signal,
  untracked,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  DialogService,
  StickyHeaderComponent,
  ToastService,
} from '../../../../../../../shared/components/index';
import { IconComponent } from '../../../../../../../shared/components/icon/icon.component';
import { BadgeComponent } from '../../../../../../../shared/components/badge/badge.component';

import {
  KDS_COLUMNS,
  KdsColumn,
  KitchenTicket,
} from '../../interfaces';
import {
  KdsConnectionState,
  KdsSseService,
  KitchenTicketsService,
} from '../../services';
import { KdsTicketCardComponent } from '../../components/kds-ticket-card/kds-ticket-card.component';

/**
 * KDS Board — real-time kitchen display.
 *
 * Renders five columns (Pending, In Preparation, Ready, Delivered,
 * Cancelled) and subscribes to the SSE stream via `KdsSseService`.
 * Delivered (green) and Cancelled (red) are kept as separate columns so
 * the kitchen never confuses an order that left with one that was
 * voided. The page:
 *  - groups tickets by status (computed signals) so the template can
 *    render a column per state without re-iterating the array;
 *  - delegates the action buttons on each card to its own methods
 *    (`startTicket`, `markTicketReady`, `markTicketDelivered`,
 *    `cancelTicket`) which call the HTTP service and let the SSE
 *    stream reconcile the final state — no optimistic patching here.
 *  - owns a SINGLE 1s `now` ticker shared with every card (instead of
 *    one timer per card) and pushes it down as an input;
 *  - shows a connecting loader before the first snapshot, surfaces a
 *    connection indicator + reconnect counter, and toasts when the
 *    stream recovers from a failure.
 */
@Component({
  selector: 'app-kds-board-page',
  standalone: true,
  imports: [
    CommonModule,
    StickyHeaderComponent,
    IconComponent,
    BadgeComponent,
    KdsTicketCardComponent,
  ],
  templateUrl: './kds-board-page.component.html',
  styleUrl: './kds-board-page.component.scss',
})
export class KdsBoardPageComponent implements OnInit, OnDestroy {
  private readonly kdsSse = inject(KdsSseService);
  private readonly ticketsService = inject(KitchenTicketsService);
  private readonly toastService = inject(ToastService);
  private readonly dialogService = inject(DialogService);
  private readonly destroyRef = inject(DestroyRef);

  readonly columns = KDS_COLUMNS;
  readonly tickets = this.kdsSse.tickets;
  readonly connectionState = this.kdsSse.connectionState;
  readonly lastReconnect = this.kdsSse.lastReconnect;
  readonly lastError = this.kdsSse.lastError;

  readonly pendingTickets = computed(() =>
    this.tickets().filter((t) => t.status === 'pending'),
  );
  readonly inPreparationTickets = computed(() =>
    this.tickets().filter((t) => t.status === 'in_preparation'),
  );
  readonly readyTickets = computed(() =>
    this.tickets().filter((t) => t.status === 'ready'),
  );
  /** Only delivered tickets — kept separate from cancelled (green column). */
  readonly deliveredTickets = computed(() =>
    this.tickets().filter((t) => t.status === 'delivered'),
  );
  /** Only cancelled/voided tickets (red column). */
  readonly cancelledTickets = computed(() =>
    this.tickets().filter((t) => t.status === 'cancelled'),
  );

  readonly columnCounts = computed<Record<KdsColumn, number>>(() => ({
    pending: this.pendingTickets().length,
    in_preparation: this.inPreparationTickets().length,
    ready: this.readyTickets().length,
    delivered: this.deliveredTickets().length,
    cancelled: this.cancelledTickets().length,
  }));

  /** Track which ticket ids are mid-mutation so cards can disable buttons. */
  readonly mutatingIds = signal<Set<number>>(new Set());

  /**
   * Single shared 1s ticker pushed down to every card as `[now]`.
   * One timer for the whole board instead of one `setInterval` per card.
   */
  readonly now = signal(Date.now());
  private tickHandle: ReturnType<typeof setInterval> | null = null;

  /**
   * Previous connection state, used by the reconnection effect to detect
   * the failure → open transition without firing on the initial connect.
   */
  private readonly prevState = signal<KdsConnectionState>('idle');

  /** Connection indicator label + color for the header chip. */
  readonly connectionLabel = computed(() => {
    switch (this.connectionState()) {
      case 'idle':
        return 'Inactivo';
      case 'connecting':
        return 'Conectando…';
      case 'open':
        return 'En vivo';
      case 'reconnecting':
        return 'Reconectando…';
      case 'error':
        return 'Sin conexión';
      case 'closed':
        return 'Cerrado';
    }
  });

  readonly connectionVariant = computed<'success' | 'warning' | 'error' | 'neutral'>(() => {
    switch (this.connectionState()) {
      case 'open':
        return 'success';
      case 'connecting':
      case 'reconnecting':
        return 'warning';
      case 'error':
      case 'closed':
        return 'error';
      default:
        return 'neutral';
    }
  });

  /**
   * True while we are establishing the very first connection and have no
   * tickets yet — used to show a "Conectando a cocina…" loader instead of
   * a blank board with empty columns.
   */
  readonly showInitialLoading = computed(() => {
    const s = this.connectionState();
    return (s === 'idle' || s === 'connecting') && this.tickets().length === 0;
  });

  constructor() {
    // Toast when the stream recovers from a failure. We track the previous
    // state in a signal and only fire on (error|reconnecting) → open, never
    // on the initial idle/connecting → open handshake.
    effect(() => {
      const current = this.connectionState();
      // Read + write prevState OUTSIDE tracking so this effect only
      // re-runs when connectionState changes — never because of its own
      // write (which would otherwise loop).
      const previous = untracked(this.prevState);
      if (
        current === 'open' &&
        (previous === 'error' || previous === 'reconnecting')
      ) {
        this.toastService.success('Conexión restablecida', 'Cocina en vivo');
      }
      untracked(() => this.prevState.set(current));
    });
  }

  ngOnInit(): void {
    this.kdsSse.connect(120);
    this.tickHandle = setInterval(() => this.now.set(Date.now()), 1000);
  }

  ngOnDestroy(): void {
    this.kdsSse.disconnect();
    if (this.tickHandle) {
      clearInterval(this.tickHandle);
      this.tickHandle = null;
    }
  }

  refresh(): void {
    this.kdsSse.reset();
    this.kdsSse.connect(120);
  }

  // ─── helpers for the template ──────────────────────────────────────

  ticketsForColumn(column: KdsColumn): KitchenTicket[] {
    switch (column) {
      case 'pending':
        return this.pendingTickets();
      case 'in_preparation':
        return this.inPreparationTickets();
      case 'ready':
        return this.readyTickets();
      case 'delivered':
        return this.deliveredTickets();
      case 'cancelled':
        return this.cancelledTickets();
    }
  }

  columnTitle(column: KdsColumn): string {
    switch (column) {
      case 'pending':
        return 'Pendientes';
      case 'in_preparation':
        return 'En preparación';
      case 'ready':
        return 'Listos';
      case 'delivered':
        return 'Entregados';
      case 'cancelled':
        return 'Cancelados';
    }
  }

  /** Badge color per column header. */
  columnBadgeVariant(
    column: KdsColumn,
  ): 'success' | 'warning' | 'error' | 'neutral' | 'info' {
    switch (column) {
      case 'ready':
      case 'delivered':
        return 'success';
      case 'in_preparation':
        return 'warning';
      case 'cancelled':
        return 'error';
      case 'pending':
        return 'neutral';
    }
  }

  isMutating(id: number): boolean {
    return this.mutatingIds().has(id);
  }

  isReconnecting(): boolean {
    const s = this.connectionState();
    return s === 'reconnecting' || s === 'connecting';
  }

  // ─── ticket mutations ──────────────────────────────────────────────

  startTicket(ticket: KitchenTicket): void {
    this.runMutation(ticket.id, () => this.ticketsService.start(ticket.id));
  }

  markTicketReady(ticket: KitchenTicket): void {
    this.runMutation(ticket.id, () => this.ticketsService.markReady(ticket.id));
  }

  markTicketDelivered(ticket: KitchenTicket): void {
    this.runMutation(ticket.id, () =>
      this.ticketsService.markDelivered(ticket.id),
    );
  }

  cancelTicket(ticket: KitchenTicket): void {
    this.dialogService
      .confirm({
        title: 'Cancelar ticket',
        message: `¿Cancelar el ticket #${ticket.id}? Esta acción no se puede deshacer.`,
        confirmText: 'Cancelar ticket',
        cancelText: 'Volver',
        confirmVariant: 'danger',
      })
      .then((confirmed) => {
        if (!confirmed) return;
        this.runMutation(ticket.id, () =>
          this.ticketsService.cancel(ticket.id),
        );
      });
  }

  private runMutation(
    ticketId: number,
    obsFactory: () => import('rxjs').Observable<KitchenTicket>,
  ): void {
    this.addMutating(ticketId);
    obsFactory()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          // The SSE stream will reconcile the cache. We just need to
          // stop showing the spinner. We optimistically clear here in
          // case the SSE event is slow (keystroke feels responsive).
          this.removeMutating(ticketId);
        },
        error: (err: unknown) => {
          this.removeMutating(ticketId);
          this.toastService.error(
            typeof err === 'string' ? err : 'Error al actualizar el ticket',
          );
        },
      });
  }

  private addMutating(id: number): void {
    this.mutatingIds.update((s) => {
      const next = new Set(s);
      next.add(id);
      return next;
    });
  }

  private removeMutating(id: number): void {
    this.mutatingIds.update((s) => {
      const next = new Set(s);
      next.delete(id);
      return next;
    });
  }

  trackByTicketId(_index: number, ticket: KitchenTicket): number {
    return ticket.id;
  }
}
