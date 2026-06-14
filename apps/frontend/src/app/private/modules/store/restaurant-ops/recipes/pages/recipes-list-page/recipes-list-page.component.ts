import {
  Component,
  computed,
  DestroyRef,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import {
  CardComponent,
  DialogService,
  DropdownAction,
  EmptyStateComponent,
  FilterConfig,
  FilterValues,
  InputsearchComponent,
  ItemListCardConfig,
  OptionsDropdownComponent,
  PaginationComponent,
  ResponsiveDataViewComponent,
  StatsComponent,
  StickyHeaderComponent,
  TableAction,
  TableColumn,
  ToastService,
} from '../../../../../../../shared/components/index';

import { Recipe } from '../../interfaces';
import { RecipesService } from '../../services';

interface RecipesStats {
  total: number;
  active: number;
  inactive: number;
  totalItems: number;
}

@Component({
  selector: 'app-recipes-list-page',
  standalone: true,
  imports: [
    FormsModule,
    StickyHeaderComponent,
    StatsComponent,
    CardComponent,
    InputsearchComponent,
    OptionsDropdownComponent,
    ResponsiveDataViewComponent,
    PaginationComponent,
    EmptyStateComponent,
  ],
  templateUrl: './recipes-list-page.component.html',
  styleUrl: './recipes-list-page.component.scss',
})
export class RecipesListPageComponent implements OnInit {
  private readonly recipesService = inject(RecipesService);
  private readonly toastService = inject(ToastService);
  private readonly dialogService = inject(DialogService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  readonly recipes = signal<Recipe[]>([]);
  readonly stats = signal<RecipesStats>({
    total: 0,
    active: 0,
    inactive: 0,
    totalItems: 0,
  });

  readonly filters = signal({ page: 1, limit: 10 });
  readonly totalItems = signal(0);
  readonly isLoading = signal(false);

  readonly searchTerm = signal('');
  readonly statusFilter = signal<'all' | 'active' | 'inactive'>('all');
  filterValues: FilterValues = {};

  readonly totalPages = computed(() =>
    Math.ceil(this.totalItems() / this.filters().limit) || 1,
  );

  readonly filterConfigs: FilterConfig[] = [
    {
      key: 'is_active',
      label: 'Estado',
      type: 'select',
      options: [
        { value: '', label: 'Todas' },
        { value: 'true', label: 'Activas' },
        { value: 'false', label: 'Inactivas' },
      ],
    },
  ];

  readonly dropdownActions = computed<DropdownAction[]>(() => [
    { label: 'Refrescar', icon: 'refresh-cw', action: 'refresh' },
    {
      label: 'Nueva Receta',
      icon: 'plus',
      action: 'create',
      variant: 'primary',
    },
  ]);

  readonly tableColumns: TableColumn[] = [
    {
      key: 'product',
      label: 'Producto',
      sortable: false,
      priority: 1,
      transform: (_: unknown, row: Recipe) =>
        row.product?.name ? row.product.name : `Receta #${row.id}`,
    },
    {
      key: 'yield_quantity',
      label: 'Rendimiento',
      sortable: true,
      priority: 2,
      transform: (value: number | string | null, row: Recipe) =>
        `${value ?? 0} ${row.yield_unit || ''}`.trim(),
    },
    {
      // Key must resolve to a real value on the row: app-table gates the cell on
      // getNestedValue(item, key) BEFORE running transform, so a non-existent
      // 'items_count' key rendered "No data" even when the recipe had items.
      // findAll returns `_count: { items }`, so we point at that nested path.
      key: '_count.items',
      label: 'Componentes',
      sortable: false,
      priority: 1,
      defaultValue: '0',
      transform: (_: unknown, row: Recipe) => {
        const count =
          row.items?.length ?? row._count?.items ?? 0;
        return String(count);
      },
    },
    {
      key: 'waste_percent',
      label: 'Merma',
      sortable: true,
      priority: 3,
      transform: (value: number | string | null) =>
        value == null ? '0%' : `${Number(value)}%`,
    },
    {
      key: 'is_active',
      label: 'Estado',
      priority: 1,
      transform: (value: boolean) => (value ? 'Activa' : 'Inactiva'),
      badge: true,
      badgeConfig: { type: 'status' },
    },
  ];

  readonly tableActions = computed<TableAction[]>(() => [
    {
      label: 'Editar',
      icon: 'edit',
      variant: 'info',
      action: (item: Recipe) => this.editRecipe(item),
    },
    {
      label: 'Desactivar',
      icon: 'trash-2',
      variant: 'danger',
      action: (item: Recipe) => this.confirmDelete(item),
    },
  ]);

  readonly cardConfig: ItemListCardConfig = {
    titleKey: 'product',
    titleTransform: (row: Recipe) =>
      row.product?.name ? row.product.name : `Receta #${row.id}`,
    subtitleKey: 'yield_quantity',
    subtitleTransform: (row: Recipe) =>
      `${Number(row.yield_quantity ?? 0)} ${row.yield_unit || ''}`.trim(),
    avatarFallbackIcon: 'chef-hat',
    avatarShape: 'square',
    badgeKey: 'is_active',
    badgeConfig: { type: 'status', size: 'sm' },
    badgeTransform: (val: boolean) => (val ? 'Activa' : 'Inactiva'),
    detailKeys: [
      {
        key: 'waste_percent',
        label: 'Merma',
        icon: 'percent',
        transform: (v: number | string | null) =>
          v == null ? '0%' : `${Number(v)}%`,
      },
      {
        key: 'items_count',
        label: 'Componentes',
        icon: 'list',
        transform: (v: number | string | null, row?: Recipe) => {
          if (row) {
            return String(row.items?.length ?? row._count?.items ?? 0);
          }
          return String(v ?? 0);
        },
      },
    ],
  };

  ngOnInit(): void {
    this.loadRecipes();
  }

  loadRecipes(): void {
    this.isLoading.set(true);

    const query: Record<string, unknown> = {
      page: this.filters().page,
      limit: this.filters().limit,
    };

    if (this.searchTerm()) {
      query['search'] = this.searchTerm();
    }
    if (this.statusFilter() === 'active') {
      query['is_active'] = true;
    } else if (this.statusFilter() === 'inactive') {
      query['is_active'] = false;
    }

    this.recipesService
      .listPaginated(query)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          const data = response.data ?? [];
          this.recipes.set(data);
          this.totalItems.set(
            response.meta?.pagination?.total ?? data.length,
          );
          this.recalculateStats(data);
          this.isLoading.set(false);
        },
        error: (error: unknown) => {
          this.toastService.error(
            typeof error === 'string'
              ? error
              : 'Error al cargar las recetas',
          );
          this.isLoading.set(false);
        },
      });
  }

  private recalculateStats(list: Recipe[]): void {
    let totalItems = 0;
    for (const r of list) {
      totalItems += r.items?.length ?? r._count?.items ?? 0;
    }
    this.stats.set({
      total: this.totalItems(),
      active: list.filter((r) => r.is_active).length,
      inactive: list.filter((r) => !r.is_active).length,
      totalItems,
    });
  }

  onSearch(term: string): void {
    this.searchTerm.set(term);
    this.filters.update((f) => ({ ...f, page: 1 }));
    this.loadRecipes();
  }

  onFilterChange(values: FilterValues): void {
    this.filterValues = values;
    const isActiveValue = values['is_active'] as string | undefined;
    if (isActiveValue === 'true') {
      this.statusFilter.set('active');
    } else if (isActiveValue === 'false') {
      this.statusFilter.set('inactive');
    } else {
      this.statusFilter.set('all');
    }
    this.filters.update((f) => ({ ...f, page: 1 }));
    this.loadRecipes();
  }

  clearFilters(): void {
    this.searchTerm.set('');
    this.statusFilter.set('all');
    this.filterValues = {};
    this.filters.update((f) => ({ ...f, page: 1 }));
    this.loadRecipes();
  }

  onPageChange(page: number): void {
    this.filters.update((f) => ({ ...f, page }));
    this.loadRecipes();
  }

  onActionClick(action: string): void {
    switch (action) {
      case 'create':
        this.createRecipe();
        break;
      case 'refresh':
        this.loadRecipes();
        break;
    }
  }

  createRecipe(): void {
    this.router.navigate(['/admin/restaurant-ops/recipes/new']);
  }

  editRecipe(recipe: Recipe): void {
    this.router.navigate(['/admin/restaurant-ops/recipes', recipe.id, 'edit']);
  }

  onRowClick(recipe: Recipe): void {
    this.editRecipe(recipe);
  }

  confirmDelete(recipe: Recipe): void {
    this.dialogService
      .confirm({
        title: 'Desactivar Receta',
        message: `¿Desactivar la receta de "${recipe.product?.name ?? 'este producto'}"? La receta se conserva y se puede restaurar después.`,
        confirmText: 'Desactivar',
        cancelText: 'Cancelar',
        confirmVariant: 'danger',
      })
      .then((confirmed: boolean) => {
        if (confirmed) {
          this.deleteRecipe(recipe);
        }
      });
  }

  private deleteRecipe(recipe: Recipe): void {
    this.recipesService
      .remove(recipe.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.toastService.success('Receta desactivada correctamente');
          this.loadRecipes();
        },
        error: (error: unknown) => {
          this.toastService.error(
            typeof error === 'string'
              ? error
              : 'Error al desactivar la receta',
          );
        },
      });
  }

  get hasFilters(): boolean {
    return this.searchTerm().length > 0 || this.statusFilter() !== 'all';
  }

  getEmptyStateTitle(): string {
    return this.hasFilters
      ? 'Ninguna receta coincide con tus filtros'
      : 'Aún no tienes recetas registradas';
  }

  getEmptyStateDescription(): string {
    return this.hasFilters
      ? 'Ajusta los filtros o la búsqueda para encontrar recetas.'
      : 'Crea tu primera receta para empezar a calcular costes y producir lotes.';
  }
}
