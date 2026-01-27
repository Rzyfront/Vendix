import { Component, OnInit, inject, DestroyRef, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Router } from '@angular/router';
import { CatalogService, Product, Category } from '../../services/catalog.service';
import { CartService } from '../../services/cart.service';
import { TenantFacade } from '../../../../../../app/core/store/tenant/tenant.facade';
import { ProductCardComponent } from '../../components/product-card/product-card.component';
import { HeroBannerComponent } from '../../components/hero-banner';
import { ProductQuickViewModalComponent } from '../../components/product-quick-view-modal';
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
  ],
  templateUrl: './home.component.html',
  styleUrls: ['./home.component.scss'],
})
export class HomeComponent implements OnInit {
  featured_products: Product[] = [];
  new_arrivals: Product[] = [];
  sale_products: Product[] = [];
  is_loading_featured = true;
  slider_config: any = null;
  show_slider = false;
  banner_content = { title: '', paragraph: '' };

  // Quick View Modal
  quickViewOpen = false;
  selectedProductSlug: string | null = null;

  private destroy_ref = inject(DestroyRef);
  private tenant_facade = inject(TenantFacade);
  private router = inject(Router);

  constructor(
    private catalog_service: CatalogService,
    private cart_service: CartService,
  ) { }

  ngOnInit(): void {
    this.loadFeaturedProducts();
    this.loadPublicConfig();
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

          // Según la estructura del localStorage (vendix_app_config), la configuración
          // suele estar en 'customConfig'. Mantenemos fallback a 'config' por compatibilidad.
          const config = domainConfig.customConfig || domainConfig.config || {};

          this.slider_config = config.slider || null;

          // Comprobación más permisiva para 'enable' (acepta true, "true", 1, "1")
          const enableVal = this.slider_config?.enable;
          const sliderEnabled =
            enableVal === true ||
            enableVal === 'true' ||
            enableVal === 1 ||
            enableVal === '1';

          const hasPhotos =
            Array.isArray(this.slider_config?.photos) &&
            this.slider_config.photos.length > 0;

          this.show_slider = !!(sliderEnabled && hasPhotos);

          // Mapeo de contenido para el banner estático o información del slider
          const inicio = config.inicio || {};

          this.banner_content = {
            title: inicio.titulo || 'Bienvenido',
            paragraph: inicio.parrafo || 'Encuentra aquí todo lo que buscas...',
          };

          // Debug exhaustivo para identificar la estructura real
          console.log('Home Config (Resolved):', {
            source: 'TenantFacade',
            domainConfigKeys: Object.keys(domainConfig),
            hasCustomConfig: !!domainConfig.customConfig,
            hasConfig: !!domainConfig.config,
            resolvedConfig: config,
            slider: {
              raw: this.slider_config,
              enabled: sliderEnabled,
              hasPhotos: hasPhotos,
              show: this.show_slider,
            },
          });
        },
      });
  }

  onAddToCart(product: Product): void {
    const result = this.cart_service.addToCart(product.id, 1);
    if (result) {
      result.subscribe();
    }
  }

  onToggleWishlist(product: Product): void {
    // TODO: Implement wishlist toggle
  }

  onQuickView(product: Product): void {
    this.selectedProductSlug = product.slug;
    this.quickViewOpen = true;
  }

  onViewMore(): void {
    this.router.navigate(['/products']).then(() => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }
}
