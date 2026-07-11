import {
  Component,
  ChangeDetectionStrategy,
  DestroyRef,
  OnInit,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { Router, RouterModule } from '@angular/router';
import { NgTemplateOutlet } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import {
  CatalogService,
  MenuItem,
  MenuNextAvailable,
  PublicMenu,
} from '../../services/catalog.service';
import { CartService } from '../../services/cart.service';
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
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (renderCartas().length || fallbackMenu()) {
      <section class="menus-section">
        <div class="section-header">
          <span class="section-kicker">Carta del restaurante</span>
          <h2>{{ title() || 'Nuestras cartas' }}</h2>
          <p class="subtitle">
            {{ subtitle() || 'Descubre los platos disponibles según el horario' }}
          </p>
        </div>

        <!-- Shared dish card template (used by available + fallback blocks). -->
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
            </div>
            <div class="dish-body">
              <h3 class="dish-name">{{ dish.product?.name }}</h3>
              <span class="dish-price">
                {{ dishPrice(dish) | currency }}
              </span>

              @if (dish.product?.has_variants) {
                <!-- Variant products: cart rejects them without a
                     product_variant_id → route to detail to pick options. -->
                <span class="dish-buy">
                  <app-button
                    variant="outline"
                    size="sm"
                    [fullWidth]="true"
                    [disabled]="!dish.is_available_now"
                    (clicked)="onViewOptions($event, dish)"
                  >
                    <app-icon slot="icon" name="eye" [size]="15" />
                    Ver opciones
                  </app-button>
                </span>
              } @else {
                <span class="dish-buy" (click)="stopCardNav($event)">
                  <span class="qty-stepper">
                    <button
                      type="button"
                      class="qty-btn"
                      [disabled]="qtyOf(dish.id) <= 1"
                      aria-label="Disminuir cantidad"
                      (click)="decQty($event, dish.id)"
                    >
                      <app-icon name="minus" [size]="14" />
                    </button>
                    <span class="qty-value">{{ qtyOf(dish.id) }}</span>
                    <button
                      type="button"
                      class="qty-btn"
                      aria-label="Aumentar cantidad"
                      (click)="incQty($event, dish.id)"
                    >
                      <app-icon name="plus" [size]="14" />
                    </button>
                  </span>
                  <app-button
                    variant="primary"
                    size="sm"
                    [fullWidth]="true"
                    [disabled]="!dish.is_available_now"
                    (clicked)="onAdd($event, dish)"
                  >
                    <app-icon slot="icon" name="shopping-cart" [size]="15" />
                    Agregar
                  </app-button>
                </span>
              }
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
        padding: 2.5rem 1rem;
        max-width: 1200px;
        margin: 0 auto;
      }
      .section-header {
        text-align: center;
        margin-bottom: 1.75rem;
      }
      .section-kicker {
        display: inline-block;
        font-size: 0.75rem;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--color-primary, #2f6f4e);
        font-weight: 600;
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
      .dishes-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(170px, 1fr));
        gap: 1rem;
      }
      .dish-card {
        display: flex;
        flex-direction: column;
        border-radius: 0.75rem;
        overflow: hidden;
        background: #fff;
        border: 1px solid #f0f0f0;
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.06);
        text-decoration: none;
        color: inherit;
        transition:
          transform 0.15s ease,
          box-shadow 0.15s ease;
      }
      .dish-card:hover {
        transform: translateY(-3px);
        box-shadow: 0 8px 20px rgba(0, 0, 0, 0.1);
      }
      .dish-card--off {
        opacity: 0.7;
      }
      .dish-image {
        position: relative;
        aspect-ratio: 4 / 3;
        background: #f7f7f7;
      }
      .dish-image img {
        width: 100%;
        height: 100%;
        object-fit: cover;
      }
      .dish-image__placeholder {
        width: 100%;
        height: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 2rem;
      }
      .dish-body {
        padding: 0.65rem 0.75rem 0.85rem;
        display: flex;
        flex-direction: column;
        gap: 0.15rem;
      }
      .dish-name {
        font-size: 0.95rem;
        font-weight: 600;
        margin: 0;
        line-height: 1.2;
      }
      .dish-price {
        font-weight: 700;
        color: var(--color-primary, #2f6f4e);
      }
      .dish-buy {
        display: flex;
        align-items: center;
        gap: 0.4rem;
        margin-top: 0.4rem;
      }
      .qty-stepper {
        display: inline-flex;
        align-items: center;
        border: 1px solid #e5e7eb;
        border-radius: 0.5rem;
        overflow: hidden;
        flex-shrink: 0;
      }
      .qty-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 1.9rem;
        height: 2rem;
        background: #fff;
        border: none;
        color: #374151;
        cursor: pointer;
      }
      .qty-btn:hover:not(:disabled) {
        background: #f3f4f6;
      }
      .qty-btn:disabled {
        opacity: 0.4;
        cursor: not-allowed;
      }
      .qty-value {
        min-width: 1.6rem;
        text-align: center;
        font-size: 0.85rem;
        font-weight: 600;
      }
    `,
  ],
})
export class MenusShowcaseComponent implements OnInit {
  readonly title = input<string>('');
  readonly subtitle = input<string>('');
  /** Tope de platos por carta en el teaser del home. */
  readonly limit = input<number>(8);

  private readonly catalogService = inject(CatalogService);
  private readonly cartService = inject(CartService);
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

  /**
   * Per-item quantity for the inline stepper, keyed by `MenuItem.id`.
   * Signal-based so the template re-renders under zoneless change detection.
   */
  private readonly quantities = signal<Record<number, number>>({});

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
          this.menus.set(res.data?.menus ?? []);
        },
        error: () => {
          this.now.set(null);
          this.menus.set([]);
        },
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

  /** Current stepper quantity for an item (defaults to 1). */
  qtyOf(itemId: number): number {
    return this.quantities()[itemId] ?? 1;
  }

  incQty(event: Event, itemId: number): void {
    this.stopCardNav(event);
    const next = this.qtyOf(itemId) + 1;
    this.quantities.update((q) => ({ ...q, [itemId]: next }));
  }

  decQty(event: Event, itemId: number): void {
    this.stopCardNav(event);
    const next = Math.max(1, this.qtyOf(itemId) - 1);
    this.quantities.update((q) => ({ ...q, [itemId]: next }));
  }

  /** Stops the wrapping card `<a>` from navigating when interacting with buy controls. */
  stopCardNav(event: Event): void {
    event.preventDefault();
    event.stopPropagation();
  }

  /** Routes a variant dish to its detail page so the customer can pick an option. */
  onViewOptions(event: Event, item: MenuItem): void {
    this.stopCardNav(event);
    const slug = item.product?.slug;
    if (slug) this.router.navigate(['/products', slug]);
  }

  /** Adds a non-variant dish to the cart. Backend rejects off-schedule dishes
   * (422 MENU_ITEM_NOT_AVAILABLE_NOW), so the button is already gated by
   * `is_available_now`; this is a defensive guard. */
  onAdd(event: Event, item: MenuItem): void {
    this.stopCardNav(event);
    const product = item.product;
    if (!product || !item.is_available_now) return;
    const result = this.cartService.addToCart(product.id, this.qtyOf(item.id));
    const done = () => this.toastService.success('Plato agregado al carrito');
    if (result) {
      result.subscribe({ next: done });
    } else {
      done();
    }
  }
}