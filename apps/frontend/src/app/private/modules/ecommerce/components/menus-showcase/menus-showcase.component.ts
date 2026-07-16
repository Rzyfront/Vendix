import {
  Component,
  ChangeDetectionStrategy,
  DestroyRef,
  OnInit,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { Router, RouterModule } from '@angular/router';
import { NgTemplateOutlet } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import {
  CatalogService,
  EcommerceProduct,
  MenuItem,
  MenuNextAvailable,
  PublicMenu,
} from '../../services/catalog.service';
import {
  formatNextAvailableDetailed,
  NextAvailableDetailed,
} from '../../services/next-available.util';
import { NextAvailableNoticeComponent } from '../next-available-notice';
import { CartService } from '../../services/cart.service';
import { WishlistService } from '../../services/wishlist.service';
import { TableContextService } from '../../services/table-context.service';
import { parseApiError } from '../../../../../core/utils/parse-api-error';
import { CurrencyPipe } from '../../../../../shared/pipes/currency';
import { ButtonComponent } from '../../../../../shared/components/button/button.component';
import { BadgeComponent } from '../../../../../shared/components/badge/badge.component';
import { IconComponent } from '../../../../../shared/components/icon/icon.component';
import { ToastService } from '../../../../../shared/components/toast/toast.service';

/**
 * Compact "Cartas" summary rendered on the storefront home. Fully self-gating:
 * the public `/ecommerce/catalog/menus` endpoint returns no menus for
 * non-restaurant stores, so the component renders nothing in that case.
 *
 * Renders ONE block per available carta (grouped by menu, not a flat list),
 * each capped at `limit` dishes. When no carta is available right now, it
 * renders exactly one fallback block: the carta with the globally-smallest
 * `next_available` delta (same formula as backend `nextAvailableWindow`),
 * with its dishes listed and the Agregar button disabled.
 *
 * Off-schedule dish filtering is FIXED (always `is_available_now`); the old
 * `availabilityDisplay` knob is gone — it only governs `/cartas` now.
 */
interface CartaBlock {
  menu: PublicMenu;
  dishes: MenuItem[];
}

@Component({
  selector: 'app-menus-showcase',
  standalone: true,
  imports: [
    RouterModule,
    NgTemplateOutlet,
    CurrencyPipe,
    ButtonComponent,
    BadgeComponent,
    IconComponent,
    NextAvailableNoticeComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (renderCartas().length || fallbackMenu()) {
      <section class="menus-section">
        <div class="section-header">
          <h2>{{ title() || 'Nuestras cartas' }}</h2>
          <p class="subtitle">
            {{ subtitle() || 'Descubre los platos disponibles según el horario' }}
          </p>
        </div>

        <!-- Shared dish card template (used by available + fallback blocks).
             Visualmente alineado a <app-product-card>: imagen 1:1 con badges
             overlay + botón quick-add flotante, nombre y precio. Sin stepper de
             cantidad — el quick-add agrega qty=1 (o enruta a detalle si el
             plato tiene variantes, igual que el product-card). -->
        <ng-template #dishCard let-dish="dish">
          <a
            class="dish-card"
            [class.dish-card--off]="!dish.is_available_now"
            [routerLink]="
              dish.product?.slug ? ['/products', dish.product?.slug] : null
            "
          >
            <div class="dish-image">
              @if (dish.product?.image_url) {
                <img
                  [src]="dish.product?.image_url"
                  [alt]="dish.product?.name"
                  loading="lazy"
                />
              } @else {
                <div class="dish-image__placeholder">🍽️</div>
              }

              @if (!dish.is_available_now) {
                <app-badge
                  class="dish-badge"
                  variant="warning"
                  size="sm"
                  badgeStyle="outline"
                >
                  Disponible {{ formatNext(dish.next_available) }}
                </app-badge>
                @if (nextAvailableFor(dish.next_available); as dishNext) {
                  <app-next-available-notice [next]="dishNext" />
                }
              } @else if (dish.product?.has_variants) {
                <div class="dish-variant-badge">
                  {{ dish.product?.variant_count }} variantes
                </div>
              }

              <!-- Acciones Like + Compartir (espejo de .card-actions de
                   product-card). Top-right, aparecen on-hover / focus. -->
              <div class="card-actions">
                <app-button
                  variant="ghost"
                  size="sm"
                  customClasses="action-btn"
                  [class.active]="isInWishlist(dish.product?.id)"
                  (clicked)="onWishlistClick($event, dish)"
                >
                  <app-icon slot="icon" name="heart" [size]="18" />
                </app-button>
                <app-button
                  variant="ghost"
                  size="sm"
                  customClasses="action-btn"
                  (clicked)="onShareClick($event, dish)"
                >
                  <app-icon slot="icon" name="share" [size]="18" />
                </app-button>
              </div>

              @if (dish.is_available_now) {
                <button
                  type="button"
                  class="dish-quick-btn"
                  [attr.aria-label]="
                    dish.product?.has_variants
                      ? 'Ver opciones'
                      : 'Agregar al carrito'
                  "
                  [title]="
                    dish.product?.has_variants
                      ? 'Ver opciones'
                      : 'Agregar al carrito'
                  "
                  (click)="onQuickAdd($event, dish)"
                >
                  <app-icon
                    [name]="dish.product?.has_variants ? 'eye' : 'shopping-cart'"
                    [size]="17"
                  />
                </button>
              }
            </div>
            <div class="dish-body">
              <h3 class="dish-name">{{ dish.product?.name }}</h3>
              @if (show_shipping_badge()) {
                <div class="shipping-badge">
                  <app-icon name="truck" [size]="12" />
                  <span>Envío disponible</span>
                </div>
              }
              <div class="dish-price">
                <span
                  class="price"
                  [class.sale-price]="dish.product?.is_on_sale"
                >
                  {{ dishPrice(dish) | currency }}
                </span>
                @if (dish.product?.is_on_sale) {
                  <span class="original-price">
                    {{ dish.product?.base_price | currency }}
                  </span>
                }
              </div>
            </div>
          </a>
        </ng-template>

        @if (renderCartas().length) {
          @for (carta of renderCartas(); track carta.menu.id) {
            <div class="carta-block">
              <div class="carta-header">
                <h3 class="carta-name">{{ carta.menu.name }}</h3>
                <app-badge variant="success">Disponible ahora</app-badge>
              </div>
              <div class="dishes-grid">
                @for (dish of carta.dishes; track dish.id) {
                  <ng-container
                    [ngTemplateOutlet]="dishCard"
                    [ngTemplateOutletContext]="{ dish: dish }"
                  />
                }
              </div>
              <div class="carta-cta">
                <app-button variant="outline" [routerLink]="['/cartas']">
                  Ver carta completa
                </app-button>
              </div>
            </div>
          }
        } @else if (fallbackMenu(); as fb) {
          <div class="carta-block carta-block--fallback">
            <div class="carta-header">
              <h3 class="carta-name">{{ fb.menu.name }}</h3>
              <app-badge variant="warning">
                Disponible {{ formatNext(fb.menu.next_available) }}
              </app-badge>
              @if (nextAvailableFor(fb.menu.next_available); as fbNext) {
                <app-next-available-notice [next]="fbNext" />
              }
            </div>
            <div class="dishes-grid">
              @for (dish of fb.dishes; track dish.id) {
                <ng-container
                  [ngTemplateOutlet]="dishCard"
                  [ngTemplateOutletContext]="{ dish: dish }"
                />
              }
            </div>
            <div class="carta-cta">
              <app-button variant="outline" [routerLink]="['/cartas']">
                Ver carta completa
              </app-button>
            </div>
          </div>
        }
      </section>
    }
  `,
  styles: [
    `
      .menus-section {
        padding: 0 1rem 1.25rem;
        max-width: 1200px;
        margin: 0 auto;
      }
      @media (min-width: 768px) {
        .menus-section {
          padding-bottom: 2rem;
        }
      }
      .section-header {
        text-align: center;
        margin-bottom: 1.75rem;
      }
      .section-header h2 {
        font-size: 1.75rem;
        font-weight: 700;
        margin: 0.25rem 0;
      }
      .section-header .subtitle {
        color: #6b7280;
        margin: 0;
      }
      .carta-block {
        margin-bottom: 2rem;
      }
      .carta-block:last-child {
        margin-bottom: 0;
      }
      .carta-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 0.75rem;
        margin-bottom: 1rem;
        flex-wrap: wrap;
      }
      .carta-name {
        font-size: 1.25rem;
        font-weight: 700;
        margin: 0;
      }
      .carta-cta {
        text-align: center;
        margin-top: 1rem;
      }
      /* Espejo del grid canónico del ecommerce (.products-grid del home):
         mobile-first con 2 columnas fijas en móvil, escalando en desktop, para
         que las cards de carta se comporten igual que el resto de cards. */
      .dishes-grid {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 1rem 0.75rem;
      }
      @media (min-width: 768px) {
        .dishes-grid {
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 1.5rem;
        }
      }
      @media (min-width: 1100px) {
        .dishes-grid {
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 2rem 1.75rem;
        }
      }
      @media (min-width: 1320px) {
        .dishes-grid {
          grid-template-columns: repeat(5, minmax(0, 1fr));
        }
      }

      /* --- dish-card: espejo visual de .product-card --- */
      .dish-card {
        position: relative;
        display: flex;
        flex-direction: column;
        height: 100%;
        background-color: var(--color-surface);
        border-radius: 8px;
        border: 1px solid rgba(148, 163, 184, 0.18);
        overflow: hidden;
        text-decoration: none;
        color: inherit;
        cursor: pointer;
        box-shadow: 0 1px 2px rgba(15, 23, 42, 0.035);
        -webkit-tap-highlight-color: transparent;
        transition:
          border-color 0.15s cubic-bezier(0.4, 0, 0.2, 1),
          background-color 0.15s cubic-bezier(0.4, 0, 0.2, 1),
          box-shadow 0.15s cubic-bezier(0.4, 0, 0.2, 1),
          transform 0.15s cubic-bezier(0.4, 0, 0.2, 1);
      }
      .dish-card:hover,
      .dish-card:focus-within {
        background-color: var(--color-background);
        box-shadow: 0 18px 38px -28px rgba(15, 23, 42, 0.5);
        transform: translateY(-2px);
        border-color: rgba(148, 163, 184, 0.34);
      }
      .dish-card:active {
        transform: scale(0.97);
      }
      .dish-card--off {
        opacity: 0.7;
      }

      .dish-image {
        position: relative;
        aspect-ratio: 1;
        background: var(--color-background);
        overflow: hidden;
        border-bottom: 1px solid rgba(148, 163, 184, 0.12);
      }
      .dish-image img {
        display: block;
        width: 100%;
        height: 100%;
        object-fit: cover;
        object-position: center;
        transition: transform 0.35s ease;
      }
      .dish-card:hover .dish-image img {
        transform: scale(1.025);
      }
      .dish-image__placeholder {
        width: 100%;
        height: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 3rem;
        color: var(--color-text-muted);
        background: var(--color-background);
      }

      .dish-badge {
        position: absolute;
        top: 0.55rem;
        left: 0.55rem;
        z-index: 1;
      }
      .dish-variant-badge {
        position: absolute;
        bottom: 0.58rem;
        left: 0.58rem;
        z-index: 1;
        padding: 0.24rem 0.48rem;
        border-radius: 999px;
        font-size: 10px;
        font-weight: var(--fw-semibold);
        backdrop-filter: blur(8px);
        -webkit-backdrop-filter: blur(8px);
        background: rgba(255, 255, 255, 0.88);
        color: var(--color-text-primary);
        border: 1px solid rgba(148, 163, 184, 0.24);
      }

      .dish-quick-btn {
        position: absolute;
        right: 0.6rem;
        bottom: 0.6rem;
        z-index: 2;
        width: 36px;
        height: 36px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        color: var(--color-text-primary);
        background: rgba(255, 255, 255, 0.9);
        border: 1px solid rgba(148, 163, 184, 0.24);
        border-radius: 999px;
        backdrop-filter: blur(10px);
        -webkit-backdrop-filter: blur(10px);
        box-shadow: 0 10px 22px -18px rgba(15, 23, 42, 0.42);
        cursor: pointer;
        opacity: 0;
        transform: translateY(4px);
        transition:
          opacity 0.15s ease,
          background-color 0.15s ease,
          border-color 0.15s ease,
          color 0.15s ease,
          transform 0.15s ease;
      }
      .dish-card:hover .dish-quick-btn,
      .dish-quick-btn:focus-visible {
        opacity: 1;
        transform: translateY(0);
      }
      .dish-quick-btn:hover {
        color: var(--color-primary);
        background: #ffffff;
        border-color: rgba(var(--color-primary-rgb, 59, 130, 246), 0.32);
        transform: translateY(-1px) scale(1.02);
      }
      .dish-quick-btn:focus-visible {
        outline: 2px solid rgba(var(--color-primary-rgb, 59, 130, 246), 0.42);
        outline-offset: 2px;
      }

      .dish-body {
        padding: 0.82rem 0.85rem 0.9rem;
        flex: 1;
        min-height: 0;
        display: flex;
        flex-direction: column;
        gap: 0.24rem;
      }
      .dish-name {
        font-size: var(--fs-sm);
        font-weight: 700;
        color: var(--color-text-primary);
        margin: 0;
        line-height: 1.28;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
      }
      .dish-price {
        margin-top: auto;
        padding-top: 0.28rem;
        display: flex;
        flex-wrap: wrap;
        align-items: baseline;
        gap: 0.35rem;
      }
      .dish-price .price {
        font-size: var(--fs-md);
        font-weight: var(--fw-bold);
        color: var(--color-text-primary);
      }
      .dish-price .price.sale-price {
        color: var(--color-success);
      }
      .dish-price .original-price {
        font-size: var(--fs-xs);
        color: var(--color-text-muted);
        text-decoration: line-through;
      }

      .card-actions {
        position: absolute;
        top: 0.55rem;
        right: 0.55rem;
        display: flex;
        flex-direction: column;
        gap: 0.38rem;
        z-index: 3;
        opacity: 0;
        transform: translateY(-4px);
        transition: opacity var(--transition-fast), transform var(--transition-fast);
      }
      .dish-card:hover .card-actions,
      .card-actions:focus-within {
        opacity: 1;
        transform: translateY(0);
      }
      :host ::ng-deep .action-btn {
        width: 34px !important;
        height: 34px !important;
        min-width: 34px !important;
        padding: 0 !important;
        border-radius: 50% !important;
        color: var(--color-text-secondary) !important;
        background: rgba(255, 255, 255, 0.88) !important;
        border: 1px solid rgba(148, 163, 184, 0.22) !important;
        box-shadow: 0 10px 22px -20px rgba(15, 23, 42, 0.45);
        backdrop-filter: blur(10px);
        -webkit-backdrop-filter: blur(10px);
      }
      :host ::ng-deep .action-btn:hover {
        background: #ffffff !important;
        color: var(--color-primary) !important;
      }
      :host ::ng-deep .action-btn.active {
        color: var(--color-error) !important;
        background: var(--color-error-light) !important;
      }

      .shipping-badge {
        display: inline-flex;
        align-items: center;
        align-self: flex-start;
        gap: 0.25rem;
        max-width: 100%;
        padding: 0.18rem 0.46rem;
        border-radius: 999px;
        background: rgba(var(--color-primary-rgb, 59, 130, 246), 0.08);
        color: var(--color-primary);
        font-size: 10.5px;
        font-weight: var(--fw-semibold);
        line-height: 1.1;
      }
      .shipping-badge span {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      @media (max-width: 480px) {
        .dish-quick-btn {
          opacity: 1;
          transform: translateY(0);
        }
        .card-actions {
          top: 0.45rem;
          right: 0.45rem;
          gap: 0.3rem;
          opacity: 1;
          transform: none;
        }
      }
    `,
  ],
})
export class MenusShowcaseComponent implements OnInit {
  readonly title = input<string>('');
  readonly subtitle = input<string>('');
  /** Tope de platos por carta en el teaser del home. */
  readonly limit = input<number>(8);
  /** Muestra el badge "Envío disponible" en cada plato (espejo del input
   *  homónimo de <app-product-card>). Lo provee el home desde el store setting. */
  readonly show_shipping_badge = input<boolean>(false);

  /** Igual que <app-product-card>: el toggle pasa por el home para preservar
   *  el gate de auth (openLoginModal) y los toasts. El estado de fill del
   *  corazón se lee del WishlistService compartido (suscripción abajo). */
  readonly toggle_wishlist = output<EcommerceProduct>();
  readonly share = output<EcommerceProduct>();

  private readonly catalogService = inject(CatalogService);
  private readonly cartService = inject(CartService);
  private readonly tableContext = inject(TableContextService);
  private readonly wishlistService = inject(WishlistService);
  private readonly toastService = inject(ToastService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  private readonly menus = signal<PublicMenu[]>([]);
  /** Store-local "now" decomposition from the backend response (NOT a client
   * clock) — used to compute the next-available delta for the fallback carta. */
  private readonly now = signal<{
    day_of_week: number;
    minutes: number;
  } | null>(null);

  /** Store IANA timezone, used to compute the human "Vuelve el Sábado a las
   *  08:00" labels. Comes from the `/ecommerce/catalog/menus` response so
   *  we don't depend on TenantFacade being ready. */
  private readonly storeTimezone = signal<string | null>(null);

  /** Product_ids actualmente en favoritos — fuente de verdad compartida con
   *  el home vía WishlistService (signal singleton). Alimenta el fill del
   *  corazón del dish-card sin que el padre pase `in_wishlist` por plato. */
  private readonly wishlist_ids = signal<Set<number>>(new Set());

  /**
   * Cartas disponibles ahora, cada una con sus platos disponibles capados a
   * `limit()`. Solo se incluyen cartas con ≥1 plato disponible.
   */
  readonly renderCartas = computed<CartaBlock[]>(() => {
    const cap = this.limit();
    const out: CartaBlock[] = [];
    for (const menu of this.menus()) {
      if (!menu.is_available_now) continue;
      const dishes: MenuItem[] = [];
      for (const section of menu.sections ?? []) {
        for (const item of section.items ?? []) {
          if (!item.product) continue;
          if (!item.is_available_now) continue;
          dishes.push(item);
        }
      }
      if (dishes.length === 0) continue;
      out.push({ menu, dishes: dishes.slice(0, cap) });
    }
    return out;
  });

  /**
   * Cuando ninguna carta está disponible ahora, la carta activa con el
   * `next_available` de menor delta global (fórmula idéntica a
   * `nextAvailableWindow` del backend, computada en cliente con el `now` de
   * la respuesta). `dishes` son todos los platos de esa carta (off-schedule)
   * para listarlos deshabilitados en el preview. Null si no hay `now` o no
   * hay cartas con `next_available`.
   */
  readonly fallbackMenu = computed<CartaBlock | null>(() => {
    if (this.renderCartas().length > 0) return null;
    const now = this.now();
    if (!now) return null;
    const cap = this.limit();
    let best: { block: CartaBlock; delta: number } | null = null;
    for (const menu of this.menus()) {
      if (!menu.is_active) continue;
      const na = menu.next_available;
      if (!na) continue;
      const delta = this.deltaToNext(na, now);
      const dishes: MenuItem[] = [];
      for (const section of menu.sections ?? []) {
        for (const item of section.items ?? []) {
          if (!item.product) continue;
          dishes.push(item);
        }
      }
      if (dishes.length === 0) continue;
      const block: CartaBlock = { menu, dishes: dishes.slice(0, cap) };
      if (!best || delta < best.delta) best = { block, delta };
    }
    return best ? best.block : null;
  });

  readonly showFallback = computed(
    () => this.renderCartas().length === 0 && this.fallbackMenu() !== null,
  );

  ngOnInit(): void {
    this.catalogService
      .getMenus()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.now.set(res.data?.now ?? null);
          this.storeTimezone.set(res.data?.store_timezone ?? null);
          this.menus.set(res.data?.menus ?? []);
        },
        error: () => {
          this.now.set(null);
          this.storeTimezone.set(null);
          this.menus.set([]);
        },
      });

    // Fuente de verdad compartida con el home: el WishlistService expone el
    // estado via `wishlist$` (toObservable de su signal). Mantener un Set de
    // product_ids para el fill del corazón del dish-card.
    this.wishlistService.wishlist$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((wishlist) => {
        const ids = new Set<number>(
          (wishlist?.items ?? []).map((i) => i.product_id),
        );
        this.wishlist_ids.set(ids);
      });
  }

  /**
   * Delta en minutos hasta la próxima apertura de una carta, replicando
   * `nextAvailableWindow` del backend (`catalog.service.ts:1336-1339`):
   * `dayDiff = (na.day_of_week - now.day_of_week + 7) % 7`,
   * `delta = dayDiff*1440 + (start - now.minutes)`, wrap semanal si <= 0.
   */
  private deltaToNext(
    na: MenuNextAvailable,
    now: { day_of_week: number; minutes: number },
  ): number {
    const [h, m] = na.start_time.split(':').map(Number);
    const start = h * 60 + m;
    const dayDiff = (na.day_of_week - now.day_of_week + 7) % 7;
    let delta = dayDiff * 1440 + (start - now.minutes);
    if (delta <= 0) delta += 7 * 1440; // 10080
    return delta;
  }

  dishPrice(item: MenuItem): number {
    const p = item.product;
    if (!p) return 0;
    return p.is_on_sale && p.sale_price != null ? p.sale_price : p.base_price;
  }

  /** Formatea `{día} HH:mm` a partir de un `MenuNextAvailable` (o "pronto"). */
  formatNext(na: MenuNextAvailable | null): string {
    if (!na) return 'pronto';
    const days = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
    const day = days[na.day_of_week] ?? '';
    return `${day} ${na.start_time}`.trim();
  }

  /**
   * Builds the structured payload expected by `<app-next-available-notice>` for
   * a dish, menu or section. Returns null when `next_available` is missing or
   * malformed (the notice block renders nothing in that case).
   */
  nextAvailableFor(na: MenuNextAvailable | null): NextAvailableDetailed | null {
    return formatNextAvailableDetailed(na, this.storeTimezone(), new Date());
  }

  /** Stops the wrapping card `<a>` from navigating when interacting with buy controls. */
  stopCardNav(event: Event): void {
    event.preventDefault();
    event.stopPropagation();
  }

  /** Fill del corazón — lee del WishlistService compartido. */
  isInWishlist(product_id: number | undefined): boolean {
    return product_id != null && this.wishlist_ids().has(product_id);
  }

  /** Toggle favoritos — delega al home (gate de auth + toasts). Espejo del
   *  `onWishlistClick` de product-card, que emite `toggle_wishlist`. */
  onWishlistClick(event: Event, item: MenuItem): void {
    this.stopCardNav(event);
    const product = this.toEcommerceProduct(item);
    if (product) this.toggle_wishlist.emit(product);
  }

  /** Compartir — delega al home (abre el share-modal con el producto). Espejo
   *  del `onShareClick` de product-card. */
  onShareClick(event: Event, item: MenuItem): void {
    this.stopCardNav(event);
    const product = this.toEcommerceProduct(item);
    if (product) this.share.emit(product);
  }

  /** Construye un EcommerceProduct mínimo a partir del MenuItemProduct del
   *  plato — suficiente para el share-modal (name, slug, image_url, final_price)
   *  y para el toggle de wishlist (id). `MenuItemProduct` es un subset de
   *  `EcommerceProduct`, así que rellenamos los campos que el endpoint de
   *  cartas no devuelve con defaults seguros (sin inventario/marca). */
  private toEcommerceProduct(item: MenuItem): EcommerceProduct | null {
    const p = item.product;
    if (!p) return null;
    const on_sale = !!p.is_on_sale && p.sale_price != null;
    return {
      id: p.id,
      name: p.name,
      slug: p.slug,
      description: null,
      base_price: p.base_price,
      sale_price: p.sale_price ?? undefined,
      is_on_sale: on_sale,
      sku: null,
      stock_quantity: null,
      available_stock: null,
      is_available: item.is_available_now,
      final_price: on_sale ? p.sale_price! : p.base_price,
      image_url: p.image_url,
      brand: null,
      categories: [],
      variant_count: p.variant_count,
    };
  }

  /** Quick action del dish-card (espejo del quick-cart-btn de product-card):
   * los platos con variantes enrutan al detalle para elegir opción (el carrito
   * los rechaza sin `product_variant_id`); los platos simples se agregan con
   * qty fija de 1 — al carrito ecommerce, o a la mesa en sesión dine-in open_tab. */
  onQuickAdd(event: Event, item: MenuItem): void {
    this.stopCardNav(event);
    if (!item.is_available_now) return;
    if (item.product?.has_variants) {
      const slug = item.product?.slug;
      if (slug) this.router.navigate(['/products', slug]);
      return;
    }
    this.addToCartOrTab(item);
  }

  /** Adds a non-variant dish (qty=1) to the cart — or, in a dine-in `open_tab`
   * session, straight to the diner's table tab. Backend rejects off-schedule
   * dishes (422 MENU_ITEM_NOT_AVAILABLE_NOW), so the button is already gated
   * by `is_available_now`; this is a defensive guard. */
  private addToCartOrTab(item: MenuItem): void {
    const product = item.product;
    if (!product || !item.is_available_now) return;
    const qty = 1;

    // Dine-in QR (open_tab): the dish belongs on the diner's table tab, NOT
    // the ecommerce cart. Mirrors product-card.onAddToCart so both entry
    // points (home showcase + full carta page) feed the same session.
    if (this.tableContext.isOpenTab()) {
      this.tableContext
        .addOrder([{ product_id: product.id, quantity: qty }])
        .subscribe({
          next: () => {
            const msg = this.tableContext.autoFire()
              ? `Agregado a la mesa ${this.tableContext.tableName()} — enviado a cocina`
              : `Agregado a la mesa ${this.tableContext.tableName()}`;
            this.toastService.success(msg);
          },
          error: (err) => {
            const { userMessage, devMessage } = parseApiError(err);
            this.toastService.error(userMessage);
            if (devMessage) console.error('[table addOrder]', devMessage);
          },
        });
      return;
    }

    const result = this.cartService.addToCart(product.id, qty);
    const done = () => this.toastService.success('Plato agregado al carrito');
    if (result) {
      result.subscribe({ next: done });
    } else {
      done();
    }
  }
}