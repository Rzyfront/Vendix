import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { Subject } from 'rxjs';
import { takeUntil, debounceTime, distinctUntilChanged } from 'rxjs/operators';
import {
  CatalogService,
  EcommerceProduct,
  Category,
  Brand,
  CatalogQuery,
} from '../../services/catalog.service';
import { CartService } from '../../services/cart.service';
import { WishlistService } from '../../services/wishlist.service';
import { StoreUiService } from '../../services/store-ui.service';
import { AuthFacade } from '../../../../../core/store/auth/auth.facade';
import { ProductCardComponent } from '../../components/product-card/product-card.component';
import { ProductQuickViewModalComponent } from '../../components/product-quick-view-modal';
import { ShareModalComponent } from '../../components/share-modal/share-modal.component';
import { ButtonComponent } from '../../../../../shared/components/button/button.component';
import { InputComponent } from '../../../../../shared/components/input/input.component';
import { IconComponent } from '../../../../../shared/components/icon/icon.component';
import { PaginationComponent } from '../../../../../shared/components/pagination/pagination.component';
import { ToastService } from '../../../../../shared/components/toast/toast.service';

@Component({
  selector: 'app-catalog-page',
  standalone: true,
  imports: [CommonModule, RouterModule, FormsModule, ProductCardComponent, ProductQuickViewModalComponent, ShareModalComponent, ButtonComponent, InputComponent, IconComponent, PaginationComponent],
  templateUrl: './catalog.component.html',
  styleUrls: ['./catalog.component.scss'],
})
export class CatalogComponent implements OnInit, OnDestroy {
  products: EcommerceProduct[] = [];
  categories: Category[] = [];
  brands: Brand[] = [];

  // Filters
  search_term = '';
  selected_category_id: number | null = null;
  selected_brand_id: number | null = null;
  min_price: number | null = null;
  max_price: number | null = null;
  sort_by: 'name' | 'price_asc' | 'price_desc' | 'newest' | 'oldest' = 'newest';

  // Pagination
  current_page = 1;
  total_pages = 1;
  total_products = 0;
  limit = 12;

  is_loading = false;
  show_filters = false;

  // Quick View Modal
  quickViewOpen = false;
  selectedProductSlug: string | null = null;

  // Share Modal
  shareModalOpen = false;
  shareProduct: EcommerceProduct | null = null;

  private destroy$ = new Subject<void>();
  private search_subject = new Subject<string>();

  // Wishlist state
  wishlist_product_ids = new Set<number>();
  private is_authenticated = false;

  constructor(
    private catalog_service: CatalogService,
    private cart_service: CartService,
    private wishlist_service: WishlistService,
    private store_ui_service: StoreUiService,
    private auth_facade: AuthFacade,
    private toast_service: ToastService,
    private route: ActivatedRoute,
    private router: Router,
  ) { }

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
        // Siempre actualizar search_term (vacío si no existe)
        this.search_term = params['search'] || '';

        if (params['category']) {
          this.selected_category_id = +params['category'];
        }
        if (params['brand']) {
          this.selected_brand_id = +params['brand'];
        }
        this.loadProducts();
      });

    // Subscribe to authentication state
    this.auth_facade.isAuthenticated$
      .pipe(takeUntil(this.destroy$))
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
      .pipe(takeUntil(this.destroy$))
      .subscribe(wishlist => {
        this.wishlist_product_ids = new Set(
          wishlist?.items.map(item => item.product_id) || []
        );
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
    // Handler para QuickViewModal - el modal ya agregó el producto al carrito
    // Este handler solo se usa para acciones post-adición (ej: cerrar modal, mostrar toast)
    this.quickViewOpen = false;
    // TODO: Show toast notification
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

}
