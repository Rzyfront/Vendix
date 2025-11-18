import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { Observable, Subject, combineLatest, takeUntil } from 'rxjs';
import {
  Product,
  ProductStats,
  ProductQueryDto,
  ProductState,
  PaginatedResponse,
} from './interfaces';
import {
  TableComponent,
  TableColumn,
  TableAction,
  ButtonComponent,
  ButtonVariant,
  InputsearchComponent,
  ModalComponent,
  ModalSize,
  IconComponent,
  SelectorComponent,
  SelectorOption,
} from '../../../../shared/components';
import { ToastService } from '../../../../shared/components/toast/toast.service';
import { ProductCreateModalComponent } from './components';

// Import service directly to avoid bundling issues
import { ProductsService } from './services/products.service';

@Component({
  selector: 'app-products',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    TableComponent,
    ButtonComponent,
    InputsearchComponent,
    IconComponent,
    SelectorComponent,

    ProductCreateModalComponent,
  ],
  template: `
    <div class="p-6 space-y-6">
      <!-- Header -->
      <div class="flex justify-between items-center">
        <div>
          <h1 class="text-3xl font-bold text-gray-900">Products</h1>
          <p class="text-gray-600 mt-1">
            Manage your store products and inventory
          </p>
        </div>
        <app-button
          variant="primary"
          (clicked)="openCreateModal()"
          [disabled]="loading"
        >
          <app-icon name="plus" [size]="16" slot="icon"></app-icon>
          New Product
        </app-button>
      </div>

      <!-- Stats Cards -->
      <div
        class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6"
        *ngIf="stats"
      >
        <div class="bg-white rounded-lg shadow-sm border p-6">
          <div class="flex items-center">
            <div class="flex-shrink-0">
              <div
                class="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center"
              >
                <app-icon
                  name="package"
                  [size]="16"
                  class="text-blue-600"
                ></app-icon>
              </div>
            </div>
            <div class="ml-4">
              <p class="text-sm font-medium text-gray-600">Total Products</p>
              <p class="text-2xl font-semibold text-gray-900">
                {{ stats.total_products }}
              </p>
            </div>
          </div>
        </div>

        <div class="bg-white rounded-lg shadow-sm border p-6">
          <div class="flex items-center">
            <div class="flex-shrink-0">
              <div
                class="w-8 h-8 bg-green-100 rounded-full flex items-center justify-center"
              >
                <app-icon
                  name="check-circle"
                  [size]="16"
                  class="text-green-600"
                ></app-icon>
              </div>
            </div>
            <div class="ml-4">
              <p class="text-sm font-medium text-gray-600">Active</p>
              <p class="text-2xl font-semibold text-gray-900">
                {{ stats.active_products }}
              </p>
            </div>
          </div>
        </div>

        <div class="bg-white rounded-lg shadow-sm border p-6">
          <div class="flex items-center">
            <div class="flex-shrink-0">
              <div
                class="w-8 h-8 bg-yellow-100 rounded-full flex items-center justify-center"
              >
                <app-icon
                  name="alert-triangle"
                  [size]="16"
                  class="text-yellow-600"
                ></app-icon>
              </div>
            </div>
            <div class="ml-4">
              <p class="text-sm font-medium text-gray-600">Low Stock</p>
              <p class="text-2xl font-semibold text-gray-900">
                {{ stats.low_stock_products }}
              </p>
            </div>
          </div>
        </div>

        <div class="bg-white rounded-lg shadow-sm border p-6">
          <div class="flex items-center">
            <div class="flex-shrink-0">
              <div
                class="w-8 h-8 bg-red-100 rounded-full flex items-center justify-center"
              >
                <app-icon
                  name="x-circle"
                  [size]="16"
                  class="text-red-600"
                ></app-icon>
              </div>
            </div>
            <div class="ml-4">
              <p class="text-sm font-medium text-gray-600">Out of Stock</p>
              <p class="text-2xl font-semibold text-gray-900">
                {{ stats.out_of_stock_products }}
              </p>
            </div>
          </div>
        </div>
      </div>

      <!-- Filters -->
      <div class="bg-white rounded-lg shadow-sm border p-6">
        <div class="flex flex-col lg:flex-row gap-4">
          <div class="flex-1">
            <app-inputsearch
              placeholder="Search products by name, SKU..."
              [(ngModel)]="searchTerm"
              (ngModelChange)="onSearchChange()"
              [size]="'md'"
            >
            </app-inputsearch>
          </div>

          <div class="flex gap-2">
            <app-selector
              [(ngModel)]="selectedState"
              (ngModelChange)="onFilterChange()"
              [options]="stateOptions"
              [placeholder]="'All States'"
              [size]="'md'"
            >
            </app-selector>

            <app-button
              variant="outline"
              (clicked)="resetFilters()"
              [disabled]="loading"
            >
              <app-icon name="refresh-cw" [size]="16" slot="icon"></app-icon>
              Reset
            </app-button>
          </div>
        </div>
      </div>

      <!-- Products Table -->
      <div class="bg-white rounded-lg shadow-sm border">
        <app-table
          [data]="products"
          [columns]="tableColumns"
          [actions]="tableActions"
          [loading]="loading"
          [emptyMessage]="emptyMessage"
          (sort)="onSortChange($event)"
        >
        </app-table>
      </div>

      <!-- Create Product Modal -->
      <app-product-create-modal
        [show]="showCreateModal"
        (closed)="closeCreateModal()"
        (created)="onProductCreated()"
      >
      </app-product-create-modal>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        width: 100%;
      }
    `,
  ],
})
export class ProductsComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();

  // Data
  products: Product[] = [];
  stats: ProductStats | null = null;

  // UI State
  loading = false;
  creating = false;
  showCreateModal = false;
  searchTerm = '';
  selectedState: ProductState | '' = '';

  // Pagination
  currentPage = 1;
  pageSize = 10;
  totalItems = 0;

  private toastService = inject(ToastService);
  private productsService = inject(ProductsService);

  // Sorting
  sortField = 'created_at';
  sortDirection: 'asc' | 'desc' = 'desc';

  // Selector options
  stateOptions: SelectorOption[] = [
    { label: 'All States', value: '' },
    { label: 'Active', value: 'active' },
    { label: 'Inactive', value: 'inactive' },
    { label: 'Archived', value: 'archived' },
  ];

  // Table Configuration
  emptyMessage = 'No products found';

  tableColumns: TableColumn[] = [
    {
      key: 'name',
      label: 'Product Name',
      sortable: true,
      width: '200px',
    },
    {
      key: 'sku',
      label: 'SKU',
      sortable: true,
      width: '120px',
    },
    {
      key: 'base_price',
      label: 'Price',
      sortable: true,
      width: '100px',
      transform: (value: number) => `$${value?.toFixed(2) || '0.00'}`,
    },
    {
      key: 'stock_quantity',
      label: 'Stock',
      sortable: true,
      width: '100px',
      transform: (value: number) => value?.toString() || '0',
    },
    {
      key: 'state',
      label: 'Status',
      sortable: true,
      width: '120px',
      badge: true,
      badgeConfig: {
        type: 'custom',
        colorMap: {
          active: 'green',
          inactive: 'yellow',
          archived: 'red',
        },
      },
      transform: (value: string) =>
        value.charAt(0).toUpperCase() + value.slice(1),
    },
    {
      key: 'created_at',
      label: 'Created',
      sortable: true,
      width: '120px',
      transform: (value: Date) => new Date(value).toLocaleDateString(),
    },
  ];

  tableActions: TableAction[] = [
    {
      label: 'Edit',
      icon: 'edit',
      action: (product: Product) => this.editProduct(product),
      variant: 'primary',
    },
    {
      label: 'Variants',
      icon: 'layers',
      action: (product: Product) => this.manageVariants(product),
      variant: 'secondary',
    },
    {
      label: 'Images',
      icon: 'image',
      action: (product: Product) => this.manageImages(product),
      variant: 'secondary',
    },
    {
      label: (product: Product) =>
        product.state === 'active' ? 'Deactivate' : 'Activate',
      icon: (product: Product) =>
        product.state === 'active' ? 'pause' : 'play',
      action: (product: Product) => this.toggleProductState(product),
      variant: 'danger',
    },
  ];

  ngOnInit() {
    this.loadInitialData();
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }

  private loadInitialData() {
    combineLatest([this.productsService.getProductStats(), this.loadProducts()])
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: ([stats]) => {
          this.stats = stats;
        },
        error: (error: any) => {
          this.toastService.error('Error loading products data');
          console.error('Error loading initial data:', error);
        },
      });
  }

  private loadProducts(): Observable<PaginatedResponse<Product>> {
    this.loading = true;

    const query: ProductQueryDto = {
      page: this.currentPage,
      limit: this.pageSize,
      search: this.searchTerm || undefined,
      state: this.selectedState || undefined,
      include_stock: true,
    };

    return this.productsService.getProducts(query);
  }

  onSearchChange() {
    this.currentPage = 1;
    this.refreshProducts();
  }

  onFilterChange() {
    this.currentPage = 1;
    this.refreshProducts();
  }

  onPageChange(page: number) {
    this.currentPage = page;
    this.refreshProducts();
  }

  onSortChange(event: { column: string; direction: 'asc' | 'desc' | null }) {
    this.sortField = event.column;
    this.sortDirection = event.direction || 'desc';
    this.refreshProducts();
  }

  resetFilters() {
    this.searchTerm = '';
    this.selectedState = '';
    this.currentPage = 1;
    this.refreshProducts();
  }

  private refreshProducts() {
    this.loadProducts().subscribe({
      next: (response) => {
        this.products = response.data;
        this.totalItems = response.pagination.total;
        this.loading = false;
      },
      error: (error: any) => {
        this.loading = false;
        this.toastService?.error('Error loading products');
        console.error('Error loading products:', error);
      },
    });
  }

  // Modal actions
  openCreateModal() {
    this.showCreateModal = true;
  }

  closeCreateModal() {
    this.showCreateModal = false;
  }

  onProductCreated() {
    this.closeCreateModal();
    this.refreshProducts();
    this.loadStats(); // Refresh stats after creating
  }

  private loadStats() {
    this.productsService.getProductStats().subscribe({
      next: (stats: ProductStats) => {
        this.stats = stats;
      },
      error: (error: any) => {
        console.error('Error loading stats:', error);
      },
    });
  }

  editProduct(product: Product) {
    // TODO: Implement edit product modal
    this.toastService?.info(`Edit product: ${product.name} - coming soon!`);
  }

  manageVariants(product: Product) {
    // TODO: Implement variants management
    this.toastService?.info(
      `Manage variants for: ${product.name} - coming soon!`,
    );
  }

  manageImages(product: Product) {
    // TODO: Implement images management
    this.toastService?.info(
      `Manage images for: ${product.name} - coming soon!`,
    );
  }

  toggleProductState(product: Product) {
    const action = product.state === 'active' ? 'deactivate' : 'activate';

    if (confirm(`Are you sure you want to ${action} "${product.name}"?`)) {
      this.productsService.deactivateProduct(product.id).subscribe({
        next: () => {
          const message =
            product.state === 'active'
              ? 'Product deactivated'
              : 'Product activated';
          this.toastService.success(message);
          this.refreshProducts();
        },
        error: (error: any) => {
          if (this.toastService) {
            this.toastService.error(`Error ${action}ing product`);
          }
          console.error(`Error ${action}ing product:`, error);
        },
      });
    }
  }
}
