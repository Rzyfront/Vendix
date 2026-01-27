import { Component, OnInit, inject, DestroyRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, Router } from '@angular/router';
import { CatalogService, Product, Category } from '../../services/catalog.service';
import { CartService } from '../../services/cart.service';
import { ProductCardComponent } from '../../components/product-card/product-card.component';
import { HeroBannerComponent } from '../../components/hero-banner';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    ProductCardComponent,
    HeroBannerComponent,
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

  private destroy_ref = inject(DestroyRef);

  constructor(
    private catalog_service: CatalogService,
    private cart_service: CartService,
  ) {}

  ngOnInit(): void {
    this.loadFeaturedProducts();
    this.loadPublicConfig();
  }

  loadFeaturedProducts(): void {
    this.catalog_service
      .getProducts({ limit: 30, sort_by: 'newest' })
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
    this.catalog_service
      .getPublicConfig()
      .pipe(takeUntilDestroyed(this.destroy_ref))
      .subscribe({
        next: (response) => {
          this.slider_config = response.data?.slider || null;
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
