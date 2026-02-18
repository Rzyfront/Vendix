import { Component, OnInit, inject, DestroyRef, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Router } from '@angular/router';
import { CatalogService, EcommerceProduct, Category } from '../../services/catalog.service';
import { CartService } from '../../services/cart.service';
import { WishlistService } from '../../services/wishlist.service';
import { StoreUiService } from '../../services/store-ui.service';
import { TenantFacade } from '../../../../../../app/core/store/tenant/tenant.facade';
import { AuthFacade } from '../../../../../core/store/auth/auth.facade';
import { ProductCardComponent } from '../../components/product-card/product-card.component';
import { HeroBannerComponent } from '../../components/hero-banner';
import { ProductQuickViewModalComponent } from '../../components/product-quick-view-modal';
import { ShareModalComponent } from '../../components/share-modal/share-modal.component';
import { ButtonComponent } from '../../../../../shared/components/button/button.component';
import { ToastService } from '../../../../../shared/components/toast/toast.service';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    ProductCardComponent,
    HeroBannerComponent,
    ProductQuickViewModalComponent,
    ShareModalComponent,
    ButtonComponent,
  ],
  templateUrl: './home.component.html',
  styleUrls: ['./home.component.scss'],
})
export class HomeComponent implements OnInit {
  featured_products: EcommerceProduct[] = [];
  new_arrivals: EcommerceProduct[] = [];
  sale_products: EcommerceProduct[] = [];
  is_loading_featured = true;
  slider_config: any = null;
  show_slider = false;
  banner_content = { title: '', paragraph: '' };

  // Quick View Modal
  quickViewOpen = false;
  selectedProductSlug: string | null = null;

  // Share Modal
  shareModalOpen = false;
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
  ) { }

  ngOnInit(): void {
    this.loadFeaturedProducts();
    this.loadPublicConfig();

    // Subscribe to authentication state
    this.auth_facade.isAuthenticated$
      .pipe(takeUntilDestroyed(this.destroy_ref))
      .subscribe(is_auth => {
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
      .subscribe(wishlist => {
        this.wishlist_product_ids = new Set(
          wishlist?.items.map(item => item.product_id) || []
        );
      });
  }

  loadFeaturedProducts(): void {
    this.catalog_service
      .getProducts({ limit: 16, sort_by: 'best_selling' as any })
      .pipe(takeUntilDestroyed(this.destroy_ref))
      .subscribe({
        next: (response) => {
          this.featured_products = response.data;
          this.is_loading_featured = false;
        },
        error: () => {
          this.is_loading_featured = false;
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

          this.slider_config = ecommerceConfig.slider || null;

          // Verificar si hay fotos configuradas
          const hasPhotos =
            Array.isArray(this.slider_config?.photos) &&
            this.slider_config.photos.length > 0;

          // El slider se muestra si hay fotos
          // El campo 'enable' es opcional - si no existe, se asume true cuando hay fotos
          this.show_slider = hasPhotos;

          // Mapeo de contenido para el banner estático desde ecommerce.inicio
          const inicio = ecommerceConfig.inicio || {};

          this.banner_content = {
            title: inicio.titulo || 'Bienvenido',
            paragraph: inicio.parrafo || 'Encuentra aquí todo lo que buscas...',
          };

          console.log('Home Config (Resolved):', {
            source: 'customConfig.ecommerce',
            hasEcommerceConfig: !!customConfig.ecommerce,
            slider: {
              hasPhotos: hasPhotos,
              photosCount: this.slider_config?.photos?.length || 0,
              show: this.show_slider,
            },
            inicio: inicio,
          });
        },
      });
  }

  onAddToCart(product: EcommerceProduct): void {
    // Guard: variant products must go through detail page for variant selection
    if (product.variant_count && product.variant_count > 0) {
      this.router.navigate(['/catalog', product.slug]);
      return;
    }
    const result = this.cart_service.addToCart(product.id, 1);
    if (result) {
      result.subscribe();
    }
  }

  onModalAddedToCart(_product: EcommerceProduct): void {
    // Modal already added the product to cart and closed itself
    this.quickViewOpen = false;
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
    this.selectedProductSlug = product.slug;
    this.quickViewOpen = true;
  }

  onShare(product: EcommerceProduct): void {
    this.shareProduct = product;
    this.shareModalOpen = true;
  }

  onShareModalClosed(): void {
    this.shareModalOpen = false;
    this.shareProduct = null;
  }

  onViewMore(): void {
    this.router.navigate(['/products']).then(() => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }
}
