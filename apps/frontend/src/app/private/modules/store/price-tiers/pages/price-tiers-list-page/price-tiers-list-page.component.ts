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
} from '../../../../../../shared/components/index';

import { PriceTier } from '../../interfaces';
import { PriceTiersService, PriceTierCacheService } from '../../services';

interface PriceTiersStats {
  total: number;
  active: number;
  inactive: number;
  package_units: number;
}

@Component({
  selector: 'app-price-tiers-list-page',
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
  templateUrl: './price-tiers-list-page.component.html',
  styleUrl: './price-tiers-list-page.component.scss',
})
export class PriceTiersListPageComponent implements OnInit {
  private readonly priceTiersService = inject(PriceTiersService);
  private readonly priceTierCache = inject(PriceTierCacheService);
  private readonly toastService = inject(ToastService);
  private readonly dialogService = inject(DialogService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  readonly priceTiers = signal<PriceTier[]>([]);
  readonly stats = signal<PriceTiersStats>({
    total: 0,
    active: 0,
    inactive: 0,
    package_units: 0,
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
        { value: '', label: 'Todos' },
        { value: 'true', label: 'Activas' },
        { value: 'false', label: 'Inactivas' },
      ],
    },
  ];

  readonly dropdownActions = computed<DropdownAction[]>(() => [
    { label: 'Refrescar', icon: 'refresh-cw', action: 'refresh' },
    {
      label: 'Nueva Tarifa',
      icon: 'plus',
      action: 'create',
      variant: 'primary',
    },
  ]);

  readonly tableColumns: TableColumn[] = [
    { key: 'name', label: 'Nombre', sortable: true, priority: 1 },
    {
      key: 'code',
      label: 'Código',
      defaultValue: '-',
      width: '120px',
      priority: 2,
    },
    {
      key: 'discount_percentage',
      label: 'Descuento',
      priority: 1,
      transform: (value: number | string | null) =>
        value == null ? '0%' : `${Number(value)}%`,
    },
    {
      key: 'is_default',
      label: 'Por Defecto',
      priority: 3,
      transform: (value: boolean) => (value ? 'Sí' : 'No'),
    },
    {
      key: 'is_package_unit',
      label: 'Unidad Paquete',
      priority: 3,
      transform: (value: boolean) => (value ? 'Sí' : 'No'),
    },
    {
      key: 'sort_order',
      label: 'Orden',
      sortable: true,
      width: '80px',
      priority: 3,
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
      action: (item: PriceTier) => this.editTier(item),
    },
    {
      label: 'Eliminar',
      icon: 'trash-2',
      variant: 'danger',
      action: (item: PriceTier) => this.confirmDelete(item),
    },
  ]);

  readonly cardConfig: ItemListCardConfig = {
    titleKey: 'name',
    subtitleKey: 'code',
    avatarFallbackIcon: 'tag',
    avatarShape: 'square',
    badgeKey: 'is_active',
    badgeConfig: { type: 'status', size: 'sm' },
    badgeTransform: (val: boolean) => (val ? 'Activa' : 'Inactiva'),
    detailKeys: [
      {
        key: 'discount_percentage',
        label: 'Descuento',
        icon: 'percent',
        transform: (v: number | string | null) =>
          v == null ? '0%' : `${Number(v)}%`,
      },
      { key: 'sort_order', label: 'Orden', icon: 'arrow-up-down' },
    ],
  };

  ngOnInit(): void {
    this.loadTiers();
  }

  loadTiers(): void {
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

    this.priceTiersService
      .listPaginated(query)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          const data = response.data ?? [];
          this.priceTiers.set(data);
          this.totalItems.set(
            response.meta?.pagination?.total ?? data.length,
          );
          this.recalculateStats(data);
          this.isLoading.set(false);
        },
        error: (error) => {
          this.toastService.error(
            typeof error === 'string' ? error : 'Error al cargar las tarifas',
          );
          this.isLoading.set(false);
        },
      });
  }

  private recalculateStats(list: PriceTier[]): void {
    this.stats.set({
      total: this.totalItems(),
      active: list.filter((t) => t.is_active).length,
      inactive: list.filter((t) => !t.is_active).length,
      package_units: list.filter((t) => t.is_package_unit).length,
    });
  }

  onSearch(term: string): void {
    this.searchTerm.set(term);
    this.filters.update((f) => ({ ...f, page: 1 }));
    this.loadTiers();
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
    this.loadTiers();
  }

  clearFilters(): void {
    this.searchTerm.set('');
    this.statusFilter.set('all');
    this.filterValues = {};
    this.filters.update((f) => ({ ...f, page: 1 }));
    this.loadTiers();
  }

  onPageChange(page: number): void {
    this.filters.update((f) => ({ ...f, page }));
    this.loadTiers();
  }

  onActionClick(action: string): void {
    switch (action) {
      case 'create':
        this.createTier();
        break;
      case 'refresh':
        this.loadTiers();
        break;
    }
  }

  createTier(): void {
    this.router.navigate(['/admin/price-tiers/new']);
  }

  editTier(tier: PriceTier): void {
    this.router.navigate(['/admin/price-tiers', tier.id, 'edit']);
  }

  onRowClick(tier: PriceTier): void {
    this.editTier(tier);
  }

  confirmDelete(tier: PriceTier): void {
    if (tier.is_default) {
      this.toastService.warning(
        'No puedes eliminar la tarifa por defecto. Marca otra tarifa como predeterminada primero.',
      );
      return;
    }
    this.dialogService
      .confirm({
        title: 'Eliminar Tarifa',
        message: `¿Eliminar "${tier.name}"? Esta acción se puede revertir desde la vista de tarifas eliminadas.`,
        confirmText: 'Eliminar',
        cancelText: 'Cancelar',
        confirmVariant: 'danger',
      })
      .then((confirmed) => {
        if (confirmed) {
          this.deleteTier(tier);
        }
      });
  }

  private deleteTier(tier: PriceTier): void {
    this.priceTiersService
      .remove(tier.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.toastService.success('Tarifa eliminada correctamente');
          this.priceTierCache.invalidate();
          this.loadTiers();
        },
        error: (error) => {
          this.toastService.error(
            typeof error === 'string' ? error : 'Error al eliminar la tarifa',
          );
        },
      });
  }

  get hasFilters(): boolean {
    return this.searchTerm().length > 0 || this.statusFilter() !== 'all';
  }

  getEmptyStateTitle(): string {
    return this.hasFilters
      ? 'Ninguna tarifa coincide con tus filtros'
      : 'No tienes tarifas registradas';
  }

  getEmptyStateDescription(): string {
    return this.hasFilters
      ? 'Ajusta los filtros o la búsqueda para encontrar tarifas.'
      : 'Crea tu primera tarifa para empezar a aplicar precios diferenciados.';
  }
}
