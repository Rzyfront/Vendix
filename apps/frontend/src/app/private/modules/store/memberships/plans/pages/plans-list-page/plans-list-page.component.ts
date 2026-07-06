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
import { CurrencyFormatService } from '../../../../../../../shared/pipes/currency';

import { GymPlan } from '../../interfaces';
import { MembershipPlansService } from '../../services';

interface PlansStats {
  total: number;
  active: number;
  inactive: number;
}

@Component({
  selector: 'app-membership-plans-list-page',
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
  templateUrl: './plans-list-page.component.html',
})
export class MembershipPlansListPageComponent implements OnInit {
  private readonly plansService = inject(MembershipPlansService);
  private readonly toastService = inject(ToastService);
  private readonly dialogService = inject(DialogService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly currencyFormat = inject(CurrencyFormatService);

  readonly plans = signal<GymPlan[]>([]);
  readonly stats = signal<PlansStats>({ total: 0, active: 0, inactive: 0 });

  readonly filters = signal({ page: 1, limit: 10 });
  readonly totalItems = signal(0);
  readonly isLoading = signal(false);

  readonly searchTerm = signal('');
  readonly statusFilter = signal<'all' | 'active' | 'inactive'>('all');
  filterValues: FilterValues = {};

  readonly totalPages = computed(
    () => Math.ceil(this.totalItems() / this.filters().limit) || 1,
  );

  readonly filterConfigs: FilterConfig[] = [
    {
      key: 'is_active',
      label: 'Estado',
      type: 'select',
      options: [
        { value: '', label: 'Todos' },
        { value: 'true', label: 'Activos' },
        { value: 'false', label: 'Inactivos' },
      ],
    },
  ];

  readonly dropdownActions = computed<DropdownAction[]>(() => [
    { label: 'Refrescar', icon: 'refresh-cw', action: 'refresh' },
    { label: 'Nuevo Plan', icon: 'plus', action: 'create', variant: 'primary' },
  ]);

  readonly tableColumns: TableColumn[] = [
    { key: 'code', label: 'Código', sortable: true, priority: 2 },
    { key: 'name', label: 'Plan', sortable: true, priority: 1 },
    {
      key: 'price',
      label: 'Precio',
      sortable: true,
      priority: 1,
      transform: (value: number | string | null) =>
        this.currencyFormat.format(value ?? 0),
    },
    {
      key: 'duration_days',
      label: 'Vigencia',
      sortable: true,
      priority: 2,
      transform: (value: number | null) => `${value ?? 0} días`,
    },
    {
      key: 'access_limit_per_period',
      label: 'Accesos/período',
      sortable: false,
      priority: 3,
      transform: (value: number | null) =>
        value == null ? 'Ilimitado' : String(value),
    },
    {
      key: 'is_active',
      label: 'Estado',
      priority: 1,
      transform: (value: boolean) => (value ? 'Activo' : 'Inactivo'),
      badge: true,
      badgeConfig: {
        type: 'custom',
        colorMap: { true: '#16a34a', false: '#b45309' },
      },
    },
  ];

  readonly tableActions = computed<TableAction[]>(() => [
    {
      label: 'Editar',
      icon: 'edit',
      variant: 'info',
      action: (item: GymPlan) => this.editPlan(item),
    },
    {
      label: 'Eliminar',
      icon: 'trash-2',
      variant: 'danger',
      action: (item: GymPlan) => this.confirmDelete(item),
    },
  ]);

  readonly cardConfig: ItemListCardConfig = {
    titleKey: 'name',
    subtitleKey: 'code',
    avatarFallbackIcon: 'dumbbell',
    avatarShape: 'square',
    badgeKey: 'is_active',
    badgeConfig: {
      type: 'custom',
      size: 'sm',
      colorMap: { true: '#16a34a', false: '#b45309' },
    },
    badgeTransform: (val: boolean) => (val ? 'Activo' : 'Inactivo'),
    detailKeys: [
      {
        key: 'price',
        label: 'Precio',
        icon: 'tag',
        transform: (v: number | string | null) =>
          this.currencyFormat.format(v ?? 0),
      },
      {
        key: 'duration_days',
        label: 'Vigencia',
        icon: 'calendar',
        transform: (v: number | null) => `${v ?? 0} días`,
      },
    ],
  };

  ngOnInit(): void {
    this.loadPlans();
  }

  loadPlans(): void {
    this.isLoading.set(true);

    const query: Record<string, unknown> = {
      page: this.filters().page,
      limit: this.filters().limit,
    };
    if (this.searchTerm()) query['search'] = this.searchTerm();
    if (this.statusFilter() === 'active') query['is_active'] = true;
    else if (this.statusFilter() === 'inactive') query['is_active'] = false;

    this.plansService
      .listPaginated(query)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          const data = response.data ?? [];
          this.plans.set(data);
          this.totalItems.set(response.meta?.total ?? data.length);
          this.recalculateStats(data);
          this.isLoading.set(false);
        },
        error: (error: unknown) => {
          this.toastService.error(
            typeof error === 'string' ? error : 'Error al cargar los planes',
          );
          this.isLoading.set(false);
        },
      });
  }

  private recalculateStats(list: GymPlan[]): void {
    this.stats.set({
      total: this.totalItems(),
      active: list.filter((p) => p.is_active).length,
      inactive: list.filter((p) => !p.is_active).length,
    });
  }

  onSearch(term: string): void {
    this.searchTerm.set(term);
    this.filters.update((f) => ({ ...f, page: 1 }));
    this.loadPlans();
  }

  onFilterChange(values: FilterValues): void {
    this.filterValues = values;
    const isActiveValue = values['is_active'] as string | undefined;
    if (isActiveValue === 'true') this.statusFilter.set('active');
    else if (isActiveValue === 'false') this.statusFilter.set('inactive');
    else this.statusFilter.set('all');
    this.filters.update((f) => ({ ...f, page: 1 }));
    this.loadPlans();
  }

  clearFilters(): void {
    this.searchTerm.set('');
    this.statusFilter.set('all');
    this.filterValues = {};
    this.filters.update((f) => ({ ...f, page: 1 }));
    this.loadPlans();
  }

  onPageChange(page: number): void {
    this.filters.update((f) => ({ ...f, page }));
    this.loadPlans();
  }

  onActionClick(action: string): void {
    if (action === 'create') this.createPlan();
    else if (action === 'refresh') this.loadPlans();
  }

  createPlan(): void {
    this.router.navigate(['/admin/memberships/plans/new']);
  }

  editPlan(plan: GymPlan): void {
    this.router.navigate(['/admin/memberships/plans', plan.id, 'edit']);
  }

  onRowClick(plan: GymPlan): void {
    this.editPlan(plan);
  }

  confirmDelete(plan: GymPlan): void {
    this.dialogService
      .confirm({
        title: 'Eliminar plan',
        message: `¿Eliminar el plan "${plan.name}"? Si tiene socios asociados solo se desactivará.`,
        confirmText: 'Eliminar',
        cancelText: 'Cancelar',
        confirmVariant: 'danger',
      })
      .then((confirmed: boolean) => {
        if (confirmed) this.deletePlan(plan);
      });
  }

  private deletePlan(plan: GymPlan): void {
    this.plansService
      .remove(plan.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (result) => {
          this.toastService.success(
            result.deleted
              ? 'Plan eliminado correctamente'
              : 'Plan desactivado (tiene socios asociados)',
          );
          this.loadPlans();
        },
        error: (error: unknown) => {
          this.toastService.error(
            typeof error === 'string' ? error : 'Error al eliminar el plan',
          );
        },
      });
  }

  get hasFilters(): boolean {
    return this.searchTerm().length > 0 || this.statusFilter() !== 'all';
  }

  getEmptyStateTitle(): string {
    return this.hasFilters
      ? 'Ningún plan coincide con tus filtros'
      : 'Aún no tienes planes registrados';
  }

  getEmptyStateDescription(): string {
    return this.hasFilters
      ? 'Ajusta los filtros o la búsqueda para encontrar planes.'
      : 'Crea tu primer plan de membresía para empezar a inscribir socios.';
  }
}
