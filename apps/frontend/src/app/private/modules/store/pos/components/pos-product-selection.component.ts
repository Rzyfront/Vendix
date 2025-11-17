import { Component, OnInit, OnDestroy, NO_ERRORS_SCHEMA, Output, EventEmitter } from '@angular/core';
import { Subject, debounceTime, distinctUntilChanged, takeUntil } from 'rxjs';
import { CommonModule } from '@angular/common';

import {
  ButtonComponent,
  InputsearchComponent,
  CardComponent,
  IconComponent,
  ToastService,
  SpinnerComponent,
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
    ButtonComponent,
    InputsearchComponent,
    CardComponent,
    IconComponent,
    SpinnerComponent,
  ],
  schemas: [NO_ERRORS_SCHEMA],
  template: `
    <div class="h-full flex flex-col">
      <!-- Search Header -->
      <div class="p-4 border-b border-gray-200 bg-white">
        <div class="flex gap-3 items-center">
          <div class="flex-1">
            <app-inputsearch
              placeholder="Buscar productos..."
              (search)="onSearch($event)"
              (clear)="onClearSearch()"
            />
          </div>

          <app-button
            variant="outline"
            size="sm"
            (clicked)="onToggleScanMode()"
          >
            <app-icon name="barcode" [size]="16" slot="icon"></app-icon>
            Escanear
          </app-button>
        </div>
      </div>

      <!-- Categories -->
      <div class="p-4 border-b border-gray-200">
        <div class="flex gap-2 overflow-x-auto pb-2">
          <button
            *ngFor="let category of categories"
            (click)="onSelectCategory(category)"
            [class]="getCategoryClass(category)"
            class="px-4 py-2 rounded-lg border font-medium text-sm whitespace-nowrap transition-colors"
          >
            {{ category.name }}
          </button>
        </div>
      </div>

      <!-- Products Grid -->
      <div class="flex-1 overflow-y-auto p-4">
        <!-- Loading State -->
        <div *ngIf="loading" class="flex items-center justify-center h-64">
          <app-spinner [size]="'md'"></app-spinner>
          <p class="mt-4 text-gray-600">Cargando productos...</p>
        </div>

        <!-- Empty State -->
        <div
          *ngIf="!loading && filteredProducts.length === 0"
          class="text-center py-12"
        >
          <app-icon name="package" [size]="48" color="gray"></app-icon>
          <p class="mt-4 text-gray-600">No se encontraron productos</p>
          <p *ngIf="searchQuery" class="text-sm text-gray-500">
            No hay resultados para "{{ searchQuery }}"
          </p>
        </div>

        <!-- Products Grid -->
        <div
          *ngIf="!loading && filteredProducts.length > 0"
          class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4"
        >
          <app-card
            *ngFor="let product of filteredProducts"
            [hoverable]="true"
            (click)="onSelectProduct(product)"
            class="cursor-pointer"
          >
            <div class="p-4">
              <div class="flex justify-between items-start mb-3">
                <div class="flex-1 min-w-0">
                  <h3 class="font-medium text-gray-900 truncate">
                    {{ product.name }}
                  </h3>
                  <p
                    *ngIf="product.description"
                    class="text-sm text-gray-600 mt-1 line-clamp-2"
                  >
                    {{ product.description }}
                  </p>
                </div>

                <!-- Product Image -->
                <div
                  class="w-16 h-16 bg-gray-100 rounded-lg flex items-center justify-center"
                >
                  <app-icon name="package" [size]="24" color="gray"></app-icon>
                </div>
              </div>

              <!-- Price and Stock -->
              <div class="flex items-center justify-between">
                <div>
                  <p class="text-lg font-bold text-gray-900">
                    {{ product.price }}
                  </p>
                  <p class="text-sm text-gray-600">
                    Stock: {{ product.stock }}
                  </p>
                </div>

                <app-button
                  variant="primary"
                  size="sm"
                  (click)="onAddToCart(product); $event.stopPropagation()"
                  [disabled]="product.stock === 0"
                  [loading]="addingToCart.has(product.id)"
                >
                  <app-icon name="plus" [size]="14" slot="icon"></app-icon>
                  {{ product.stock === 0 ? 'Sin stock' : 'Agregar' }}
                </app-button>
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

      .line-clamp-2 {
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
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
  @Output() productAddedToCart = new EventEmitter<{ product: any; quantity: number }>();

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
    this.categories = [
      { id: 'all', name: 'Todos', icon: 'grid' },
      { id: 'electronics', name: 'Electrónicos', icon: 'cpu' },
      { id: 'clothing', name: 'Ropa', icon: 'shirt' },
      { id: 'food', name: 'Alimentos', icon: 'coffee' },
      { id: 'books', name: 'Libros', icon: 'book' },
      { id: 'other', name: 'Otros', icon: 'package' },
    ];
    this.selectedCategory = this.categories[0];
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
    // Use POS optimized search for real products
    this.productService
      .searchProducts({ pos_optimized: true, include_stock: true })
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (result: SearchResult) => {
          this.filteredProducts = result.products || [];
          this.loading = false;
        },
        error: (error: any) => {
          this.loading = false;
          this.toastService.error('Error al cargar productos');
        },
      });
  }

  private filterProducts(): void {
    // This would normally filter by category and search query
    // For now, just use all products
    this.productService
      .searchProducts({})
      .pipe(takeUntil(this.destroy$))
      .subscribe((result: SearchResult) => {
        this.filteredProducts = result.products || [];
      });
  }

  onSearch(event: any): void {
    this.searchSubject$.next(event);
  }

  onClearSearch(): void {
    this.searchSubject$.next('');
  }

  onSelectCategory(category: any): void {
    this.selectedCategory = category;
    this.filterProducts();
  }

  getCategoryClass(category: any): string {
    const baseClass =
      'border-gray-200 text-gray-600 hover:border-gray-300 hover:text-gray-800';
    const selectedClass = 'border-blue-500 bg-blue-50 text-blue-600';

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
}
