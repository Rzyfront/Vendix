import {
  Component,
  input,
  output,
  inject,
  effect,
  signal,
  computed,
  afterNextRender,
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
  PaginationComponent,
  EmptyStateComponent,
  CardComponent,
  ImageLightboxComponent,
  ButtonComponent, // FIX QUI-503
  IconComponent,  // FIX QUI-503
} from '../../../../../../shared/components/index';
import { CurrencyFormatService } from '../../../../../../shared/pipes/currency';

// QUI-729 — el filtro tri-estado vive ahora en `app-options-dropdown` como
// una entrada más de `filterConfigs` (label "Productos e insumos"). El
// componente `product-type-chip-filter` queda en disco pero huérfano, sin
// importes ni usos — el usuario decide si eliminarlo.
import type { ProductTypeFilterValue } from '../product-type-chip-filter/product-type-chip-filter.component';

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
    PaginationComponent,
    CardComponent,
    ImageLightboxComponent,
    ButtonComponent, // FIX QUI-503
    IconComponent,   // FIX QUI-503
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

  /** Granular permission flag driven by the parent page (FIX QUI-503). */
  readonly canCreate = input(false);

  /**
   * Granular permission flag for the bulk-edit entry point (QUI-567).
   * Mirrors `canCreate`: the parent derives it from `AuthFacade.hasPermission`
   * (`store:products:bulk_update`). This is UI affordance only — the backend
   * `PermissionsGuard` is the real authorization boundary.
   */
  readonly canBulkEdit = input(false);

  readonly refresh = output<void>();
  readonly search = output<string>();
  readonly filter = output<Partial<ProductQueryDto>>();
  readonly create = output<void>();
  readonly edit = output<Product>();
  readonly delete = output<Product>();
  readonly toggleState = output<Product>();
  readonly bulkUpload = output<void>();
  readonly bulkImageUpload = output<void>();
  readonly bulkEdit = output<void>();
  readonly downloadCurrentProducts = output<void>();
  readonly sort = output<{ column: string; direction: 'asc' | 'desc' | null }>();
  readonly pageChange = output<number>();

  searchTerm = '';
  selectedState = '';
  selectedCategory = '';
  selectedBrand = '';
  selectedProductType = '';
  readonly selectedImageProduct = signal<Product | null>(null);
  readonly imagePreviewOpen = signal(false);

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
        // Archived is intentionally omitted from the filter dropdown per the
        // "Datos archivados" issue: archived data must not be visible or
        // filterable from the admin UI. Admins can still access archived
        // products via direct URL (`/admin/products/:id`) to restore them.
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
    // QUI-729 — filtro tri-estado Productos / Insumos / Todos. Vive DENTRO
    // del dropdown (no en la barra). Distinto de "Tipo de Producto" arriba
    // porque esa dimensión es sobre `product_type` (Físico / Servicio);
    // esta es sobre `is_ingredient`. El default 'products' vive en el
    // CLIENTE (ADR-6), por eso el initialValue abajo — no se manda al
    // backend con `is_ingredient: undefined`, se manda como `is_ingredient:
    // false` y la carga inicial ya llega filtrada.
    {
      key: 'is_ingredient',
      label: 'Productos e insumos',
      type: 'select',
      options: [
        { value: 'products', label: 'Productos' },
        { value: 'ingredients', label: 'Insumos' },
        { value: 'all', label: 'Todos' },
      ],
    },
  ];

  // Current filter values. Inicia con `is_ingredient: 'products'` para que el
  // primer render ya llegue filtrado al backend y el badge del dropdown
  // muestre 1 desde el inicio (eso sustituye al banner que quitamos: el
  // badge avisa al usuario que hay un filtro puesto que oculta los insumos).
  filterValues: FilterValues = { is_ingredient: 'products' };

  // Dropdown actions for the filter/options dropdown.
  //
  // FIX QUI-503: se filtra POR ACCIÓN, no escondiendo el dropdown completo.
  // Sólo 'create' y 'bulk-upload' crean productos; 'bulk-image-upload' es un
  // update y 'download-current-products' es una exportación, así que un
  // usuario con read+update y sin create seguía necesitando esas dos.
  // `showActions` queda en su default (true) y `OptionsDropdownComponent`
  // oculta la sección solo si la lista queda vacía.
  //
  // QUI-567: 'bulk-edit' es la ÚNICA puerta de entrada a la vista dedicada
  // /admin/products/bulk-edit (no hay entrada en el sidebar), y se gatea con
  // `store:products:bulk_update` — el mismo permiso que exige el backend.
  readonly dropdownActions = computed<DropdownAction[]>(() => {
    const creationActions = new Set(['create', 'bulk-upload']);
    const canCreate = this.canCreate();
    const canBulkEdit = this.canBulkEdit();
    const all: DropdownAction[] = [
      {
        label: 'Nuevo Producto',
        icon: 'plus',
        action: 'create',
        variant: 'primary',
      },
      { label: 'Carga Masiva', icon: 'upload-cloud', action: 'bulk-upload' },
      { label: 'Carga de Imágenes', icon: 'image', action: 'bulk-image-upload' },
      { label: 'Edición masiva', icon: 'list-checks', action: 'bulk-edit' },
      {
        label: 'Descargar Plantilla con Productos Actuales',
        icon: 'file-spreadsheet',
        action: 'download-current-products',
      },
    ];
    return all.filter((a) => {
      if (a.action === 'bulk-edit') return canBulkEdit;
      if (creationActions.has(a.action)) return canCreate;
      return true;
    });
  });

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
      imageClick: (product: Product, event: MouseEvent) =>
        this.openImagePreview(product, event),
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
      label: 'Editar',
      icon: 'edit',
      action: (product: Product) => this.edit.emit(product),
      variant: 'info',
    },
    {
      label: (product: Product) =>
        product.state === ProductState.ACTIVE ? 'Desactivar' : 'Activar',
      icon: (product: Product) =>
        product.state === ProductState.ACTIVE ? 'toggle-right' : 'toggle-left',
      variant: (product: Product) =>
        product.state === ProductState.ACTIVE ? 'warning' : 'success',
      tooltip: (product: Product) =>
        product.state === ProductState.ACTIVE
          ? 'Desactivar producto'
          : 'Activar producto',
      action: (product: Product) => this.toggleState.emit(product),
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
    avatarClick: (item: Product, event: MouseEvent) =>
      this.openImagePreview(item, event),
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
    ],
  };

  constructor() {
    effect(() => {
      // Re-run whenever categories or brands input signals change
      this.categories();
      this.brands();
      this.updateFilterOptions();
    });

    // QUI-729 — el default del listado (solo productos, sin insumos) vive en el
    // CLIENTE y se emite tras el primer render, de modo que la carga inicial ya
    // llegue filtrada a `is_ingredient=false`.
    afterNextRender(() => this.emitQuery());
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
    this.emitQuery();
  }

  /**
   * Construye el `ProductQueryDto` a partir de los filtros del dropdown y lo
   * emite. El filtro tri-estado de productos/insumos vive ahora en
   * `filterValues['is_ingredient']` (string) y traduce:
   *   - 'products'    → `is_ingredient: false` (default del listado admin)
   *   - 'ingredients' → `is_ingredient: true`
   *   - 'all'         → OMITE `is_ingredient` (productos E insumos, tercer estado)
   *
   * El default 'products' lo fija `filterValues` al construirse — esa es la
   * fuente del primer render con 90 productos, sin tener que depender de un
   * signal ni de un side-effect en constructor.
   */
  private emitQuery(): void {
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

    // Si el dropdown dejó el campo vacío (caso "limpiar" antes de que la
    // lista cargue) caemos al default 'products' para mantener la invariante
    // del primer render (ADR-6).
    const ingredient: ProductTypeFilterValue =
      (this.filterValues['is_ingredient'] as ProductTypeFilterValue) ||
      'products';
    if (ingredient === 'products') {
      query.is_ingredient = false;
    } else if (ingredient === 'ingredients') {
      query.is_ingredient = true;
    }

    this.filter.emit(query);
  }

  clearFilters(): void {
    this.searchTerm = '';
    this.selectedState = '';
    this.selectedCategory = '';
    this.selectedBrand = '';
    this.selectedProductType = '';
    // "Limpiar todo" vuelve al default del listado: solo productos, sin
    // insumos. Restauramos `filterValues` a su estado inicial, no a `{}`,
    // porque el "Limpiar todo" genérico del dropdown emitiría `''` y la lista
    // pasaría a mostrar 105 (regresión silenciosa que QUI-729 vino a matar).
    this.filterValues = { is_ingredient: 'products' };
    this.search.emit('');
    this.filter.emit({ is_ingredient: false });
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
      case 'bulk-edit':
        this.bulkEdit.emit();
        break;
      case 'download-current-products':
        this.downloadCurrentProducts.emit();
        break;
    }
  }

  openImagePreview(product: Product, event?: MouseEvent): void {
    event?.stopPropagation();
    if (!this.getProductImageUrl(product)) {
      return;
    }
    this.selectedImageProduct.set(product);
    this.imagePreviewOpen.set(true);
  }

  closeImagePreview(): void {
    this.imagePreviewOpen.set(false);
    this.selectedImageProduct.set(null);
  }

  // Helper methods
  getProductImageUrl(product: Product): string {
    return product.image_url ?? '';
  }

  getSelectedImageUrl(): string {
    return this.selectedImageProduct()?.image_url ?? '';
  }

  getSelectedImageAlt(): string {
    return this.selectedImageProduct()?.name || 'Imagen del producto';
  }

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
