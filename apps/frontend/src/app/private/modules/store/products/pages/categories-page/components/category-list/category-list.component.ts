import { Component, computed, input, output, signal } from '@angular/core';

import { FormsModule } from '@angular/forms';

// Shared Components
import {
  ButtonComponent,
  TableColumn,
  TableAction,
  InputsearchComponent,
  IconComponent,
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
} from '../../../../../../../../shared/components/index';

// Interfaces
import { ProductCategory } from '../../../../interfaces';

@Component({
  selector: 'app-category-list',
  standalone: true,
  imports: [
    FormsModule,
    ButtonComponent,
    InputsearchComponent,
    IconComponent,
    OptionsDropdownComponent,
    ResponsiveDataViewComponent,
    PaginationComponent,
    EmptyStateComponent,
    CardComponent,
    ImageLightboxComponent,
  ],
  templateUrl: './category-list.component.html',
})
export class CategoryListComponent {
  readonly items = input<ProductCategory[]>([]);
  readonly isLoading = input(false);
  readonly totalItems = input(0);
  readonly currentPage = input(1);
  readonly totalPages = input(1);
  readonly limit = input(10);
  readonly canCreate = input(false);
  readonly canUpdate = input(false);
  readonly canDelete = input(false);

  readonly refresh = output<void>();
  readonly search = output<string>();
  readonly filter = output<FilterValues>();
  readonly create = output<void>();
  readonly edit = output<ProductCategory>();
  readonly delete = output<ProductCategory>();
  readonly toggleState = output<ProductCategory>();
  readonly toggleFeatured = output<ProductCategory>();
  readonly sort = output<{
    column: string;
    direction: 'asc' | 'desc' | null;
  }>();
  readonly pageChange = output<number>();

  searchTerm = signal('');
  selectedStatus = signal('');
  readonly selectedImageCategory = signal<ProductCategory | null>(null);
  readonly imagePreviewOpen = signal(false);

  filterConfigs: FilterConfig[] = [
    {
      key: 'state',
      label: 'Estado',
      type: 'select',
      options: [
        { value: '', label: 'Todos' },
        { value: 'active', label: 'Activas' },
        { value: 'inactive', label: 'Inactivas' },
      ],
    },
    {
      key: 'is_featured',
      label: 'Destacado',
      type: 'select',
      options: [
        { value: '', label: 'Todas' },
        { value: 'true', label: 'Destacadas' },
        { value: 'false', label: 'No destacadas' },
      ],
    },
  ];

  filterValues: FilterValues = {};

  readonly dropdownActions = computed<DropdownAction[]>(() => {
    const baseActions: DropdownAction[] = [
      { label: 'Refrescar', icon: 'refresh-cw', action: 'refresh' },
    ];
    if (this.canCreate()) {
      baseActions.push({
        label: 'Nueva Categoría',
        icon: 'plus',
        action: 'create',
        variant: 'primary',
      });
    }
    return baseActions;
  });

  tableColumns: TableColumn[] = [
    {
      key: 'image_url',
      label: 'Foto',
      type: 'image',
      width: '80px',
      priority: 3,
      defaultValue: '',
      imageClick: (category: ProductCategory, event: MouseEvent) =>
        this.openImagePreview(category, event),
    },
    { key: 'name', label: 'Nombre', sortable: true, priority: 1 },
    { key: 'slug', label: 'Slug', sortable: true, priority: 3 },
    {
      key: 'description',
      label: 'Descripción',
      defaultValue: '—',
      priority: 4,
    },
    {
      key: 'is_featured',
      label: 'Destacado',
      sortable: true,
      priority: 2,
      transform: (value: boolean) => (value ? 'Destacada' : 'Normal'),
      badge: true,
      badgeConfig: {
        type: 'custom',
        colorMap: {
          true: '#d97706',
          false: '#6b7280',
          Destacada: '#d97706',
          Normal: '#6b7280',
        },
      },
    },
    {
      key: 'state',
      label: 'Estado',
      priority: 1,
      transform: (value: string) =>
        value === 'active' ? 'Activo' : 'Inactivo',
      badge: true,
      badgeConfig: {
        type: 'status',
      },
    },
  ];

  readonly tableActions = computed<TableAction[]>(() => {
    const actions: TableAction[] = [];
    if (this.canUpdate()) {
      actions.push({
        label: 'Editar',
        icon: 'pencil',
        variant: 'info',
        action: (item: ProductCategory) => this.edit.emit(item),
      });
      actions.push({
        label: (item: ProductCategory) =>
          item.state === 'active' ? 'Desactivar' : 'Activar',
        icon: (item: ProductCategory) =>
          item.state === 'active' ? 'toggle-right' : 'toggle-left',
        variant: (item: ProductCategory) =>
          item.state === 'active' ? 'warning' : 'success',
        tooltip: (item: ProductCategory) =>
          item.state === 'active'
            ? 'Desactivar categoría'
            : 'Activar categoría',
        action: (item: ProductCategory) => this.toggleState.emit(item),
      });
      actions.push({
        label: (item: ProductCategory) =>
          item.is_featured ? 'Quitar destacado' : 'Destacar',
        icon: 'star',
        variant: (item: ProductCategory) =>
          item.is_featured ? 'muted' : 'warning',
        tooltip: (item: ProductCategory) =>
          item.is_featured
            ? 'Quitar prioridad en el inicio'
            : 'Dar prioridad en el inicio',
        action: (item: ProductCategory) => this.toggleFeatured.emit(item),
      });
    }
    if (this.canDelete()) {
      actions.push({
        label: 'Eliminar',
        icon: 'trash-2',
        variant: 'danger',
        action: (item: ProductCategory) => this.delete.emit(item),
      });
    }
    return actions;
  });

  cardConfig: ItemListCardConfig = {
    titleKey: 'name',
    subtitleKey: 'slug',
    avatarKey: 'image_url',
    avatarClick: (category: ProductCategory, event: MouseEvent) =>
      this.openImagePreview(category, event),
    avatarFallbackIcon: 'layers',
    avatarShape: 'square',
    badgeKey: 'state',
    badgeConfig: { type: 'status', size: 'sm' },
    badgeTransform: (val: string) => (val === 'active' ? 'Activo' : 'Inactivo'),
    detailKeys: [
      {
        key: 'is_featured',
        label: 'Destacada',
        icon: 'star',
        transform: (value: boolean) => (value ? 'Sí' : 'No'),
      },
      { key: 'description', label: 'Descripción', icon: 'file-text' },
    ],
  };

  onSearchChange(term: string): void {
    this.searchTerm.set(term);
    this.search.emit(term);
  }

  onFilterChange(values: FilterValues): void {
    this.filterValues = values;
    this.selectedStatus.set((values['state'] as string) || '');
    this.filter.emit(values);
  }

  clearFilters(): void {
    this.searchTerm.set('');
    this.selectedStatus.set('');
    this.filterValues = {};
    this.search.emit('');
    this.filter.emit({});
  }

  onActionClick(action: string): void {
    switch (action) {
      case 'create':
        if (!this.canCreate()) return;
        this.create.emit();
        break;
      case 'refresh':
        this.refresh.emit();
        break;
    }
  }

  onRowClick(category: ProductCategory): void {
    if (!this.canUpdate()) return;
    this.edit.emit(category);
  }

  openImagePreview(category: ProductCategory, event?: MouseEvent): void {
    event?.stopPropagation();
    if (!category.image_url) return;
    this.selectedImageCategory.set(category);
    this.imagePreviewOpen.set(true);
  }

  closeImagePreview(): void {
    this.imagePreviewOpen.set(false);
    this.selectedImageCategory.set(null);
  }

  getSelectedImageUrl(): string {
    return this.selectedImageCategory()?.image_url ?? '';
  }

  getSelectedImageAlt(): string {
    return this.selectedImageCategory()?.name || 'Imagen de categoría';
  }

  getEmptyStateTitle(): string {
    return this.hasFilters
      ? 'Ninguna categoría coincide con sus filtros'
      : 'No se encontraron categorías';
  }

  getEmptyStateDescription(): string {
    return this.hasFilters
      ? 'Intente ajustar sus términos de búsqueda o filtros'
      : 'Comience agregando una nueva categoría.';
  }

  get hasFilters(): boolean {
    return !!(
      this.searchTerm() ||
      this.selectedStatus() ||
      this.filterValues['is_featured']
    );
  }
}
