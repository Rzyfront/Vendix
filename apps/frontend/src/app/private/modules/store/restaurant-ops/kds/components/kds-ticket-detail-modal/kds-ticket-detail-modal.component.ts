import {
  Component,
  ChangeDetectionStrategy,
  computed,
  DestroyRef,
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
import {
  itemHasActiveRecipe,
  KitchenTicket,
  KitchenTicketItem,
} from '../../interfaces';
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
  /**
   * Reversa al paso anterior — disponible SOLO en este modal (nunca en
   * las cards del board). El board pide confirmación y delega en
   * `KitchenTicketsService.revert`.
   */
  readonly revertClicked = output<KitchenTicket>();
  /**
   * "Crear receta" para un plato sin receta — re-emitido al board, que
   * deep-linkea a `recipes/new?product_id=…`. Mismo CTA que la card.
   */
  readonly createRecipeClicked = output<KitchenTicketItem>();
  /** Cierre del modal (X / backdrop / Escape) propagado al board. */
  readonly closed = output<void>();

  /** Hide actions when the card itself wouldn't expose them either. */
  readonly showDelivered = input<boolean>(true);

  private readonly recipesService = inject(RecipesService);
  private readonly ticketsService = inject(KitchenTicketsService);
  private readonly toast = inject(ToastService);
  // Captured in the injection context (field initializer) so `loadRecipe`
  // — invoked from inside the constructor `effect`, OUTSIDE the injection
  // context — can tie its subscription to THIS component's lifecycle.
  // Calling `takeUntilDestroyed()` with no arg outside an injection context
  // resolves the wrong destroy scope and cuts the HTTP stream before it can
  // emit `next`/`error`, leaving every dish WITH a recipe stuck on
  // "Cargando receta…" forever (no-arg form was the lone outlier vs the
  // 1400+ `takeUntilDestroyed(this.destroyRef)` call sites in the repo).
  private readonly destroyRef = inject(DestroyRef);

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

  /**
   * Mismo bloqueo que la card: el ticket solo es iniciable si TODOS los
   * platos tienen receta activa (espejo del guard backend
   * `KITCHEN_TICKET_NO_RECIPE`). El modal deshabilita "Iniciar" en
   * consecuencia.
   */
  readonly canStart = computed(() =>
    (this.ticketDisplay()?.items ?? []).every((it) => itemHasActiveRecipe(it)),
  );

  /** Per-dish recipe presence — drives the "Crear receta" CTA in the modal. */
  itemHasRecipe(item: KitchenTicketItem): boolean {
    return itemHasActiveRecipe(item);
  }

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

  /**
   * Un ticket es reversible desde cualquier estado distinto de
   * `pending` (que es el estado inicial y no tiene paso anterior).
   * Es decir: in_preparation / ready / delivered / cancelled SÍ;
   * pending y sin-ticket NO.
   */
  readonly canRevert = computed(() => {
    const s = this.ticketDisplay()?.status;
    return s != null && s !== 'pending';
  });

  /**
   * Etiqueta legible del estado DESTINO al revertir (paso anterior).
   *  - in_preparation → 'Pendiente'
   *  - ready          → 'En preparación'
   *  - delivered      → 'Listo'
   *  - cancelled      → 'Listo'
   */
  readonly previousStateLabel = computed(() => {
    const s = this.ticketDisplay()?.status;
    switch (s) {
      case 'in_preparation':
        return 'Pendiente';
      case 'ready':
        return 'En preparación';
      case 'delivered':
        return 'Listo';
      case 'cancelled':
        return 'Listo';
      default:
        return '';
    }
  });

  constructor() {
    // Whenever the ticket changes, refetch the recipes for the new
    // (or newly-added) products. Cache by product_id so re-firing
    // the same dish is instant.
    effect(() => {
      const t = this.ticket();
      if (!t) return;
      for (const item of t.items ?? []) {
        const pid = item.product_id;
        if (typeof pid !== 'number') continue;
        if (this.recipeCache.has(pid)) continue;
        // Short-circuit: si el payload ya indica que el plato no tiene receta
        // activa (`product.recipe` ausente o `is_active === false`), lo
        // marcamos 'missing' sin pegar a la API — evita un fetch que de todas
        // formas degradaría a "no disponible".
        if (!itemHasActiveRecipe(item)) {
          this.recipeCache.set(pid, { status: 'missing' });
          continue;
        }
        this.loadRecipe(pid);
      }
      // Sync the local signal with the cache.
      this.publishCache();
    });
  }

  private loadRecipe(productId: number): void {
    this.recipeCache.set(productId, { status: 'loading' });
    this.recipesService
      .getByProduct(productId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (recipe) => {
          this.recipeCache.set(productId, { status: 'ok', recipe });
          this.publishCache();
        },
        error: (err: any) => {
          // Alineado con `KitchenTicketsService.handleMutationError`: el
          // envelope de error de Vendix expone el código en
          // `error.error_code` (o `error.code`). El parseo anterior
          // (`err.error.error.code`, doble `.error`) nunca acertaba, así que
          // recetas reales caían a 'error'/'missing'. Ahora se lee bien.
          const code =
            err?.error?.error_code ?? err?.error?.code ?? err?.code;
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
  onRevert(): void {
    const t = this.ticketDisplay();
    if (t) this.revertClicked.emit(t);
  }
  onCreateRecipe(item: KitchenTicketItem): void {
    this.createRecipeClicked.emit(item);
  }

  /** Emite el cierre al board para que resetee `selectedTicketId`. */
  onClose(): void {
    this.closed.emit();
  }
}
