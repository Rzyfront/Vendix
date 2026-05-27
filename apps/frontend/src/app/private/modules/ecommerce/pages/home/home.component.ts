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
import { TenantFacade } from '../../../../../../app/core/store/tenant/tenant.facade';
import { AuthFacade } from '../../../../../core/store/auth/auth.facade';
import { ProductCardComponent } from '../../components/product-card/product-card.component';
import { HeroBannerComponent } from '../../components/hero-banner';
import { CategoriesShowcaseComponent } from '../../components/categories-showcase/categories-showcase.component';
import { BrandsShowcaseComponent } from '../../components/brands-showcase/brands-showcase.component';
import { ProductQuickViewModalComponent } from '../../components/product-quick-view-modal';
import { ShareModalComponent } from '../../components/share-modal/share-modal.component';
import { ButtonComponent } from '../../../../../shared/components/button/button.component';
import { ToastService } from '../../../../../shared/components/toast/toast.service';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

interface HomeSectionConfig {
  enabled?: boolean;
  title?: string;
  subtitle?: string;
  limit?: number;
}

interface HomeSectionsConfig {
  categories: HomeSectionConfig;
  brands: HomeSectionConfig;
  featured_products: HomeSectionConfig;
}

const DEFAULT_HOME_SECTIONS: HomeSectionsConfig = {
  categories: {
    enabled: true,
    title: 'Categorías',
    subtitle: 'Explora por tipo de producto',
    limit: 8,
  },
  brands: {
    enabled: true,
    title: 'Marcas',
    subtitle: 'Compra por tus marcas favoritas',
    limit: 8,
  },
  featured_products: {
    enabled: true,
    title: 'Productos destacados',
    subtitle: 'Selección especial de la tienda',
    limit: 16,
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
  readonly home_sections = signal<HomeSectionsConfig>(DEFAULT_HOME_SECTIONS);
  readonly featured_section = computed(
    () => this.home_sections().featured_products,
  );
  readonly banner_content = signal<{ title: string; paragraph: string }>({
    title: 'Bienvenido',
    paragraph: 'Encuentra aquí todo lo que buscas...',
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

  constructor(
    private catalog_service: CatalogService,
    private cart_service: CartService,
  ) {}

  ngOnInit(): void {
    this.loadFeaturedProducts();
    this.loadPublicConfig();

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
    if (this.featured_section().enabled === false) {
      this.featured_products.set([]);
      this.is_loading_featured.set(false);
      return;
    }

    this.is_loading_featured.set(true);
    this.catalog_service
      .getProducts({ limit, sort_by: 'newest', is_featured: true })
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

          this.slider_config.set(ecommerceConfig.slider || null);
          const configuredSections = ecommerceConfig.home_sections || {};
          this.home_sections.set({
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
          });
          this.loadFeaturedProducts();

          // Verificar si hay fotos configuradas
          const hasPhotos =
            Array.isArray(this.slider_config()?.photos) &&
            this.slider_config()?.photos.length > 0;

          // El slider se muestra si hay fotos
          // El campo 'enable' es opcional - si no existe, se asume true cuando hay fotos
          this.show_slider.set(hasPhotos);

          // Mapeo de contenido para el banner estático desde ecommerce.inicio
          const inicio = ecommerceConfig.inicio || {};

          this.banner_content.set({
            title: inicio.titulo || 'Bienvenido',
            paragraph: inicio.parrafo || 'Encuentra aquí todo lo que buscas...',
          });
        },
      });
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
    const result = this.cart_service.addToCart(product.id, 1);
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
