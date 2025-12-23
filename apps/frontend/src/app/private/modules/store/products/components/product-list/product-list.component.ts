import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';

import {
  Product,
  ProductState,
  ProductQueryDto,
  ProductCategory,
  Brand,
} from '../../interfaces';

// Import shared components
import {
  InputsearchComponent,
  IconComponent,
  TableComponent,
  ButtonComponent,
  TableColumn,
  TableAction,
} from '../../../../../../shared/components/index';

import { ProductFilterDropdownComponent } from '../product-filter-dropdown/product-filter-dropdown.component';
import { ProductEmptyStateComponent } from '../product-empty-state.component';

// Import styles
import './product-list.component.css';

@Component({
  selector: 'app-product-list',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    FormsModule,
    InputsearchComponent,
    IconComponent,
    TableComponent,
    ButtonComponent,
    ProductFilterDropdownComponent,
    ProductEmptyStateComponent,
  ],
  templateUrl: './product-list.component.html',
})
export class ProductListComponent {
  @Input() products: Product[] = [];
  @Input() isLoading = false;
  @Input() categories: ProductCategory[] = [];
  @Input() brands: Brand[] = [];

  @Output() refresh = new EventEmitter<void>();
  @Output() search = new EventEmitter<string>();
  @Output() filter = new EventEmitter<Partial<ProductQueryDto>>();
  @Output() create = new EventEmitter<void>();
  @Output() edit = new EventEmitter<Product>();
  @Output() delete = new EventEmitter<Product>();
  @Output() bulkUpload = new EventEmitter<void>();
  @Output() sort = new EventEmitter<{
    column: string;
    direction: 'asc' | 'desc' | null;
  }>();

  searchTerm = '';
  selectedState = '';
  selectedCategory = '';
  selectedBrand = '';

  // Table configuration
  tableColumns: TableColumn[] = [
    {
      key: 'images',
      label: '', // Empty label for symmetry
      sortable: false,
      width: '50px',
      align: 'center',
      priority: 1,
      type: 'image',
      transform: (value: any[]) => {
        if (!value || value.length === 0) return '';
        const mainImage = value.find((img: any) => img.is_main);
        return mainImage ? mainImage.image_url : value[0].image_url;
      },
    },
    {
      key: 'name',
      label: 'Nombre',
      sortable: true,
      width: '250px',
      priority: 1,
    },
    { key: 'sku', label: 'SKU', sortable: true, width: '120px', priority: 2 },
    {
      key: 'base_price',
      label: 'Precio',
      sortable: true,
      width: '100px',
      align: 'right',
      priority: 1,
      transform: (value: number) => this.formatCurrency(value),
    },
    {
      key: 'stock_quantity',
      label: 'Stock',
      sortable: true,
      width: '80px',
      align: 'center',
      priority: 1,
      transform: (value: number) => value?.toString() || '0',
    },
    {
      key: 'state',
      label: 'Estado',
      sortable: true,
      width: '100px',
      align: 'center',
      priority: 1,
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
  ];

  tableActions: TableAction[] = [
    {
      label: 'Edit',
      icon: 'edit',
      action: (product: Product) => this.edit.emit(product),
      variant: 'primary',
    },
    {
      label: 'Eliminar',
      icon: 'trash-2',
      action: (product: Product) => this.delete.emit(product),
      variant: 'danger',
    },
  ];

  // Event Handlers
  onSearchChange(term: string): void {
    this.searchTerm = term;
    this.search.emit(term);
  }

  onFilterDropdownChange(query: ProductQueryDto): void {
    this.selectedState = query.state || '';
    this.selectedCategory = query.category_id?.toString() || '';
    this.selectedBrand = query.brand_id?.toString() || '';
    this.filter.emit(query);
  }

  clearFilters(): void {
    this.searchTerm = '';
    this.selectedState = '';
    this.selectedCategory = '';
    this.selectedBrand = '';
    this.search.emit('');
    this.filter.emit({});
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

  getEmptyStateTitle(): string {
    return this.hasFilters
      ? 'Ningún producto coincide con sus filtros'
      : 'No se encontraron productos';
  }

  getEmptyStateDescription(): string {
    return this.hasFilters
      ? 'Intente ajustar sus términos de búsqueda o filtros'
      : 'Comience creando su primer producto.';
  }

  get hasFilters(): boolean {
    return !!(
      this.searchTerm ||
      this.selectedState ||
      this.selectedCategory ||
      this.selectedBrand
    );
  }
}
