import {
  Component,
  computed,
  DestroyRef,
  inject,
  OnInit,
  signal,
  TemplateRef,
  ViewChild,
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
import { formatDateOnlyUTC } from '../../../../../../../shared/utils/date.util';

import {
  GymMembership,
  GymMembershipStatus,
  GYM_MEMBERSHIP_STATUS_COLORS,
  GYM_MEMBERSHIP_STATUS_LABELS,
} from '../../interfaces';
import { MemberBulkScannerService } from '../../services/member-bulk-scanner.service';
import { CommitMemberRosterDto } from '../../interfaces/member-bulk-scanner.interface';
import { MembershipsService } from '../../services';
import { MemberBulkScannerModalComponent } from '../../components/member-bulk-scanner/member-bulk-scanner-modal.component';
import { MembershipProgressComponent } from '../../components/membership-progress/membership-progress.component';
import { membershipProgress } from '../../utils/membership-progress.util';

interface MembersStats {
  total: number;
  active: number;
  pending: number;
  expired: number;
}

@Component({
  selector: 'app-membership-members-list-page',
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
    MemberBulkScannerModalComponent,
    MembershipProgressComponent,
  ],
  templateUrl: './members-list-page.component.html',
})
export class MembershipMembersListPageComponent implements OnInit {
  private readonly membershipsService = inject(MembershipsService);
  private readonly bulkScanner = inject(MemberBulkScannerService);
  private readonly toastService = inject(ToastService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  readonly memberships = signal<GymMembership[]>([]);
  readonly stats = signal<MembersStats>({ total: 0, active: 0, pending: 0, expired: 0 });

  readonly filters = signal({ page: 1, limit: 10 });
  readonly totalItems = signal(0);
  readonly isLoading = signal(false);

  readonly searchTerm = signal('');
  readonly statusFilter = signal<GymMembershipStatus | 'all'>('all');
  /** Drives the bulk-import modal visibility. Server-side permission
   *  (`store:memberships:bulk_import`) is the real gate; we surface the
   *  trigger to any user with `store:memberships:read`. */
  readonly showBulkScanner = signal(false);
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
      label: 'Carga masiva (IA)',
      icon: 'scan-line',
      action: 'bulk_scan',
    },
    {
      label: 'Asignar Membresía',
      icon: 'plus',
      action: 'create',
      variant: 'primary',
    },
  ]);

  @ViewChild('progressTpl', { static: true })
  progressTpl!: TemplateRef<any>;

  readonly tableColumns = computed<TableColumn[]>(() => [
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
        row.plan?.name ?? `Plan #${row.plan_id}`,
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
      key: 'progress',
      label: 'Progreso',
      sortable: false,
      priority: 2,
      template: this.progressTpl,
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
  ]);

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
      row.plan?.name ?? `Plan #${row.plan_id}`,
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
      {
        key: 'progress',
        label: 'Progreso',
        icon: 'trending-up',
        progressTransform: (item: GymMembership) => {
          const p = membershipProgress(item.period_start, item.period_end);
          if (!p.hasRange) return null;
          return {
            percent: p.percent,
            label: `${p.elapsedDays}/${p.totalDays} días`,
            color: GYM_MEMBERSHIP_STATUS_COLORS[item.status] ?? '#16a34a',
          };
        },
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

  statusColorForRow(row: GymMembership): string {
    return GYM_MEMBERSHIP_STATUS_COLORS[row.status] ?? '#6b7280';
  }

  loadMemberships(): void {
    this.isLoading.set(true);

    const query: Record<string, unknown> = {
      page: this.filters().page,
      limit: this.filters().limit,
    };
    if (this.statusFilter() !== 'all') query['status'] = this.statusFilter();
    if (this.searchTerm()) query['search'] = this.searchTerm();

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
      expired: list.filter((m) => m.status === 'expired').length,
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

  onSearch(term: string): void {
    this.searchTerm.set(term);
    this.filters.update((f) => ({ ...f, page: 1 }));
    this.loadMemberships();
  }

  clearFilters(): void {
    this.searchTerm.set('');
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
    else if (action === 'bulk_scan') this.showBulkScanner.set(true);
  }

  assignMembership(): void {
    this.router.navigate(['/admin/memberships/members/new']);
  }

  /**
   * Modal emits the validated DTO; we hand it off to the scanner service,
   * surface a toast with the per-row counters, and refresh the list so the
   * new (and reused) memberships appear. The modal stays mounted and self-
   * resets via its own `(close)` listener; we just close on success.
   */
  onBulkCommit(dto: CommitMemberRosterDto): void {
    this.bulkScanner
      .commitRoster(dto)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          const data = response?.data;
          if (!data) {
            this.toastService.error('Respuesta inesperada del servidor');
            return;
          }

          // Plan creation is atomic on the backend: if any plan failed, NO
          // member row was persisted. Report and let the user retry.
          if (data.plan_errors?.length) {
            this.toastService.error(
              `No se creó nada: ${data.plan_errors.length} plan(es) con error. Corrige los planes e intenta de nuevo.`,
              'Carga masiva',
            );
            return;
          }

          const succeeded = data.succeeded ?? 0;
          const failed = data.failed ?? 0;
          const plansCreated = dto.plans.filter(
            (p) => p.status === 'new',
          ).length;

          if (failed === 0) {
            this.toastService.success(
              `Importación completa: ${succeeded} socios creados` +
                (plansCreated ? `, ${plansCreated} planes nuevos.` : '.'),
              'Carga masiva',
            );
          } else {
            this.toastService.warning(
              `Importación parcial: ${succeeded} ok, ${failed} con error. Revisa los detalles.`,
              'Carga masiva',
            );
          }

          this.showBulkScanner.set(false);
          this.loadMemberships();
        },
        error: (error: unknown) => {
          const message =
            typeof error === 'string'
              ? error
              : 'Error al confirmar la carga masiva';
          this.toastService.error(message);
        },
      });
  }

  openDetail(membership: GymMembership): void {
    this.router.navigate(['/admin/memberships/members', membership.id]);
  }

  onRowClick(membership: GymMembership): void {
    this.openDetail(membership);
  }

  get hasFilters(): boolean {
    return this.searchTerm().length > 0 || this.statusFilter() !== 'all';
  }

  getEmptyStateTitle(): string {
    return this.hasFilters
      ? 'Ninguna membresía coincide con la búsqueda o el filtro'
      : 'Aún no tienes socios con membresía';
  }

  getEmptyStateDescription(): string {
    return this.hasFilters
      ? 'Ajusta la búsqueda o el filtro de estado para ver más membresías.'
      : 'Asigna una membresía a un cliente para registrarlo como socio.';
  }
}
