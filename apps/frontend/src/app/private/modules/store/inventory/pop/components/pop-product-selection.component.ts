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

import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { InputsearchComponent } from '../../../../../../shared/components/inputsearch/inputsearch.component';
import { OptionsDropdownComponent } from '../../../../../../shared/components/options-dropdown/options-dropdown.component';
import { DropdownAction } from '../../../../../../shared/components/options-dropdown/options-dropdown.interfaces';
import { ToastService } from '../../../../../../shared/components/toast/toast.service';

import { PopCartService } from '../services/pop-cart.service';
import { ProductsService } from '../../../products/services/products.service';
import { PopBulkDataModalComponent } from './pop-bulk-data-modal.component';

@Component({
  selector: 'app-pop-product-selection',
  standalone: true,
  imports: [CommonModule, IconComponent, InputsearchComponent, OptionsDropdownComponent, PopBulkDataModalComponent],
  schemas: [NO_ERRORS_SCHEMA],
  template: `
    <div class="h-full flex flex-col bg-surface rounded-card shadow-card border border-border">
      <!-- Products Header - Outside overflow container -->
      <div class="products-header flex-none px-4 lg:px-6 py-3 lg:py-4 border-b border-border bg-surface rounded-t-card">
        <!-- Desktop Header -->
        <div class="hidden lg:flex justify-between items-center gap-4">
          <div class="flex-1 min-w-0">
            <h2 class="text-lg font-semibold text-text-primary">
              Productos Disponibles ({{ filteredProducts.length }})
            </h2>
          </div>

          <div class="flex items-center gap-3">
            <app-inputsearch
              class="w-64"
              size="sm"
              placeholder="Buscar productos..."
              [debounceTime]="300"
              (searchChange)="onSearch($event)"
            />

            <app-options-dropdown
              [actions]="dropdownActions"
              triggerIcon="package-plus"
              triggerLabel="Opciones"
              title="Opciones"
              (actionClick)="onDropdownAction($event)"
            ></app-options-dropdown>
          </div>
        </div>

        <!-- Mobile Header (Compact) -->
        <div class="lg:hidden flex items-center gap-2">
          <app-inputsearch
            class="flex-1"
            size="sm"
            placeholder="Buscar..."
            [debounceTime]="300"
            (searchChange)="onSearch($event)"
          />

          <app-options-dropdown
            [actions]="dropdownActions"
            triggerIcon="package-plus"
            triggerLabel="Opciones"
            title="Opciones"
            (actionClick)="onDropdownAction($event)"
          ></app-options-dropdown>
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
            No se encontraron productos
          </h3>
          <p class="text-sm text-text-secondary mb-4 max-w-xs mx-auto">
            Intenta buscar con otros términos.
          </p>
        </div>

        <!-- Modern Compact Products Grid (Responsive) -->
        <div
          *ngIf="!loading && filteredProducts.length > 0"
          class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-2 sm:gap-3"
        >
          <!-- Modern Product Card -->
          <div
            *ngFor="let product of filteredProducts; trackBy: trackByProductId"
            (click)="onAddToCart(product)"
            class="group relative bg-surface border border-border rounded-card shadow-card hover:shadow-lg transition-all duration-200 hover:scale-[1.02] cursor-pointer overflow-hidden"
          >
            <!-- Product Image or Icon -->
            <div
              class="aspect-square bg-gradient-to-br from-surface to-muted/30 relative overflow-hidden"
            >
              <!-- Product Image -->
              <img
                *ngIf="product.image_url"
                [src]="product.image_url"
                [alt]="product.name"
                class="w-full h-full object-cover transition-transform duration-300 group-hover:scale-110"
                (error)="onImageError($event)"
              />
              <!-- Placeholder Icon -->
              <div
                *ngIf="!product.image_url"
                class="absolute inset-0 flex items-center justify-center text-muted-foreground/30 group-hover:text-primary/30 transition-colors"
              >
                <div
                    class="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center"
                >
                    <app-icon name="image" [size]="24" class="text-primary/60"></app-icon>
                </div>
              </div>

              <!-- Compact Stock Badge -->
              @if (product.track_inventory !== false) {
                <div
                  class="absolute top-2 right-2 px-2 py-0.5 rounded text-[10px] font-bold shadow-sm backdrop-blur-sm"
                  [ngClass]="{
                    'bg-green-100/90 text-green-700':
                      product.stock_quantity > 10,
                    'bg-amber-100/90 text-amber-700':
                      product.stock_quantity <= 10 && product.stock_quantity > 0,
                    'bg-red-100/90 text-red-700': product.stock_quantity === 0
                  }"
                >
                  {{ product.stock_quantity }}
                </div>
              } @else {
                <div class="absolute top-2 right-2 px-2 py-0.5 rounded text-[10px] font-bold shadow-sm backdrop-blur-sm bg-blue-100/90 text-blue-700">
                  Bajo pedido
                </div>
              }
            </div>

            <!-- Product Info -->
            <div class="p-3">
              <h3
                class="text-sm font-medium text-text-primary line-clamp-2 min-h-[2.5em] mb-1 group-hover:text-primary transition-colors"
                [title]="product.name"
              >
                {{ product.name }}
              </h3>
              <div class="flex items-center justify-between mt-auto">
                <span class="text-xs text-text-secondary font-mono truncate max-w-[60%]">
                  {{ product.sku }}
                </span>
                <button
                  class="w-6 h-6 rounded-full bg-primary/10 hover:bg-primary/20 text-primary flex items-center justify-center transition-colors"
                >
                  <app-icon name="plus" [size]="14"></app-icon>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
    
    <app-pop-bulk-data-modal 
        [isOpen]="bulkModalOpen"
        (close)="bulkModalOpen = false"
        (dataLoaded)="onBulkDataLoaded($event)"
    ></app-pop-bulk-data-modal>
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

      /* Sticky header with blur */
      .products-header {
        position: sticky;
        top: 0;
        z-index: 10;
        background: rgba(var(--color-surface-rgb, 255, 255, 255), 0.85);
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
        overflow: visible; /* Allow dropdown to overflow */
      }

      /* Touch feedback for mobile */
      @media (max-width: 1023px) {
        :host ::ng-deep .group {
          transition: transform 0.15s ease;
          -webkit-tap-highlight-color: transparent;
        }

        :host ::ng-deep .group:active {
          transform: scale(0.97);
        }
      }
    `,
  ],
})
export class PopProductSelectionComponent implements OnInit, OnDestroy {
  loading = false;
  searchQuery = '';
  filteredProducts: any[] = [];
  categories: any[] = [];
  addingToCart = new Set<string>();

  bulkModalOpen = false;

  // Dropdown actions configuration
  dropdownActions: DropdownAction[] = [
    {
      label: 'Nuevo producto',
      icon: 'plus',
      action: 'new-product',
      variant: 'primary',
    },
    {
      label: 'Carga masiva',
      icon: 'upload-cloud',
      action: 'bulk-import',
      variant: 'outline',
    },
  ];

  @Output() productSelected = new EventEmitter<any>();
  @Output() requestManualAdd = new EventEmitter<void>();
  @Output() bulkDataLoaded = new EventEmitter<any[]>();
  @Output() productAddedToCart = new EventEmitter<{
    product: any;
    quantity: number;
  }>();

  private destroy$ = new Subject<void>();
  private searchSubject$ = new Subject<string>();

  constructor(
    private productsService: ProductsService,
    private cartService: PopCartService,
    private toastService: ToastService
  ) { }

  ngOnInit(): void {
    this.setupSearchSubscription();
    this.loadProducts();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
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
      page: 1,
      limit: 50,
      state: 'active'
    };

    if (this.searchQuery) {
      filters.search = this.searchQuery;
    }

    this.productsService
      .getProducts(filters)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response) => {
          this.filteredProducts = response.data || [];
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

  onAddToCart(product: any): void {
    this.addingToCart.add(product.id);

    // Map to POP expected structure if needed, or just pass the product
    // PopCartService expects 'cost' not 'cost_price' in some places, OR it adapts.
    // Let's ensure we pass unit_cost correctly.
    // PopCartService.addItem uses product.cost or product.unit_price or product.cost_price depending on what's available?
    // Let's check addItem in PopCartService: "unit_cost: product.cost || 0"
    // The product from ProductsService has 'cost_price'. We should normalize it or let service handle it.
    // Ideally map it here.

    const popProduct = {
      ...product,
      cost: Number(product.cost_price || product.price || 0)
    };

    this.cartService.addItem(popProduct, 1);
    this.toastService.success(`${product.name} agregado al carrito`);
    this.addingToCart.delete(product.id);
  }

  onImageError(event: any): void {
    event.target.style.display = 'none';
  }

  trackByProductId(index: number, product: any): string {
    return product.id;
  }

  onBulkDataLoaded(data: any[]): void {
    this.bulkDataLoaded.emit(data);
  }

  onDropdownAction(action: string): void {
    switch (action) {
      case 'new-product':
        this.requestManualAdd.emit();
        break;
      case 'bulk-import':
        this.bulkModalOpen = true;
        break;
    }
  }
}
