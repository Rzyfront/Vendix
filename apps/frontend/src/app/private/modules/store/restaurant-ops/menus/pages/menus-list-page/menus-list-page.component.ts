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

import { Menu, MenuStats } from '../../interfaces';
import { MenusService } from '../../services';

@Component({
  selector: 'app-menus-list-page',
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
  templateUrl: './menus-list-page.component.html',
  styleUrl: './menus-list-page.component.scss',
})
export class MenusListPageComponent implements OnInit {
  private readonly menusService = inject(MenusService);
  private readonly toastService = inject(ToastService);
  private readonly dialogService = inject(DialogService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  readonly menus = signal<Menu[]>([]);
  readonly stats = signal<MenuStats>({
    total_menus: 0,
    active_menus: 0,
    total_sections: 0,
    total_section_items: 0,
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
      label: 'Nueva Carta',
      icon: 'plus',
      action: 'create',
      variant: 'primary',
    },
  ]);

  readonly tableColumns: TableColumn[] = [
    {
      key: 'name',
      label: 'Nombre',
      sortable: true,
      priority: 1,
    },
    {
      key: 'sections',
      label: 'Secciones',
      sortable: false,
      priority: 1,
      transform: (_: unknown, row: Menu) =>
        String(row._count?.sections ?? 0),
    },
    {
      key: 'availability_windows',
      label: 'Ventanas',
      sortable: false,
      priority: 2,
      transform: (_: unknown, row: Menu) =>
        String(row._count?.availability_windows ?? 0),
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
      action: (item: Menu) => this.editMenu(item),
    },
    {
      label: 'Ingeniería',
      icon: 'bar-chart-2',
      variant: 'info',
      action: () => this.openEngineering(),
    },
    {
      label: 'Desactivar',
      icon: 'trash-2',
      variant: 'danger',
      action: (item: Menu) => this.confirmDelete(item),
    },
  ]);

  readonly cardConfig: ItemListCardConfig = {
    titleKey: 'name',
    subtitleKey: 'sections',
    subtitleTransform: (row: Menu) =>
      `${row._count?.sections ?? 0} secciones`,
    avatarFallbackIcon: 'book-open',
    avatarShape: 'square',
    badgeKey: 'is_active',
    badgeConfig: { type: 'status', size: 'sm' },
    badgeTransform: (val: boolean) => (val ? 'Activa' : 'Inactiva'),
    detailKeys: [
      {
        key: 'availability_windows',
        label: 'Ventanas',
        icon: 'clock',
        transform: (_: unknown, row?: Menu) =>
          String(row?._count?.availability_windows ?? 0),
      },
    ],
  };

  ngOnInit(): void {
    this.loadMenus();
  }

  loadMenus(): void {
    this.isLoading.set(true);
    const query: Record<string, unknown> = {
      page: this.filters().page,
      limit: this.filters().limit,
    };
    if (this.searchTerm()) query['search'] = this.searchTerm();
    if (this.statusFilter() === 'active') query['is_active'] = true;
    else if (this.statusFilter() === 'inactive') query['is_active'] = false;

    this.menusService
      .listPaginated(query)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          const data = response.data ?? [];
          this.menus.set(data);
          this.totalItems.set(
            response.meta?.pagination?.total ?? data.length,
          );
          this.refreshStats();
          this.isLoading.set(false);
        },
        error: (error: unknown) => {
          this.toastService.error(
            typeof error === 'string'
              ? error
              : 'Error al cargar las cartas',
          );
          this.isLoading.set(false);
        },
      });
  }

  private refreshStats(): void {
    this.menusService
      .getStats()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (s) => this.stats.set(s),
        error: () => undefined,
      });
  }

  onSearch(term: string): void {
    this.searchTerm.set(term);
    this.filters.update((f) => ({ ...f, page: 1 }));
    this.loadMenus();
  }

  onFilterChange(values: FilterValues): void {
    this.filterValues = values;
    const v = values['is_active'] as string | undefined;
    if (v === 'true') this.statusFilter.set('active');
    else if (v === 'false') this.statusFilter.set('inactive');
    else this.statusFilter.set('all');
    this.filters.update((f) => ({ ...f, page: 1 }));
    this.loadMenus();
  }

  clearFilters(): void {
    this.searchTerm.set('');
    this.statusFilter.set('all');
    this.filterValues = {};
    this.filters.update((f) => ({ ...f, page: 1 }));
    this.loadMenus();
  }

  onPageChange(page: number): void {
    this.filters.update((f) => ({ ...f, page }));
    this.loadMenus();
  }

  onActionClick(action: string): void {
    switch (action) {
      case 'create':
        this.createMenu();
        break;
      case 'refresh':
        this.loadMenus();
        break;
    }
  }

  createMenu(): void {
    const name = window.prompt('Nombre de la nueva carta:');
    if (!name) return;
    this.menusService
      .create({ name, is_active: true })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (created) => {
          this.toastService.success('Carta creada');
          this.router.navigate([
            '/admin/restaurant-ops/menus',
            created.id,
            'edit',
          ]);
        },
        error: (e: unknown) =>
          this.toastService.error(
            typeof e === 'string' ? e : 'Error al crear la carta',
          ),
      });
  }

  editMenu(menu: Menu): void {
    this.router.navigate(['/admin/restaurant-ops/menus', menu.id, 'edit']);
  }

  openEngineering(): void {
    this.router.navigate(['/admin/restaurant-ops/menus/engineering']);
  }

  onRowClick(menu: Menu): void {
    this.editMenu(menu);
  }

  confirmDelete(menu: Menu): void {
    this.dialogService
      .confirm({
        title: 'Desactivar Carta',
        message: `¿Desactivar la carta "${menu.name}"?`,
        confirmText: 'Desactivar',
        cancelText: 'Cancelar',
        confirmVariant: 'danger',
      })
      .then((confirmed: boolean) => {
        if (confirmed) this.deleteMenu(menu);
      });
  }

  private deleteMenu(menu: Menu): void {
    this.menusService
      .remove(menu.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.toastService.success('Carta desactivada');
          this.loadMenus();
        },
        error: (error: unknown) =>
          this.toastService.error(
            typeof error === 'string' ? error : 'Error al desactivar',
          ),
      });
  }

  get hasFilters(): boolean {
    return this.searchTerm().length > 0 || this.statusFilter() !== 'all';
  }

  getEmptyStateTitle(): string {
    return this.hasFilters
      ? 'Ninguna carta coincide con tus filtros'
      : 'Aún no tienes cartas registradas';
  }

  getEmptyStateDescription(): string {
    return this.hasFilters
      ? 'Ajusta los filtros o la búsqueda para encontrar cartas.'
      : 'Crea tu primera carta (Lunch, Dinner, etc.) para empezar a vender.';
  }
}
