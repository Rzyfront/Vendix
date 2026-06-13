import {
  Component,
  computed,
  DestroyRef,
  inject,
  OnDestroy,
  OnInit,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  CardComponent,
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
  KitchenTicketStatus,
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
 * Renders four columns (Pending, In Preparation, Ready, Delivered) and
 * subscribes to the SSE stream via `KdsSseService`. The page:
 *  - groups tickets by status (computed signals) so the template can
 *    render a column per state without re-iterating the array;
 *  - delegates the action buttons on each card to its own methods
 *    (`startTicket`, `markTicketReady`, `markTicketDelivered`,
 *    `cancelTicket`) which call the HTTP service and let the SSE
 *    stream reconcile the final state — no optimistic patching here.
 *  - exposes a small connection indicator + reconnect counter so
 *    kitchen staff see when the board is offline.
 */
@Component({
  selector: 'app-kds-board-page',
  standalone: true,
  imports: [
    CommonModule,
    StickyHeaderComponent,
    CardComponent,
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
  readonly deliveredTickets = computed(() =>
    this.tickets().filter(
      (t) => t.status === 'delivered' || t.status === 'cancelled',
    ),
  );

  readonly columnCounts = computed(() => ({
    pending: this.pendingTickets().length,
    in_preparation: this.inPreparationTickets().length,
    ready: this.readyTickets().length,
    delivered: this.deliveredTickets().length,
  }));

  /** Track which ticket ids are mid-mutation so cards can disable buttons. */
  readonly mutatingIds = signal<Set<number>>(new Set());

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

  ngOnInit(): void {
    this.kdsSse.connect(120);
  }

  ngOnDestroy(): void {
    this.kdsSse.disconnect();
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
