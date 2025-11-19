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

import {
  CardComponent,
  IconComponent,
  ButtonComponent,
  InputsearchComponent,
  ToastService,
} from '../../../../../shared/components';

import { PosCartService } from '../services/pos-cart.service';
import {
  PosProductService,
  SearchResult,
} from '../services/pos-product.service';

@Component({
  selector: 'app-pos-product-selection',
  standalone: true,
  imports: [
    CommonModule,
    CardComponent,
    IconComponent,
    ButtonComponent,
    InputsearchComponent,
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
            class="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 w-full sm:w-auto"
          >
            <!-- Input de búsqueda compacto -->
            <app-inputsearch
              class="w-full sm:w-64"
              size="sm"
              placeholder="Buscar productos..."
              [debounceTime]="300"
              (searchChange)="onSearch($event)"
            />

            <!-- Filtro de categoría -->
            <select
              class="px-3 py-2 border border-border rounded-input focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary bg-surface text-text-primary text-sm"
              (change)="onCategoryChange($event)"
              [value]="selectedCategory?.id || 'all'"
            >
              <option *ngFor="let category of categories" [value]="category.id">
                {{ category.name }}
              </option>
            </select>

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

          <!-- Products Grid -->
          <div
            *ngIf="!loading && filteredProducts.length > 0"
            class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4"
          >
            <app-card
              *ngFor="
                let product of filteredProducts;
                trackBy: trackByProductId
              "
              [hoverable]="true"
              (click)="onAddToCart(product)"
              class="cursor-pointer group h-full flex flex-col overflow-hidden shadow-card hover:shadow-lg transition-all duration-200"
              [padding]="false"
            >
              <div class="flex flex-col h-full">
                <!-- Product Image & Badge -->
                <div
                  class="relative aspect-square bg-muted overflow-hidden rounded-t-lg"
                >
                  <div
                    class="absolute inset-0 flex items-center justify-center text-text-secondary"
                  >
                    <app-icon name="image" [size]="32"></app-icon>
                  </div>
                  <!-- Real image would go here -->

                  <!-- Stock Badge -->
                  <div
                    *ngIf="product.stock <= 5"
                    class="absolute top-2 right-2 px-2 py-1 rounded-full text-xs font-bold text-white shadow-sm"
                    [class]="
                      product.stock === 0 ? 'bg-destructive' : 'bg-warning'
                    "
                  >
                    {{
                      product.stock === 0 ? 'AGOTADO' : product.stock + ' left'
                    }}
                  </div>
                </div>

                <!-- Content -->
                <div class="p-4 flex flex-col flex-1">
                  <h3
                    class="text-sm font-semibold text-text-primary line-clamp-2 mb-2 leading-snug min-h-[2.5em]"
                  >
                    {{ product.name }}
                  </h3>

                  <div class="mt-auto flex items-center justify-between">
                    <span class="text-base font-bold text-primary">
                      {{
                        product.price
                          | currency: 'ARS' : 'symbol-narrow' : '1.0-0'
                      }}
                    </span>

                    <div
                      class="w-8 h-8 rounded-full bg-primary-light text-primary flex items-center justify-center group-hover:bg-primary group-hover:text-white transition-all duration-200"
                    >
                      <app-icon name="plus" [size]="16"></app-icon>
                    </div>
                  </div>
                </div>
              </div>
            </app-card>
          </div>
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

        <!-- Products Grid -->
        <div
          *ngIf="!loading && filteredProducts.length > 0"
          class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-6"
        >
          <app-card
            *ngFor="let product of filteredProducts; trackBy: trackByProductId"
            [hoverable]="true"
            (click)="onAddToCart(product)"
            class="cursor-pointer group h-full flex flex-col overflow-hidden shadow-card hover:shadow-lg transition-all duration-200"
            [padding]="false"
          >
            <div class="flex flex-col h-full">
              <!-- Product Image & Badge -->
              <div
                class="relative aspect-square bg-muted overflow-hidden rounded-t-lg"
              >
                <div
                  class="absolute inset-0 flex items-center justify-center text-text-secondary"
                >
                  <app-icon name="image" [size]="32"></app-icon>
                </div>
                <!-- Real image would go here -->

                <!-- Stock Badge -->
                <div
                  *ngIf="product.stock <= 5"
                  class="absolute top-3 right-3 px-2 py-1 rounded-full text-xs font-bold text-white shadow-sm"
                  [class]="
                    product.stock === 0 ? 'bg-destructive' : 'bg-warning'
                  "
                >
                  {{
                    product.stock === 0 ? 'AGOTADO' : product.stock + ' left'
                  }}
                </div>
              </div>

              <!-- Content -->
              <div class="p-4 flex flex-col flex-1">
                <h3
                  class="text-sm font-semibold text-text-primary line-clamp-2 mb-2 leading-snug min-h-[2.5em]"
                >
                  {{ product.name }}
                </h3>

                <div class="mt-auto flex items-center justify-between">
                  <span class="text-base font-bold text-primary">
                    {{
                      product.price
                        | currency: 'ARS' : 'symbol-narrow' : '1.0-0'
                    }}
                  </span>

                  <div
                    class="w-8 h-8 rounded-full bg-primary-light text-primary flex items-center justify-center group-hover:bg-primary group-hover:text-white transition-all duration-200"
                  >
                    <app-icon name="plus" [size]="16"></app-icon>
                  </div>
                </div>
              </div>
            </div>
          </app-card>
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
    `,
  ],
})
export class PosProductSelectionComponent implements OnInit, OnDestroy {
  loading = false;
  searchQuery = '';
  selectedCategory: any = null;
  filteredProducts: any[] = [];
  categories: any[] = [];
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
  ) {}

  ngOnInit(): void {
    this.initializeCategories();
    this.setupSearchSubscription();
    this.loadProducts();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private initializeCategories(): void {
    this.categories = [{ id: 'all', name: 'Todos', icon: 'grid' }];
    this.selectedCategory = this.categories[0];
    this.loadCategories();
  }

  private loadCategories(): void {
    this.productService
      .getCategories()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (categories) => {
          // Add backend categories to the list
          const backendCategories = categories.map((cat) => ({
            id: cat.id.toString(),
            name: cat.name,
            icon: 'tag',
          }));
          this.categories = [this.categories[0], ...backendCategories];
        },
        error: (error) => {
          console.warn('Error loading categories, using defaults:', error);
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
    const filters: any = {
      pos_optimized: true,
      include_stock: true,
      state: 'active', // Only get active products
      store_id: this.getCurrentStoreId(),
    };

    if (this.searchQuery) {
      filters.search = this.searchQuery;
    }

    if (this.selectedCategory && this.selectedCategory.id !== 'all') {
      filters.category_id = this.selectedCategory.id;
    }

    this.productService
      .searchProducts(filters)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (result: SearchResult) => {
          this.filteredProducts = this.transformProducts(result.products || []);
          this.loading = false;
        },
        error: (error: any) => {
          this.loading = false;
          this.toastService.error('Error al cargar productos');
          console.error('Product search error:', error);
        },
      });
  }

  private transformProducts(products: any[]): any[] {
    return products.map((product) => ({
      id: product.id.toString(),
      name: product.name,
      sku: product.sku || '',
      price: parseFloat(product.base_price || product.price || 0),
      cost: product.cost ? parseFloat(product.cost) : undefined,
      category: product.category?.name || 'Sin categoría',
      brand: product.brand?.name || '',
      stock: product.stock_quantity || product.quantity_available || 0,
      minStock: 5, // Default minimum stock
      image: product.image || '',
      description: product.description || '',
      barcode: product.barcode || '',
      tags: product.tags || [],
      isActive: product.state === 'active',
      createdAt: new Date(product.created_at),
      updatedAt: new Date(product.updated_at),
    }));
  }

  private getCurrentStoreId(): number {
    // Try to get store ID from localStorage or tenant service
    const storeData = localStorage.getItem('current_store');
    if (storeData) {
      try {
        const store = JSON.parse(storeData);
        return typeof store.id === 'string' ? parseInt(store.id) : store.id;
      } catch {
        return 1; // fallback
      }
    }
    return 1; // fallback store ID
  }

  onSearch(searchTerm: string): void {
    this.searchSubject$.next(searchTerm);
  }

  onClearSearch(): void {
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
    // This would typically open a product details modal
    // For now, just emit the product selection event
    this.productSelected.emit(product);
  }

  onAddToCart(product: any): void {
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
          // Emit event when product is successfully added to cart
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

  trackByProductId(index: number, product: any): string {
    return product.id;
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
}
