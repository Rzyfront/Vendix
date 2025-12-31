import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { CatalogService, Product, Category } from '../../services/catalog.service';
import { CartService } from '../../services/cart.service';
import { ProductCardComponent } from '../../components/product-card/product-card.component';

@Component({
    selector: 'app-home',
    standalone: true,
    imports: [CommonModule, RouterModule, ProductCardComponent],
    templateUrl: './home.component.html',
    styleUrls: ['./home.component.scss'],
})
export class HomeComponent implements OnInit {
    featured_products: Product[] = [];
    categories: Category[] = [];
    is_loading = true;

    constructor(
        private catalog_service: CatalogService,
        private cart_service: CartService,
    ) { }

    ngOnInit(): void {
        this.loadFeaturedProducts();
        this.loadCategories();
    }

    loadFeaturedProducts(): void {
        this.catalog_service.getProducts({ limit: 8, sort_by: 'newest' }).subscribe({
            next: (response) => {
                this.featured_products = response.data;
                this.is_loading = false;
            },
            error: () => {
                this.is_loading = false;
            },
        });
    }

    loadCategories(): void {
        this.catalog_service.getCategories().subscribe({
            next: (response) => {
                if (response.success) {
                    this.categories = response.data.slice(0, 6); // Show only 6 categories
                }
            },
        });
    }

    onAddToCart(product: Product): void {
        this.cart_service.addToLocalCart(product.id, 1);
    }

    onToggleWishlist(product: Product): void {
        // TODO: Implement wishlist toggle
    }
}
