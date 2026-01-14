import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subscription } from 'rxjs';
import { Router } from '@angular/router'; // Import Router

// Services
import { ProductsService } from './services/products.service';
import { CategoriesService } from './services/categories.service';
import { BrandsService } from './services/brands.service';
import { ToastService } from '../../../../shared/components/toast/toast.service';
import { DialogService } from '../../../../shared/components/dialog/dialog.service';
import { TenantFacade } from '../../../../core/store/tenant/tenant.facade';
import { extractApiErrorMessage } from '../../../../core/utils/api-error-handler';

// Models
import {
  Product,
  CreateProductDto,
  UpdateProductDto,
  ProductQueryDto,
  ProductStats,
  ProductCategory,
  Brand,
} from './interfaces';

// Components
import { ProductListComponent } from './components/product-list/product-list.component';
import { ProductCreateModalComponent } from './components/product-create-modal.component';
import { BulkUploadModalComponent } from './components/bulk-upload-modal/bulk-upload-modal.component';
import { StatsComponent } from '../../../../shared/components/stats/stats.component';

@Component({
  selector: 'app-products',
  standalone: true,
  imports: [
    CommonModule,
    ProductListComponent,
    ProductCreateModalComponent,
    BulkUploadModalComponent,
    StatsComponent,
  ],
  providers: [ProductsService],
  template: `
    <div class="w-full">
      <!-- Stats Grid -->
      <div
        class="grid grid-cols-4 gap-2 md:gap-4 lg:gap-6 mb-4 md:mb-6 lg:mb-8"
      >
        <app-stats
          title="Productos Totales"
          [value]="stats.total_products"
          [smallText]="getGrowthPercentage(5.2) + ' vs last month'"
          iconName="package"
          iconBgColor="bg-blue-100"
          iconColor="text-blue-600"
        ></app-stats>

        <app-stats
          title="Productos Activos"
          [value]="stats.active_products"
          [smallText]="getGrowthPercentage(2.1) + ' vs last month'"
          iconName="check-circle"
          iconBgColor="bg-green-100"
          iconColor="text-green-600"
        ></app-stats>

        <app-stats
          title="Stock Bajo"
          [value]="stats.low_stock_products"
          [smallText]="stats.out_of_stock_products + ' out of stock'"
          iconName="alert-triangle"
          iconBgColor="bg-amber-100"
          iconColor="text-amber-600"
        ></app-stats>

        <app-stats
          title="Valor Total"
          [value]="(stats.total_value || 0 | currency) || '$0.00'"
          [smallText]="'+12% vs last month'"
          iconName="dollar-sign"
          iconBgColor="bg-purple-100"
          iconColor="text-purple-600"
        ></app-stats>
      </div>

      <!-- Product List -->
      <app-product-list
        [products]="products"
        [isLoading]="isLoading"
        [categories]="categories"
        [brands]="brands"
        (refresh)="loadProducts()"
        (search)="onSearch($event)"
        (filter)="onFilter($event)"
        (create)="openCreateModal()"
        (edit)="navigateToEditPage($event)"
        (delete)="deleteProduct($event)"
        (bulkUpload)="openBulkUploadModal()"
      ></app-product-list>

      <!-- Modals -->
      <app-product-create-modal
        [(isOpen)]="isCreateModalOpen"
        [product]="null"
        [isSubmitting]="isCreatingProduct"
        (cancel)="onModalClose()"
        (submit)="onSaveProduct($event)"
      ></app-product-create-modal>

      <app-bulk-upload-modal
        [(isOpen)]="isBulkUploadModalOpen"
        (uploadComplete)="onBulkUploadComplete()"
      ></app-bulk-upload-modal>
    </div>
  `,
})
export class ProductsComponent implements OnInit, OnDestroy {
  products: Product[] = [];
  categories: ProductCategory[] = [];
  brands: Brand[] = [];
  isLoading = false;

  // Stats
  stats: ProductStats = {
    total_products: 0,
    active_products: 0,
    inactive_products: 0,
    archived_products: 0,
    low_stock_products: 0,
    out_of_stock_products: 0,
    total_value: 0,
    categories_count: 0,
    brands_count: 0,
  };

  // Queries
  searchTerm = '';
  currentFilters: Partial<ProductQueryDto> = {};

  // Modal State
  isCreateModalOpen = false;
  isBulkUploadModalOpen = false;
  isCreatingProduct = false;

  private subscriptions: Subscription[] = [];

  constructor(
    private productsService: ProductsService,
    private categoriesService: CategoriesService,
    private brandsService: BrandsService,
    private toastService: ToastService,
    private dialogService: DialogService,
    private tenantFacade: TenantFacade,
    private router: Router, // Inject Router
  ) { }

  ngOnInit(): void {
    this.loadProducts();
    this.loadStats();
    this.loadCategories();
    this.loadBrands();
  }

  ngOnDestroy(): void {
    this.subscriptions.forEach((sub) => sub.unsubscribe());
  }

  loadProducts(): void {
    this.isLoading = true;
    const query: ProductQueryDto = {
      ...(this.searchTerm && { search: this.searchTerm }),
      ...this.currentFilters,
    };

    const sub = this.productsService.getProducts(query).subscribe({
      next: (response: any) => {
        if (response.data) {
          this.products = response.data;
        } else {
          this.products = [];
        }
        this.isLoading = false;
      },
      error: (error: any) => {
        console.error('Error loading products:', error);
        const message = extractApiErrorMessage(error);
        this.toastService.error(message, 'Error al cargar productos');
        this.isLoading = false;
      },
    });
    this.subscriptions.push(sub);
  }

  loadStats(): void {
    const currentStore = this.tenantFacade.getCurrentStore();
    if (!currentStore || !currentStore.id) return;

    const storeId = parseInt(currentStore.id, 10);
    if (isNaN(storeId)) return;

    const sub = this.productsService.getProductStats(storeId).subscribe({
      next: (response: any) => {
        if (response) this.stats = response;
      },
      error: (error: any) => {
        console.error('Error loading stats:', error);
        const message = extractApiErrorMessage(error);
        this.toastService.error(message, 'Error al cargar estadísticas');
      },
    });
    this.subscriptions.push(sub);
  }

  loadCategories(): void {
    this.categoriesService
      .getCategories()
      .subscribe((cats) => (this.categories = cats));
  }

  loadBrands(): void {
    this.brandsService
      .getBrands()
      .subscribe((brands) => (this.brands = brands));
  }

  // Event Handlers
  onSearch(term: string): void {
    this.searchTerm = term;
    this.loadProducts();
  }

  onFilter(filters: Partial<ProductQueryDto>): void {
    this.currentFilters = filters;
    this.loadProducts();
  }

  openCreateModal(): void {
    this.isCreateModalOpen = true;
  }

  navigateToEditPage(product: Product): void {
    this.router.navigate(['/admin/products/edit', product.id]);
  }

  onModalClose(): void {
    this.isCreateModalOpen = false;
  }
  onSaveProduct(data: any): void {
    this.createProduct(data);
  }

  createProduct(data: CreateProductDto): void {
    this.isCreatingProduct = true;
    const sub = this.productsService.createProduct(data).subscribe({
      next: () => {
        this.toastService.success('Producto creado exitosamente');
        this.isCreatingProduct = false;
        this.onModalClose();
        this.loadProducts();
        this.loadStats();
      },
      error: (error: any) => {
        const message = extractApiErrorMessage(error);
        this.toastService.error(message, 'Error al crear producto');
        this.isCreatingProduct = false;
      },
    });
    this.subscriptions.push(sub);
  }

  deleteProduct(product: Product): void {
    this.dialogService
      .confirm({
        title: 'Eliminar Producto',
        message: `¿Está seguro de que desea eliminar "${product.name}"? Esta acción no se puede deshacer.`,
        confirmText: 'Eliminar',
        cancelText: 'Cancelar',
        confirmVariant: 'danger',
      })
      .then((confirmed) => {
        if (confirmed) {
          this.productsService.deleteProduct(product.id).subscribe({
            next: () => {
              this.toastService.success('Producto eliminado exitosamente');
              this.loadProducts();
              this.loadStats();
            },
            error: () => this.toastService.error('Error al eliminar producto'),
          });
        }
      });
  }

  // Bulk Upload
  openBulkUploadModal(): void {
    this.isBulkUploadModalOpen = true;
  }

  onBulkUploadComplete(): void {
    this.isBulkUploadModalOpen = false;
    this.loadProducts();
    this.loadStats();
    this.toastService.success('Carga masiva completada');
  }
  // Helpers
  getGrowthPercentage(val: number): string {
    return val > 0 ? `+${val}%` : `${val}%`;
  }
}
