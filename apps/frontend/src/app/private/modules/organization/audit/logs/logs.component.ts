import {
  Component,
  OnInit,
  signal,
  computed,
  inject,
  DestroyRef,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { Subscription } from 'rxjs';
import {
  AuditLog,
  AuditQueryDto,
  AuditStats,
  AuditAction,
  AuditResource,
  PaginatedAuditResponse,
} from '../interfaces/audit.interface';
import { AuditService } from '../services/audit.service';
import {
  TableColumn,
  TableAction,
  StatsComponent,
  ModalComponent,
  ButtonComponent,
  ResponsiveDataViewComponent,
  ItemListCardConfig,
  DiffViewerComponent,
  CardComponent,
  OptionsDropdownComponent,
  FilterConfig,
  DropdownAction,
  FilterValues,
  PaginationComponent,
} from '../../../../../shared/components';
import { formatDateOnlyUTC } from '../../../../../shared/utils/date.util';

interface StatItem {
  title: string;
  value: number;
  smallText: string;
  iconName: string;
  iconBgColor: string;
  iconColor: string;
}

interface PaginationState {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

@Component({
  selector: 'app-logs',
  standalone: true,
  imports: [
    CommonModule,
    StatsComponent,
    ModalComponent,
    ButtonComponent,
    ResponsiveDataViewComponent,
    DiffViewerComponent,
    CardComponent,
    OptionsDropdownComponent,
    PaginationComponent,
  ],
  templateUrl: './logs.component.html',
})
export class LogsComponent implements OnInit {
  private destroyRef = inject(DestroyRef);
  private auditService = inject(AuditService);

  readonly logs = signal<AuditLog[]>([]);
  readonly stats = signal<AuditStats | null>(null);
  readonly statsItems = signal<StatItem[]>([]);
  readonly isLoading = this.auditService.isLoading;
  private statsSubscription: Subscription | null = null;
  private logsSubscription: Subscription | null = null;

  readonly selectedLog = signal<AuditLog | null>(null);
  readonly showDetailModal = signal<boolean>(false);
  readonly filterValues = signal<FilterValues>({});
  readonly pagination = signal<PaginationState>({
    page: 1,
    limit: 10,
    total: 0,
    totalPages: 0,
  });

  readonly totalLogCount = computed(
    () => this.pagination().total || this.logs().length,
  );
  readonly hasActiveFilters = computed(() =>
    Object.values(this.filterValues()).some((value) =>
      Array.isArray(value) ? value.length > 0 : !!value,
    ),
  );

  private readonly resourceLabels: Record<AuditResource, string> = {
    [AuditResource.USERS]: 'Usuarios',
    [AuditResource.ORGANIZATIONS]: 'Organizaciones',
    [AuditResource.STORES]: 'Tiendas',
    [AuditResource.DOMAIN_SETTINGS]: 'Dominios',
    [AuditResource.PRODUCTS]: 'Productos',
    [AuditResource.ORDERS]: 'Pedidos',
    [AuditResource.AUTH]: 'Autenticación',
    [AuditResource.ROLES]: 'Roles',
    [AuditResource.PERMISSIONS]: 'Permisos',
    [AuditResource.SYSTEM]: 'Sistema',
    [AuditResource.SETTINGS]: 'Configuración',
  };

  private readonly actionLabels: Record<AuditAction, string> = {
    [AuditAction.CREATE]: 'Creación',
    [AuditAction.UPDATE]: 'Actualización',
    [AuditAction.DELETE]: 'Eliminación',
    [AuditAction.LOGIN]: 'Inicio de sesión',
    [AuditAction.LOGOUT]: 'Cierre de sesión',
    [AuditAction.PASSWORD_CHANGE]: 'Cambio de contraseña',
    [AuditAction.EMAIL_VERIFY]: 'Correo verificado',
    [AuditAction.ONBOARDING_COMPLETE]: 'Onboarding completo',
    [AuditAction.PERMISSION_CHANGE]: 'Cambio de permisos',
    [AuditAction.LOGIN_FAILED]: 'Login fallido',
    [AuditAction.ACCOUNT_LOCKED]: 'Cuenta bloqueada',
    [AuditAction.ACCOUNT_UNLOCKED]: 'Cuenta desbloqueada',
    [AuditAction.SUSPICIOUS_ACTIVITY]: 'Actividad sospechosa',
    [AuditAction.PASSWORD_RESET]: 'Restablecimiento de contraseña',
    [AuditAction.VIEW]: 'Consulta',
    [AuditAction.SEARCH]: 'Búsqueda',
  };

  resources = Object.values(AuditResource).map((resource) => ({
    value: resource,
    label: this.formatAuditResource(resource),
  }));
  actions = Object.values(AuditAction).map((action) => ({
    value: action,
    label: this.formatAuditAction(action),
  }));

  filterConfigs: FilterConfig[] = [
    {
      key: 'resource',
      label: 'Recurso',
      type: 'select',
      options: [{ value: '', label: 'Todos los recursos' }, ...this.resources],
    },
    {
      key: 'action',
      label: 'Acción',
      type: 'select',
      options: [{ value: '', label: 'Todas las acciones' }, ...this.actions],
    },
    {
      key: 'from_date',
      label: 'Desde',
      type: 'date',
      helpText: 'Fecha inicial del evento',
    },
    {
      key: 'to_date',
      label: 'Hasta',
      type: 'date',
      helpText: 'Fecha final del evento',
    },
  ];

  dropdownActions: DropdownAction[] = [
    {
      label: 'Actualizar',
      icon: 'refresh-cw',
      action: 'refresh',
    },
    {
      label: 'Exportar CSV',
      icon: 'download',
      action: 'export',
      variant: 'primary',
    },
  ];

  tableColumns: TableColumn[] = [
    {
      key: 'action',
      label: 'Acción',
      transform: (value: AuditAction) => this.formatAuditAction(value),
      badge: true,
      badgeConfig: {
        type: 'custom',
        size: 'sm',
        colorMap: {
          CREATE: '#22c55e',
          UPDATE: '#3b82f6',
          DELETE: '#ef4444',
          LOGIN: '#8b5cf6',
          LOGOUT: '#64748b',
          LOGIN_FAILED: '#f59e0b',
          ACCOUNT_LOCKED: '#ef4444',
          ACCOUNT_UNLOCKED: '#22c55e',
          SUSPICIOUS_ACTIVITY: '#ef4444',
        },
      },
      priority: 1,
    },
    {
      key: 'resource',
      label: 'Recurso',
      transform: (value: AuditResource) => this.formatAuditResource(value),
      priority: 2,
    },
    {
      key: 'users',
      label: 'Usuario',
      transform: (user: AuditLog['users']) => this.formatUserName(user),
      priority: 1,
    },
    {
      key: 'created_at',
      label: 'Fecha',
      priority: 2,
      transform: (val: string) => formatDateOnlyUTC(val),
    },
    {
      key: 'resource_id',
      label: 'ID Recurso',
      priority: 3,
      transform: (val: any) => (val ? `ID: ${val}` : '-'),
    },
  ];

  tableActions: TableAction[] = [
    {
      label: 'Ver Detalle',
      icon: 'eye',
      action: (log: AuditLog) => this.viewDetail(log),
      variant: 'info',
      tooltip: 'Ver detalle del registro',
    },
  ];

  cardConfig: ItemListCardConfig = {
    titleKey: 'action',
    titleTransform: (log: AuditLog) => this.formatAuditAction(log.action),
    subtitleKey: 'resource',
    subtitleTransform: (log: AuditLog) =>
      `${this.formatAuditResource(log.resource)}${log.resource_id ? ` #${log.resource_id}` : ''}`,
    avatarFallbackIcon: 'shield',
    avatarShape: 'square',
    badgeKey: 'action',
    badgeConfig: {
      type: 'custom',
      size: 'sm',
      colorMap: {
        CREATE: '#22c55e',
        UPDATE: '#3b82f6',
        DELETE: '#ef4444',
        LOGIN: '#8b5cf6',
        LOGOUT: '#64748b',
        LOGIN_FAILED: '#f59e0b',
        ACCOUNT_LOCKED: '#ef4444',
        ACCOUNT_UNLOCKED: '#22c55e',
        SUSPICIOUS_ACTIVITY: '#ef4444',
      },
    },
    badgeTransform: (value: AuditAction) => this.formatAuditAction(value),
    detailKeys: [
      {
        key: 'users',
        label: 'Usuario',
        icon: 'user',
        transform: (user: AuditLog['users']) => this.formatUserName(user),
      },
      {
        key: 'created_at',
        label: 'Fecha',
        icon: 'calendar',
        transform: (val: string) => formatDateOnlyUTC(val),
      },
      {
        key: 'ip_address',
        label: 'IP',
        icon: 'globe',
        transform: (value: string | undefined) => value || 'N/A',
      },
    ],
  };

  ngOnInit(): void {
    this.loadLogs();
    this.loadStats();
  }

  loadLogs(): void {
    if (this.logsSubscription) {
      this.logsSubscription.unsubscribe();
      this.logsSubscription = null;
    }

    const query: AuditQueryDto = {
      page: this.pagination().page,
      limit: this.pagination().limit,
      resource: this.getFilterString('resource') as AuditResource | undefined,
      action: this.getFilterString('action') as AuditAction | undefined,
      from_date: this.getFilterString('from_date'),
      to_date: this.getFilterString('to_date'),
    };

    this.logsSubscription = this.auditService
      .getAuditLogs(query)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response: PaginatedAuditResponse) => {
          this.logs.set(response.data || []);
          if (response.pagination) {
            this.pagination.set(response.pagination);
          }
        },
        error: (err) => {
          console.error(err);
        },
      });
  }

  loadStats(): void {
    if (this.statsSubscription) {
      this.statsSubscription.unsubscribe();
      this.statsSubscription = null;
    }

    this.statsSubscription = this.auditService
      .getAuditStats()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (stats) => {
          this.stats.set(stats);
          this.updateStatsItems();
        },
        error: (err) => {
          console.error('Error loading audit stats:', err);
        },
      });
  }

  updateStatsItems(): void {
    const stats = this.stats();
    if (!stats) return;

    const combined = stats.logs_by_action_and_resource || {};
    const byAction = stats.logs_by_action || {};
    const byResource = stats.logs_by_resource || {};

    const userChanges = this.sumCombinedCounts(combined, [
      'users',
      'roles',
      'permissions',
    ]);
    const settingsChanges = this.sumCombinedCounts(combined, [
      'settings',
      'domain_settings',
      'organizations',
      'stores',
    ]);
    const authActionEvents = this.sumCounts(byAction, [
      AuditAction.LOGIN,
      AuditAction.LOGOUT,
      AuditAction.LOGIN_FAILED,
      AuditAction.ACCOUNT_LOCKED,
      AuditAction.ACCOUNT_UNLOCKED,
      AuditAction.SUSPICIOUS_ACTIVITY,
      AuditAction.PASSWORD_RESET,
      AuditAction.PASSWORD_CHANGE,
    ]);
    const authEvents = authActionEvents || this.sumCounts(byResource, ['auth']);

    this.statsItems.set([
      {
        title: 'Eventos',
        value: stats.total_logs || 0,
        smallText: 'registros de auditoría',
        iconName: 'history',
        iconBgColor: 'bg-blue-100',
        iconColor: 'text-blue-500',
      },
      {
        title: 'Seguridad',
        value: authEvents,
        smallText: 'sesiones y alertas',
        iconName: 'shield-check',
        iconBgColor: 'bg-red-100',
        iconColor: 'text-red-500',
      },
      {
        title: 'Usuarios',
        value:
          userChanges ||
          this.sumCounts(byResource, ['users', 'roles', 'permissions']),
        smallText: 'usuarios, roles y permisos',
        iconName: 'users',
        iconBgColor: 'bg-emerald-100',
        iconColor: 'text-emerald-500',
      },
      {
        title: 'Configuración',
        value:
          settingsChanges ||
          this.sumCounts(byResource, [
            'settings',
            'domain_settings',
            'organizations',
            'stores',
          ]),
        smallText: 'ajustes críticos',
        iconName: 'settings',
        iconBgColor: 'bg-purple-100',
        iconColor: 'text-purple-500',
      },
    ]);
  }

  onPageChange(page: number): void {
    this.pagination.update((pagination) => ({ ...pagination, page }));
    this.loadLogs();
  }

  refreshLogs(): void {
    this.auditService.invalidateCache();
    this.loadLogs();
    this.loadStats();
  }

  viewDetail(log: AuditLog): void {
    this.selectedLog.set(log);
    this.showDetailModal.set(true);
  }

  closeModal(): void {
    this.showDetailModal.set(false);
    this.selectedLog.set(null);
  }

  exportLogs(): void {
    const query: AuditQueryDto = {
      resource: this.getFilterString('resource') as AuditResource | undefined,
      action: this.getFilterString('action') as AuditAction | undefined,
      from_date: this.getFilterString('from_date'),
      to_date: this.getFilterString('to_date'),
    };
    this.auditService.exportAuditLogs(query);
  }

  onFilterChange(values: FilterValues): void {
    this.filterValues.set(values);
    this.pagination.update((pagination) => ({ ...pagination, page: 1 }));
    this.loadLogs();
  }

  clearFilters(): void {
    this.filterValues.set({});
    this.pagination.update((pagination) => ({ ...pagination, page: 1 }));
    this.loadLogs();
  }

  onDropdownAction(action: string): void {
    if (action === 'refresh') {
      this.refreshLogs();
      return;
    }

    if (action === 'export') {
      this.exportLogs();
    }
  }

  hasChanges(log: AuditLog): boolean {
    return !!(log.old_values || log.new_values);
  }

  formatDateOnlyUTC(date: string): string {
    return formatDateOnlyUTC(date);
  }

  formatAuditAction(action: AuditAction | string): string {
    return this.actionLabels[action as AuditAction] || action.replace(/_/g, ' ');
  }

  formatAuditResource(resource: AuditResource | string): string {
    return this.resourceLabels[resource as AuditResource] || resource.replace(/_/g, ' ');
  }

  formatUserName(user: AuditLog['users']): string {
    return user ? `${user.first_name} ${user.last_name}` : 'Sistema';
  }

  getEmptyStateTitle(): string {
    return this.hasActiveFilters()
      ? 'No hay registros con estos filtros'
      : 'No hay registros de auditoría';
  }

  getEmptyStateDescription(): string {
    return this.hasActiveFilters()
      ? 'Limpia los filtros o actualiza la lista para revisar nuevos eventos.'
      : 'Los eventos aparecerán aquí cuando se registren cambios auditables.';
  }

  private getFilterString(key: string): string | undefined {
    const value = this.filterValues()[key];
    return typeof value === 'string' && value !== '' ? value : undefined;
  }

  private sumCounts(record: Record<string, number>, keys: string[]): number {
    return keys.reduce((total, key) => total + (record[key] || 0), 0);
  }

  private sumCombinedCounts(
    record: Record<string, number>,
    resources: string[],
  ): number {
    return resources.reduce(
      (total, resource) =>
        total +
        (record[`CREATE_${resource}`] || 0) +
        (record[`UPDATE_${resource}`] || 0) +
        (record[`DELETE_${resource}`] || 0) +
        (record[`PERMISSION_CHANGE_${resource}`] || 0),
      0,
    );
  }
}
