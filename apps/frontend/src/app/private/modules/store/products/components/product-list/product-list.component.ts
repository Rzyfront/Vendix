import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { Subscription } from 'rxjs';

import { ProductsService } from '../../services/products.service';
import { CategoriesService } from '../../services/categories.service';
import { BrandsService } from '../../services/brands.service';
import {
  Product,
  ProductState,
  CreateProductDto,
  UpdateProductDto,
  ProductQueryDto,
  ProductStats,
  ProductCategory,
  Brand,
} from '../../interfaces';

// Import existing components
import {
  ProductStatsComponent,
  ProductEmptyStateComponent,
  ProductCreateModalComponent,
} from '../index';

// Import shared components
import {
  InputsearchComponent,
  IconComponent,
  TableComponent,
  ButtonComponent,
  DialogService,
  ToastService,
  TableColumn,
  TableAction,
} from '../../../../../../shared/components/index';

// Import styles (CSS instead of SCSS to avoid loader issues)
import './product-list.component.css';

@Component({
  selector: 'app-product-list',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    FormsModule,
    ReactiveFormsModule,
    ProductStatsComponent,
    ProductEmptyStateComponent,
    ProductCreateModalComponent,
    InputsearchComponent,
    IconComponent,
    TableComponent,
    ButtonComponent,
  ],
  providers: [ProductsService],
  templateUrl: './product-list.component.html',
})
export class ProductListComponent implements OnInit, OnDestroy {
  products: Product[] = [];
  isLoading = false;
  searchTerm = '';
  selectedState = '';
  selectedCategory = '';
  selectedBrand = '';

  // Table configuration
  tableColumns: TableColumn[] = [
    {
      key: 'images',
      label: 'Image',
      sortable: false,
      width: '80px',
      align: 'center',
      transform: (value: any[]) => {
        if (!value || value.length === 0)
          return '/assets/placeholder-product.png';
        const mainImage = value.find((img: any) => img.is_main);
        return mainImage ? mainImage.image_url : value[0].image_url;
      },
    },
    { key: 'name', label: 'Name', sortable: true, width: '250px' },
    { key: 'sku', label: 'SKU', sortable: true, width: '120px' },
    {
      key: 'base_price',
      label: 'Price',
      sortable: true,
      width: '100px',
      align: 'right',
      transform: (value: number) => this.formatCurrency(value),
    },
    {
      key: 'stock_quantity',
      label: 'Stock',
      sortable: true,
      width: '80px',
      align: 'center',
      transform: (value: number) => value?.toString() || '0',
    },
    {
      key: 'state',
      label: 'Status',
      sortable: true,
      width: '100px',
      align: 'center',
      badge: true,
      badgeConfig: {
        type: 'custom',
        size: 'sm',
        colorMap: {
          active: '#22c55e',
          inactive: '#f59e0b',
          archived: '#ef4444',
        },
      },
      transform: (value: ProductState) => this.formatProductState(value),
    },
    {
      key: 'category.name',
      label: 'Category',
      sortable: true,
      width: '150px',
      defaultValue: 'N/A',
    },
    {
      key: 'brand.name',
      label: 'Brand',
      sortable: true,
      width: '150px',
      defaultValue: 'N/A',
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
      label: 'Duplicate',
      icon: 'copy',
      action: (product: Product) => this.duplicateProduct(product),
      variant: 'secondary',
    },
    {
      label: 'Delete',
      icon: 'trash-2',
      action: (product: Product) => this.deleteProduct(product),
      variant: 'danger',
    },
  ];

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

  // Modal state
  isCreateModalOpen = false;
  isCreatingProduct = false;
  createProductForm!: FormGroup;

  // Edit Modal state
  isEditModalOpen = false;
  isUpdatingProduct = false;
  selectedProduct?: Product;

  // Available options for filters
  categories: ProductCategory[] = [];
  brands: Brand[] = [];

  private subscriptions: Subscription[] = [];

  constructor(
    private productsService: ProductsService,
    private categoriesService: CategoriesService,
    private brandsService: BrandsService,
    private fb: FormBuilder,
    private dialogService: DialogService,
    private toastService: ToastService,
  ) {
    this.initializeCreateForm();
  }

  ngOnInit(): void {
    this.loadProducts();
    this.loadStats();
    this.loadCategories();
    this.loadBrands();
  }

  ngOnDestroy(): void {
    this.subscriptions.forEach((sub) => sub.unsubscribe());
  }

  private initializeCreateForm(): void {
    this.createProductForm = this.fb.group({
      name: ['', [Validators.required, Validators.minLength(2)]],
      slug: ['', [Validators.minLength(2)]],
      description: [''],
      base_price: [0, [Validators.required, Validators.min(0)]],
      sku: [''],
      stock_quantity: [0, [Validators.min(0)]],
      category_id: [null],
      brand_id: [null],
      state: [ProductState.ACTIVE],
    });
  }

  get hasFilters(): boolean {
    return !!(
      this.searchTerm ||
      this.selectedState ||
      this.selectedCategory ||
      this.selectedBrand
    );
  }

  openCreateProductModal(): void {
    this.isCreateModalOpen = true;
    this.createProductForm.reset({
      name: '',
      slug: '',
      description: '',
      base_price: 0,
      sku: '',
      stock_quantity: 0,
      category_id: null,
      brand_id: null,
      state: ProductState.ACTIVE,
    });
  }

  onCreateModalChange(isOpen: boolean): void {
    this.isCreateModalOpen = isOpen;
    if (!isOpen) {
      this.createProductForm.reset();
    }
  }

  onCreateModalCancel(): void {
    this.isCreateModalOpen = false;
    this.createProductForm.reset();
  }

  createProduct(productData?: CreateProductDto | Event): void {
    if (!productData || productData instanceof Event) {
      if (this.createProductForm.invalid) {
        Object.keys(this.createProductForm.controls).forEach((key) => {
          this.createProductForm.get(key)?.markAsTouched();
        });
        return;
      }

      const formData = this.createProductForm.value;
      productData = {
        name: formData.name,
        slug: formData.slug || this.generateSlug(formData.name),
        description: formData.description || undefined,
        base_price: formData.base_price,
        sku: formData.sku || undefined,
        stock_quantity: formData.stock_quantity || undefined,
        category_id: formData.category_id || undefined,
        brand_id: formData.brand_id || undefined,
      };
    }

    this.isCreatingProduct = true;

    const sub = this.productsService
      .createProduct(productData as CreateProductDto)
      .subscribe({
        next: (response: any) => {
          console.log('Create product response:', response);
          this.isCreateModalOpen = false;
          this.loadProducts();
          this.loadStats();
          this.toastService.success('Product created successfully');
          this.isCreatingProduct = false;
        },
        error: (error: any) => {
          console.error('Error creating product:', error);
          this.toastService.error('Error creating product');
          this.isCreatingProduct = false;
        },
      });

    this.subscriptions.push(sub);
  }

  loadProducts(): void {
    this.isLoading = true;

    const query: ProductQueryDto = {
      ...(this.searchTerm && { search: this.searchTerm }),
      ...(this.selectedState && { state: this.selectedState as ProductState }),
      ...(this.selectedCategory && {
        category_id: parseInt(this.selectedCategory),
      }),
      ...(this.selectedBrand && { brand_id: parseInt(this.selectedBrand) }),
    };

    const sub = this.productsService.getProducts(query).subscribe({
      next: (response: any) => {
        console.log('Products response:', response);
        if (response.data) {
          this.products = response.data.map((product: any) => ({
            id: product.id,
            store_id: product.store_id,
            category_id: product.category_id,
            brand_id: product.brand_id,
            name: product.name,
            slug: product.slug,
            description: product.description,
            base_price: product.base_price,
            sku: product.sku,
            stock_quantity: product.stock_quantity,
            state: product.state || ProductState.ACTIVE,
            created_at: product.created_at || new Date(),
            updated_at: product.updated_at || new Date(),
            category: product.category,
            brand: product.brand,
            images: product.images || [],
            variants: product.variants || [],
          }));
          console.log('Processed products:', this.products);
        } else {
          console.warn('Invalid response structure:', response);
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
    const sub = this.productsService.getProductStats().subscribe({
      next: (response: any) => {
        console.log('Product stats response:', response);
        if (response) {
          this.stats = response;
        } else {
          console.warn('Invalid stats response structure:', response);
          this.updateStats();
        }
      },
      error: (error: any) => {
        console.error('Error loading product stats:', error);
        this.updateStats();
      },
    });

    this.subscriptions.push(sub);
  }

  loadCategories(): void {
    this.categoriesService.getCategories().subscribe({
      next: (categories: ProductCategory[]) => {
        this.categories = categories;
      },
      error: (error: any) => {
        console.error('Error loading categories:', error);
        this.categories = [];
      },
    });
  }

  loadBrands(): void {
    this.brandsService.getBrands().subscribe({
      next: (brands: Brand[]) => {
        this.brands = brands;
      },
      error: (error: any) => {
        console.error('Error loading brands:', error);
        this.brands = [];
      },
    });
  }

  updateStats(): void {
    this.stats.total_products = this.products.length;
    this.stats.active_products = this.products.filter(
      (product) => product.state === ProductState.ACTIVE,
    ).length;
    this.stats.inactive_products = this.products.filter(
      (product) => product.state === ProductState.INACTIVE,
    ).length;
    this.stats.archived_products = this.products.filter(
      (product) => product.state === ProductState.ARCHIVED,
    ).length;
    this.stats.low_stock_products = this.products.filter(
      (product) =>
        product.stock_quantity !== undefined &&
        product.stock_quantity > 0 &&
        product.stock_quantity <= 10,
    ).length;
    this.stats.out_of_stock_products = this.products.filter(
      (product) => product.stock_quantity === 0,
    ).length;
  }

  refreshProducts(): void {
    this.loadProducts();
  }

  clearFilters(): void {
    this.searchTerm = '';
    this.selectedState = '';
    this.selectedCategory = '';
    this.selectedBrand = '';
    this.loadProducts();
  }

  onStateChange(event: any): void {
    this.selectedState = event.target.value;
    this.loadProducts();
  }

  onCategoryChange(event: any): void {
    this.selectedCategory = event.target.value;
    this.loadProducts();
  }

  onBrandChange(event: any): void {
    this.selectedBrand = event.target.value;
    this.loadProducts();
  }

  onSearchChange(searchTerm: string): void {
    this.searchTerm = searchTerm;
    this.loadProducts();
  }

  onTableSort(sortEvent: {
    column: string;
    direction: 'asc' | 'desc' | null;
  }): void {
    console.log('Sort event:', sortEvent);
    this.loadProducts();
  }

  editProduct(product: Product): void {
    this.selectedProduct = product;
    this.isEditModalOpen = true;
  }

  onEditModalChange(isOpen: boolean): void {
    this.isEditModalOpen = isOpen;
    if (!isOpen) {
      this.selectedProduct = undefined;
    }
  }

  onEditModalCancel(): void {
    this.isEditModalOpen = false;
    this.selectedProduct = undefined;
  }

  updateProduct(productData: any): void {
    if (!this.selectedProduct) return;

    this.isUpdatingProduct = true;

    const updateData: UpdateProductDto = {
      name: productData.name,
      slug: productData.slug,
      description: productData.description,
      base_price: productData.base_price,
      sku: productData.sku,
      stock_quantity: productData.stock_quantity,
      state: productData.state,
      category_id: productData.category_id,
      brand_id: productData.brand_id,
    };

    const sub = this.productsService
      .updateProduct(this.selectedProduct.id, updateData)
      .subscribe({
        next: (response: any) => {
          console.log('Update product response:', response);
          this.isEditModalOpen = false;
          this.selectedProduct = undefined;
          this.loadProducts();
          this.loadStats();
          this.toastService.success('Product updated successfully');
          this.isUpdatingProduct = false;
        },
        error: (error: any) => {
          console.error('Error updating product:', error);
          this.toastService.error('Error updating product');
          this.isUpdatingProduct = false;
        },
      });

    this.subscriptions.push(sub);
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

  deleteProduct(product: Product): void {
    this.dialogService
      .confirm({
        title: 'Delete Product',
        message: `Are you sure you want to delete "${product.name}"? This action cannot be undone.`,
        confirmText: 'Delete',
        cancelText: 'Cancel',
        confirmVariant: 'danger',
      })
      .then((confirmed: boolean) => {
        if (confirmed) {
          const sub = this.productsService.deleteProduct(product.id).subscribe({
            next: () => {
              this.loadProducts();
              this.loadStats();
              this.toastService.success('Product deleted successfully');
            },
            error: (error: any) => {
              console.error('Error deleting product:', error);
              this.toastService.error('Error deleting product');
            },
          });

          this.subscriptions.push(sub);
        }
      });
  }

  viewProduct(product: Product): void {
    console.log('View product:', product);
  }

  // Helper methods
  formatProductState(state: ProductState): string {
    return state;
  }

  formatCurrency(value: number): string {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
    }).format(value);
  }

  generateSlug(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');
  }

  getEmptyStateTitle(): string {
    if (this.hasFilters) {
      return 'No products match your filters';
    }
    return 'No products found';
  }

  getEmptyStateDescription(): string {
    if (this.hasFilters) {
      return 'Try adjusting your search terms or filters';
    }
    return 'Get started by creating your first product.';
  }
}
