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
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import {
  CatalogService,
  MenuItem,
  PublicMenu,
} from '../../services/catalog.service';
import { CartService } from '../../services/cart.service';
import { CurrencyPipe } from '../../../../../shared/pipes/currency';
import { ButtonComponent } from '../../../../../shared/components/button/button.component';
import { IconComponent } from '../../../../../shared/components/icon/icon.component';
import { ToastService } from '../../../../../shared/components/toast/toast.service';

/**
 * Compact "Cartas" summary rendered on the storefront home. It is fully
 * self-gating: the public `/ecommerce/catalog/menus` endpoint returns no
 * menus for non-restaurant stores, so the component renders nothing in that
 * case (no need for an extra industry check here).
 *
 * `availabilityDisplay` mirrors the store setting `home_sections.menus`:
 * - `hide`  → only dishes available right now are shown.
 * - `badge` → every dish is shown; off-schedule ones get a
 *   "Disponible {día} HH:mm" badge.
 */
interface PreviewDish {
  item: MenuItem;
  menuName: string;
}

@Component({
  selector: 'app-menus-showcase',
  standalone: true,
  imports: [RouterModule, CurrencyPipe, ButtonComponent, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (visibleDishes().length > 0) {
      <section class="menus-section">
        <div class="section-header">
          <span class="section-kicker">Carta del restaurante</span>
          <h2>{{ title() || 'Nuestras cartas' }}</h2>
          <p class="subtitle">
            {{ subtitle() || 'Descubre los platos disponibles según el horario' }}
          </p>
        </div>

        <div class="dishes-grid">
          @for (dish of visibleDishes(); track dish.item.id) {
            <a
              class="dish-card"
              [class.dish-card--off]="!dish.item.is_available_now"
              [routerLink]="
                dish.item.product?.slug
                  ? ['/products', dish.item.product?.slug]
                  : null
              "
            >
              <div class="dish-image">
                @if (dish.item.product?.image_url) {
                  <img
                    [src]="dish.item.product?.image_url"
                    [alt]="dish.item.product?.name"
                    loading="lazy"
                  />
                } @else {
                  <div class="dish-image__placeholder">🍽️</div>
                }
                @if (!dish.item.is_available_now) {
                  <span class="dish-badge">
                    Disponible {{ nextLabel(dish.item) }}
                  </span>
                }
              </div>
              <div class="dish-body">
                <span class="dish-menu">{{ dish.menuName }}</span>
                <h3 class="dish-name">{{ dish.item.product?.name }}</h3>
                <span class="dish-price">
                  {{ dishPrice(dish.item) | currency }}
                </span>

                @if (dish.item.product?.has_variants) {
                  <!-- Variant products: cart rejects them without a
                       product_variant_id → route to detail to pick options. -->
                  <span class="dish-buy">
                    <app-button
                      variant="outline"
                      size="sm"
                      [fullWidth]="true"
                      (clicked)="onViewOptions($event, dish.item)"
                    >
                      <app-icon slot="icon" name="eye" [size]="15" />
                      Ver opciones
                    </app-button>
                  </span>
                } @else {
                  <span
                    class="dish-buy"
                    (click)="stopCardNav($event)"
                  >
                    <span class="qty-stepper">
                      <button
                        type="button"
                        class="qty-btn"
                        [disabled]="qtyOf(dish.item.id) <= 1"
                        aria-label="Disminuir cantidad"
                        (click)="decQty($event, dish.item.id)"
                      >
                        <app-icon name="minus" [size]="14" />
                      </button>
                      <span class="qty-value">{{ qtyOf(dish.item.id) }}</span>
                      <button
                        type="button"
                        class="qty-btn"
                        aria-label="Aumentar cantidad"
                        (click)="incQty($event, dish.item.id)"
                      >
                        <app-icon name="plus" [size]="14" />
                      </button>
                    </span>
                    <app-button
                      variant="primary"
                      size="sm"
                      [fullWidth]="true"
                      [disabled]="!dish.item.is_available_now"
                      (clicked)="onAdd($event, dish.item)"
                    >
                      <app-icon slot="icon" name="shopping-cart" [size]="15" />
                      Agregar
                    </app-button>
                  </span>
                }
              </div>
            </a>
          }
        </div>

        <div class="view-more-container">
          <app-button variant="outline" [routerLink]="['/cartas']">
            Ver carta completa
          </app-button>
        </div>
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
      .dish-badge {
        position: absolute;
        bottom: 0.5rem;
        left: 0.5rem;
        background: rgba(17, 24, 39, 0.85);
        color: #fff;
        font-size: 0.7rem;
        padding: 0.2rem 0.5rem;
        border-radius: 999px;
      }
      .dish-body {
        padding: 0.65rem 0.75rem 0.85rem;
        display: flex;
        flex-direction: column;
        gap: 0.15rem;
      }
      .dish-menu {
        font-size: 0.7rem;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        color: #9ca3af;
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
      .view-more-container {
        text-align: center;
        margin-top: 1.75rem;
      }
    `,
  ],
})
export class MenusShowcaseComponent implements OnInit {
  readonly title = input<string>('');
  readonly subtitle = input<string>('');
  readonly availabilityDisplay = input<'hide' | 'badge'>('hide');
  readonly limit = input<number>(8);

  private readonly catalogService = inject(CatalogService);
  private readonly cartService = inject(CartService);
  private readonly toastService = inject(ToastService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  private readonly menus = signal<PublicMenu[]>([]);

  /**
   * Per-item quantity for the inline stepper, keyed by `MenuItem.id`.
   * Signal-based so the template re-renders under zoneless change detection.
   */
  private readonly quantities = signal<Record<number, number>>({});

  /** Flattened, schedule-aware dish list capped at `limit`. */
  readonly visibleDishes = computed<PreviewDish[]>(() => {
    const display = this.availabilityDisplay();
    const cap = this.limit();
    const out: PreviewDish[] = [];
    for (const menu of this.menus()) {
      for (const section of menu.sections ?? []) {
        for (const item of section.items ?? []) {
          if (!item.product) continue;
          if (display === 'hide' && !item.is_available_now) continue;
          out.push({ item, menuName: menu.name });
        }
      }
    }
    // Show available dishes first when in badge mode.
    out.sort(
      (a, b) =>
        Number(b.item.is_available_now) - Number(a.item.is_available_now),
    );
    return out.slice(0, cap);
  });

  ngOnInit(): void {
    this.catalogService
      .getMenus()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => this.menus.set(res.data?.menus ?? []),
        error: () => this.menus.set([]),
      });
  }

  dishPrice(item: MenuItem): number {
    const p = item.product;
    if (!p) return 0;
    return p.is_on_sale && p.sale_price != null ? p.sale_price : p.base_price;
  }

  nextLabel(item: MenuItem): string {
    const na = item.next_available;
    if (!na) return 'pronto';
    const days = [
      'Dom',
      'Lun',
      'Mar',
      'Mié',
      'Jue',
      'Vie',
      'Sáb',
    ];
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
