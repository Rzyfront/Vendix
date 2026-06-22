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
import { AlertBannerComponent } from '../../../../../../../shared/components/alert-banner/alert-banner.component';
import { KitchenTicketsService } from '../../services/kitchen-tickets.service';
import {
  itemHasActiveRecipe,
  KitchenTicket,
  KitchenTicketItem,
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
  imports: [CommonModule, ButtonComponent, BadgeComponent, IconComponent, AlertBannerComponent],
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
  /**
   * Emitted from the per-dish "Crear receta" CTA shown on items without an
   * active recipe. The board deep-links to `recipes/new?product_id=…` so the
   * operator can attach a recipe to the exact dish that is blocking the
   * ticket. Stops propagation in the template so it never opens the modal.
   */
  readonly createRecipeClicked = output<KitchenTicketItem>();
  /**
   * Restaurant Suite — Fase K Gap 4: emitted on click of the card
   * body (NOT the actions footer). The board opens the detail
   * modal in response. Action buttons stop propagation so they
   * never trigger the modal open.
   */
  readonly cardClicked = output<KitchenTicket>();

  readonly elapsedSeconds = computed(() => {
    const fired = this.toDate(this.ticket().fired_at);
    if (!fired) return 0;
    return Math.max(0, Math.floor((this.now() - fired.getTime()) / 1000));
  });

  readonly elapsedLabel = computed(() => this.formatElapsed(this.elapsedSeconds()));

  /**
   * Restaurant Suite — Fase K Gap 5: smallest `preparation_time_minutes`
   * across the ticket's items. Items without a value contribute the
   * default of 10 minutes (per spec: "platos sin tiempo usan el
   * default 10 min"). A value of 0 or negative is treated as the
   * default too.
   */
  readonly smallestPrepMinutes = computed<number>(() => {
    const DEFAULT_MIN = 10;
    const items = this.ticket()?.items ?? [];
    if (items.length === 0) return DEFAULT_MIN;
    let smallest = Number.POSITIVE_INFINITY;
    for (const item of items) {
      const raw = item.product?.preparation_time_minutes;
      const v = Number(raw ?? 0);
      const minutes = v > 0 ? v : DEFAULT_MIN;
      if (minutes < smallest) smallest = minutes;
    }
    return Number.isFinite(smallest) ? smallest : DEFAULT_MIN;
  });

  /** Warning tier: `elapsed >= smallestPrepMinutes`. */
  readonly isWarning = computed(() => {
    if (this.isTerminal(this.ticket().status)) return false;
    return this.elapsedSeconds() >= this.smallestPrepMinutes() * 60;
  });

  /** Danger tier: `elapsed >= smallestPrepMinutes + 5 min`. */
  readonly isDanger = computed(() => {
    if (this.isTerminal(this.ticket().status)) return false;
    return (
      this.elapsedSeconds() >=
      (this.smallestPrepMinutes() + 5) * 60
    );
  });

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

  // ─── Restaurant Suite — recipe readiness (per dish, blocking) ──────
  /**
   * True when at least one dish on the ticket has no active recipe. The
   * backend `startPreparation` guard rejects the `in_preparation`
   * transition for such tickets (`KITCHEN_TICKET_NO_RECIPE`); we surface
   * the block proactively here instead of waiting for the failed click.
   */
  readonly hasRecipeLessItem = computed(() =>
    (this.ticket().items ?? []).some((it) => !itemHasActiveRecipe(it)),
  );

  /** A ticket is startable only when every dish has an active recipe. */
  readonly canStart = computed(() => !this.hasRecipeLessItem());

  /** Per-dish recipe presence — drives the "Sin receta" badge + CTA. */
  itemHasRecipe(item: KitchenTicketItem): boolean {
    return itemHasActiveRecipe(item);
  }

  // ─── Restaurant Suite — per-dish urgency ───────────────────────────
  /**
   * Per-dish preparation time in minutes (product-level; the ticket item
   * carries no variant FK). Missing/0/negative ⇒ default 10 min, matching
   * the ticket-level `smallestPrepMinutes` rule.
   */
  itemPrepMinutes(item: KitchenTicketItem): number {
    const DEFAULT_MIN = 10;
    const v = Number(item.product?.preparation_time_minutes ?? 0);
    return v > 0 ? v : DEFAULT_MIN;
  }

  /**
   * Per-dish urgency tier against the SHARED elapsed clock. All items are
   * fired at the same instant, so dishes with a shorter prep time cross the
   * threshold sooner — a 2-min dish alerts while a 10-min dish is still calm.
   * Suppressed in terminal states.
   */
  itemUrgency(item: KitchenTicketItem): 'none' | 'warning' | 'danger' {
    if (this.isTerminal(this.ticket().status)) return 'none';
    const prep = this.itemPrepMinutes(item);
    const elapsed = this.elapsedSeconds();
    if (elapsed >= (prep + 5) * 60) return 'danger';
    if (elapsed >= prep * 60) return 'warning';
    return 'none';
  }

  onCreateRecipe(item: KitchenTicketItem): void {
    this.createRecipeClicked.emit(item);
  }

  onCardClick(): void {
    this.cardClicked.emit(this.ticket());
  }

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
