import { Component, OnInit, OnDestroy, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { debounceTime, distinctUntilChanged, Subject, takeUntil } from 'rxjs';
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
  TableComponent,
  TableColumn,
  TableAction,
  InputsearchComponent,
  IconComponent,
  ButtonComponent,
  ToastService,
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
    TableComponent,
    InputsearchComponent,
    IconComponent,
    ButtonComponent,
  ],
  templateUrl: './audit.component.html',
  styleUrls: ['./audit.component.css'],
})
export class AuditComponent implements OnInit, OnDestroy {
  auditLogs: AuditLog[] = [];
  auditStats: AuditStats | null = null;
  isLoading = false;
  searchSubject = new Subject<string>();
  showFiltersDropdown = false;
  private destroy$ = new Subject<void>();

  // Form for filters
  filterForm: FormGroup;

  // Table configuration
  tableColumns: TableColumn[] = [
    {
      key: 'users',
      label: 'Usuario',
      sortable: true,
      priority: 1,
      transform: (value: any) =>
        value ? `${value.first_name} ${value.last_name}` : 'N/A',
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
          CREATE: '#22c55e',
          UPDATE: '#3b82f6',
          DELETE: '#ef4444',
          LOGIN: '#10b981',
          LOGOUT: '#6b7280',
          READ: '#f59e0b',
          PERMISSION_CHANGE: '#8b5cf6',
        },
      },
      transform: (value: AuditAction) => this.getActionDisplay(value).text,
    },
    {
      key: 'resource',
      label: 'Recurso',
      sortable: true,
      priority: 2,
      transform: (value: AuditResource) => this.getResourceDisplay(value),
    },

    {
      key: 'users',
      label: 'Organización',
      sortable: true,
      priority: 2,
      transform: (value: any) =>
        value?.organization_id ? `Org ${value.organization_id}` : 'N/A',
    },
    {
      key: 'stores',
      label: 'Tienda',
      sortable: true,
      priority: 2,
      transform: (value: any) => value?.name || 'N/A',
    },
    {
      key: 'ip_address',
      label: 'IP',
      sortable: true,
      priority: 3,
      transform: (value: string) => value || 'N/A',
    },
    {
      key: 'created_at',
      label: 'Fecha',
      sortable: true,
      priority: 3,
      transform: (value: string) => this.formatDate(value),
    },
  ];

  tableActions: TableAction[] = [
    {
      label: 'Ver Detalles',
      icon: 'eye',
      action: (log: AuditLog) => this.viewLogDetails(log),
      variant: 'primary',
    },
  ];

  // Pagination
  pagination = {
    page: 1,
    limit: 20,
    total: 0,
    totalPages: 0,
  };

  // Audit Details Modal state
  isDetailsModalOpen = false;
  selectedAuditLog: AuditLog | null = null;

  // Filter options
  actionOptions = [
    { value: '', label: 'Todas las acciones' },
    { value: AuditAction.CREATE, label: 'Crear' },
    { value: AuditAction.UPDATE, label: 'Actualizar' },
    { value: AuditAction.DELETE, label: 'Eliminar' },
    { value: AuditAction.LOGIN, label: 'Login' },
    { value: AuditAction.LOGOUT, label: 'Logout' },
    { value: AuditAction.READ, label: 'Lectura' },
    { value: AuditAction.PERMISSION_CHANGE, label: 'Cambio Permisos' },
  ];

  resourceOptions = [
    { value: '', label: 'Todos los recursos' },
    { value: AuditResource.USERS, label: 'Usuarios' },
    { value: AuditResource.ORGANIZATIONS, label: 'Organizaciones' },
    { value: AuditResource.STORES, label: 'Tiendas' },
    { value: AuditResource.ROLES, label: 'Roles' },
    { value: AuditResource.PERMISSIONS, label: 'Permisos' },
    { value: AuditResource.PRODUCTS, label: 'Productos' },
    { value: AuditResource.ORDERS, label: 'Órdenes' },
    { value: AuditResource.CATEGORIES, label: 'Categorías' },
  ];

  constructor(
    private auditService: AuditService,
    private fb: FormBuilder,
    private toastService: ToastService,
  ) {
    this.filterForm = this.fb.group({
      search: [''],
      action: [''],
      resource: [''],
      userId: [''],
      storeId: [''],
      organizationId: [''],
      fromDate: [''],
      toDate: [''],
    });

    // Setup search debounce
    this.searchSubject
      .pipe(debounceTime(300), distinctUntilChanged(), takeUntil(this.destroy$))
      .subscribe((searchTerm: string) => {
        this.filterForm.patchValue(
          { search: searchTerm },
          { emitEvent: false },
        );
        this.pagination.page = 1;
        this.loadAuditLogs();
      });
  }

  ngOnInit(): void {
    this.loadAuditLogs();
    this.loadAuditStats();

    // Subscribe to form changes
    this.filterForm.valueChanges
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => {
        this.pagination.page = 1;
        this.loadAuditLogs();
      });

    // Subscribe to service loading states
    this.auditService.isLoading
      .pipe(takeUntil(this.destroy$))
      .subscribe((loading) => {
        this.isLoading = loading;
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  toggleFiltersDropdown(): void {
    this.showFiltersDropdown = !this.showFiltersDropdown;
  }

  hasActiveFilters(): boolean {
    const filters = this.filterForm.value;
    return !!(
      filters.action ||
      filters.resource ||
      filters.fromDate ||
      filters.toDate ||
      filters.organizationId ||
      filters.storeId
    );
  }

  getActiveFiltersCount(): number {
    const filters = this.filterForm.value;
    let count = 0;
    if (filters.action) count++;
    if (filters.resource) count++;
    if (filters.fromDate) count++;
    if (filters.toDate) count++;
    if (filters.organizationId) count++;
    if (filters.storeId) count++;
    return count;
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    const target = event.target as HTMLElement;
    const dropdownElement = target.closest('.relative');

    if (!dropdownElement && this.showFiltersDropdown) {
      this.showFiltersDropdown = false;
    }
  }

  loadAuditLogs(): void {
    const filters = this.filterForm.value;
    const query: AuditQueryDto = {
      limit: this.pagination.limit,
      offset: (this.pagination.page - 1) * this.pagination.limit,
      // search: filters.search || undefined,
      action: filters.action || undefined,
      resource: filters.resource || undefined,
      userId: filters.userId || undefined,
      storeId: filters.storeId || undefined,
      organizationId: filters.organizationId || undefined,
      fromDate: filters.fromDate || undefined,
      toDate: filters.toDate || undefined,
    };

    this.auditService.getAuditLogs(query).subscribe({
      next: (response: AuditLogsResponse) => {
        this.auditLogs = response.logs || [];
        this.pagination.total = response.total || 0;
        this.pagination.totalPages = Math.ceil(response.total / response.limit);
      },
      error: (error) => {
        console.error('Error loading audit logs:', error);
        this.auditLogs = [];
        this.pagination.total = 0;
        this.pagination.totalPages = 0;
        this.toastService.error('Error al cargar los logs de auditoría');
      },
    });
  }

  loadAuditStats(): void {
    const filters = this.filterForm.value;
    this.auditService
      .getAuditStats(filters.fromDate, filters.toDate)
      .subscribe({
        next: (stats: AuditStats) => {
          this.auditStats = stats;
        },
        error: (error) => {
          console.error('Error loading audit stats:', error);
          // Establecer valores por defecto
          this.auditStats = {
            total_logs: 0,
            logs_by_action: {} as Record<AuditAction, number>,
            logs_by_resource: {} as Record<AuditResource, number>,
            logs_by_user: [],
            logs_by_day: [],
          };
        },
      });
  }

  onSearchChange(searchTerm: string): void {
    this.searchSubject.next(searchTerm);
  }

  onPageChange(page: number): void {
    this.pagination.page = page;
    this.loadAuditLogs();
  }

  onSortChange(event: {
    column: string;
    direction: 'asc' | 'desc' | null;
  }): void {
    // TODO: Implement sorting logic
    console.log('Sort changed:', event.column, event.direction);
    this.loadAuditLogs();
  }

  refreshAuditLogs(): void {
    this.loadAuditLogs();
    this.loadAuditStats();
  }

  viewLogDetails(log: AuditLog): void {
    this.selectedAuditLog = log;
    this.isDetailsModalOpen = true;
  }

  clearFilters(): void {
    this.filterForm.reset({
      search: '',
      action: '',
      resource: '',
      userId: '',
      storeId: '',
      organizationId: '',
      fromDate: '',
      toDate: '',
    });
  }

  getActionDisplay(action: AuditAction): { text: string; class: string } {
    switch (action) {
      case AuditAction.CREATE:
        return {
          text: 'Crear',
          class:
            'bg-green-50 text-green-700 border border-green-200 font-medium',
        };
      case AuditAction.UPDATE:
        return {
          text: 'Actualizar',
          class: 'bg-blue-50 text-blue-700 border border-blue-200 font-medium',
        };
      case AuditAction.DELETE:
        return {
          text: 'Eliminar',
          class: 'bg-red-50 text-red-700 border border-red-200 font-medium',
        };
      case AuditAction.LOGIN:
        return {
          text: 'Login',
          class:
            'bg-emerald-50 text-emerald-700 border border-emerald-200 font-medium',
        };
      case AuditAction.LOGOUT:
        return {
          text: 'Logout',
          class:
            'bg-slate-50 text-slate-700 border border-slate-200 font-medium',
        };
      case AuditAction.READ:
        return {
          text: 'Lectura',
          class:
            'bg-amber-50 text-amber-700 border border-amber-200 font-medium',
        };
      case AuditAction.PERMISSION_CHANGE:
        return {
          text: 'Cambio Permisos',
          class:
            'bg-violet-50 text-violet-700 border border-violet-200 font-medium',
        };
      default:
        return {
          text: 'Desconocido',
          class: 'bg-gray-50 text-gray-700 border border-gray-200 font-medium',
        };
    }
  }

  getResourceDisplay(resource: AuditResource): string {
    const resourceMap: Record<AuditResource, string> = {
      [AuditResource.USERS]: 'Usuarios',
      [AuditResource.ORGANIZATIONS]: 'Organizaciones',
      [AuditResource.STORES]: 'Tiendas',
      [AuditResource.ROLES]: 'Roles',
      [AuditResource.PERMISSIONS]: 'Permisos',
      [AuditResource.PRODUCTS]: 'Productos',
      [AuditResource.ORDERS]: 'Órdenes',
      [AuditResource.CATEGORIES]: 'Categorías',
    };
    return resourceMap[resource] || resource;
  }

  formatDate(dateString: string): string {
    const date = new Date(dateString);
    return date.toLocaleDateString('es-ES', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  onDetailsModalChange(isOpen: boolean): void {
    this.isDetailsModalOpen = isOpen;
    if (!isOpen) {
      this.selectedAuditLog = null;
    }
  }

  getEmptyStateTitle(): string {
    const filters = this.filterForm.value;
    if (filters.search || filters.action || filters.resource) {
      return 'No se encontraron logs con los filtros aplicados';
    }
    return 'No hay logs de auditoría';
  }

  getEmptyStateDescription(): string {
    const filters = this.filterForm.value;
    if (filters.search || filters.action || filters.resource) {
      return 'Intenta ajustar los términos de búsqueda o filtros';
    }
    return 'Los logs de auditoría aparecerán aquí cuando se realicen acciones en el sistema.';
  }
}
