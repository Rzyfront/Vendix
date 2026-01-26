import {
  Component,
  OnInit,
  OnDestroy,
  NO_ERRORS_SCHEMA,
  Output,
  EventEmitter,
} from '@angular/core';
import { Subject, debounceTime, distinctUntilChanged, takeUntil } from 'rxjs';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Store } from '@ngrx/store';

import {
  IconComponent,
  ButtonComponent,
  InputsearchComponent,
  ToastService,
  DialogService,
} from '../../../../../shared/components';
import { Router } from '@angular/router';

import { PosCartService } from '../services/pos-cart.service';
import {
  PosProductService,
  SearchResult,
} from '../services/pos-product.service';
import { environment } from '../../../../../../environments/environment';
import {
  selectAccessToken,
  selectUser,
} from '../../../../../core/store/auth/auth.selectors';
import { ProductFilterDropdownComponent } from '../../products/components/product-filter-dropdown/product-filter-dropdown.component';
import { ProductQueryDto, Brand } from '../../products/interfaces';

@Component({
  selector: 'app-pos-product-selection',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    IconComponent,
    ButtonComponent,
    InputsearchComponent,
    ProductFilterDropdownComponent,
  ],
  schemas: [NO_ERRORS_SCHEMA],
  template: `
    <div
      class="h-full flex flex-col bg-surface rounded-card shadow-card border border-border overflow-hidden"
    >
      <!-- Products Header -->
      <div class="px-6 py-4 border-b border-border">
        <div
          class="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4"
        >
          <div class="flex-1 min-w-0">
            <h2 class="text-lg font-semibold text-text-primary">
              Productos Disponibles ({{ filteredProducts.length }})
            </h2>
          </div>

          <div
            class="flex flex-col lg:flex-row items-start lg:items-center gap-3 w-full lg:w-auto"
          >
            <!-- Input de búsqueda -->
            <app-inputsearch
              class="w-full lg:w-64"
              size="sm"
              placeholder="Buscar productos..."
              [debounceTime]="300"
              [(ngModel)]="searchQuery"
              (searchChange)="onSearch($event)"
            />

            <!-- Componente de filtros -->
            <app-product-filter-dropdown
              [categories]="categories"
              [brands]="brands"
              [isLoading]="loading"
              [searchTerm]="searchQuery"
              [selectedCategory]="selectedCategory?.id?.toString() || ''"
              [selectedBrand]="selectedBrand?.id?.toString() || ''"
              (filterChange)="onFilterChange($event)"
              class="w-full lg:w-auto"
            ></app-product-filter-dropdown>

            <app-button
              variant="outline"
              size="sm"
              (clicked)="onToggleScanMode()"
              class="shrink-0"
              title="Escanear código de barras"
            >
              <app-icon name="barcode" [size]="16" slot="icon"></app-icon>
            </app-button>
          </div>
        </div>
      </div>

      <!-- Products Content -->
      <div class="flex-1 overflow-y-auto p-6">
        <!-- Loading State -->
        <div *ngIf="loading" class="p-8 text-center">
          <div
            class="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"
          ></div>
          <p class="mt-2 text-text-secondary">Cargando productos...</p>
        </div>

        <!-- Empty State -->
        <div
          *ngIf="!loading && filteredProducts.length === 0"
          class="flex flex-col items-center justify-center h-64 text-center p-8"
        >
          <div
            class="w-16 h-16 bg-muted rounded-full flex items-center justify-center mb-4"
          >
            <app-icon
              name="package"
              [size]="32"
              class="text-text-secondary"
            ></app-icon>
          </div>
          <h3 class="text-lg font-semibold text-text-primary mb-2">
            {{ getEmptyStateTitle() }}
          </h3>
          <p class="text-sm text-text-secondary mb-4 max-w-xs mx-auto">
            {{ getEmptyStateDescription() }}
          </p>
          <app-button
            *ngIf="searchQuery"
            variant="outline"
            size="md"
            (clicked)="onClearSearch()"
          >
            Limpiar búsqueda
          </app-button>
        </div>

        <!-- Modern Compact Products Grid -->
        <div
          *ngIf="!loading && filteredProducts.length > 0"
          class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3"
        >
          <!-- Modern Product Card -->
          <div
            *ngFor="let product of filteredProducts; trackBy: trackByProductId"
            (click)="onAddToCart(product)"
            class="group relative bg-surface border border-border rounded-card shadow-card hover:shadow-lg transition-all duration-200 hover:scale-[1.02] cursor-pointer overflow-hidden"
            [class]="
              product.stock === 0
                ? 'opacity-60 cursor-not-allowed'
                : 'cursor-pointer hover:border-primary'
            "
          >
            <!-- Product Image or Icon -->
            <div
              class="aspect-square bg-gradient-to-br from-surface to-muted/30 relative overflow-hidden"
            >
              <!-- Product Image -->
              <img
                *ngIf="product.image_url || product.image"
                [src]="product.image_url || product.image"
                [alt]="product.name"
                class="w-full h-full object-cover"
                (error)="onImageError($event)"
              />

              <!-- Default Icon when no image -->
              <div
                *ngIf="!product.image && !product.image_url"
                class="absolute inset-0 flex items-center justify-center"
              >
                <div
                  class="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center"
                >
                  <app-icon
                    name="image"
                    [size]="24"
                    class="text-primary/60"
                  ></app-icon>
                </div>
              </div>

              <!-- Stock Badge -->
              <div
                *ngIf="product.stock <= 5"
                class="absolute top-2 right-2 px-2 py-1 rounded-md text-xs font-semibold backdrop-blur-sm border"
                [class]="
                  product.stock === 0
                    ? 'bg-error/80 text-white border-error/60'
                    : 'bg-warning/80 text-white border-warning/60'
                "
              >
                {{
                  product.stock === 0 ? 'AGOTADO' : 'Últimas ' + product.stock
                }}
              </div>
            </div>

            <!-- Product Info -->
            <div class="p-3">
              <!-- Product Name -->
              <h3
                class="text-text-primary font-medium text-sm leading-tight line-clamp-2 mb-2 group-hover:text-primary transition-colors"
                [title]="product.name"
              >
                {{ product.name }}
              </h3>

              <!-- Product Description (shortened) -->
              <p
                *ngIf="product.description"
                class="text-text-secondary text-xs line-clamp-1 mb-2"
                [title]="product.description"
              >
                {{ product.description }}
              </p>

              <!-- Bottom Section: Price and Quick Add -->
              <div class="flex items-center justify-between">
                <!-- Price -->
                <div class="flex flex-col">
                  <span class="text-text-primary font-bold text-lg">
                    {{ product.final_price | currency }}
                  </span>
                </div>

                <!-- Quick Add Button -->
                <button
                  class="w-7 h-7 rounded-full bg-primary/10 hover:bg-primary/20 border border-primary/20 hover:border-primary/30 flex items-center justify-center transition-all duration-200 group/btn"
                  [class]="
                    product.stock === 0
                      ? 'opacity-50 cursor-not-allowed'
                      : 'hover:bg-primary/30 hover:scale-110'
                  "
                  [disabled]="product.stock === 0"
                >
                  <app-icon
                    name="plus"
                    [size]="14"
                    class="text-primary/70 group-hover/btn:text-primary transition-colors"
                  ></app-icon>
                </button>
              </div>

              <!-- Additional Product Details -->
              <div
                *ngIf="product.sku || product.category_name"
                class="mt-2 pt-2 border-t border-border/60"
              >
                <div
                  class="flex items-center justify-between text-xs text-text-muted"
                >
                  <span *ngIf="product.sku" class="font-mono">{{
                    product.sku
                  }}</span>
                  <span *ngIf="product.category_name">{{
                    product.category_name
                  }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        height: 100%;
      }

      .scrollbar-hide::-webkit-scrollbar {
        display: none;
      }
      .scrollbar-hide {
        -ms-overflow-style: none;
        scrollbar-width: none;
      }

      /* Clamp utilities for text truncation */
      .line-clamp-1 {
        display: -webkit-box;
        -webkit-line-clamp: 1;
        -webkit-box-orient: vertical;
        overflow: hidden;
      }

      .line-clamp-2 {
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
      }

      /* Modern card transitions */
      .modern-card {
        transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
      }

      /* Subtle hover effects */
      .modern-card:hover {
        transform: translateY(-1px);
      }

      /* Price styling */
      .price-primary {
        color: var(--color-primary);
        font-weight: var(--fw-bold);
      }

      /* Stock badges */
      .stock-badge {
        backdrop-filter: blur(8px);
        -webkit-backdrop-filter: blur(8px);
      }
    `,
  ],
})
export class PosProductSelectionComponent implements OnInit, OnDestroy {
  loading = false;
  searchQuery = '';
  selectedCategory: any = null;
  selectedBrand: any = null;
  filteredProducts: any[] = [];
  categories: any[] = [];
  brands: any[] = [];
  addingToCart = new Set<string>();

  @Output() productSelected = new EventEmitter<any>();
  @Output() productAddedToCart = new EventEmitter<{
    product: any;
    quantity: number;
  }>();

  private destroy$ = new Subject<void>();
  private searchSubject$ = new Subject<string>();

  constructor(
    private productService: PosProductService,
    private cartService: PosCartService,
    private toastService: ToastService,
    private dialogService: DialogService,
    private router: Router,
    private store: Store,
  ) { }

  ngOnInit(): void {
    this.checkAuthState();
    this.initializeCategories();
    this.initializeBrands();
    this.setupSearchSubscription();

    this.loadProducts();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private initializeCategories(): void {
    this.categories = [{ id: '', name: 'Todos', icon: 'grid' }];
    this.selectedCategory = this.categories[0];
    this.loadCategories();
  }

  private initializeBrands(): void {
    this.brands = [
      {
        id: '',
        name: 'Todas',
        slug: 'all',
        store_id: 0,
        created_at: new Date(),
        updated_at: new Date(),
      },
    ];
    this.selectedBrand = this.brands[0];
    this.loadBrands();
  }

  private loadCategories(): void {
    this.productService
      .getCategories()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (categories) => {
          const backendCategories = categories.map((cat) => ({
            id: cat.id.toString(),
            name: cat.name,
            icon: 'tag',
          }));
          this.categories = [this.categories[0], ...backendCategories];
        },
        error: (error) => {
          // Error loading categories, using defaults
        },
      });
  }

  private loadBrands(): void {
    this.productService
      .getBrands()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (brands) => {
          const backendBrands = brands.map((brand) => ({
            ...brand,
            id: brand.id.toString(),
          }));
          this.brands = [this.brands[0], ...backendBrands];
        },
        error: (error) => {
          // Error loading brands, using defaults
        },
      });
  }

  private setupSearchSubscription(): void {
    this.searchSubject$
      .pipe(debounceTime(300), distinctUntilChanged(), takeUntil(this.destroy$))
      .subscribe((query) => {
        this.searchQuery = query;
        this.filterProducts();
      });
  }

  private loadProducts(): void {
    this.loading = true;
    this.filterProducts();
  }

  private filterProducts(): void {
    this.loading = true;
    const filters: any = {
      state: 'active',
      pos_optimized: true,
      include_stock: true,
    };

    if (this.searchQuery) {
      filters.query = this.searchQuery;
    }

    if (this.selectedCategory && this.selectedCategory.id !== '') {
      filters.category = this.selectedCategory.id;
    }

    if (this.selectedBrand && this.selectedBrand.id !== '') {
      filters.brand = this.selectedBrand.id.toString();
    }

    this.productService
      .searchProducts(filters)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (result: SearchResult) => {
          const uniqueProducts = this.removeDuplicateProducts(
            result.products || [],
          );

          this.filteredProducts = uniqueProducts;
          this.loading = false;
        },
        error: (error: any) => {
          this.loading = false;
          this.toastService.error('Error al cargar productos');
        },
      });
  }

  onSearch(searchTerm: string): void {
    this.searchSubject$.next(searchTerm);
  }

  onClearSearch(): void {
    this.searchQuery = '';
    this.searchSubject$.next('');
  }

  onCategoryChange(event: any): void {
    const categoryId = event.target.value;
    const category = this.categories.find((c) => c.id === categoryId);
    this.selectedCategory = category || this.categories[0];
    this.filterProducts();
  }

  onSelectCategory(category: any): void {
    this.selectedCategory = category;
    this.filterProducts();
  }

  onSelectBrand(brand: Brand): void {
    this.selectedBrand = brand;
    this.filterProducts();
  }

  onFilterChange(filters: ProductQueryDto): void {
    // Update selected category and brand for UI consistency
    if (filters.category_id) {
      this.selectedCategory =
        this.categories.find((c) => c.id === filters.category_id!.toString()) ||
        this.categories[0];
    } else {
      this.selectedCategory = this.categories[0];
    }

    if (filters.brand_id) {
      this.selectedBrand =
        this.brands.find((b) => b.id.toString() === filters.brand_id!.toString()) ||
        this.brands[0];
    } else {
      this.selectedBrand = this.brands[0];
    }

    // Update search query if it was changed in filters (for future extensibility)
    if (filters.search !== undefined && filters.search !== this.searchQuery) {
      this.searchQuery = filters.search;
    }

    this.filterProducts();
  }

  getCategoryClass(category: any): string {
    const baseClass =
      'border-border bg-surface text-text-secondary hover:border-primary hover:text-primary hover:bg-primary-light transition-colors';
    const selectedClass =
      'border-primary bg-primary-light text-primary shadow-card';

    return this.selectedCategory?.id === category.id
      ? selectedClass
      : baseClass;
  }

  onSelectProduct(product: any): void {
    this.productSelected.emit(product);
  }

  onAddToCart(product: any): void {
    if (product.price <= 0) {
      this.dialogService
        .confirm({
          title: 'Precio no configurado',
          message:
            'Este producto no tiene un precio de venta válido (0 o menor). Debes configurar el precio antes de agregarlo al carrito.',
          confirmText: 'Configurar producto',
          cancelText: 'Cancelar',
        })
        .then((confirmed) => {
          if (confirmed) {
            this.router.navigate([`/admin/products/edit/${product.id}`]);
          }
        });
      return;
    }

    if (product.stock > 0 && product.stock <= 5) {
      this.toastService.warning(
        `Producto con existencias bajo (${product.stock} unidades restantes)`,
      );
    }

    if (product.stock === 0) {
      this.toastService.warning('Producto sin stock disponible');
      return;
    }

    this.addingToCart.add(product.id);

    this.cartService
      .addToCart({
        product: product,
        quantity: 1,
      })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.addingToCart.delete(product.id);
          this.toastService.success(`${product.name} agregado al carrito`);
          this.productAddedToCart.emit({ product, quantity: 1 });
        },
        error: (error) => {
          this.addingToCart.delete(product.id);
          this.toastService.error('Error al agregar producto al carrito');
        },
      });
  }

  onToggleScanMode(): void {
    this.toastService.info('Modo escáner próximamente');
  }

  onImageError(event: any): void {
    // Hide broken image and show default icon
    event.target.style.display = 'none';
  }

  trackByProductId(index: number, product: any): string {
    return product.id;
  }

  private removeDuplicateProducts(products: any[]): any[] {
    if (!products || products.length === 0) {
      return [];
    }

    const seen = new Set<string>();
    const uniqueProducts = products.filter((product) => {
      if (
        !product ||
        product.id === undefined ||
        product.id === null ||
        product.id === ''
      ) {
        return false;
      }

      const productId = product.id;
      if (seen.has(productId)) {
        return false;
      }
      seen.add(productId);
      return true;
    });

    return uniqueProducts;
  }

  getEmptyStateTitle(): string {
    if (this.searchQuery) {
      return 'No se encontraron productos';
    }
    return 'No hay productos disponibles';
  }

  getEmptyStateDescription(): string {
    if (this.searchQuery) {
      return 'Intenta buscar con otros términos o cambia la categoría.';
    }
    return 'Los productos aparecerán aquí cuando estén disponibles.';
  }

  private checkAuthState(): void {
    // Use store selectors instead of direct localStorage access
    this.store.select(selectAccessToken).subscribe((token: any) => {
      if (!token) {
        this.toastService.error(
          'No estás autenticado. Por favor, inicia sesión.',
        );
      }
    });

    this.store.select(selectUser).subscribe((user: any) => {
      // User data handled by store
    });

    // Keep store check for now since it's critical for POS
    const currentStore = localStorage.getItem('current_store');
    if (currentStore) {
      try {
        JSON.parse(currentStore);
      } catch (e) {
        // Error parsing current store
      }
    }
  }
}
