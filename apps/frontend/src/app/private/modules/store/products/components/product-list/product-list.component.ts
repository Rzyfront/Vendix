import { Component, Input, Output, EventEmitter, OnChanges, SimpleChanges, inject } from '@angular/core';
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
  TableColumn,
  TableAction,
  ResponsiveDataViewComponent,
  ItemListCardConfig,
  OptionsDropdownComponent,
  FilterConfig,
  DropdownAction,
  FilterValues,
} from '../../../../../../shared/components/index';

import { ProductEmptyStateComponent } from '../product-empty-state.component';
import { CurrencyFormatService } from '../../../../../../shared/pipes/currency';

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
    OptionsDropdownComponent,
    ProductEmptyStateComponent,
    ResponsiveDataViewComponent,
  ],
  templateUrl: './product-list.component.html',
})
export class ProductListComponent implements OnChanges {
  private currencyService = inject(CurrencyFormatService);

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
  @Output() bulkImageUpload = new EventEmitter<void>();
  @Output() sort = new EventEmitter<{
    column: string;
    direction: 'asc' | 'desc' | null;
  }>();

  searchTerm = '';
  selectedState = '';
  selectedCategory = '';
  selectedBrand = '';

  // Filter configuration for the options dropdown
  filterConfigs: FilterConfig[] = [
    {
      key: 'state',
      label: 'Estado',
      type: 'select',
      options: [
        { value: '', label: 'Todos los Estados' },
        { value: ProductState.ACTIVE, label: 'Activo' },
        { value: ProductState.INACTIVE, label: 'Inactivo' },
        { value: ProductState.ARCHIVED, label: 'Archivado' },
      ],
    },
    {
      key: 'category_id',
      label: 'Categoría',
      type: 'select',
      options: [],
      placeholder: 'Seleccionar categoría',
    },
    {
      key: 'brand_id',
      label: 'Marca',
      type: 'select',
      options: [],
      placeholder: 'Seleccionar marca',
    },
  ];

  // Current filter values
  filterValues: FilterValues = {};

  // Dropdown actions for the filter/options dropdown
  dropdownActions: DropdownAction[] = [
    { label: 'Nuevo Producto', icon: 'plus', action: 'create', variant: 'primary' },
    { label: 'Carga Masiva', icon: 'upload-cloud', action: 'bulk-upload' },
    { label: 'Carga de Imágenes', icon: 'image', action: 'bulk-image-upload' },
  ];

  // Table configuration
  tableColumns: TableColumn[] = [
    {
      key: 'image_url',
      label: '', // Empty label for symmetry
      sortable: false,
      width: '50px',
      align: 'center',
      priority: 1,
      type: 'image',
      transform: (value: string) => value || '',
    },
    {
      key: 'name',
      label: 'Nombre',
      sortable: true,
      width: '250px',
      priority: 1,
    },
    {
      key: 'brand',
      label: 'Marca',
      sortable: true,
      width: '120px',
      priority: 2,
      transform: (value: Brand) => value?.name || '-',
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

  // Card Config
  cardConfig: ItemListCardConfig = {
    titleKey: 'name',
    subtitleKey: 'brand',
    subtitleTransform: (val: any) => val?.name || '-',
    avatarKey: 'image_url',
    avatarShape: 'square', // Square images for products
    badgeKey: 'state',
    badgeConfig: {
      type: 'custom',
      size: 'sm',
      colorMap: {
        active: '#22c55e',
        inactive: '#f59e0b',
        archived: '#ef4444',
      },
    },
    badgeTransform: (val: any) => this.formatProductState(val),
    footerKey: 'base_price',
    footerLabel: 'Precio',
    footerStyle: 'prominent', // Large price display
    footerTransform: (val: any) => this.formatCurrency(val),
    detailKeys: [
      {
        key: 'sku',
        label: 'SKU',
      },
      {
        key: 'stock_quantity',
        label: 'Stock',
        transform: (val: any) => val?.toString() || '0'
      }
    ]
  };

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['categories'] || changes['brands']) {
      this.updateFilterOptions();
    }
  }

  private updateFilterOptions(): void {
    // Update category options
    const categoryFilter = this.filterConfigs.find(f => f.key === 'category_id');
    if (categoryFilter) {
      categoryFilter.options = [
        { value: '', label: 'Todas las Categorías' },
        ...this.categories.map(cat => ({
          value: cat.id.toString(),
          label: cat.name,
        })),
      ];
      categoryFilter.disabled = this.categories.length === 0;
      categoryFilter.helpText = this.categories.length === 0 ? 'No hay categorías disponibles' : undefined;
    }

    // Update brand options
    const brandFilter = this.filterConfigs.find(f => f.key === 'brand_id');
    if (brandFilter) {
      brandFilter.options = [
        { value: '', label: 'Todas las Marcas' },
        ...this.brands.map(brand => ({
          value: brand.id.toString(),
          label: brand.name,
        })),
      ];
      brandFilter.disabled = this.brands.length === 0;
      brandFilter.helpText = this.brands.length === 0 ? 'No hay marcas disponibles' : undefined;
    }

    // Force re-render by creating new array reference
    this.filterConfigs = [...this.filterConfigs];
  }

  // Event Handlers
  onSearchChange(term: string): void {
    this.searchTerm = term;
    this.search.emit(term);
  }

  onFilterChange(values: FilterValues): void {
    this.filterValues = values;
    this.selectedState = (values['state'] as string) || '';
    this.selectedCategory = (values['category_id'] as string) || '';
    this.selectedBrand = (values['brand_id'] as string) || '';

    // Build the ProductQueryDto
    const query: ProductQueryDto = {};
    if (this.selectedState) {
      query.state = this.selectedState as ProductState;
    }
    if (this.selectedCategory) {
      query.category_id = parseInt(this.selectedCategory, 10);
    }
    if (this.selectedBrand) {
      query.brand_id = parseInt(this.selectedBrand, 10);
    }

    this.filter.emit(query);
  }

  clearFilters(): void {
    this.searchTerm = '';
    this.selectedState = '';
    this.selectedCategory = '';
    this.selectedBrand = '';
    this.filterValues = {};
    this.search.emit('');
    this.filter.emit({});
  }

  onActionClick(action: string): void {
    switch (action) {
      case 'create':
        this.create.emit();
        break;
      case 'bulk-upload':
        this.bulkUpload.emit();
        break;
      case 'bulk-image-upload':
        this.bulkImageUpload.emit();
        break;
    }
  }

  // Helper methods
  formatProductState(state: ProductState): string {
    return state;
  }

  formatCurrency(value: number): string {
    return this.currencyService.format(value);
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
