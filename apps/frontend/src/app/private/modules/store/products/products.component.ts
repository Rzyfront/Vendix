import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subscription } from 'rxjs';

// Services
import { ProductsService } from './services/products.service';
import { CategoriesService } from './services/categories.service';
import { BrandsService } from './services/brands.service';
import { ToastService } from '../../../../shared/components/toast/toast.service';
import { DialogService } from '../../../../shared/components/dialog/dialog.service';
import { TenantFacade } from '../../../../core/store/tenant/tenant.facade';

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
    <div class="p-6">
      <!-- Stats Grid -->
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <app-stats
          title="Total Products"
          [value]="stats.total_products"
          [smallText]="getGrowthPercentage(5.2) + ' vs last month'"
          iconName="package"
          iconBgColor="bg-blue-100"
          iconColor="text-blue-600"
        ></app-stats>
        
        <app-stats
          title="Active Products"
          [value]="stats.active_products"
          [smallText]="getGrowthPercentage(2.1) + ' vs last month'"
          iconName="check-circle"
          iconBgColor="bg-green-100"
          iconColor="text-green-600"
        ></app-stats>
        
        <app-stats
          title="Low Stock"
          [value]="stats.low_stock_products"
          [smallText]="stats.out_of_stock_products + ' out of stock'"
          iconName="alert-triangle"
          iconBgColor="bg-amber-100"
          iconColor="text-amber-600"
        ></app-stats>
        
        <app-stats
          title="Total Value"
          [value]="((stats.total_value || 0) | currency) || '$0.00'"
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
        (edit)="openEditModal($event)"
        (delete)="deleteProduct($event)"
        (duplicate)="duplicateProduct($event)"
        (bulkUpload)="openBulkUploadModal()"
      ></app-product-list>

      <!-- Modals -->
      <app-product-create-modal
        [isOpen]="isCreateModalOpen || isEditModalOpen"
        [product]="selectedProduct || null"
        [isSubmitting]="isCreatingProduct || isUpdatingProduct"
        (openChange)="!$event ? onModalClose() : null"
        (cancel)="onModalClose()"
        (submit)="onSaveProduct($event)"
      ></app-product-create-modal>

      <app-bulk-upload-modal
        [isOpen]="isBulkUploadModalOpen"
        (closeModal)="onBulkUploadClose()"
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
    isEditModalOpen = false;
    isBulkUploadModalOpen = false;
    isCreatingProduct = false;
    isUpdatingProduct = false;
    selectedProduct: Product | null = null;

    private subscriptions: Subscription[] = [];

    constructor(
        private productsService: ProductsService,
        private categoriesService: CategoriesService,
        private brandsService: BrandsService,
        private toastService: ToastService,
        private dialogService: DialogService,
        private tenantFacade: TenantFacade
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
            error: (console.error),
        });
        this.subscriptions.push(sub);
    }

    loadCategories(): void {
        this.categoriesService.getCategories().subscribe(cats => this.categories = cats);
    }

    loadBrands(): void {
        this.brandsService.getBrands().subscribe(brands => this.brands = brands);
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
        this.selectedProduct = null;
        this.isCreateModalOpen = true;
    }

    openEditModal(product: Product): void {
        this.selectedProduct = product;
        this.isEditModalOpen = true;
    }

    onModalClose(): void {
        this.isCreateModalOpen = false;
        this.isEditModalOpen = false;
        this.selectedProduct = null;
    }

    onSaveProduct(data: any): void {
        if (this.selectedProduct) {
            this.updateProduct(this.selectedProduct.id, data);
        } else {
            this.createProduct(data);
        }
    }

    createProduct(data: CreateProductDto): void {
        this.isCreatingProduct = true;
        const sub = this.productsService.createProduct(data).subscribe({
            next: () => {
                this.toastService.success('Product created successfully');
                this.isCreatingProduct = false;
                this.onModalClose();
                this.loadProducts();
                this.loadStats();
            },
            error: () => {
                this.toastService.error('Error creating product');
                this.isCreatingProduct = false;
            }
        });
        this.subscriptions.push(sub);
    }

    updateProduct(id: number, data: UpdateProductDto): void {
        this.isUpdatingProduct = true;
        const sub = this.productsService.updateProduct(id, data).subscribe({
            next: () => {
                this.toastService.success('Product updated successfully');
                this.isUpdatingProduct = false;
                this.onModalClose();
                this.loadProducts();
                this.loadStats();
            },
            error: () => {
                this.toastService.error('Error updating product');
                this.isUpdatingProduct = false;
            }
        });
        this.subscriptions.push(sub);
    }

    deleteProduct(product: Product): void {
        this.dialogService.confirm({
            title: 'Eliminar Producto',
            message: `¿Está seguro de que desea eliminar "${product.name}"? Esta acción no se puede deshacer.`,
            confirmText: 'Eliminar',
            cancelText: 'Cancelar',
            confirmVariant: 'danger',
        }).then((confirmed) => {
            if (confirmed) {
                this.productsService.deleteProduct(product.id).subscribe({
                    next: () => {
                        this.toastService.success('Product deleted successfully');
                        this.loadProducts();
                        this.loadStats();
                    },
                    error: () => this.toastService.error('Error deleting product')
                });
            }
        });
    }

    duplicateProduct(product: Product): void {
        const duplicateData: CreateProductDto = {
            name: `${product.name} (Copy)`,
            slug: `${product.slug}-copy`,
            description: product.description,
            base_price: product.base_price,
            sku: product.sku ? `${product.sku}-COPY` : undefined,
            stock_quantity: product.stock_quantity,
            category_id: product.category_id,
            brand_id: product.brand_id,
        };
        this.createProduct(duplicateData);
    }

    // Bulk Upload
    openBulkUploadModal(): void {
        this.isBulkUploadModalOpen = true;
    }

    onBulkUploadClose(): void {
        this.isBulkUploadModalOpen = false;
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
