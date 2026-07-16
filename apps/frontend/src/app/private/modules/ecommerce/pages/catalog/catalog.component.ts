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
import {
  MultiSelectorComponent,
  MultiSelectorOption,
} from '../../../../../shared/components/multi-selector/multi-selector.component';
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
    MultiSelectorComponent,
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
  readonly selected_category_ids = signal<number[]>([]);
  readonly selected_brand_ids = signal<number[]>([]);
  readonly min_price = signal<number | null>(null);
  readonly max_price = signal<number | null>(null);
  readonly sort_by = signal<CatalogSortBy>('newest');

  // Pagination
  readonly current_page = signal(1);
  readonly total_pages = signal(1);
  readonly total_products = signal(0);
  readonly limit = signal(12);
  readonly catalog_settings = signal<CatalogSettings>(DEFAULT_CATALOG_SETTINGS);
  readonly shipping_badge_enabled = signal(false);
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
  readonly category_options = computed<MultiSelectorOption[]>(() =>
    this.categories().map((category) => ({
      value: category.id,
      label: category.name,
    })),
  );
  readonly brand_options = computed<MultiSelectorOption[]>(() =>
    this.brands().map((brand) => ({
      value: brand.id,
      label: brand.name,
    })),
  );
  readonly selected_category_labels = computed(() =>
    this.getSelectedLabels(
      this.category_options(),
      this.selected_category_ids(),
    ),
  );
  readonly selected_brand_labels = computed(() =>
    this.getSelectedLabels(this.brand_options(), this.selected_brand_ids()),
  );
  readonly price_filter_label = computed(() => {
    const minPrice = this.min_price();
    const maxPrice = this.max_price();

    if (minPrice !== null && maxPrice !== null) {
      return `$${minPrice} - $${maxPrice}`;
    }
    if (minPrice !== null) {
      return `Desde $${minPrice}`;
    }
    if (maxPrice !== null) {
      return `Hasta $${maxPrice}`;
    }
    return '';
  });
  readonly active_filters_count = computed(() => {
    let count =
      this.selected_category_ids().length + this.selected_brand_ids().length;
    if (this.min_price() !== null || this.max_price() !== null) {
      count += 1;
    }
    return count;
  });
  readonly has_active_filters = computed(() => this.active_filters_count() > 0);

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
      .pipe(
        debounceTime(400),
        distinctUntilChanged(),
        takeUntilDestroyed(this.destroyRef),
      )
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

        const categoryParam =
          params['category_ids'] ||
          params['categories'] ||
          params['category'] ||
          params['category_id'];
        const brandParam =
          params['brand_ids'] ||
          params['brands'] ||
          params['brand'] ||
          params['brand_id'];
        this.selected_category_ids.set(this.parseIdsParam(categoryParam));
        this.selected_brand_ids.set(this.parseIdsParam(brandParam));
        this.min_price.set(this.parsePriceParam(params['min_price']));
        this.max_price.set(this.parsePriceParam(params['max_price']));
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
    if (this.selected_category_ids().length > 0)
      query.category_ids = this.selected_category_ids().join(',');
    if (this.selected_brand_ids().length > 0)
      query.brand_ids = this.selected_brand_ids().join(',');
    if (this.min_price() !== null) query.min_price = this.min_price()!;
    if (this.max_price() !== null) query.max_price = this.max_price()!;

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
    this.shipping_badge_enabled.set(this.hasConfiguredShipping(ecommerce));
    this.limit.set(productsPerPage);

    if (catalog.enable_filters !== true) {
      this.show_filters.set(false);
    }
  }

  private hasConfiguredShipping(ecommerce: any): boolean {
    const shipping = ecommerce?.shipping || {};
    return (
      shipping.has_configured_shipping === true ||
      shipping.enabled === true ||
      shipping.shipping_enabled === true
    );
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

  onCategoriesChange(category_ids: (string | number)[]): void {
    this.selected_category_ids.set(this.toNumberArray(category_ids));
    this.current_page.set(1);
    this.updateUrl();
    this.loadProducts();
  }

  onBrandsChange(brand_ids: (string | number)[]): void {
    this.selected_brand_ids.set(this.toNumberArray(brand_ids));
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

  onMinPriceChange(value: string | number | null): void {
    this.min_price.set(this.normalizePriceValue(value));
  }

  onMaxPriceChange(value: string | number | null): void {
    this.max_price.set(this.normalizePriceValue(value));
  }

  applyPriceFilter(): void {
    this.current_page.set(1);
    this.updateUrl();
    this.loadProducts();
  }

  clearFilters(): void {
    this.search_term.set('');
    this.selected_category_ids.set([]);
    this.selected_brand_ids.set([]);
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
    // Chokepoint (D3): mesa-vs-cart routing lives in `cartService.addProduct`.
    const result = this.cart_service.addProduct(product.id, 1);
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
    const queryParams: Record<string, string | number | null> = {
      category: null,
      category_id: null,
      category_ids: null,
      categories: null,
      brand: null,
      brand_id: null,
      brand_ids: null,
      brands: null,
      min_price: null,
      max_price: null,
      search: null,
    };
    if (this.selected_category_ids().length > 0)
      queryParams['category_ids'] = this.selected_category_ids().join(',');
    if (this.selected_brand_ids().length > 0)
      queryParams['brand_ids'] = this.selected_brand_ids().join(',');
    if (this.min_price() !== null) queryParams['min_price'] = this.min_price();
    if (this.max_price() !== null) queryParams['max_price'] = this.max_price();
    if (this.search_term()) queryParams['search'] = this.search_term();

    this.router.navigate([], {
      relativeTo: this.route,
      queryParams,
      queryParamsHandling: 'merge',
    });
  }

  private parseIdsParam(value: unknown): number[] {
    if (!value) return [];

    const rawValue = Array.isArray(value) ? value.join(',') : String(value);
    return this.toNumberArray(rawValue.split(','));
  }

  private parsePriceParam(value: unknown): number | null {
    if (value === null || value === undefined || value === '') return null;
    return this.normalizePriceValue(String(value));
  }

  private normalizePriceValue(value: string | number | null): number | null {
    if (value === null || value === undefined || value === '') return null;

    const numericValue = Number(value);
    if (!Number.isFinite(numericValue) || numericValue < 0) return null;

    return numericValue;
  }

  private toNumberArray(values: (string | number)[]): number[] {
    return [
      ...new Set(
        values
          .map((value) => Number(value))
          .filter((value) => Number.isInteger(value) && value > 0),
      ),
    ];
  }

  private getSelectedLabels(
    options: MultiSelectorOption[],
    selectedIds: number[],
  ): string[] {
    return selectedIds.map((id) => {
      const option = options.find((item) => Number(item.value) === id);
      return option?.label || String(id);
    });
  }
}
