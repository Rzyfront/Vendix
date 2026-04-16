import {
  Component,
  input,
  output,
  inject,
  effect,
} from '@angular/core';
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
  ButtonComponent,
  IconComponent,
  PaginationComponent,
  EmptyStateComponent,
  CardComponent,
} from '../../../../../../shared/components/index';
import { CurrencyFormatService } from '../../../../../../shared/pipes/currency';

// Import styles
import './product-list.component.css';

@Component({
  selector: 'app-product-list',
  standalone: true,
  imports: [
    RouterModule,
    FormsModule,
    InputsearchComponent,
    OptionsDropdownComponent,
    EmptyStateComponent,
    ResponsiveDataViewComponent,
    ButtonComponent,
    IconComponent,
    PaginationComponent,
    CardComponent,
  ],
  templateUrl: './product-list.component.html',
})
export class ProductListComponent {
  private currencyService = inject(CurrencyFormatService);

  readonly products = input<Product[]>([]);
  readonly isLoading = input(false);
  readonly categories = input<ProductCategory[]>([]);
  readonly brands = input<Brand[]>([]);
  readonly paginationData = input({ page: 1, limit: 10, total: 0, totalPages: 0 });

  readonly refresh = output<void>();
  readonly search = output<string>();
  readonly filter = output<Partial<ProductQueryDto>>();
  readonly create = output<void>();
  readonly edit = output<Product>();
  readonly delete = output<Product>();
  readonly bulkUpload = output<void>();
  readonly bulkImageUpload = output<void>();
  readonly sort = output<{ column: string; direction: 'asc' | 'desc' | null }>();
  readonly pageChange = output<number>();

  searchTerm = '';
  selectedState = '';
  selectedCategory = '';
  selectedBrand = '';
  selectedProductType = '';

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
    {
      key: 'product_type',
      label: 'Tipo de Producto',
      type: 'select',
      options: [
        { value: '', label: 'Todos los Tipos' },
        { value: 'physical', label: 'Producto Físico' },
        { value: 'service', label: 'Servicio' },
      ],
    },
  ];

  // Current filter values
  filterValues: FilterValues = {};

  // Dropdown actions for the filter/options dropdown
  dropdownActions: DropdownAction[] = [
    {
      label: 'Nuevo Producto',
      icon: 'plus',
      action: 'create',
      variant: 'primary',
    },
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
      key: 'pricing_type',
      label: 'Unidad de medida',
      sortable: false,
      width: '80px',
      align: 'center',
      priority: 3,
      transform: (value: string) => (value === 'weight' ? 'Peso' : 'Unidad'),
    },
    {
      key: 'product_type',
      label: 'Tipo',
      sortable: false,
      width: '100px',
      align: 'center',
      priority: 2,
      badge: true,
      badgeConfig: {
        type: 'custom',
        size: 'sm',
        colorMap: {
          physical: '#3b82f6',
          service: '#8b5cf6',
        },
      },
      transform: (value: string) =>
        value === 'service' ? 'Servicio' : 'Producto',
    },
    {
      key: 'stock_quantity',
      label: 'Stock',
      sortable: true,
      width: '100px',
      align: 'center',
      priority: 1,
      transform: (value: number, item?: any) =>
        item?.product_type === 'service'
          ? 'Servicio'
          : item?.track_inventory === false
            ? 'Disponible'
            : value?.toString() || '0',
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
      variant: 'info',
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
    subtitleTransform: (item: any) => item?.brand?.name || '-',
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
        transform: (val: any, item?: any) =>
          item?.product_type === 'service'
            ? 'Servicio'
            : item?.track_inventory === false
              ? 'Disponible'
              : val?.toString() || '0',
      },
    ],
  };

  constructor() {
    effect(() => {
      // Re-run whenever categories or brands input signals change
      this.categories();
      this.brands();
      this.updateFilterOptions();
    });
  }

  private updateFilterOptions(): void {
    const cats = this.categories();
    const brnds = this.brands();

    // Update category options
    const categoryFilter = this.filterConfigs.find(
      (f) => f.key === 'category_id',
    );
    if (categoryFilter) {
      categoryFilter.options = [
        { value: '', label: 'Todas las Categorías' },
        ...cats.map((cat) => ({
          value: cat.id.toString(),
          label: cat.name,
        })),
      ];
      categoryFilter.disabled = cats.length === 0;
      categoryFilter.helpText =
        cats.length === 0
          ? 'No hay categorías disponibles'
          : undefined;
    }

    // Update brand options
    const brandFilter = this.filterConfigs.find((f) => f.key === 'brand_id');
    if (brandFilter) {
      brandFilter.options = [
        { value: '', label: 'Todas las Marcas' },
        ...brnds.map((brand) => ({
          value: brand.id.toString(),
          label: brand.name,
        })),
      ];
      brandFilter.disabled = brnds.length === 0;
      brandFilter.helpText =
        brnds.length === 0 ? 'No hay marcas disponibles' : undefined;
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
    this.selectedProductType = (values['product_type'] as string) || '';

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
    if (this.selectedProductType) {
      query.product_type = this.selectedProductType as 'physical' | 'service';
    }

    this.filter.emit(query);
  }

  clearFilters(): void {
    this.searchTerm = '';
    this.selectedState = '';
    this.selectedCategory = '';
    this.selectedBrand = '';
    this.selectedProductType = '';
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

  formatCurrency(value: any): string {
    return this.currencyService.format(Number(value) || 0);
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
      this.selectedBrand ||
      this.selectedProductType
    );
  }
}
