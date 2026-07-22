import {
  Component,
  ChangeDetectionStrategy,
  DestroyRef,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { Router, RouterModule } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import {
  CatalogService,
  EcommerceProduct,
  MenuItem,
  MenuNextAvailable,
  MenuSection,
  PublicMenu,
} from '../../services/catalog.service';
import {
  formatNextAvailableDetailed,
  NextAvailableDetailed,
} from '../../services/next-available.util';
import { NextAvailableNoticeComponent } from '../../components/next-available-notice';
import { CartService } from '../../services/cart.service';
import { WishlistService } from '../../services/wishlist.service';
import { StoreUiService } from '../../services/store-ui.service';
import { TableContextService } from '../../services/table-context.service';
import { AuthFacade } from '../../../../../core/store/auth/auth.facade';
import { TenantFacade } from '../../../../../core/store/tenant/tenant.facade';
import { CurrencyPipe } from '../../../../../shared/pipes/currency';
import { ButtonComponent } from '../../../../../shared/components/button/button.component';
import { BadgeComponent } from '../../../../../shared/components/badge/badge.component';
import { IconComponent } from '../../../../../shared/components/icon/icon.component';
import { ShareModalComponent } from '../../components/share-modal/share-modal.component';
import { ToastService } from '../../../../../shared/components/toast/toast.service';

type AvailabilityDisplay = 'hide' | 'badge';

interface RenderSection extends MenuSection {
  visibleItems: MenuItem[];
}

interface RenderMenu extends PublicMenu {
  visibleSections: RenderSection[];
}

/**
 * Dedicated storefront page (`/cartas`) showing the full restaurant menus
 * grouped by section, schedule-aware. Independent from the general catalog:
 * it consumes `/ecommerce/catalog/menus`, which returns nothing for
 * non-restaurant stores. The `hide`/`badge` behavior mirrors the store
 * setting `home_sections.menus.availability_display`.
 *
 * El dish-card es espejo visual de `<app-product-card>` (imagen 1:1, badges
 * overlay, card-actions Like/Compartir, quick-add flotante, sin qty-stepper).
 */
@Component({
  selector: 'app-menus-page',
  standalone: true,
  imports: [
    RouterModule,
    CurrencyPipe,
    ButtonComponent,
    BadgeComponent,
    IconComponent,
    ShareModalComponent,
    NextAvailableNoticeComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './menus-page.component.html',
  styleUrls: ['./menus-page.component.scss'],
})
export class MenusPageComponent implements OnInit {
  private readonly catalogService = inject(CatalogService);
  private readonly cartService = inject(CartService);
  private readonly wishlistService = inject(WishlistService);
  private readonly storeUiService = inject(StoreUiService);
  /** QR-mode-aware visibility (Step 7) — consumed by the dish-quick-btn
   *  template to hide purchase CTAs when the active scan mode forbids it. */
  protected readonly tableContext = inject(TableContextService);
  private readonly authFacade = inject(AuthFacade);
  private readonly toastService = inject(ToastService);
  private readonly router = inject(Router);
  private readonly tenantFacade = inject(TenantFacade);
  private readonly destroyRef = inject(DestroyRef);

  readonly isLoading = signal(true);
  readonly availabilityDisplay = signal<AvailabilityDisplay>('hide');
  readonly shipping_badge_enabled = signal(false);
  private readonly menus = signal<PublicMenu[]>([]);
  /** Store IANA tz returned by `/ecommerce/catalog/menus`. Used for the
   *  consolidated "next available" label + delta. Null until the response
   *  arrives; falls back to the browser's local TZ in that case. */
  private readonly storeTimezone = signal<string | null>(null);

  /** Product_ids en favoritos — fuente de verdad compartida vía
   *  WishlistService (signal singleton). Alimenta el fill del corazón. */
  readonly wishlist_product_ids = signal<Set<number>>(new Set());
  private is_authenticated = false;

  /** Share modal state. */
  readonly shareModalOpen = signal(false);
  readonly shareProduct = signal<EcommerceProduct | null>(null);

  private static readonly DAY_LABELS = [
    'Domingo',
    'Lunes',
    'Martes',
    'Miércoles',
    'Jueves',
    'Viernes',
    'Sábado',
  ];

  /** Menus filtered/annotated for rendering per the availability setting. */
  readonly renderMenus = computed<RenderMenu[]>(() => {
    const display = this.availabilityDisplay();
    const out: RenderMenu[] = [];
    for (const menu of this.menus()) {
      const sections: RenderSection[] = [];
      for (const section of menu.sections ?? []) {
        const items = (section.items ?? []).filter((it) => {
          if (!it.product) return false;
          if (display === 'hide' && !it.is_available_now) return false;
          return true;
        });
        if (items.length === 0) continue;
        sections.push({ ...section, visibleItems: items });
      }
      if (sections.length === 0) continue;
      out.push({ ...menu, visibleSections: sections });
    }
    return out;
  });

  readonly hasMenus = computed(() => this.renderMenus().length > 0);

  ngOnInit(): void {
    this.tenantFacade.domainConfig$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((domainConfig: any) => {
        const ecommerce = domainConfig?.customConfig?.ecommerce;
        const menusCfg = ecommerce?.home_sections?.menus;
        const display = menusCfg?.availability_display;
        this.availabilityDisplay.set(display === 'badge' ? 'badge' : 'hide');
        this.shipping_badge_enabled.set(this.hasConfiguredShipping(ecommerce));
      });

    // Auth state → load/clear wishlist (igual que catalog/home).
    this.authFacade.isAuthenticated$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((is_auth) => {
        this.is_authenticated = is_auth;
        if (is_auth) {
          this.wishlistService.getWishlist().subscribe();
        } else {
          this.wishlist_product_ids.set(new Set());
        }
      });

    // Fuente de verdad del wishlist — alimenta el fill del corazón.
    this.wishlistService.wishlist$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((wishlist) => {
        this.wishlist_product_ids.set(
          new Set((wishlist?.items ?? []).map((i) => i.product_id)),
        );
      });

    this.catalogService
      .getMenus()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (res) => {
          this.menus.set(res.data?.menus ?? []);
          this.storeTimezone.set(res.data?.store_timezone ?? null);
          this.isLoading.set(false);
        },
        error: () => {
          this.menus.set([]);
          this.storeTimezone.set(null);
          this.isLoading.set(false);
        },
      });
  }

  dishPrice(item: MenuItem): number {
    const p = item.product;
    if (!p) return 0;
    return p.is_on_sale && p.sale_price != null ? p.sale_price : p.base_price;
  }

  nextLabel(entity: { next_available: MenuNextAvailable | null }): string {
    const na = entity.next_available;
    if (!na) return 'pronto';
    const day = MenusPageComponent.DAY_LABELS[na.day_of_week] ?? '';
    return `${day} a las ${na.start_time}`.trim();
  }

  /** Structured payload for `<app-next-available-notice>` — used in templates
   *  in addition to the legacy `nextLabel()` badge text. Returns null when
   *  `next_available` is null (notice renders nothing). */
  nextAvailableFor(
    entity: { next_available: MenuNextAvailable | null } | null | undefined,
  ): NextAvailableDetailed | null {
    if (!entity) return null;
    return formatNextAvailableDetailed(
      entity.next_available,
      this.storeTimezone(),
      new Date(),
    );
  }

  /** Stops the wrapping card `<a>` from navigating when interacting with buy controls. */
  stopCardNav(event: Event): void {
    event.preventDefault();
    event.stopPropagation();
  }

  /** Fill del corazón — lee del WishlistService compartido. */
  isInWishlist(product_id: number | undefined): boolean {
    return product_id != null && this.wishlist_product_ids().has(product_id);
  }

  /** Toggle favoritos — gate de auth (openLoginModal) + toasts, igual que
   *  catalog/home. Espejo del `onWishlistClick` de product-card. */
  onWishlistClick(event: Event, item: MenuItem): void {
    this.stopCardNav(event);
    if (!this.is_authenticated) {
      this.storeUiService.openLoginModal();
      return;
    }
    const product = this.toEcommerceProduct(item);
    if (!product) return;
    if (this.isInWishlist(product.id)) {
      this.wishlistService.removeItem(product.id).subscribe({
        next: () => this.toastService.info('Producto eliminado de favoritos'),
      });
    } else {
      this.wishlistService.addItem(product.id).subscribe({
        next: () => this.toastService.success('Producto agregado a favoritos'),
      });
    }
  }

  /** Compartir — abre el share-modal con el producto. */
  onShareClick(event: Event, item: MenuItem): void {
    this.stopCardNav(event);
    const product = this.toEcommerceProduct(item);
    if (!product) return;
    this.shareProduct.set(product);
    this.shareModalOpen.set(true);
  }

  onShareModalClosed(): void {
    this.shareModalOpen.set(false);
    this.shareProduct.set(null);
  }

  /** Quick action del dish-card (espejo del quick-cart-btn de product-card):
   * variantes → ruta detalle; simples → carrito (o mesa en open_tab) qty=1. */
  onQuickAdd(event: Event, item: MenuItem): void {
    this.stopCardNav(event);
    if (!item.is_available_now || item.is_sold_out) return;
    if (item.product?.has_variants) {
      const slug = item.product?.slug;
      if (slug) this.router.navigate(['/products', slug]);
      return;
    }
    this.addToCartOrTab(item);
  }

  /** Agrega un plato simple (qty=1) al carrito — o a la mesa en sesión dine-in
   *  open_tab. El backend rechaza platos fuera de horario (422
   *  MENU_ITEM_NOT_AVAILABLE_NOW), por eso el botón se gatea con
   *  `is_available_now`; esto es un guard defensivo. El chokepoint mesa-vs-cart
   *  y el toast mesa viven ahora en `cartService.addProduct` (D3); aquí sólo
   *  sumamos el toast del camino ecommerce. */
  private addToCartOrTab(item: MenuItem): void {
    const product = item.product;
    if (!product || !item.is_available_now) return;
    const qty = 1;
    const isMesa = this.tableContext.isOpenTab();
    const result = this.cartService.addProduct(product.id, qty);
    if (isMesa) return; // mesa path toasts internally inside addProduct
    const done = () => this.toastService.success('Plato agregado al carrito');
    if (result) {
      result.subscribe({ next: done });
    } else {
      done();
    }
  }

  /** Construye un EcommerceProduct mínimo desde el MenuItemProduct del plato —
   *  suficiente para el share-modal (name, slug, image_url, final_price) y
   *  para el toggle de wishlist (id). `MenuItemProduct` es un subset, así que
   *  rellenamos los campos que el endpoint de cartas no devuelve. */
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
      is_available: item.is_available_now && !item.is_sold_out,
      final_price: on_sale ? p.sale_price! : p.base_price,
      image_url: p.image_url,
      brand: null,
      categories: [],
      variant_count: p.variant_count,
    };
  }

  private hasConfiguredShipping(ecommerce: any): boolean {
    const shipping = ecommerce?.shipping || {};
    return (
      shipping.has_configured_shipping === true ||
      shipping.enabled === true ||
      shipping.shipping_enabled === true
    );
  }
}