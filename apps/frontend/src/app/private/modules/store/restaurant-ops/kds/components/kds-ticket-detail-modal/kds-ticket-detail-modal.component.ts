import {
  Component,
  ChangeDetectionStrategy,
  computed,
  effect,
  input,
  output,
  signal,
  inject,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ButtonComponent } from '../../../../../../../shared/components/button/button.component';
import { IconComponent } from '../../../../../../../shared/components/icon/icon.component';
import { BadgeComponent } from '../../../../../../../shared/components/badge/badge.component';
import { ToastService } from '../../../../../../../shared/components/toast/toast.service';
import { ModalComponent } from '../../../../../../../shared/components/modal/modal.component';
import { KitchenTicket } from '../../interfaces';
import { KitchenTicketsService } from '../../services/kitchen-tickets.service';
import { RecipesService } from '../../../recipes/services/recipes.service';
import { Recipe } from '../../../recipes/interfaces';

interface RecipeLoadState {
  status: 'idle' | 'loading' | 'ok' | 'missing' | 'error';
  recipe?: Recipe;
  errorCode?: string;
}

/**
 * KdsTicketDetailModal (Restaurant Suite — Fase K Gap 4)
 *
 * Opens on click of a KDS card and shows:
 *  - the order header (number, table, status, fired_at, elapsed).
 *  - the ticket items with their quantities, names, notes, and
 *    preparation time.
 *  - the active recipe for each item (via `RecipesService.getByProduct`),
 *    with graceful degradation to "Receta no disponible" on 403/404
 *    (we never block the modal on a missing recipe).
 *  - replica of the KDS board actions (Start / Ready / Deliver /
 *    Cancel) that re-emit to the parent handlers so the SSE stream
 *    keeps the source of truth consistent.
 *
 * The modal is "live": it consumes the SAME `ticket` input as the
 * card, so any SSE event on the board updates the modal in real
 * time (the parent's `selectedTicket()` is a `computed` over
 * `tickets()` by id).
 */
@Component({
  selector: 'app-kds-ticket-detail-modal',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, ModalComponent, ButtonComponent, IconComponent, BadgeComponent],
  templateUrl: './kds-ticket-detail-modal.component.html',
  styleUrl: './kds-ticket-detail-modal.component.scss',
})
export class KdsTicketDetailModalComponent {
  readonly isOpen = input<boolean>(false);
  readonly ticket = input<KitchenTicket | null>(null);
  readonly isMutating = input<boolean>(false);

  /** Re-emit actions back to the board so the SSE pipeline stays in charge. */
  readonly startClicked = output<KitchenTicket>();
  readonly readyClicked = output<KitchenTicket>();
  readonly deliverClicked = output<KitchenTicket>();
  readonly cancelClicked = output<KitchenTicket>();

  /** Hide actions when the card itself wouldn't expose them either. */
  readonly showDelivered = input<boolean>(true);

  private readonly recipesService = inject(RecipesService);
  private readonly ticketsService = inject(KitchenTicketsService);
  private readonly toast = inject(ToastService);

  /** Cache of recipe loads keyed by `product_id` to avoid hammering the API. */
  private readonly recipeCache = new Map<number, RecipeLoadState>();
  readonly recipeStates = signal<Record<number, RecipeLoadState>>({});

  readonly ticketDisplay = computed(() => this.ticket());

  readonly statusLabel = computed(() => {
    const t = this.ticketDisplay();
    return t ? KitchenTicketsService.statusLabel(t.status) : '';
  });

  readonly statusVariant = computed<
    'success' | 'neutral' | 'warning' | 'error' | 'info' | 'primary'
  >(() => {
    const status = this.ticketDisplay()?.status;
    switch (status) {
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
      default:
        return 'neutral';
    }
  });

  readonly isTerminal = computed(() => {
    const s = this.ticketDisplay()?.status;
    return s === 'delivered' || s === 'cancelled';
  });

  readonly elapsedLabel = computed(() => {
    const t = this.ticketDisplay();
    if (!t?.fired_at) return '—';
    const fired = t.fired_at instanceof Date ? t.fired_at : new Date(t.fired_at);
    if (Number.isNaN(fired.getTime())) return '—';
    const sec = Math.max(0, Math.floor((Date.now() - fired.getTime()) / 1000));
    const mm = String(Math.floor(sec / 60)).padStart(2, '0');
    const ss = String(sec % 60).padStart(2, '0');
    return `${mm}:${ss}`;
  });

  constructor() {
    // Whenever the ticket changes, refetch the recipes for the new
    // (or newly-added) products. Cache by product_id so re-firing
    // the same dish is instant.
    effect(() => {
      const t = this.ticket();
      if (!t) return;
      const productIds = (t.items ?? [])
        .map((it) => it.product_id)
        .filter((id): id is number => typeof id === 'number');
      for (const pid of productIds) {
        if (this.recipeCache.has(pid)) continue;
        this.loadRecipe(pid);
      }
      // Sync the local signal with the cache.
      this.recipeStates.set(this.snapshotCache(productIds));
    });
  }

  private loadRecipe(productId: number): void {
    this.recipeCache.set(productId, { status: 'loading' });
    this.recipesService
      .getByProduct(productId)
      .pipe(takeUntilDestroyed())
      .subscribe({
        next: (recipe) => {
          this.recipeCache.set(productId, { status: 'ok', recipe });
          this.publishCache();
        },
        error: (err: any) => {
          const code = err?.error?.error?.code ?? err?.code;
          // 403/404 → graceful degradation ("receta no disponible")
          if (
            code === 'MENU_NOT_FOUND' ||
            code === 'RECIPE_NOT_FOUND' ||
            code === 'FORBIDDEN' ||
            err?.status === 403 ||
            err?.status === 404
          ) {
            this.recipeCache.set(productId, { status: 'missing' });
          } else {
            this.recipeCache.set(productId, {
              status: 'error',
              errorCode: code ?? 'UNKNOWN',
            });
            this.toast.warning(
              'No se pudo cargar la receta; mostrando detalles básicos.',
            );
          }
          this.publishCache();
        },
      });
  }

  private publishCache(): void {
    const ids = Array.from(this.recipeCache.keys());
    this.recipeStates.set(this.snapshotCache(ids));
  }

  private snapshotCache(productIds: number[]): Record<number, RecipeLoadState> {
    const out: Record<number, RecipeLoadState> = {};
    for (const id of productIds) {
      const state = this.recipeCache.get(id);
      if (state) out[id] = state;
    }
    return out;
  }

  recipeStateFor(productId: number | null | undefined): RecipeLoadState {
    if (!productId) return { status: 'missing' };
    return this.recipeStates()[productId] ?? { status: 'idle' };
  }

  onStart(): void {
    const t = this.ticketDisplay();
    if (t) this.startClicked.emit(t);
  }
  onReady(): void {
    const t = this.ticketDisplay();
    if (t) this.readyClicked.emit(t);
  }
  onDeliver(): void {
    const t = this.ticketDisplay();
    if (t) this.deliverClicked.emit(t);
  }
  onCancel(): void {
    const t = this.ticketDisplay();
    if (t) this.cancelClicked.emit(t);
  }
}
