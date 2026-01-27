import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { Subject } from 'rxjs';
import { takeUntil, debounceTime, distinctUntilChanged } from 'rxjs/operators';
import {
  CatalogService,
  Product,
  Category,
  Brand,
  CatalogQuery,
} from '../../services/catalog.service';
import { CartService } from '../../services/cart.service';
import { ProductCardComponent } from '../../components/product-card/product-card.component';

@Component({
  selector: 'app-catalog-page',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule, ProductCardComponent],
  templateUrl: './catalog.component.html',
  styleUrls: ['./catalog.component.scss'],
})
export class CatalogComponent implements OnInit, OnDestroy {
  products: Product[] = [];
  categories: Category[] = [];
  brands: Brand[] = [];

  // Filters
  search_term = '';
  selected_category_id: number | null = null;
  selected_brand_id: number | null = null;
  min_price: number | null = null;
  max_price: number | null = null;
  sort_by: 'name' | 'price_asc' | 'price_desc' | 'newest' = 'newest';

  // Pagination
  current_page = 1;
  total_pages = 1;
  total_products = 0;
  limit = 12;

  is_loading = false;
  show_filters = false;

  // Quick View
  quickViewOpen = false;
  selectedProductSlug: string | null = null;

  private destroy$ = new Subject<void>();
  private search_subject = new Subject<string>();

  constructor(
    private catalog_service: CatalogService,
    private cart_service: CartService,
    private route: ActivatedRoute,
    private router: Router,
  ) {}

  ngOnInit(): void {
    // Load categories and brands
    this.loadCategories();
    this.loadBrands();

    // Handle search debounce
    this.search_subject
      .pipe(debounceTime(400), distinctUntilChanged(), takeUntil(this.destroy$))
      .subscribe(() => {
        this.current_page = 1;
        this.loadProducts();
      });

    // Handle route data and query params
    const routeData = this.route.snapshot.data;
    if (routeData['defaultFilters']) {
      const defaults = routeData['defaultFilters'];
      if (defaults.sort_by) this.sort_by = defaults.sort_by;
      if (defaults.has_discount !== undefined) {
        // We'll use a special flag for this if needed,
        // for now let's assume we pass it to loadProducts
      }
    }

    this.route.queryParams
      .pipe(takeUntil(this.destroy$))
      .subscribe((params) => {
        if (params['category']) {
          this.selected_category_id = +params['category'];
        }
        if (params['brand']) {
          this.selected_brand_id = +params['brand'];
        }
        if (params['search']) {
          this.search_term = params['search'];
        }
        this.loadProducts();
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  loadProducts(): void {
    this.is_loading = true;

    const routeData = this.route.snapshot.data;
    const defaults = routeData['defaultFilters'] || {};

    const query: CatalogQuery = {
      page: this.current_page,
      limit: this.limit,
      sort_by: this.sort_by,
    };

    if (this.search_term) query.search = this.search_term;
    if (this.selected_category_id)
      query.category_id = this.selected_category_id;
    if (this.selected_brand_id) query.brand_id = this.selected_brand_id;
    if (this.min_price) query.min_price = this.min_price;
    if (this.max_price) query.max_price = this.max_price;

    // Merge with default filters from route data
    if (defaults.has_discount) query.has_discount = true;
    if (defaults.created_after) query.created_after = defaults.created_after;

    this.catalog_service.getProducts(query).subscribe({
      next: (response) => {
        this.products = response.data;
        this.total_products = response.meta.total;
        this.total_pages = response.meta.total_pages;
        this.current_page = response.meta.page;
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
          this.categories = response.data;
        }
      },
    });
  }

  loadBrands(): void {
    this.catalog_service.getBrands().subscribe({
      next: (response) => {
        if (response.success) {
          this.brands = response.data;
        }
      },
    });
  }

  onSearchChange(): void {
    this.search_subject.next(this.search_term);
  }

  onCategorySelect(category_id: number | null): void {
    this.selected_category_id = category_id;
    this.current_page = 1;
    this.updateUrl();
    this.loadProducts();
  }

  onBrandSelect(brand_id: number | null): void {
    this.selected_brand_id = brand_id;
    this.current_page = 1;
    this.updateUrl();
    this.loadProducts();
  }

  onSortChange(): void {
    this.current_page = 1;
    this.loadProducts();
  }

  applyPriceFilter(): void {
    this.current_page = 1;
    this.loadProducts();
  }

  clearFilters(): void {
    this.search_term = '';
    this.selected_category_id = null;
    this.selected_brand_id = null;
    this.min_price = null;
    this.max_price = null;
    this.sort_by = 'newest';
    this.current_page = 1;
    this.updateUrl();
    this.loadProducts();
  }

  toggleFilters(): void {
    this.show_filters = !this.show_filters;
  }

  goToPage(page: number): void {
    if (page >= 1 && page <= this.total_pages) {
      this.current_page = page;
      this.loadProducts();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  onAddToCart(product: Product): void {
    const result = this.cart_service.addToCart(product.id, 1);
    if (result) {
      result.subscribe();
    }
    // TODO: Show toast notification
  }

  onToggleWishlist(product: Product): void {
    // TODO: Implement wishlist toggle
  }

  onQuickView(product: Product): void {
    this.selectedProductSlug = product.slug;
    this.quickViewOpen = true;
  }

  private updateUrl(): void {
    const queryParams: any = {};
    if (this.selected_category_id)
      queryParams.category = this.selected_category_id;
    if (this.selected_brand_id) queryParams.brand = this.selected_brand_id;
    if (this.search_term) queryParams.search = this.search_term;

    this.router.navigate([], {
      relativeTo: this.route,
      queryParams,
      queryParamsHandling: 'merge',
    });
  }

  get page_numbers(): number[] {
    const pages: number[] = [];
    const start = Math.max(1, this.current_page - 2);
    const end = Math.min(this.total_pages, this.current_page + 2);

    for (let i = start; i <= end; i++) {
      pages.push(i);
    }
    return pages;
  }
}
