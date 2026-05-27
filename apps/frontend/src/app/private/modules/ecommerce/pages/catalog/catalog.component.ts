import {
  Component,
  ChangeDetectionStrategy,
  OnInit,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { Subject } from 'rxjs';
import { debounceTime, distinctUntilChanged } from 'rxjs/operators';
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
import { TenantFacade } from '../../../../../core/store/tenant/tenant.facade';
import { ProductCardComponent } from '../../components/product-card/product-card.component';
import { ProductQuickViewModalComponent } from '../../components/product-quick-view-modal';
import { ShareModalComponent } from '../../components/share-modal/share-modal.component';
import { ButtonComponent } from '../../../../../shared/components/button/button.component';
import { InputComponent } from '../../../../../shared/components/input/input.component';
import { IconComponent } from '../../../../../shared/components/icon/icon.component';
import { PaginationComponent } from '../../../../../shared/components/pagination/pagination.component';
import {
  SelectorComponent,
  SelectorOption,
} from '../../../../../shared/components/selector/selector.component';
import { ToastService } from '../../../../../shared/components/toast/toast.service';

interface CatalogSettings {
  products_per_page: number;
  show_out_of_stock: boolean;
  show_variants: boolean;
  show_related_products: boolean;
  enable_filters: boolean;
}

type CatalogSortBy = 'name' | 'price_asc' | 'price_desc' | 'newest' | 'oldest';

const DEFAULT_CATALOG_SETTINGS: CatalogSettings = {
  products_per_page: 12,
  show_out_of_stock: false,
  show_variants: true,
  show_related_products: false,
  enable_filters: false,
};

@Component({
  selector: 'app-catalog-page',
  standalone: true,
  imports: [
    RouterModule,
    FormsModule,
    ProductCardComponent,
    ProductQuickViewModalComponent,
    ShareModalComponent,
    ButtonComponent,
    InputComponent,
    IconComponent,
    PaginationComponent,
    SelectorComponent,
  ],
  templateUrl: './catalog.component.html',
  styleUrls: ['./catalog.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CatalogComponent implements OnInit {
  readonly products = signal<EcommerceProduct[]>([]);
  readonly categories = signal<Category[]>([]);
  readonly brands = signal<Brand[]>([]);

  // Filters
  readonly search_term = signal('');
  readonly selected_category_id = signal<number | null>(null);
  readonly selected_brand_id = signal<number | null>(null);
  readonly min_price = signal<number | null>(null);
  readonly max_price = signal<number | null>(null);
  readonly sort_by = signal<CatalogSortBy>('newest');

  // Pagination
  readonly current_page = signal(1);
  readonly total_pages = signal(1);
  readonly total_products = signal(0);
  readonly limit = signal(12);
  readonly catalog_settings = signal<CatalogSettings>(DEFAULT_CATALOG_SETTINGS);
  readonly filters_enabled = computed(
    () => this.catalog_settings().enable_filters === true,
  );
  readonly show_variants = computed(
    () => this.catalog_settings().show_variants !== false,
  );
  readonly sortOptions: SelectorOption[] = [
    { value: 'newest', label: 'Más recientes' },
    { value: 'oldest', label: 'Menos recientes' },
    { value: 'name', label: 'Nombre A-Z' },
    { value: 'price_asc', label: 'Precio: menor a mayor' },
    { value: 'price_desc', label: 'Precio: mayor a menor' },
  ];

  readonly is_loading = signal(false);
  readonly show_filters = signal(false);

  // Quick View Modal
  readonly quickViewOpen = signal(false);
  readonly selectedProductSlug = signal<string | null>(null);

  // Share Modal
  readonly shareModalOpen = signal(false);
  readonly shareProduct = signal<EcommerceProduct | null>(null);

  private destroyRef = inject(DestroyRef);
  private search_subject = new Subject<string>(); // LEGÍTIMO — debounceTime+distinctUntilChanged search stream

  // Wishlist state
  readonly wishlist_product_ids = signal<Set<number>>(new Set<number>());
  private is_authenticated = false;

  constructor(
    private catalog_service: CatalogService,
    private cart_service: CartService,
    private wishlist_service: WishlistService,
    private store_ui_service: StoreUiService,
    private auth_facade: AuthFacade,
    private tenant_facade: TenantFacade,
    private toast_service: ToastService,
    private route: ActivatedRoute,
    private router: Router,
  ) {}

  ngOnInit(): void {
    this.applyCatalogSettings(
      this.tenant_facade.getCurrentDomainConfig()?.customConfig?.ecommerce,
    );
    this.loadPublicCatalogSettings();

    // Load categories and brands
    this.loadCategories();
    this.loadBrands();

    // Handle search debounce
    this.search_subject
      .pipe(debounceTime(400), distinctUntilChanged(), takeUntilDestroyed(this.destroyRef))
      .subscribe(() => {
        this.current_page.set(1);
        this.loadProducts();
      });

    // Handle route data and query params
    const routeData = this.route.snapshot.data;
    if (routeData['defaultFilters']) {
      const defaults = routeData['defaultFilters'];
      if (defaults.sort_by) this.sort_by.set(defaults.sort_by);
      if (defaults.has_discount !== undefined) {
        // We'll use a special flag for this if needed,
        // for now let's assume we pass it to loadProducts
      }
    }

    this.route.queryParams
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((params) => {
        // Siempre actualizar search_term (vacío si no existe)
        this.search_term.set(params['search'] || '');

        const categoryParam = params['category'] || params['category_id'];
        const brandParam = params['brand'] || params['brand_id'];
        this.selected_category_id.set(categoryParam ? +categoryParam : null);
        this.selected_brand_id.set(brandParam ? +brandParam : null);
        this.loadProducts();
      });

    // Subscribe to authentication state
    this.auth_facade.isAuthenticated$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((is_auth) => {
        this.is_authenticated = is_auth;
        if (is_auth) {
          // Load wishlist when user is authenticated
          this.wishlist_service.getWishlist().subscribe();
        } else {
          // Clear wishlist state when not authenticated
          this.wishlist_product_ids.set(new Set<number>());
        }
      });

    // Subscribe to wishlist changes
    this.wishlist_service.wishlist$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((wishlist) => {
        this.wishlist_product_ids.set(
          new Set(wishlist?.items.map((item) => item.product_id) || []),
        );
      });
  }

  loadProducts(): void {
    this.is_loading.set(true);

    const routeData = this.route.snapshot.data;
    const defaults = routeData['defaultFilters'] || {};

    const query: CatalogQuery = {
      page: this.current_page(),
      limit: this.limit(),
      sort_by: this.sort_by(),
    };

    if (this.search_term()) query.search = this.search_term();
    if (this.selected_category_id())
      query.category_id = this.selected_category_id()!;
    if (this.selected_brand_id()) query.brand_id = this.selected_brand_id()!;
    if (this.min_price()) query.min_price = this.min_price()!;
    if (this.max_price()) query.max_price = this.max_price()!;

    // Merge with default filters from route data
    if (defaults.has_discount) query.has_discount = true;
    if (defaults.created_after) query.created_after = defaults.created_after;

    this.catalog_service
      .getProducts(query)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          this.products.set(response.data);
          this.total_products.set(response.meta.total);
          this.total_pages.set(response.meta.total_pages);
          this.current_page.set(response.meta.page);
          this.is_loading.set(false);
        },
        error: () => {
          this.is_loading.set(false);
        },
      });
  }

  private loadPublicCatalogSettings(): void {
    this.catalog_service
      .getPublicConfig()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          this.applyCatalogSettings(response.data?.ecommerce);
          this.loadProducts();
        },
      });
  }

  private applyCatalogSettings(ecommerce: any): void {
    const catalog = {
      ...DEFAULT_CATALOG_SETTINGS,
      ...(ecommerce?.catalog || {}),
    };
    const productsPerPage = Number(catalog.products_per_page || 12);

    this.catalog_settings.set({
      products_per_page: productsPerPage,
      show_out_of_stock: catalog.show_out_of_stock === true,
      show_variants: catalog.show_variants !== false,
      show_related_products: catalog.show_related_products === true,
      enable_filters: catalog.enable_filters === true,
    });
    this.limit.set(productsPerPage);

    if (catalog.enable_filters !== true) {
      this.show_filters.set(false);
    }
  }

  loadCategories(): void {
    this.catalog_service
      .getCategories()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          if (response.success) {
            this.categories.set(response.data);
          }
        },
      });
  }

  loadBrands(): void {
    this.catalog_service
      .getBrands()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          if (response.success) {
            this.brands.set(response.data);
          }
        },
      });
  }

  onSearchChange(): void {
    this.search_subject.next(this.search_term());
  }

  onCategorySelect(category_id: number | null): void {
    this.selected_category_id.set(category_id);
    this.current_page.set(1);
    this.updateUrl();
    this.loadProducts();
  }

  onBrandSelect(brand_id: number | null): void {
    this.selected_brand_id.set(brand_id);
    this.current_page.set(1);
    this.updateUrl();
    this.loadProducts();
  }

  onSortChange(value?: string | number | null): void {
    if (typeof value === 'string') {
      this.sort_by.set(value as CatalogSortBy);
    }
    this.current_page.set(1);
    this.loadProducts();
  }

  applyPriceFilter(): void {
    this.current_page.set(1);
    this.loadProducts();
  }

  clearFilters(): void {
    this.search_term.set('');
    this.selected_category_id.set(null);
    this.selected_brand_id.set(null);
    this.min_price.set(null);
    this.max_price.set(null);
    this.sort_by.set('newest');
    this.current_page.set(1);
    this.updateUrl();
    this.loadProducts();
  }

  toggleFilters(): void {
    this.show_filters.set(!this.show_filters());
  }

  goToPage(page: number): void {
    if (page >= 1 && page <= this.total_pages()) {
      this.current_page.set(page);
      this.loadProducts();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
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
    // Handler para QuickViewModal - el modal ya agregó el producto al carrito
    // Este handler solo se usa para acciones post-adición (ej: cerrar modal, mostrar toast)
    this.quickViewOpen.set(false);
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
    return this.wishlist_product_ids().has(product_id);
  }

  onQuickView(product: EcommerceProduct): void {
    this.selectedProductSlug.set(product.slug);
    this.quickViewOpen.set(true);
  }

  onShare(product: EcommerceProduct): void {
    this.shareProduct.set(product);
    this.shareModalOpen.set(true);
  }

  onShareModalClosed(): void {
    this.shareModalOpen.set(false);
    this.shareProduct.set(null);
  }

  private updateUrl(): void {
    const queryParams: any = {};
    if (this.selected_category_id())
      queryParams.category = this.selected_category_id();
    if (this.selected_brand_id()) queryParams.brand = this.selected_brand_id();
    if (this.search_term()) queryParams.search = this.search_term();

    this.router.navigate([], {
      relativeTo: this.route,
      queryParams,
      queryParamsHandling: 'merge',
    });
  }
}
