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
  DropdownAction,
  EmptyStateComponent,
  FilterConfig,
  FilterValues,
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
import { formatDateOnlyUTC } from '../../../../../../../shared/utils/date.util';

import {
  GymMembership,
  GymMembershipStatus,
  GYM_MEMBERSHIP_STATUS_COLORS,
  GYM_MEMBERSHIP_STATUS_LABELS,
} from '../../interfaces';
import { MembershipsService } from '../../services';

interface MembersStats {
  total: number;
  active: number;
  pending: number;
}

@Component({
  selector: 'app-membership-members-list-page',
  standalone: true,
  imports: [
    FormsModule,
    StickyHeaderComponent,
    StatsComponent,
    CardComponent,
    OptionsDropdownComponent,
    ResponsiveDataViewComponent,
    PaginationComponent,
    EmptyStateComponent,
  ],
  templateUrl: './members-list-page.component.html',
})
export class MembershipMembersListPageComponent implements OnInit {
  private readonly membershipsService = inject(MembershipsService);
  private readonly toastService = inject(ToastService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  readonly memberships = signal<GymMembership[]>([]);
  readonly stats = signal<MembersStats>({ total: 0, active: 0, pending: 0 });

  readonly filters = signal({ page: 1, limit: 10 });
  readonly totalItems = signal(0);
  readonly isLoading = signal(false);

  readonly statusFilter = signal<GymMembershipStatus | 'all'>('all');
  filterValues: FilterValues = {};

  readonly totalPages = computed(
    () => Math.ceil(this.totalItems() / this.filters().limit) || 1,
  );

  readonly filterConfigs: FilterConfig[] = [
    {
      key: 'status',
      label: 'Estado',
      type: 'select',
      options: [
        { value: '', label: 'Todos' },
        { value: 'active', label: 'Activa' },
        { value: 'pending_payment', label: 'Pago pendiente' },
        { value: 'suspended', label: 'Suspendida' },
        { value: 'frozen', label: 'Congelada' },
        { value: 'expired', label: 'Vencida' },
        { value: 'cancelled', label: 'Cancelada' },
      ],
    },
  ];

  readonly dropdownActions = computed<DropdownAction[]>(() => [
    { label: 'Refrescar', icon: 'refresh-cw', action: 'refresh' },
    {
      label: 'Asignar Membresía',
      icon: 'plus',
      action: 'create',
      variant: 'primary',
    },
  ]);

  readonly tableColumns: TableColumn[] = [
    {
      key: 'customer',
      label: 'Socio',
      sortable: false,
      priority: 1,
      transform: (_: unknown, row: GymMembership) => this.customerName(row),
    },
    {
      key: 'plan',
      label: 'Plan',
      sortable: false,
      priority: 2,
      transform: (_: unknown, row: GymMembership) =>
        row.plan?.name ?? `Plan #${row.gym_plan_id}`,
    },
    {
      key: 'period_end',
      label: 'Vence',
      sortable: true,
      priority: 2,
      transform: (value: string | null) =>
        value ? formatDateOnlyUTC(value) : 'Sin vigencia',
    },
    {
      key: 'status',
      label: 'Estado',
      priority: 1,
      transform: (value: GymMembershipStatus) =>
        GYM_MEMBERSHIP_STATUS_LABELS[value] ?? value,
      badge: true,
      badgeConfig: { type: 'custom', colorMap: GYM_MEMBERSHIP_STATUS_COLORS },
    },
  ];

  readonly tableActions = computed<TableAction[]>(() => [
    {
      label: 'Ver detalle',
      icon: 'eye',
      variant: 'info',
      action: (item: GymMembership) => this.openDetail(item),
    },
  ]);

  readonly cardConfig: ItemListCardConfig = {
    titleKey: 'customer',
    titleTransform: (row: GymMembership) => this.customerName(row),
    subtitleKey: 'plan',
    subtitleTransform: (row: GymMembership) =>
      row.plan?.name ?? `Plan #${row.gym_plan_id}`,
    avatarFallbackIcon: 'user',
    avatarShape: 'circle',
    badgeKey: 'status',
    badgeConfig: {
      type: 'custom',
      size: 'sm',
      colorMap: GYM_MEMBERSHIP_STATUS_COLORS,
    },
    badgeTransform: (val: GymMembershipStatus) =>
      GYM_MEMBERSHIP_STATUS_LABELS[val] ?? val,
    detailKeys: [
      {
        key: 'period_end',
        label: 'Vence',
        icon: 'calendar',
        transform: (v: string | null) =>
          v ? formatDateOnlyUTC(v) : 'Sin vigencia',
      },
    ],
  };

  ngOnInit(): void {
    this.loadMemberships();
  }

  private customerName(row: GymMembership): string {
    const c = row.customer;
    if (!c) return `Socio #${row.customer_id}`;
    const name = `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim();
    return name || c.email || `Socio #${row.customer_id}`;
  }

  loadMemberships(): void {
    this.isLoading.set(true);

    const query: Record<string, unknown> = {
      page: this.filters().page,
      limit: this.filters().limit,
    };
    if (this.statusFilter() !== 'all') query['status'] = this.statusFilter();

    this.membershipsService
      .listPaginated(query)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          const data = response.data ?? [];
          this.memberships.set(data);
          this.totalItems.set(response.meta?.total ?? data.length);
          this.recalculateStats(data);
          this.isLoading.set(false);
        },
        error: (error: unknown) => {
          this.toastService.error(
            typeof error === 'string'
              ? error
              : 'Error al cargar las membresías',
          );
          this.isLoading.set(false);
        },
      });
  }

  private recalculateStats(list: GymMembership[]): void {
    this.stats.set({
      total: this.totalItems(),
      active: list.filter((m) => m.status === 'active').length,
      pending: list.filter((m) => m.status === 'pending_payment').length,
    });
  }

  onFilterChange(values: FilterValues): void {
    this.filterValues = values;
    const status = (values['status'] as string | undefined) ?? '';
    this.statusFilter.set(
      status ? (status as GymMembershipStatus) : 'all',
    );
    this.filters.update((f) => ({ ...f, page: 1 }));
    this.loadMemberships();
  }

  clearFilters(): void {
    this.statusFilter.set('all');
    this.filterValues = {};
    this.filters.update((f) => ({ ...f, page: 1 }));
    this.loadMemberships();
  }

  onPageChange(page: number): void {
    this.filters.update((f) => ({ ...f, page }));
    this.loadMemberships();
  }

  onActionClick(action: string): void {
    if (action === 'create') this.assignMembership();
    else if (action === 'refresh') this.loadMemberships();
  }

  assignMembership(): void {
    this.router.navigate(['/admin/memberships/members/new']);
  }

  openDetail(membership: GymMembership): void {
    this.router.navigate(['/admin/memberships/members', membership.id]);
  }

  onRowClick(membership: GymMembership): void {
    this.openDetail(membership);
  }

  get hasFilters(): boolean {
    return this.statusFilter() !== 'all';
  }

  getEmptyStateTitle(): string {
    return this.hasFilters
      ? 'Ninguna membresía coincide con el filtro'
      : 'Aún no tienes socios con membresía';
  }

  getEmptyStateDescription(): string {
    return this.hasFilters
      ? 'Ajusta el filtro de estado para ver más membresías.'
      : 'Asigna una membresía a un cliente para registrarlo como socio.';
  }
}
