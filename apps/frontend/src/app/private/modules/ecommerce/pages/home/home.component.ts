import {
  Component,
  ChangeDetectionStrategy,
  OnInit,
  inject,
  DestroyRef,
  computed,
  signal,
} from '@angular/core';

import { RouterModule, Router } from '@angular/router';
import {
  CatalogService,
  EcommerceProduct,
} from '../../services/catalog.service';
import { CartService } from '../../services/cart.service';
import { WishlistService } from '../../services/wishlist.service';
import { StoreUiService } from '../../services/store-ui.service';
import { TableContextService } from '../../services/table-context.service';
import { TenantFacade } from '../../../../../../app/core/store/tenant/tenant.facade';
import { AuthFacade } from '../../../../../core/store/auth/auth.facade';
import { ProductCardComponent } from '../../components/product-card/product-card.component';
import { HeroBannerComponent } from '../../components/hero-banner';
import { CategoriesShowcaseComponent } from '../../components/categories-showcase/categories-showcase.component';
import { BrandsShowcaseComponent } from '../../components/brands-showcase/brands-showcase.component';
import { MenusShowcaseComponent } from '../../components/menus-showcase/menus-showcase.component';
import { PromotionsShowcaseComponent } from '../../components/promotions-showcase/promotions-showcase.component';
import { ProductQuickViewModalComponent } from '../../components/product-quick-view-modal';
import { ShareModalComponent } from '../../components/share-modal/share-modal.component';
import { ButtonComponent } from '../../../../../shared/components/button/button.component';
import { ToastService } from '../../../../../shared/components/toast/toast.service';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

interface HomeSectionConfig {
  enabled?: boolean;
  title?: string;
  subtitle?: string;
  /** Tope de platos por carta en el teaser del home (showcase agrupa por carta). */
  limit?: number;
  sort_order?: number;
  /** Cartas: rige el render de `/cartas` (no el home). En el default del home
   * queda inerte — el showcase del home tiene filtrado fijo por horario. */
  availability_display?: 'hide' | 'badge';
}

interface HomeSectionsConfig {
  slider: HomeSectionConfig;
  welcome: HomeSectionConfig;
  categories: HomeSectionConfig;
  brands: HomeSectionConfig;
  featured_products: HomeSectionConfig;
  promotions: HomeSectionConfig;
  menus: HomeSectionConfig;
}

type HomeSectionKey = keyof HomeSectionsConfig;

interface OrderedHomeSection {
  key: HomeSectionKey;
  config: HomeSectionConfig;
}

const DEFAULT_HOME_SECTIONS: HomeSectionsConfig = {
  slider: {
    enabled: true,
    title: 'Slider principal',
    subtitle: 'La primera historia visual de tu tienda',
    sort_order: 10,
  },
  welcome: {
    enabled: false,
    title: '',
    subtitle: '',
    sort_order: 20,
  },
  categories: {
    enabled: true,
    title: 'Categorías',
    subtitle: 'Explora por tipo de producto',
    limit: 8,
    sort_order: 30,
  },
  brands: {
    enabled: true,
    title: 'Marcas',
    subtitle: 'Compra por tus marcas favoritas',
    limit: 8,
    sort_order: 40,
  },
  featured_products: {
    enabled: true,
    title: 'Productos destacados',
    subtitle: 'Selección especial de la tienda',
    limit: 16,
    sort_order: 50,
  },
  // Opt-in (default off). sort_order 60 = valor por defecto del backend.
  // `menus` se subió a 70 para deshacer el empate histórico en 60.
  promotions: {
    enabled: false,
    title: 'Promociones activas',
    subtitle: 'Aprovecha las ofertas vigentes de la tienda',
    sort_order: 60,
  },
  menus: {
    enabled: false,
    title: 'Nuestras cartas',
    subtitle: 'Descubre los platos disponibles según el horario',
    // limit = tope de platos por carta en el teaser del home (showcase agrupa por carta)
    limit: 8,
    // Subido 60 -> 70 para no empatar con `promotions` (backend default 60).
    sort_order: 70,
    // Inerte en el default del home (solo lo lee /cartas via menus-page).
    availability_display: 'hide',
  },
};

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [
    RouterModule,
    ProductCardComponent,
    HeroBannerComponent,
    CategoriesShowcaseComponent,
    BrandsShowcaseComponent,
    MenusShowcaseComponent,
    PromotionsShowcaseComponent,
    ProductQuickViewModalComponent,
    ShareModalComponent,
    ButtonComponent,
  ],
  templateUrl: './home.component.html',
  styleUrls: ['./home.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HomeComponent implements OnInit {
  readonly featured_products = signal<EcommerceProduct[]>([]);
  readonly new_arrivals = signal<EcommerceProduct[]>([]);
  readonly sale_products = signal<EcommerceProduct[]>([]);
  readonly is_loading_featured = signal(true);
  readonly quickViewOpen = signal(false);
  readonly shareModalOpen = signal(false);
  readonly selectedProductSlug = signal<string | null>(null);
  readonly slider_config = signal<any>(null);
  readonly show_slider = signal(false);
  readonly slider_slides = computed<any[]>(() => {
    const photos = this.slider_config()?.photos;
    return Array.isArray(photos)
      ? photos.filter((photo: any) => !!photo?.url)
      : [];
  });
  readonly home_sections = signal<HomeSectionsConfig>(DEFAULT_HOME_SECTIONS);
  readonly shipping_badge_enabled = signal(false);
  readonly featured_section = computed(
    () => this.home_sections().featured_products,
  );
  readonly ordered_home_sections = computed<OrderedHomeSection[]>(() => {
    const sections = this.home_sections();
    return (Object.keys(sections) as HomeSectionKey[])
      .map((key) => ({ key, config: sections[key] }))
      .filter((section) => section.config.enabled !== false)
      .filter(
        (section) =>
          section.key !== 'welcome' || this.hasWelcomeContent(section.config),
      )
      .sort(
        (a, b) =>
          (a.config.sort_order ?? DEFAULT_HOME_SECTIONS[a.key].sort_order ?? 0) -
          (b.config.sort_order ?? DEFAULT_HOME_SECTIONS[b.key].sort_order ?? 0),
      );
  });
  shareProduct: EcommerceProduct | null = null;

  // Wishlist state
  wishlist_product_ids = new Set<number>();
  private is_authenticated = false;

  private destroy_ref = inject(DestroyRef);
  private tenant_facade = inject(TenantFacade);
  private auth_facade = inject(AuthFacade);
  private router = inject(Router);
  private wishlist_service = inject(WishlistService);
  private store_ui_service = inject(StoreUiService);
  private toast_service = inject(ToastService);
  // QR dine-in (Step 8): parent must NOT re-add in mesa-mode — the
  // product-card has already routed via the mesa chokepoint.
  private table_context_service = inject(TableContextService);

  constructor(
    private catalog_service: CatalogService,
    private cart_service: CartService,
  ) {}

  ngOnInit(): void {
    this.loadFeaturedProducts();
    this.loadPublicConfig();
    this.loadShippingAvailability();

    // Subscribe to authentication state
    this.auth_facade.isAuthenticated$
      .pipe(takeUntilDestroyed(this.destroy_ref))
      .subscribe((is_auth) => {
        this.is_authenticated = is_auth;
        if (is_auth) {
          // Load wishlist when user is authenticated
          this.wishlist_service.getWishlist().subscribe();
        } else {
          // Clear wishlist state when not authenticated
          this.wishlist_product_ids.clear();
        }
      });

    // Subscribe to wishlist changes
    this.wishlist_service.wishlist$
      .pipe(takeUntilDestroyed(this.destroy_ref))
      .subscribe((wishlist) => {
        this.wishlist_product_ids = new Set(
          wishlist?.items.map((item) => item.product_id) || [],
        );
      });
  }

  loadFeaturedProducts(limit = this.featured_section().limit || 16): void {
    // Fallback: even if featured_products section is disabled, load products
    // when there are NO other sections to render — prevents blank homepage.
    const isFallback = this.ordered_home_sections().length === 0;
    if (this.featured_section().enabled === false && !isFallback) {
      this.featured_products.set([]);
      this.is_loading_featured.set(false);
      return;
    }

    this.is_loading_featured.set(true);
    this.catalog_service
      .getProducts({ limit, sort_by: 'newest', is_featured: true, fill: true })
      .pipe(takeUntilDestroyed(this.destroy_ref))
      .subscribe({
        next: (response) => {
          this.featured_products.set(response.data);
          this.is_loading_featured.set(false);
        },
        error: () => {
          this.is_loading_featured.set(false);
        },
      });
  }

  loadPublicConfig(): void {
    // Usamos TenantFacade en lugar de una llamada HTTP redundante
    // Esto asegura que usamos la configuración ya resuelta del dominio
    this.tenant_facade.domainConfig$
      .pipe(takeUntilDestroyed(this.destroy_ref))
      .subscribe({
        next: (domainConfig: any) => {
          if (!domainConfig) return;

          // La configuración de ecommerce está en customConfig.ecommerce
          const customConfig = domainConfig.customConfig || {};
          const ecommerceConfig = customConfig.ecommerce || {};
          if (this.hasConfiguredShipping(ecommerceConfig)) {
            this.shipping_badge_enabled.set(true);
          }

          this.slider_config.set(ecommerceConfig.slider || null);
          const inicio = ecommerceConfig.inicio || {};
          const configuredSections = ecommerceConfig.home_sections || {};
          const configuredWelcome = configuredSections.welcome || {};
          const welcomeTitle = this.normalizeText(
            configuredWelcome.title ?? inicio.titulo,
          );
          const welcomeSubtitle = this.normalizeText(
            configuredWelcome.subtitle ?? inicio.parrafo,
          );
          this.home_sections.set({
            slider: {
              ...DEFAULT_HOME_SECTIONS.slider,
              ...(configuredSections.slider || {}),
            },
            welcome: {
              ...DEFAULT_HOME_SECTIONS.welcome,
              ...configuredWelcome,
              enabled:
                configuredWelcome.enabled ??
                Boolean(welcomeTitle.trim() || welcomeSubtitle.trim()),
              title: welcomeTitle,
              subtitle: welcomeSubtitle,
            },
            categories: {
              ...DEFAULT_HOME_SECTIONS.categories,
              ...(configuredSections.categories || {}),
            },
            brands: {
              ...DEFAULT_HOME_SECTIONS.brands,
              ...(configuredSections.brands || {}),
            },
            featured_products: {
              ...DEFAULT_HOME_SECTIONS.featured_products,
              ...(configuredSections.featured_products || {}),
            },
            promotions: {
              ...DEFAULT_HOME_SECTIONS.promotions,
              ...(configuredSections.promotions || {}),
            },
            menus: {
              ...DEFAULT_HOME_SECTIONS.menus,
              ...(configuredSections.menus || {}),
            },
          });
          this.loadFeaturedProducts();

          // Verificar si hay fotos configuradas
          const sliderEnabled =
            (configuredSections.slider?.enabled ?? true) !== false &&
            (this.slider_config()?.enable ?? true) !== false;

          // El slider se muestra si hay fotos
          // El campo 'enable' es opcional - si no existe, se asume true cuando hay fotos
          this.show_slider.set(
            sliderEnabled && this.slider_slides().length > 0,
          );
        },
      });
  }

  private loadShippingAvailability(): void {
    this.catalog_service
      .getPublicConfig()
      .pipe(takeUntilDestroyed(this.destroy_ref))
      .subscribe({
        next: (response) => {
          this.shipping_badge_enabled.set(
            this.hasConfiguredShipping(response.data?.ecommerce),
          );
        },
      });
  }

  hasWelcomeContent(config: HomeSectionConfig): boolean {
    return Boolean(config.title?.trim() || config.subtitle?.trim());
  }

  private hasConfiguredShipping(ecommerce: any): boolean {
    const shipping = ecommerce?.shipping || {};
    return (
      shipping.has_configured_shipping === true ||
      shipping.enabled === true ||
      shipping.shipping_enabled === true
    );
  }

  private normalizeText(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
  }

  onAddToCart(product: EcommerceProduct): void {
    // Guard: bookable services go to booking page
    if (product.requires_booking && product.product_type === 'service') {
      this.router.navigate(['/book', product.id]);
      return;
    }
    // Guard: variant products must go through detail page for variant selection
    if (product.variant_count && product.variant_count > 0) {
      this.router.navigate(['/products', product.slug]);
      return;
    }
    // QR dine-in (Step 8): product-card.onAddToCart already dispatched via
    // the mesa chokepoint — do NOT call addProduct again here, that would
    // double the items on the bill. Step 7 already hid purchase CTAs in
    // mesa-mode at the surface, so this guard is defense-in-depth.
    if (this.table_context_service.isActive()) {
      return;
    }
    // Chokepoint (D3): mesa-vs-cart routing lives in `cartService.addProduct`.
    const result = this.cart_service.addProduct(product.id, 1);
    if (result) {
      result.subscribe();
    }
  }

  onModalAddedToCart(_product: EcommerceProduct): void {
    // Modal already added the product to cart and closed itself
    this.quickViewOpen.set(false);
  }

  onToggleWishlist(product: EcommerceProduct): void {
    // Check authentication first
    if (!this.is_authenticated) {
      this.store_ui_service.openLoginModal();
      return;
    }

    // Toggle wishlist with toast feedback
    if (this.isInWishlist(product.id)) {
      this.wishlist_service.removeItem(product.id).subscribe({
        next: () => this.toast_service.info('Producto eliminado de favoritos'),
      });
    } else {
      this.wishlist_service.addItem(product.id).subscribe({
        next: () => this.toast_service.success('Producto agregado a favoritos'),
      });
    }
  }

  isInWishlist(product_id: number): boolean {
    return this.wishlist_product_ids.has(product_id);
  }

  onQuickView(product: EcommerceProduct): void {
    this.selectedProductSlug.set(product.slug);
    this.quickViewOpen.set(true);
  }

  onShare(product: EcommerceProduct): void {
    this.shareProduct = product;
    this.shareModalOpen.set(true);
  }

  onShareModalClosed(): void {
    this.shareModalOpen.set(false);
    this.shareProduct = null;
  }

  onViewMore(): void {
    this.router.navigate(['/products']).then(() => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }
}
