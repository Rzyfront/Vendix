import { Component, OnInit, inject, DestroyRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { CatalogService, Product } from '../../services/catalog.service';
import { CartService } from '../../services/cart.service';
import { ProductCardComponent } from '../../components/product-card/product-card.component';
import { HeroBannerComponent } from '../../components/hero-banner';
import { CategoriesShowcaseComponent } from '../../components/categories-showcase';
import { ProductsScrollComponent } from '../../components/products-scroll';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

@Component({
    selector: 'app-home',
    standalone: true,
    imports: [
        CommonModule,
        RouterModule,
        ProductCardComponent,
        HeroBannerComponent,
        CategoriesShowcaseComponent,
        ProductsScrollComponent,
    ],
    templateUrl: './home.component.html',
    styleUrls: ['./home.component.scss'],
})
export class HomeComponent implements OnInit {
    featured_products: Product[] = [];
    is_loading_featured = true;
    thirty_days_ago: string;

    private destroy_ref = inject(DestroyRef);

    constructor(
        private catalog_service: CatalogService,
        private cart_service: CartService,
    ) {
        // Calculate once in constructor to avoid expression changed errors
        this.thirty_days_ago = this.getThirtyDaysAgo();
    }

    ngOnInit(): void {
        this.loadFeaturedProducts();
    }

    loadFeaturedProducts(): void {
        this.catalog_service.getProducts({ limit: 8, sort_by: 'newest' }).pipe(
            takeUntilDestroyed(this.destroy_ref)
        ).subscribe({
            next: (response) => {
                this.featured_products = response.data;
                this.is_loading_featured = false;
            },
            error: () => {
                this.is_loading_featured = false;
            },
        });
    }

    onAddToCart(product: Product): void {
        this.cart_service.addToLocalCart(product.id, 1);
    }

    onToggleWishlist(product: Product): void {
        // TODO: Implement wishlist toggle
    }

    getThirtyDaysAgo(): string {
        const date = new Date();
        date.setDate(date.getDate() - 30);
        return date.toISOString();
    }
}
