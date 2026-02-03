import { Component, OnInit, OnDestroy, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { debounceTime, distinctUntilChanged, Subject, takeUntil, finalize } from 'rxjs';
import {
  AuditLog,
  AuditStats,
  AuditQueryDto,
  AuditLogsResponse,
  AuditAction,
  AuditResource,
} from './interfaces/audit.interface';
import { AuditService } from './services/audit.service';
import {
  AuditStatsComponent,
  AuditEmptyStateComponent,
  AuditDetailsModalComponent,
} from './components/index';

// Import components from shared
import {
  TableColumn,
  TableAction,
  InputsearchComponent,
  IconComponent,
  ButtonComponent,
  SelectorComponent,
  ToastService,
  ResponsiveDataViewComponent,
  ItemListCardConfig,
} from '../../../../shared/components/index';
import {
  FormsModule,
  ReactiveFormsModule,
  FormBuilder,
  FormGroup,
} from '@angular/forms';

@Component({
  selector: 'app-audit',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    AuditStatsComponent,
    AuditEmptyStateComponent,
    AuditDetailsModalComponent,
    ResponsiveDataViewComponent,
    InputsearchComponent,
    IconComponent,
    ButtonComponent,
    SelectorComponent,
  ],
  templateUrl: './audit.component.html',
})
export class AuditComponent implements OnInit, OnDestroy {
  private readonly auditService = inject(AuditService);
  private readonly fb = inject(FormBuilder);
  private readonly toastService = inject(ToastService);

  // Signals for state
  auditLogs = signal<AuditLog[]>([]);
  auditStats = signal<AuditStats | null>(null);
  isLoading = signal<boolean>(false);
  showCreateModal = signal<boolean>(false); // Reuse if needed, but Audit is read-only
  isDetailsModalOpen = signal<boolean>(false);
  selectedAuditLog = signal<AuditLog | null>(null);

  private readonly destroy$ = new Subject<void>();
  filterForm: FormGroup;

  // Pagination state (Signals)
  currentPage = signal<number>(1);
  pageSize = signal<number>(20);
  totalItems = signal<number>(0);
  totalPages = computed(() => Math.ceil(this.totalItems() / this.pageSize()));

  // Table configuration
  tableColumns: TableColumn[] = [
    {
      key: 'users',
      label: 'Usuario',
      sortable: true,
      priority: 1,
      transform: (value: any) =>
        value ? `${value.first_name} ${value.last_name}` : 'Sistema',
    },
    {
      key: 'action',
      label: 'Acción',
      sortable: true,
      badge: true,
      priority: 1,
      badgeConfig: {
        type: 'custom',
        size: 'sm',
        colorMap: {
          CREATE: '#10b981', // green-500
          UPDATE: '#3b82f6', // blue-500
          DELETE: '#ef4444', // red-500
          LOGIN: '#34d399',  // emerald-400
          LOGOUT: '#6b7280', // gray-500
          READ: '#f59e0b',   // amber-500
          PERMISSION_CHANGE: '#8b5cf6', // violet-500
        },
      },
      transform: (value: AuditAction) => this.getActionLabel(value),
    },
    {
      key: 'resource',
      label: 'Recurso',
      sortable: true,
      priority: 2,
      transform: (value: AuditResource) => this.getResourceDisplay(value),
    },
    {
      key: 'stores',
      label: 'Tienda',
      sortable: true,
      priority: 2,
      transform: (value: any) => value?.name || '---',
    },
    {
      key: 'ip_address',
      label: 'Dirección IP',
      sortable: true,
      priority: 3,
      transform: (value: string) => value || 'N/A',
    },
    {
      key: 'created_at',
      label: 'Fecha y Hora',
      sortable: true,
      priority: 1,
      transform: (value: string) => this.formatDate(value),
    },
  ];

  tableActions: TableAction[] = [
    {
      label: 'Detalles',
      icon: 'eye',
      action: (log: AuditLog) => this.viewLogDetails(log),
      variant: 'primary',
    },
  ];

  // Filter options
  actionOptions = [
    { value: '', label: 'Acciones' },
    { value: AuditAction.CREATE, label: 'Crear' },
    { value: AuditAction.UPDATE, label: 'Actualizar' },
    { value: AuditAction.DELETE, label: 'Eliminar' },
    { value: AuditAction.LOGIN, label: 'Login' },
    { value: AuditAction.LOGOUT, label: 'Logout' },
    { value: AuditAction.READ, label: 'Lectura' },
    { value: AuditAction.PERMISSION_CHANGE, label: 'Cambio Permisos' },
  ];

  resourceOptions = [
    { value: '', label: 'Recursos' },
    { value: AuditResource.USERS, label: 'Usuarios' },
    { value: AuditResource.ORGANIZATIONS, label: 'Organizaciones' },
    { value: AuditResource.STORES, label: 'Tiendas' },
    { value: AuditResource.ROLES, label: 'Roles' },
    { value: AuditResource.PERMISSIONS, label: 'Permisos' },
    { value: AuditResource.PRODUCTS, label: 'Productos' },
    { value: AuditResource.ORDERS, label: 'Órdenes' },
    { value: AuditResource.CATEGORIES, label: 'Categorías' },
  ];

  // Card configuration for mobile
  cardConfig: ItemListCardConfig = {
    titleKey: 'users',
    titleTransform: (value: any) =>
      value ? `${value.first_name} ${value.last_name}` : 'Sistema',
    subtitleKey: 'action',
    badgeKey: 'action',
    badgeConfig: {
      type: 'custom',
      size: 'sm',
      colorMap: {
        CREATE: '#10b981', // green-500
        UPDATE: '#3b82f6', // blue-500
        DELETE: '#ef4444', // red-500
        LOGIN: '#34d399',  // emerald-400
        LOGOUT: '#6b7280', // gray-500
        READ: '#f59e0b',   // amber-500
        PERMISSION_CHANGE: '#8b5cf6', // violet-500
      },
    },
    badgeTransform: (value: AuditAction) => this.getActionLabel(value),
    detailKeys: [
      { key: 'resource', label: 'Recurso', transform: (v) => this.getResourceDisplay(v) },
      { key: 'created_at', label: 'Fecha', transform: (v) => this.formatDate(v) },
    ],
  };

  constructor() {
    this.filterForm = this.fb.group({
      search: [''],
      action: [''],
      resource: [''],
      fromDate: [''],
      toDate: [''],
    });
  }

  ngOnInit(): void {
    this.loadAuditLogs();
    this.loadAuditStats();

    // Reactive filters
    this.filterForm.valueChanges
      .pipe(debounceTime(300), distinctUntilChanged(), takeUntil(this.destroy$))
      .subscribe(() => {
        this.currentPage.set(1);
        this.loadAuditLogs();
      });

    // Loading state from service
    this.auditService.isLoading$
      .pipe(takeUntil(this.destroy$))
      .subscribe(loading => this.isLoading.set(loading));
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  loadAuditLogs(): void {
    const filters = this.filterForm.value;
    const query: AuditQueryDto = {
      limit: this.pageSize(),
      offset: (this.currentPage() - 1) * this.pageSize(),
      action: filters.action || undefined,
      resource: filters.resource || undefined,
      fromDate: filters.fromDate || undefined,
      toDate: filters.toDate || undefined,
    };

    this.auditService.getAuditLogs(query)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response: AuditLogsResponse) => {
          this.auditLogs.set(response.logs || []);
          this.totalItems.set(response.total || 0);
        },
        error: () => {
          this.auditLogs.set([]);
          this.toastService.error('Error al cargar logs');
        }
      });
  }

  loadAuditStats(): void {
    const filters = this.filterForm.value;
    this.auditService.getAuditStats(filters.fromDate, filters.toDate)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (stats) => this.auditStats.set(stats),
        error: () => this.toastService.error('Error al cargar estadísticas')
      });
  }

  onSearchChange(searchTerm: string): void {
    this.filterForm.patchValue({ search: searchTerm });
  }

  onPageChange(page: number): void {
    this.currentPage.set(page);
    this.loadAuditLogs();
  }

  refreshAuditLogs(): void {
    this.loadAuditLogs();
    this.loadAuditStats();
  }

  viewLogDetails(log: AuditLog): void {
    this.selectedAuditLog.set(log);
    this.isDetailsModalOpen.set(true);
  }

  clearFilters(): void {
    this.filterForm.reset({
      search: '',
      action: '',
      resource: '',
      fromDate: '',
      toDate: '',
    });
  }

  getActionLabel(action: AuditAction): string {
    const map: Record<string, string> = {
      CREATE: 'Crear',
      UPDATE: 'Actualizar',
      DELETE: 'Eliminar',
      LOGIN: 'Login',
      LOGOUT: 'Logout',
      READ: 'Lectura',
      PERMISSION_CHANGE: 'Permisos',
    };
    return map[action] || action;
  }

  getResourceDisplay(resource: AuditResource): string {
    const map: Record<string, string> = {
      [AuditResource.USERS]: 'Usuarios',
      [AuditResource.ORGANIZATIONS]: 'Organizaciones',
      [AuditResource.STORES]: 'Tiendas',
      [AuditResource.ROLES]: 'Roles',
      [AuditResource.PERMISSIONS]: 'Permisos',
      [AuditResource.PRODUCTS]: 'Productos',
      [AuditResource.ORDERS]: 'Órdenes',
      [AuditResource.CATEGORIES]: 'Categorías',
    };
    return map[resource] || resource;
  }

  formatDate(dateString: string): string {
    if (!dateString) return '---';
    const date = new Date(dateString);
    return date.toLocaleString('es-ES', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  getEmptyStateTitle(): string {
    return this.hasActiveFilters() ? 'Sin resultados para la búsqueda' : 'No hay registros de auditoría';
  }

  getEmptyStateDescription(): string {
    return this.hasActiveFilters()
      ? 'Intenta ajustar los filtros para encontrar lo que buscas.'
      : 'Aún no se ha registrado actividad en el sistema.';
  }

  private hasActiveFilters(): boolean {
    const f = this.filterForm.value;
    return !!(f.search || f.action || f.resource || f.fromDate || f.toDate);
  }
}
