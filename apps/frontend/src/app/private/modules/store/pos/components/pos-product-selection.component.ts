import {
  Component,
  NO_ERRORS_SCHEMA,
  input,
  output,
  inject,
  effect,
  signal,
  computed,
  DestroyRef,
} from '@angular/core';
import { Subject, debounceTime, distinctUntilChanged } from 'rxjs';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { Store } from '@ngrx/store';

import {
  IconComponent,
  ButtonComponent,
  InputsearchComponent,
  ToastService,
  DialogService,
  OptionsDropdownComponent,
  FilterConfig,
  FilterValues,
  BadgeComponent,
} from '../../../../../shared/components';
import {
  CurrencyPipe,
  CurrencyFormatService,
} from '../../../../../shared/pipes/currency';
import { Router } from '@angular/router';

import { PosCartService } from '../services/pos-cart.service';
import {
  PosProductService,
  PosProductVariant,
  SearchResult,
} from '../services/pos-product.service';
import { PosScaleService } from '../services/pos-scale.service';
import { PosRestaurantIntegrationService } from '../services/pos-restaurant-integration.service';
import { PosVariantSelectorComponent } from './pos-variant-selector/pos-variant-selector.component';
import { PosStockSourcingModalComponent } from './pos-stock-sourcing-modal.component';
import {
  PosPreparedChoiceModalComponent,
  PreparedChoice,
} from './pos-prepared-choice-modal/pos-prepared-choice-modal.component';
import { PosSerialSelectionModalComponent } from './pos-serial-selection-modal/pos-serial-selection-modal.component';
import { MultiSelectorOption } from '../../../../../shared/components/multi-selector/multi-selector.component';
import { SerialNumbersService } from '../../serial-numbers/services/serial-numbers.service';
import { PosCashRegisterService } from '../services/pos-cash-register.service';
import { PosApiService } from '../services/pos-api.service';
import { StockSourcingSuggestionResponse } from '../models/sourcing.model';
import { environment } from '../../../../../../environments/environment';
import {
  selectAccessToken,
  selectUser,
  selectStoreSettings,
} from '../../../../../core/store/auth/auth.selectors';
import {
  ProductQueryDto,
  Brand,
  ProductCategory,
} from '../../products/interfaces';

/**
 * Minimal typed view of an active order-scope promotion, mapped from the
 * `/store/promotions/active` response. Only the fields the grid chip needs.
 */
interface ActiveOrderPromotion {
  id: number;
  name: string;
  type: 'percentage' | 'fixed_amount';
  value: number;
  minPurchaseAmount: number | null;
}

@Component({
  selector: 'app-pos-product-selection',
  standalone: true,
  imports: [
    FormsModule,
    IconComponent,
    ButtonComponent,
    InputsearchComponent,
    OptionsDropdownComponent,
    CurrencyPipe,
    PosVariantSelectorComponent,
    PosStockSourcingModalComponent,
    PosPreparedChoiceModalComponent,
    PosSerialSelectionModalComponent,
    BadgeComponent,
  ],
  schemas: [NO_ERRORS_SCHEMA],
  template: `
    <div
      class="h-full flex flex-col bg-surface rounded-card lg:rounded-card shadow-card border border-border overflow-hidden"
    >
      <!-- Products Header -->
      <div
        class="px-3 lg:px-6 py-3 lg:py-4 border-b border-border product-header"
      >
        <!-- Single header row: count badge + search + filters -->
        <div class="flex items-center gap-2 lg:gap-3 w-full">
          <!-- Input de búsqueda -->
          <app-inputsearch
            class="flex-1"
            size="sm"
            placeholder="Buscar productos..."
            [debounceTime]="300"
            [ngModel]="searchQuery()"
            (ngModelChange)="searchQuery.set($event)"
            (searchChange)="onSearch($event)"
          />

          <!-- Componente de filtros -->
          <app-options-dropdown
            [filters]="filterConfigs"
            [filterValues]="filterValues()"
            [isLoading]="loading()"
            title="Filtros"
            triggerLabel="Filtros"
            (filterChange)="onOptionsFilterChange($event)"
            (clearAllFilters)="onClearFilters()"
            class="shrink-0"
          ></app-options-dropdown>

          <!-- Botón cliente / Cola -->
          @if (queueEnabled() && queueCount() > 0) {
            <button
              class="relative flex items-center justify-center w-10 sm:w-11 h-10 sm:h-11 rounded-[10px] bg-accent/10 hover:bg-accent/20 transition-colors border border-accent/30 shrink-0"
              (click)="openQueueModal.emit()"
              title="Cola de clientes ({{ queueCount() }})"
            >
              <app-icon name="users" [size]="18" class="text-accent"></app-icon>
              <span
                class="absolute -top-1.5 -right-1.5 min-w-[20px] h-5 flex items-center justify-center rounded-full bg-accent text-white text-xs font-bold px-1"
              >
                {{ queueCount() }}
              </span>
            </button>
          } @else {
            <app-button
              variant="outline"
              size="md"
              customClasses="w-10 sm:w-11 !px-0 bg-surface !rounded-[10px] shrink-0"
              (clicked)="openCustomerModal.emit()"
              [title]="
                selectedCustomer() ? selectedCustomer().name : 'Agregar cliente'
              "
            >
              <app-icon
                slot="icon"
                [name]="selectedCustomer() ? 'user-check' : 'user-plus'"
                [size]="18"
                [class]="selectedCustomer() ? 'text-primary' : ''"
              ></app-icon>
            </app-button>
          }
        </div>

        <!-- General order-scope promotion notice. Order-scope auto-apply
             promotions discount the WHOLE order (not a single product), so
             they cannot be surfaced on a per-product card — they get one
             discreet view-level chip here. Source: /store/promotions/active
             filtered to scope='order' && is_auto_apply. -->
        @if (orderPromoNotice(); as notice) {
          <div class="mt-2 flex">
            <app-badge
              variant="success"
              size="sm"
              badgeStyle="outline"
              class="min-w-0"
            >
              <app-icon name="ticket" [size]="13" class="mr-1 shrink-0" />
              <span class="truncate max-w-[220px] sm:max-w-[360px]">{{
                notice
              }}</span>
            </app-badge>
          </div>
        }
      </div>

      <!-- Products Content -->
      <div class="flex-1 overflow-y-auto min-h-0 p-3 lg:p-6 relative z-0">
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
              class="w-20 h-20 rounded-2xl flex items-center justify-center mb-4"
              style="background-color: var(--color-primary-light)"
            >
              <app-icon
                name="package-open"
                [size]="36"
                color="var(--color-primary)"
              ></app-icon>
            </div>
            <h3 class="text-lg font-semibold text-text-primary mb-2">
              {{ getEmptyStateTitle() }}
            </h3>
            <p class="text-sm text-text-secondary mb-4 max-w-xs mx-auto">
              {{ getEmptyStateDescription() }}
            </p>
            @if (searchQuery()) {
              <app-button
                variant="outline"
                size="md"
                (clicked)="onClearSearch()"
              >
                Limpiar búsqueda
              </app-button>
            }
          </div>
        }

        <!-- Modern Compact Products Grid -->
        @if (!loading() && filteredProducts().length > 0) {
          <div
            class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-2 sm:gap-3"
          >
            <!-- Modern Product Card (iOS-style) -->
            @for (
              product of filteredProducts();
              track trackByProductId($index, product)
            ) {
              <div
                (click)="onAddToCart(product)"
                class="group relative bg-surface border border-border rounded-card shadow-sm hover:shadow-lg transition-all duration-200 cursor-pointer overflow-hidden product-card"
                [class]="
                  isProductCardUnavailable(product)
                    ? 'opacity-60 cursor-not-allowed'
                    : 'cursor-pointer hover:border-primary active:scale-[0.97]'
                "
              >
                <!-- Product Image or Icon -->
                <div
                  class="aspect-square bg-gradient-to-br from-surface to-muted/30 relative overflow-hidden"
                >
                  <!-- Product Image -->
                  @if (product.image_url || product.image) {
                    <img
                      [src]="product.image_url || product.image"
                      [alt]="product.name"
                      class="w-full h-full object-cover"
                      (error)="onImageError($event)"
                    />
                  }
                  <!-- Default Icon when no image -->
                  @if (!product.image && !product.image_url) {
                    <div
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
                  }
                  <!-- Stock Badge -->
                  @if (
                    product.track_inventory !== false && !product.has_variants
                  ) {
                    @if (product.is_available === false) {
                      <app-badge
                        variant="error"
                        size="xs"
                        badgeStyle="outline"
                        class="absolute top-2 right-2 z-[1]"
                      >
                        AGOTADO
                      </app-badge>
                    } @else if (isProductLowStock(product)) {
                      <app-badge
                        variant="warning"
                        size="xs"
                        badgeStyle="outline"
                        class="absolute top-2 right-2 z-[1]"
                      >
                        Últimas {{ product.stock }}
                      </app-badge>
                    }
                  } @else if (product.track_inventory === false) {
                    <app-badge
                      variant="info"
                      size="xs"
                      badgeStyle="outline"
                      class="absolute top-2 right-2 z-[1]"
                    >
                      Disponible
                    </app-badge>
                  }
                  <!-- Promotion Badge — backend-resolved auto promotion. -->
                  @if (product.active_promotion) {
                    <app-badge
                      variant="success"
                      size="xs"
                      badgeStyle="outline"
                      class="absolute bottom-2 right-2 z-[1]"
                    >
                      {{ product.active_promotion.badge_label }}
                    </app-badge>
                  }
                  <!-- Variant Indicator -->
                  @if (product.has_variants) {
                    <div
                      class="absolute top-2 left-2 px-1.5 py-1 rounded-md text-[10px] font-semibold backdrop-blur-md bg-black/60 border border-white/10 flex items-center gap-1"
                    >
                      <app-icon
                        name="layers"
                        [size]="12"
                        [color]="'#ffffff'"
                      ></app-icon>
                      <span class="text-white">{{
                        product.product_variants?.length
                      }}</span>
                    </div>
                  }
                  <!-- Weight Product Badge -->
                  @if (product.pricing_type === 'weight') {
                    <div
                      class="absolute bottom-2 left-2 px-1.5 py-1 rounded-md text-[10px] font-semibold backdrop-blur-md bg-blue-600/80 border border-white/10 flex items-center gap-1"
                    >
                      <app-icon
                        name="scale"
                        [size]="12"
                        [color]="'#ffffff'"
                      ></app-icon>
                      <span class="text-white">Peso</span>
                    </div>
                  }
                </div>
                <!-- Product Info -->
                <div class="p-2 sm:p-3">
                  <!-- Product Name -->
                  <h3
                    class="text-text-primary font-medium text-xs sm:text-sm leading-tight line-clamp-2 mb-1 sm:mb-2 group-hover:text-primary transition-colors"
                    [title]="product.name"
                  >
                    {{ product.name }}
                  </h3>
                  <!-- Product Description (hidden on mobile, shortened on desktop) -->
                  @if (product.description) {
                    <p
                      class="hidden sm:block text-text-secondary text-xs line-clamp-1 mb-2"
                      [title]="product.description"
                    >
                      {{ product.description }}
                    </p>
                  }
                  <!-- Bottom Section: Price and Stock -->
                  <div class="flex items-center justify-between">
                    <!-- Price -->
                    <div class="flex flex-col">
                      @if (hasActivePromoOrSale(product)) {
                        <div class="flex items-baseline gap-1 flex-wrap">
                          <span
                            class="text-success font-bold text-xs sm:text-sm lg:text-base xl:text-lg leading-tight truncate"
                          >
                            {{ promotionalPrice(product) | currency }}
                            @if (product.pricing_type === 'weight') {
                              <span
                                class="text-[10px] font-normal text-text-secondary"
                                >/{{ defaultWeightUnit() }}</span
                              >
                            }
                          </span>
                          <span
                            class="text-[10px] sm:text-xs text-text-muted line-through"
                          >
                            {{ product.final_price | currency }}
                          </span>
                        </div>
                      } @else {
                        <span
                          class="text-text-primary font-bold text-xs sm:text-sm lg:text-base xl:text-lg leading-tight truncate"
                        >
                          {{ product.final_price | currency }}
                          @if (product.pricing_type === 'weight') {
                            <span
                              class="text-[10px] font-normal text-text-secondary"
                              >/{{ defaultWeightUnit() }}</span
                            >
                          }
                        </span>
                      }
                      <!-- Stock indicator for non-variant products -->
                      @if (product.track_inventory !== false) {
                        @if (!product.has_variants) {
                          <span
                            class="text-[10px] sm:text-xs leading-tight"
                            [class]="
                              product.is_available === false
                                ? 'text-error font-semibold'
                                : isProductLowStock(product)
                                  ? 'text-warning font-medium'
                                  : 'text-text-muted'
                            "
                          >
                            {{
                              product.is_available === false
                                ? 'Sin stock'
                                : product.stock + ' en stock'
                            }}
                          </span>
                        }
                      } @else {
                        @if (!product.has_variants) {
                          <span
                            class="text-[10px] sm:text-xs leading-tight text-blue-600 font-medium"
                          >
                            Disponible
                          </span>
                        }
                      }
                    </div>
                  </div>
                  <!-- Additional Product Details + Add Button -->
                  <div
                    class="hidden sm:flex items-center justify-between mt-2 pt-2 border-t border-border/60 gap-2"
                  >
                    <div
                      class="flex-1 min-w-0 flex items-center gap-2 text-xs text-text-muted"
                    >
                      @if (product.sku) {
                        <span
                          class="font-mono truncate max-w-[80px]"
                          [title]="product.sku"
                          >{{ product.sku }}</span
                        >
                      }
                      @if (product.category_name) {
                        <span class="truncate">{{
                          product.category_name
                        }}</span>
                      }
                    </div>
                    <button
                      [class]="getAddButtonClass(product)"
                      [disabled]="isProductCardUnavailable(product)"
                      (click)="$event.stopPropagation(); onAddToCart(product)"
                      aria-label="Agregar al carrito"
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2.5"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                      >
                        <line x1="12" y1="5" x2="12" y2="19"></line>
                        <line x1="5" y1="12" x2="19" y2="12"></line>
                      </svg>
                    </button>
                  </div>
                </div>
              </div>
            }
          </div>
        }
      </div>
    </div>

    <!-- Variant Selector Modal -->
    @if (showVariantSelector() && selectedProductForVariant()) {
      <app-pos-variant-selector
        [product]="selectedProductForVariant()"
        [variants]="selectedProductForVariant()!.product_variants"
        (variantSelected)="onVariantSelected($event)"
        (closed)="onVariantSelectorClosed()"
      ></app-pos-variant-selector>
    }

    <!-- Stock Sourcing Suggestion Modal -->
    <app-pos-stock-sourcing-modal
      [(isOpen)]="showSourcingModal"
      [suggestion]="sourcingResponse()"
      [productName]="sourcingProductName()"
      [variantLabel]="sourcingVariantLabel()"
      (closed)="onSourcingModalClosed()"
    ></app-pos-stock-sourcing-modal>

    <!-- Restaurant Suite — Fase K Gap 1: choice modal for prepared
         + track_inventory + stock greater than 0 products. -->
    <app-pos-prepared-choice-modal
      [isOpen]="preparedChoiceOpen()"
      [product]="preparedChoiceProduct()"
      (decided)="onPreparedChoice($event)"
    ></app-pos-prepared-choice-modal>

    <!-- QUI-431: serial-number selection for serialized products -->
    <app-pos-serial-selection-modal
      [isOpen]="serialModalOpen()"
      [productName]="serialModalProductName()"
      [quantity]="serialModalQuantity()"
      [options]="serialModalOptions()"
      [loading]="serialModalLoading()"
      (confirmed)="onSerialConfirmed($event)"
      (cancelled)="onSerialCancelled()"
    ></app-pos-serial-selection-modal>
  `,
  styles: [
    `
      :host {
        display: block;
        height: 100%;
        min-height: 0;
        overflow: hidden;
      }

      .scrollbar-hide::-webkit-scrollbar {
        display: none;
      }
      .scrollbar-hide {
        -ms-overflow-style: none;
        scrollbar-width: none;
      }

      /* iOS-style header blur */
      .product-header {
        background: rgba(var(--color-surface-rgb, 255, 255, 255), 0.85);
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
        position: relative;
        z-index: 10;
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

      /* iOS-style product cards */
      .product-card {
        transition: all 0.15s cubic-bezier(0.4, 0, 0.2, 1);
        -webkit-tap-highlight-color: transparent;
      }

      .product-card:active {
        transform: scale(0.97);
      }

      @media (hover: hover) {
        .product-card:hover {
          transform: translateY(-2px);
          box-shadow: 0 8px 25px -8px rgba(0, 0, 0, 0.15);
        }

        .product-card:active {
          transform: scale(0.98);
        }
      }

      /* Price styling */
      .price-primary {
        color: var(--color-primary);
        font-weight: var(--fw-bold);
      }
    `,
  ],
})
export class PosProductSelectionComponent {
  private destroyRef = inject(DestroyRef);
  readonly loading = signal(false);
  readonly searchQuery = signal('');
  readonly selectedCategory = signal<any>(null);
  readonly selectedBrand = signal<any>(null);
  readonly filteredProducts = signal<any[]>([]);
  readonly categories = signal<any[]>([]);
  readonly brands = signal<any[]>([]);
  addingToCart = new Set<string>();

  // Variant selection state
  readonly showVariantSelector = signal(false);
  readonly selectedProductForVariant = signal<any>(null);

  // Stock sourcing modal state — surfaced when in-scope stock is insufficient
  // and `pos_stock_scope === 'main_location'`.
  readonly showSourcingModal = signal(false);
  readonly sourcingResponse = signal<StockSourcingSuggestionResponse | null>(
    null,
  );
  readonly sourcingProductName = signal<string>('');
  readonly sourcingVariantLabel = signal<string>('');

  // Scale/weight settings from store
  readonly scaleEnabled = signal(false);
  readonly defaultWeightUnit = signal<'kg' | 'g' | 'lb'>('kg');
  readonly allowManualWeightEntry = signal(true);
  readonly lowStockThreshold = signal(10);

  // Filter configuration for the options dropdown
  filterConfigs: FilterConfig[] = [
    {
      key: 'category_id',
      label: 'Categoría',
      type: 'select',
      options: [{ value: '', label: 'Todas las Categorías' }],
      placeholder: 'Seleccionar categoría',
    },
    {
      key: 'brand_id',
      label: 'Marca',
      type: 'select',
      options: [{ value: '', label: 'Todas las Marcas' }],
      placeholder: 'Seleccionar marca',
    },
  ];

  // Current filter values
  readonly filterValues = signal<FilterValues>({});

  readonly refreshTrigger = input<number>(0);
  readonly selectedCustomer = input<any>(null);
  readonly queueEnabled = input<boolean>(false);
  readonly queueCount = input<number>(0);

  readonly productSelected = output<any>();
  readonly productAddedToCart = output<{ product: any; quantity: number }>();
  readonly bookingRequired = output<any>();
  readonly openCustomerModal = output<void>();
  readonly openQueueModal = output<void>();

  private searchSubject$ = new Subject<string>(); // LEGÍTIMO — debounceTime+distinctUntilChanged search stream
  private productService = inject(PosProductService);
  private cartService = inject(PosCartService);
  private toastService = inject(ToastService);
  private dialogService = inject(DialogService);
  private router = inject(Router);
  private store = inject(Store);
  private currencyService = inject(CurrencyFormatService);
  private scaleService = inject(PosScaleService);
  private restaurantIntegration = inject(PosRestaurantIntegrationService);
  private serialNumbersService = inject(SerialNumbersService);
  private cashRegisterService = inject(PosCashRegisterService);
  private posApiService = inject(PosApiService);

  // ─── Order-scope promotion notice ──────────────────────────────────────────
  /**
   * Active auto-apply promotions whose scope is the WHOLE order. These never
   * appear as a per-product `active_promotion` (that field is product/category
   * only), so the grid surfaces them as a single view-level chip.
   */
  readonly orderScopePromotions = signal<ActiveOrderPromotion[]>([]);

  /**
   * Human-readable chip label for the highest-priority active order-scope
   * promotion (backend already returns them ordered by priority desc), with a
   * "+N" suffix when more than one is active. Null when none is active.
   */
  readonly orderPromoNotice = computed<string | null>(() => {
    const promos = this.orderScopePromotions();
    if (promos.length === 0) return null;
    const top = promos[0];
    const name = (top.name ?? '').trim();
    const head = name ? `Promoción de orden: ${name}` : 'Promoción de orden activa';
    const benefit = this.orderPromoBenefitLabel(top);
    const detail = benefit ? `${head} · ${benefit}` : head;
    return promos.length > 1 ? `${detail} (+${promos.length - 1})` : detail;
  });

  constructor() {
    this.checkAuthState();
    this.loadScaleSettings();
    this.initializeCategories();
    this.initializeBrands();
    this.setupSearchSubscription();
    this.loadProducts();
    this.loadOrderScopePromotions();

    effect(() => {
      if (this.refreshTrigger() > 0) {
        this.loadProducts();
      }
    });

    effect(() => {
      if (this.restaurantIntegration.isRestaurantMode()) {
        this.filterProducts();
      }
    });
  }

  private initializeCategories(): void {
    const allCategory = { id: '', name: 'Todos', icon: 'grid' };
    this.categories.set([allCategory]);
    this.selectedCategory.set(allCategory);
    this.loadCategories();
  }

  private initializeBrands(): void {
    const allBrand = {
      id: '',
      name: 'Todas',
      slug: 'all',
      store_id: 0,
      created_at: new Date(),
      updated_at: new Date(),
    };
    this.brands.set([allBrand]);
    this.selectedBrand.set(allBrand);
    this.loadBrands();
  }

  private loadCategories(): void {
    this.productService
      .getCategories()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (categories) => {
          const backendCategories = categories.map((cat) => ({
            id: cat.id.toString(),
            name: cat.name,
            icon: 'tag',
          }));
          this.categories.set([this.categories()[0], ...backendCategories]);
          this.updateFilterOptions();
        },
        error: (error) => {},
      });
  }

  private loadBrands(): void {
    this.productService
      .getBrands()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (brands) => {
          const backendBrands = brands.map((brand) => ({
            ...brand,
            id: brand.id.toString(),
          }));
          this.brands.set([this.brands()[0], ...backendBrands]);
          this.updateFilterOptions();
        },
        error: (error) => {},
      });
  }

  private updateFilterOptions(): void {
    const categoryFilter = this.filterConfigs.find(
      (f) => f.key === 'category_id',
    );
    if (categoryFilter) {
      categoryFilter.options = [
        { value: '', label: 'Todas las Categorías' },
        ...this.categories()
          .filter((c) => c.id !== '')
          .map((cat) => ({
            value: cat.id.toString(),
            label: cat.name,
          })),
      ];
    }

    const brandFilter = this.filterConfigs.find((f) => f.key === 'brand_id');
    if (brandFilter) {
      brandFilter.options = [
        { value: '', label: 'Todas las Marcas' },
        ...this.brands()
          .filter((b) => b.id !== '')
          .map((brand) => ({
            value: brand.id.toString(),
            label: brand.name,
          })),
      ];
    }

    this.filterConfigs = [...this.filterConfigs];
  }

  private setupSearchSubscription(): void {
    this.searchSubject$
      .pipe(
        debounceTime(300),
        distinctUntilChanged(),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((query) => {
        this.searchQuery.set(query);
        this.filterProducts();
      });
  }

  loadProducts(): void {
    this.loading.set(true);
    this.filterProducts();
  }

  private filterProducts(): void {
    this.loading.set(true);
    const filters: any = {
      state: 'active',
      pos_optimized: true,
      include_stock: true,
      // El POS es un canal de venta: nunca muestra insumos puros ni productos
      // marcados como no-vendibles. Filtro universal (no gateado por industria)
      // para ser consistente con catálogo, mesas y menú, que ya aplican
      // is_sellable=true en el backend. Seguro en retail: la columna es
      // NOT NULL DEFAULT TRUE, así que solo oculta lo marcado a propósito.
      is_sellable: true,
    };

    if (this.searchQuery()) {
      filters.query = this.searchQuery();
    }

    const selectedCat = this.selectedCategory();
    if (selectedCat && selectedCat.id !== '') {
      filters.category = selectedCat.id;
    }

    const selectedBr = this.selectedBrand();
    if (selectedBr && selectedBr.id !== '') {
      filters.brand = selectedBr.id.toString();
    }

    this.productService
      .searchProducts(filters)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result: SearchResult) => {
          const uniqueProducts = this.removeDuplicateProducts(
            result.products || [],
          );

          this.filteredProducts.set(uniqueProducts);
          this.loading.set(false);
        },
        error: (error: any) => {
          this.loading.set(false);
          this.toastService.error('Error al cargar productos');
        },
      });
  }

  /**
   * Load active auto-apply order-scope promotions for the view-level chip.
   * Uses the same admin endpoint the cart already relies on
   * (`/store/promotions/active`). Failures are non-critical — the chip simply
   * stays hidden. Managed subscribe (takeUntilDestroyed) → signal, consistent
   * with the rest of this component's data loads.
   */
  private loadOrderScopePromotions(): void {
    this.posApiService
      .getActivePromotions()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response: any) => {
          const raw = response?.data ?? response ?? [];
          const list: any[] = Array.isArray(raw) ? raw : [];
          const orderPromos = list
            .filter((p) => p?.scope === 'order' && p?.is_auto_apply === true)
            .map(
              (p): ActiveOrderPromotion => ({
                id: Number(p.id),
                name: String(p.name ?? ''),
                type: p.type === 'fixed_amount' ? 'fixed_amount' : 'percentage',
                value: Number(p.value ?? 0),
                minPurchaseAmount:
                  p.min_purchase_amount != null
                    ? Number(p.min_purchase_amount)
                    : null,
              }),
            );
          this.orderScopePromotions.set(orderPromos);
        },
        error: () => {
          this.orderScopePromotions.set([]);
        },
      });
  }

  /**
   * Concise benefit fragment for an order-scope promotion chip:
   * `-10%` for percentage, `-$5.000` for a fixed amount. Empty when the value
   * is not a usable positive number.
   */
  private orderPromoBenefitLabel(promo: ActiveOrderPromotion): string {
    const value = Number(promo.value);
    if (!Number.isFinite(value) || value <= 0) return '';
    if (promo.type === 'percentage') {
      return `-${value}%`;
    }
    return `-${this.formatPrice(value)}`;
  }

  onSearch(searchTerm: string): void {
    this.searchSubject$.next(searchTerm);
  }

  onClearSearch(): void {
    this.searchQuery.set('');
    this.searchSubject$.next('');
  }

  onCategoryChange(event: any): void {
    const categoryId = event.target.value;
    const category = this.categories().find((c) => c.id === categoryId);
    this.selectedCategory.set(category || this.categories()[0]);
    this.filterProducts();
  }

  onSelectCategory(category: any): void {
    this.selectedCategory.set(category);
    this.filterProducts();
  }

  onSelectBrand(brand: Brand): void {
    this.selectedBrand.set(brand);
    this.filterProducts();
  }

  onOptionsFilterChange(values: FilterValues): void {
    this.filterValues.set(values);

    const categoryId = values['category_id'] as string;
    const brandId = values['brand_id'] as string;

    if (categoryId) {
      this.selectedCategory.set(
        this.categories().find((c) => c.id === categoryId) ||
          this.categories()[0],
      );
    } else {
      this.selectedCategory.set(this.categories()[0]);
    }

    if (brandId) {
      this.selectedBrand.set(
        this.brands().find((b) => b.id.toString() === brandId) ||
          this.brands()[0],
      );
    } else {
      this.selectedBrand.set(this.brands()[0]);
    }

    this.filterProducts();
  }

  onClearFilters(): void {
    this.filterValues.set({});
    this.selectedCategory.set(this.categories()[0]);
    this.selectedBrand.set(this.brands()[0]);
    this.filterProducts();
  }

  onFilterChange(filters: ProductQueryDto): void {
    if (filters.category_id) {
      this.selectedCategory.set(
        this.categories().find(
          (c) => c.id === filters.category_id!.toString(),
        ) || this.categories()[0],
      );
    } else {
      this.selectedCategory.set(this.categories()[0]);
    }

    if (filters.brand_id) {
      this.selectedBrand.set(
        this.brands().find(
          (b) => b.id.toString() === filters.brand_id!.toString(),
        ) || this.brands()[0],
      );
    } else {
      this.selectedBrand.set(this.brands()[0]);
    }

    if (filters.search !== undefined && filters.search !== this.searchQuery()) {
      this.searchQuery.set(filters.search);
    }

    this.filterProducts();
  }

  getCategoryClass(category: any): string {
    const baseClass =
      'border-border bg-surface text-text-secondary hover:border-primary hover:text-primary hover:bg-primary-light transition-colors';
    const selectedClass =
      'border-primary bg-primary-light text-primary shadow-card';

    return this.selectedCategory()?.id === category.id
      ? selectedClass
      : baseClass;
  }

  onSelectProduct(product: any): void {
    this.productSelected.emit(product);
  }

  isProductCardUnavailable(product: any): boolean {
    if (product.effective_track_inventory === false) return false;
    if (product.track_inventory === false) return false;

    if (product.has_variants) {
      const variants = product.product_variants ?? [];
      if (!variants.length) return false;
      return variants.every((v: any) => v.is_available === false);
    }

    if (typeof product.is_available === 'boolean') {
      return !product.is_available;
    }
    return product.stock === 0;
  }

  getAddButtonClass(product: any): string {
    const base =
      'shrink-0 w-7 h-7 rounded-full flex items-center justify-center transition-all duration-200 shadow-sm text-[var(--color-text-on-primary)]';
    return this.isProductCardUnavailable(product)
      ? `${base} opacity-50 cursor-not-allowed bg-muted`
      : `${base} bg-[var(--color-primary)] hover:opacity-90 hover:scale-110 active:scale-95`;
  }

  async onAddToCart(product: any): Promise<void> {
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

    // Intercept products with variants — open selector modal
    if (product.has_variants && product.product_variants?.length > 0) {
      this.showVariantSelector.set(true);
      this.selectedProductForVariant.set(product);
      return;
    }

    if (product.requires_booking === true) {
      this.bookingRequired.emit(product);
      return;
    }

    await this.addToCartNormal(product);
  }

  async onVariantSelected(variant: PosProductVariant): Promise<void> {
    this.showVariantSelector.set(false);
    const product = this.selectedProductForVariant();
    this.selectedProductForVariant.set(null);

    if (!product) return;

    if (product.requires_booking === true) {
      this.bookingRequired.emit({ product, variant });
      return;
    }

    // If product is weight-based and scale is enabled, prompt for weight
    const isWeightProduct =
      product.pricing_type === 'weight' && this.scaleEnabled();
    if (isWeightProduct) {
      const unit = this.defaultWeightUnit();
      const variantPrice = variant.price_override ?? product.final_price;
      const weight = await this.getWeightFromScaleOrManual(
        product.name,
        variantPrice,
        unit,
      );
      if (weight === undefined) return;

      if (weight <= 0) {
        this.toastService.warning('El peso debe ser mayor a 0');
        return;
      }
      if (weight > 999) {
        this.toastService.warning('El peso máximo permitido es 999 ' + unit);
        return;
      }

      this.addingToCart.add(product.id);
      this.cartService
        .addToCart({ product, quantity: 1, variant, weight, weight_unit: unit })
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: () => {
            this.addingToCart.delete(product.id);
            const variantLabel =
              variant.attributes?.map((a) => a.attribute_value).join(' / ') ||
              '';
            this.toastService.success(
              `${product.name} (${variantLabel}) ${weight} ${unit} agregado al carrito`,
            );
            this.productAddedToCart.emit({ product, quantity: 1 });
          },
          error: (error) => {
            this.addingToCart.delete(product.id);
            this.handleAddToCartError(error, product, variant, 1);
          },
        });
      return;
    }

    // QUI-431: serialized products NO longer capture serials at the POS.
    // The serial numbers are now registered when the dispatch remission is
    // confirmed, so the add proceeds directly without opening the (kept, but
    // unused-here) serial-selection modal and without aborting on cancel.
    this.addingToCart.add(product.id);

    this.cartService
      .addToCart({
        product,
        quantity: 1,
        variant,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.addingToCart.delete(product.id);
          const variantLabel =
            variant.attributes?.map((a) => a.attribute_value).join(' / ') || '';
          this.toastService.success(
            `${product.name} (${variantLabel}) agregado al carrito`,
          );
          this.productAddedToCart.emit({ product, quantity: 1 });
        },
        error: (error) => {
          this.addingToCart.delete(product.id);
          this.handleAddToCartError(error, product, variant, 1);
        },
      });
  }

  onVariantSelectorClosed(): void {
    this.showVariantSelector.set(false);
    this.selectedProductForVariant.set(null);
  }

  /**
   * Detect when the cart-service rejection was caused by insufficient stock.
   * The cart service throws an Error whose `.message` includes "Stock
   * insuficiente"; we match defensively against both `error.message` and the
   * stringified error so future refactors of the cart service do not break
   * this check silently.
   */
  private isInsufficientStockError(error: any): boolean {
    const msg = (error?.message ?? String(error ?? '')).toString();
    return msg.toLowerCase().includes('stock insuficiente');
  }

  /**
   * Try to surface a sourcing-suggestion modal when add-to-cart was rejected
   * due to insufficient stock under the `main_location` POS scope.
   * Falls back to a plain warning toast otherwise.
   */
  private handleAddToCartError(
    error: any,
    product: any,
    variant?: PosProductVariant,
    quantity: number = 1,
  ): void {
    const isStockError = this.isInsufficientStockError(error);
    const scope = this.productService.getPosStockScope();

    if (!isStockError || scope !== 'main_location') {
      this.toastService.warning(
        error?.message || 'Error al agregar producto al carrito',
      );
      return;
    }

    const productId = Number(product?.id);
    if (!Number.isFinite(productId)) {
      this.toastService.warning(
        error?.message || 'Error al agregar producto al carrito',
      );
      return;
    }

    this.productService
      .getStockSourcingSuggestion({
        product_id: productId,
        product_variant_id: variant?.id ?? null,
        quantity,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          // If by the time we asked there is in-scope stock, just inform the
          // cashier — the cart-service local cache is stale relative to the
          // backend. They can re-tap "add to cart".
          if (response.suggestion === 'available') {
            this.toastService.info(
              'Hay stock disponible; intenta agregar nuevamente.',
            );
            return;
          }
          const variantLabel =
            variant?.attributes?.map((a) => a.attribute_value).join(' / ') ||
            '';
          this.sourcingResponse.set(response);
          this.sourcingProductName.set(product?.name ?? '');
          this.sourcingVariantLabel.set(variantLabel);
          this.showSourcingModal.set(true);
        },
        error: () => {
          // Endpoint failed — fall back to the original error message.
          this.toastService.warning(
            error?.message || 'Error al agregar producto al carrito',
          );
        },
      });
  }

  onSourcingModalClosed(): void {
    this.sourcingResponse.set(null);
    this.sourcingProductName.set('');
    this.sourcingVariantLabel.set('');
  }

  // ─── Restaurant Suite — Fase K Gap 1: prepared/track_inventory/stock choice ──
  /** True when the prepared-choice modal is visible. */
  readonly preparedChoiceOpen = signal(false);
  /** Product the cashier is currently deciding on. */
  readonly preparedChoiceProduct = signal<{
    id: number;
    name: string;
    stock?: number;
    sku?: string | null;
  } | null>(null);
  /** Resolver captured at modal-open time; invoked with the cashier's choice. */
  private preparedChoiceResolver:
    | ((choice: PreparedChoice) => void)
    | null = null;

  /**
   * Returns true if the product qualifies for the stock-vs-KDS
   * decision modal: a `prepared` product_type that tracks inventory
   * and has stock > 0. Only meaningful in a `restaurant` store
   * industry (we don't prompt retail stores).
   */
  private shouldPromptPreparedChoice(product: any): boolean {
    if (!this.restaurantIntegration.isRestaurantMode()) return false;
    if (product?.product_type !== 'prepared') return false;
    if (product?.track_inventory === false) return false;
    const stock = Number(product?.stock ?? 0);
    return stock > 0;
  }

  /** Opens the choice modal and returns a promise resolved with the cashier's pick. */
  private askPreparedChoice(product: any): Promise<PreparedChoice> {
    return new Promise<PreparedChoice>((resolve) => {
      this.preparedChoiceProduct.set({
        id: Number(product.id),
        name: String(product.name ?? ''),
        stock: Number(product.stock ?? 0),
        sku: product.sku ?? null,
      });
      this.preparedChoiceResolver = resolve;
      this.preparedChoiceOpen.set(true);
    });
  }

  /** Modal callback — runs the resolver and closes the modal. */
  onPreparedChoice(result: {
    product: { id: number; name: string; stock?: number };
    choice: PreparedChoice;
  }): void {
    const resolver = this.preparedChoiceResolver;
    this.preparedChoiceResolver = null;
    this.preparedChoiceOpen.set(false);
    this.preparedChoiceProduct.set(null);
    if (resolver) resolver(result.choice);
  }

  // ─── QUI-431: serial-number selection for serialized products ───────────────
  /** True when the serial-selection modal is visible. */
  readonly serialModalOpen = signal(false);
  /** Product name shown in the serial modal. */
  readonly serialModalProductName = signal<string>('');
  /** Quantity of serials the line requires. */
  readonly serialModalQuantity = signal<number>(1);
  /** Available in_stock serials (id + serial) as selector options. */
  readonly serialModalOptions = signal<MultiSelectorOption[]>([]);
  /** True while the available-serials request is loading. */
  readonly serialModalLoading = signal(false);
  /** Resolver captured at open time; invoked with the cashier's choice or null. */
  private serialResolver:
    | ((result: { serialIds: number[]; freeTextSerials: string[] } | null) => void)
    | null = null;

  /**
   * Opens the serial-selection modal for a serialized product and resolves with
   * the cashier's choice (pool ids + free-text) or null if cancelled. The pool
   * is fetched from the active cash-register session's location; when no
   * location is resolvable, the modal still allows free-text entry.
   */
  private askSerialSelection(
    product: any,
    quantity: number,
    variantId?: number,
  ): Promise<{ serialIds: number[]; freeTextSerials: string[] } | null> {
    return new Promise((resolve) => {
      this.serialResolver = resolve;
      this.serialModalProductName.set(String(product?.name ?? ''));
      this.serialModalQuantity.set(quantity > 0 ? quantity : 1);
      this.serialModalOptions.set([]);
      this.serialModalOpen.set(true);

      const productId = Number(product?.id);
      // The register's location override is the POS source-of-truth location for
      // the in_stock pool lookup. Falls back to the register's nested location id.
      const session = this.cashRegisterService.getActiveSessionSnapshot();
      const locationId =
        session?.register?.location_id ?? session?.register?.location?.id ?? null;

      // Pool lookup needs both product and location; without a location we keep
      // the modal open in free-text-only mode (backend resolves/creates rows).
      if (!Number.isFinite(productId) || locationId == null) {
        return;
      }

      this.serialModalLoading.set(true);
      this.serialNumbersService
        .listAvailable({
          product_id: productId,
          location_id: locationId,
          product_variant_id: variantId,
        })
        .pipe(takeUntilDestroyed(this.destroyRef))
        .subscribe({
          next: (serials) => {
            this.serialModalOptions.set(
              serials.map((s) => ({
                value: s.id,
                label: s.serial_number,
              })),
            );
            this.serialModalLoading.set(false);
          },
          error: () => {
            // Non-fatal: fall back to free-text entry only.
            this.serialModalOptions.set([]);
            this.serialModalLoading.set(false);
          },
        });
    });
  }

  /** Modal callback — resolve with the cashier's selection and close. */
  onSerialConfirmed(result: {
    serialIds: number[];
    freeTextSerials: string[];
  }): void {
    const resolver = this.serialResolver;
    this.serialResolver = null;
    this.serialModalOpen.set(false);
    if (resolver) resolver(result);
  }

  /** Modal callback — cashier cancelled; resolve with null (abort add). */
  onSerialCancelled(): void {
    const resolver = this.serialResolver;
    this.serialResolver = null;
    this.serialModalOpen.set(false);
    if (resolver) resolver(null);
  }

  /** True when the product requires per-unit serial numbers. */
  private requiresSerials(product: any): boolean {
    return product?.requires_serial_numbers === true;
  }

  private async addToCartNormal(product: any): Promise<void> {
    if (product.track_inventory !== false) {
      if (product.stock > 0 && this.isProductLowStock(product)) {
        this.toastService.warning(
          `Producto con existencias bajo (${product.stock} unidades restantes)`,
        );
      }

      if (product.stock === 0) {
        this.toastService.warning('Producto sin stock disponible');
        return;
      }
    }

    // Check if product is sold by weight and scale is enabled
    const isWeightProduct =
      product.pricing_type === 'weight' && this.scaleEnabled();

    // For weight products, require weight input
    if (isWeightProduct) {
      const unit = this.defaultWeightUnit();
      const weight = await this.getWeightFromScaleOrManual(
        product.name,
        product.final_price,
        unit,
      );
      if (weight === undefined) return;

      if (weight <= 0) {
        this.toastService.warning('El peso debe ser mayor a 0');
        return;
      }
      if (weight > 999) {
        this.toastService.warning('El peso máximo permitido es 999 ' + unit);
        return;
      }

      this.addWeightProductToCart(product, weight);
      return;
    }

    // Restaurant Suite — Fase K Gap 1: prepared + track_inventory +
    // stock>0 product → ask the cashier whether to use stock or
    // produce via KDS before adding to cart.
    let skipKds = false;
    if (this.shouldPromptPreparedChoice(product)) {
      const choice = await this.askPreparedChoice(product);
      if (choice === 'cancel') return;
      skipKds = choice === 'stock';
    }

    // QUI-431: serialized products NO longer capture serials at the POS.
    // The serial numbers are now registered when the dispatch remission is
    // confirmed, so the add proceeds directly without opening the (kept, but
    // unused-here) serial-selection modal and without aborting on cancel.

    // Regular unit product
    this.addingToCart.add(product.id);

    this.cartService
      .addToCart({
        product: product,
        quantity: 1,
        skipKds,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.addingToCart.delete(product.id);
          const tag = skipKds ? ' (usar stock)' : '';
          this.toastService.success(
            `${product.name} agregado al carrito${tag}`,
          );
          this.productAddedToCart.emit({ product, quantity: 1 });
        },
        error: (error) => {
          this.addingToCart.delete(product.id);
          this.handleAddToCartError(error, product, undefined, 1);
        },
      });
  }

  private addWeightProductToCart(product: any, weight: number): void {
    this.addingToCart.add(product.id);

    const unit = this.defaultWeightUnit();
    const totalPrice = product.final_price * weight;

    this.cartService
      .addToCart({
        product: product,
        quantity: 1,
        weight: weight,
        weight_unit: unit,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.addingToCart.delete(product.id);
          this.toastService.success(
            `${product.name} (${weight} ${unit}) agregado al carrito - ${this.formatPrice(totalPrice)}`,
          );
          this.productAddedToCart.emit({ product, quantity: 1 });
        },
        error: (error) => {
          this.addingToCart.delete(product.id);
          this.handleAddToCartError(error, product, undefined, 1);
        },
      });
  }

  private async getWeightFromScaleOrManual(
    productName: string,
    price: number,
    unit: string,
  ): Promise<number | undefined> {
    if (this.scaleService.isConnected()) {
      return this.scaleService.showWeightModal({
        title: 'Lectura de Báscula',
        message: `${productName}\nPrecio: ${this.formatPrice(price)}/${unit}`,
        weightUnit: unit,
        allowManualFallback: this.allowManualWeightEntry(),
      });
    }

    if (this.allowManualWeightEntry()) {
      const weightStr = await this.dialogService.prompt(
        {
          title: 'Ingresar Peso',
          message: `${productName}\nPrecio: ${this.formatPrice(price)}/${unit}`,
          placeholder: `Peso en ${unit}`,
          defaultValue: '1.0',
          confirmText: 'Agregar',
          cancelText: 'Cancelar',
          inputType: 'number',
        },
        { size: 'sm' },
      );

      if (!weightStr) return undefined;
      const weight = parseFloat(weightStr.replace(',', '.'));
      return isNaN(weight) ? undefined : weight;
    }

    this.toastService.warning(
      'Báscula no conectada y pesado manual deshabilitado',
    );
    return undefined;
  }

  async toggleScaleConnection(): Promise<void> {
    if (this.scaleService.isConnected()) {
      await this.scaleService.disconnect();
      this.toastService.info('Báscula desconectada');
    } else {
      const connected = await this.scaleService.connect();
      if (connected) {
        this.toastService.success('Báscula conectada');
      } else {
        this.toastService.warning('No se pudo conectar la báscula');
      }
    }
  }

  get scaleConnectionStatus() {
    return this.scaleService.status();
  }

  get showScaleButton(): boolean {
    return this.scaleEnabled() && this.scaleService.isWebSerialSupported();
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
    if (this.searchQuery()) {
      return 'No se encontraron productos';
    }
    return 'No hay productos disponibles';
  }

  getEmptyStateDescription(): string {
    if (this.searchQuery()) {
      return 'Intenta buscar con otros términos o cambia la categoría.';
    }
    return 'Los productos aparecerán aquí cuando estén disponibles.';
  }

  private formatPrice(amount: number): string {
    return this.currencyService.format(amount);
  }

  /**
   * Cards render the promotional price when the product has either a
   * backend-resolved auto promotion (`active_promotion`) or an active
   * `sale_price < base_price`. Both paths are visually consistent —
   * struck-through original next to the discounted price + a badge.
   */
  hasActivePromoOrSale(product: any): boolean {
    const promo = product?.active_promotion;
    if (promo && Number(promo.promotional_price) < Number(product.final_price)) {
      return true;
    }
    const salePrice = Number(product?.sale_price);
    const basePrice = Number(product?.price ?? product?.base_price);
    return (
      Number.isFinite(salePrice) &&
      salePrice > 0 &&
      Number.isFinite(basePrice) &&
      salePrice < basePrice &&
      product?.is_on_sale === true
    );
  }

  /**
   * Resolve the promotional unit price for a card. Prefer the
   * backend-resolved `active_promotion.promotional_price`; fall back to
   * `sale_price` when the product is on sale and the promotion is absent.
   */
  promotionalPrice(product: any): number {
    const promo = product?.active_promotion;
    if (promo && Number.isFinite(Number(promo.promotional_price))) {
      return Number(promo.promotional_price);
    }
    const salePrice = Number(product?.sale_price);
    if (Number.isFinite(salePrice) && salePrice > 0) {
      return salePrice;
    }
    return Number(product?.final_price ?? 0);
  }

  isProductLowStock(product: any): boolean {
    const stock = Number(product?.stock ?? product?.stock_quantity ?? 0);
    return stock > 0 && stock <= this.getProductLowStockThreshold(product);
  }

  private getProductLowStockThreshold(product: any): number {
    const productThreshold = Number(product?.minStock);
    if (Number.isFinite(productThreshold) && productThreshold >= 0) {
      return productThreshold;
    }

    const configuredThreshold = Number(this.lowStockThreshold());
    return Number.isFinite(configuredThreshold) && configuredThreshold >= 0
      ? configuredThreshold
      : 10;
  }

  private loadScaleSettings(): void {
    this.store
      .select(selectStoreSettings)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((storeSettings: any) => {
        const threshold = Number(storeSettings?.inventory?.low_stock_threshold);
        this.lowStockThreshold.set(
          Number.isFinite(threshold) && threshold >= 0 ? threshold : 10,
        );

        if (storeSettings?.pos?.scale) {
          this.scaleEnabled.set(storeSettings.pos.scale.enabled ?? false);
          this.defaultWeightUnit.set(
            storeSettings.pos.scale.default_weight_unit || 'kg',
          );
          this.allowManualWeightEntry.set(
            storeSettings.pos.scale.allow_manual_weight_entry ?? true,
          );

          if (storeSettings.pos.scale.device) {
            this.scaleService.configure(storeSettings.pos.scale.device);
          }
        }
      });
  }

  private checkAuthState(): void {
    // Use store selectors instead of direct localStorage access
    this.store
      .select(selectAccessToken)
      .pipe(takeUntilDestroyed())
      .subscribe((token: any) => {
        if (!token) {
          this.toastService.error(
            'No estás autenticado. Por favor, inicia sesión.',
          );
        }
      });

    this.store
      .select(selectUser)
      .pipe(takeUntilDestroyed())
      .subscribe((user: any) => {
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
