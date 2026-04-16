import {
  Component,
  NO_ERRORS_SCHEMA,
  signal,
  output,
  inject,
  DestroyRef,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subject, debounceTime, distinctUntilChanged } from 'rxjs';


import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { InputsearchComponent } from '../../../../../../shared/components/inputsearch/inputsearch.component';
import { OptionsDropdownComponent } from '../../../../../../shared/components/options-dropdown/options-dropdown.component';
import { DropdownAction } from '../../../../../../shared/components/options-dropdown/options-dropdown.interfaces';
import { BadgeComponent } from '../../../../../../shared/components/badge/badge.component';
import { ToastService } from '../../../../../../shared/components/toast/toast.service';

import { PopCartService } from '../services/pop-cart.service';
import { ProductsService } from '../../../products/services/products.service';
import { PopBulkDataModalComponent } from './pop-bulk-data-modal.component';
import {
  PopProductConfigModalComponent,
  PopProductConfigResult,
} from './pop-product-config-modal.component';

@Component({
  selector: 'app-pop-product-selection',
  standalone: true,
  imports: [
    IconComponent,
    InputsearchComponent,
    OptionsDropdownComponent,
    BadgeComponent,
    PopBulkDataModalComponent,
    PopProductConfigModalComponent
],
  schemas: [NO_ERRORS_SCHEMA],
  template: `
    <div
      class="h-full flex flex-col bg-surface rounded-card shadow-card border border-border"
      >
      <!-- Products Header - Outside overflow container -->
      <div
        class="products-header flex-none px-4 lg:px-6 py-3 lg:py-4 border-b border-border bg-surface rounded-t-card"
        >
        <!-- Desktop Header -->
        <div class="hidden lg:flex justify-between items-center gap-4">
          <div class="flex-1 min-w-0">
            <h2 class="text-lg font-semibold text-text-primary">
              Productos Disponibles ({{ filteredProducts().length }})
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
        @if (loading()) {
          <div class="p-8 text-center">
            <div
              class="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"
            ></div>
            <p class="mt-2 text-text-secondary">Cargando productos...</p>
          </div>
        }
    
        <!-- Empty State -->
        @if (!loading() && filteredProducts().length === 0) {
          <div
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
        }
    
        <!-- Modern Compact Products Grid (Responsive) -->
        @if (!loading() && filteredProducts().length > 0) {
          <div
            class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-2 sm:gap-3"
            >
            <!-- Modern Product Card -->
            @for (product of filteredProducts(); track trackByProductId($index, product)) {
              <div
                (click)="onAddToCart(product)"
                class="group relative bg-surface border border-border rounded-card shadow-card hover:shadow-lg transition-all duration-200 hover:scale-[1.02] cursor-pointer overflow-hidden"
                >
                <!-- Product Image or Icon -->
                <div
                  class="aspect-square bg-gradient-to-br from-surface to-muted/30 relative overflow-hidden"
                  >
                  <!-- Product Image -->
                  @if (product.image_url) {
                    <img
                      [src]="product.image_url"
                      [alt]="product.name"
                      class="w-full h-full object-cover transition-transform duration-300 group-hover:scale-110"
                      (error)="onImageError($event)"
                      />
                  }
                  <!-- Placeholder Icon -->
                  @if (!product.image_url) {
                    <div
                      class="absolute inset-0 flex items-center justify-center text-muted-foreground/30 group-hover:text-primary/30 transition-colors"
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
                  }
                  <!-- Compact Stock Badge -->
                  @if (product.track_inventory !== false) {
                    <app-badge
                      [variant]="product.stock_quantity === 0 ? 'error' : product.stock_quantity <= 10 ? 'warning' : 'success'"
                      size="xs"
                      badgeStyle="outline"
                      class="absolute top-2 right-2 z-[1]">
                      {{ product.stock_quantity }}
                    </app-badge>
                  } @else {
                    <app-badge variant="info" size="xs" badgeStyle="outline" class="absolute top-2 right-2 z-[1]">
                      Disponible
                    </app-badge>
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
                    <div class="flex items-center gap-1 min-w-0">
                      <span
                        class="text-xs text-text-secondary font-mono truncate max-w-[60%]"
                        >
                        {{ product.sku }}
                      </span>
                      @if (product.pricing_type === 'weight') {
                        <span
                          class="inline-flex items-center px-1 py-0.5 rounded text-[9px] font-semibold bg-blue-50 text-blue-600 shrink-0"
                          >
                          Peso
                        </span>
                      }
                    </div>
                    <button
                      class="w-6 h-6 rounded-full bg-primary/10 hover:bg-primary/20 text-primary flex items-center justify-center transition-colors"
                      >
                      <app-icon name="plus" [size]="14"></app-icon>
                    </button>
                  </div>
                </div>
              </div>
            }
          </div>
        }
      </div>
    </div>
    
    <app-pop-bulk-data-modal
      [isOpen]="bulkModalOpen()"
      (close)="bulkModalOpen.set(false)"
      (dataLoaded)="onBulkDataLoaded($event)"
    ></app-pop-bulk-data-modal>

    <app-pop-product-config-modal
      [isOpen]="configModalOpen()"
      [product]="configModalProduct()"
      (confirmed)="onProductConfigConfirmed($event)"
      (closed)="configModalOpen.set(false)"
    ></app-pop-product-config-modal>
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
export class PopProductSelectionComponent {
  loading = signal(false);
  searchQuery = '';
  filteredProducts = signal<any[]>([]);
  categories = signal<any[]>([]);
  addingToCart = new Set<string>();

  bulkModalOpen = signal(false);
  configModalOpen = signal(false);
  configModalProduct = signal<any>(null);

  // Dropdown actions configuration
  dropdownActions: DropdownAction[] = [
    {
      label: 'Escanear factura',
      icon: 'scan-line',
      action: 'scan-invoice',
      variant: 'primary',
    },
    {
      label: 'Nuevo producto',
      icon: 'plus',
      action: 'new-product',
      variant: 'outline',
    },
    {
      label: 'Carga masiva',
      icon: 'upload-cloud',
      action: 'bulk-import',
      variant: 'outline',
    },
  ];

  readonly productSelected = output<any>();
  readonly requestManualAdd = output<void>();
  readonly bulkDataLoaded = output<any[]>();
  readonly productAddedToCart = output<{ product: any; quantity: number }>();
  readonly scanInvoice = output<void>();

  private destroyRef = inject(DestroyRef);
  private productsService = inject(ProductsService);
  private cartService = inject(PopCartService);
  private toastService = inject(ToastService);
  private searchSubject$ = new Subject<string>();

  constructor() {
    this.setupSearchSubscription();
    this.loadProducts();
  }

  private setupSearchSubscription(): void {
    this.searchSubject$
      .pipe(debounceTime(300), distinctUntilChanged(), takeUntilDestroyed(this.destroyRef))
      .subscribe((query) => {
        this.searchQuery = query;
        this.filterProducts();
      });
  }

  private loadProducts(): void {
    this.loading.set(true);
    this.filterProducts();
  }

  private filterProducts(): void {
    const filters: any = {
      page: 1,
      limit: 25,
      state: 'active',
      track_inventory: true,
      include_variants: true,
    };

    if (this.searchQuery) {
      filters.search = this.searchQuery;
    }

    this.productsService
      .getProducts(filters)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          this.filteredProducts.set(response.data || []);
          this.loading.set(false);
        },
        error: (error: any) => {
          this.loading.set(false);
          this.toastService.error('Error al cargar productos');
        },
      });
  }

  onSearch(searchTerm: string): void {
    this.searchSubject$.next(searchTerm);
  }

  onAddToCart(product: any): void {
    this.addingToCart.add(product.id);

    const popProduct = {
      ...product,
      cost: Number(product.cost_price || product.price || 0),
      cost_price: Number(product.cost_price || 0),
      pricing_type: product.pricing_type || 'unit',
      requires_batch_tracking: product.requires_batch_tracking || false,
    };

    // POP always opens config modal (unlike POS, speed is not critical)
    this.configModalProduct.set(popProduct);
    this.configModalOpen.set(true);
    this.addingToCart.delete(product.id);
  }

  onProductConfigConfirmed(result: PopProductConfigResult): void {
    if (!this.configModalProduct()) return;

    const product = {
      ...this.configModalProduct(),
      pricing_type: result.pricing_type || this.configModalProduct()?.pricing_type,
    };

    if (result.variants?.length) {
      // Multi-variant: add one cart item per selected variant
      result.variants.forEach((variant) => {
        this.cartService
          .addToCart({
            product,
            variant,
            quantity: 1,
            unit_cost: variant.cost_price
              ? Number(variant.cost_price)
              : result.unit_cost,
            lot_info: result.lot_info,
          })
          .subscribe();
      });

      const count = result.variants.length;
      this.toastService.success(
        count === 1
          ? `${product.name} agregado al carrito`
          : `${count} variantes de ${product.name} agregadas al carrito`,
      );
    } else {
      // Single item (no variants)
      this.cartService
        .addToCart({
          product,
          variant: result.variant,
          quantity: result.quantity,
          unit_cost: result.unit_cost,
          lot_info: result.lot_info,
        })
        .subscribe();

      this.toastService.success(`${product.name} agregado al carrito`);
    }

    // Update product in filteredProducts to reflect newly created variants
    if (result.variants?.length && this.configModalProduct()) {
      const productIndex = this.filteredProducts().findIndex(
        (p: any) => p.id === this.configModalProduct()?.id,
      );
      if (productIndex >= 0) {
        this.filteredProducts.update(products => {
          const updated = [...products];
          updated[productIndex] = {
            ...updated[productIndex],
            product_variants: result.variants,
          };
          return updated;
        });
      }
    }

    this.configModalOpen.set(false);
    this.configModalProduct.set(null);
  }

  onImageError(event: any): void {
    event.target.style.display = 'none';
  }

  trackByProductId(index: number, product: any): string {
    return product.id;
  }

  updateProductVariants(productId: number, variants: any[]): void {
    const productIndex = this.filteredProducts().findIndex(
      (p: any) => p.id === productId,
    );
    if (productIndex >= 0) {
      this.filteredProducts.update(products => {
        const updated = [...products];
        updated[productIndex] = {
          ...updated[productIndex],
          product_variants: variants,
        };
        return updated;
      });
    }
  }

  onBulkDataLoaded(data: any[]): void {
    this.bulkDataLoaded.emit(data);
  }

  onDropdownAction(action: string): void {
    switch (action) {
      case 'scan-invoice':
        this.scanInvoice.emit();
        break;
      case 'new-product':
        this.requestManualAdd.emit();
        break;
      case 'bulk-import':
        this.bulkModalOpen.set(true);
        break;
    }
  }
}
