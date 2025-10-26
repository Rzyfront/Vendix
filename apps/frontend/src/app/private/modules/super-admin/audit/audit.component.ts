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
} from './components/index';

// Import components from shared
import {
  TableComponent,
  TableColumn,
  TableAction,
  InputsearchComponent,
  IconComponent,
  ButtonComponent,
  DialogService,
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
    { key: 'user_name', label: 'Usuario', sortable: true },
    { key: 'user_email', label: 'Email', sortable: true },
    {
      key: 'action',
      label: 'Acción',
      sortable: true,
      badge: true,
      badgeConfig: {
        type: 'status',
        size: 'sm',
      },
      transform: (value: AuditAction) => this.getActionDisplay(value).text,
    },
    {
      key: 'resource',
      label: 'Recurso',
      sortable: true,
      transform: (value: AuditResource) => this.getResourceDisplay(value),
    },
    { key: 'resource_id', label: 'ID Recurso', sortable: false },
    { key: 'organization_name', label: 'Organización', sortable: true },
    { key: 'store_name', label: 'Tienda', sortable: true },
    { key: 'ip_address', label: 'IP', sortable: false },
    {
      key: 'created_at',
      label: 'Fecha',
      sortable: true,
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

  // Filter options
  actionOptions = [
    { value: '', label: 'Todas las acciones' },
    { value: AuditAction.CREATE, label: 'Crear' },
    { value: AuditAction.UPDATE, label: 'Actualizar' },
    { value: AuditAction.DELETE, label: 'Eliminar' },
    { value: AuditAction.LOGIN, label: 'Login' },
    { value: AuditAction.LOGOUT, label: 'Logout' },
    { value: AuditAction.READ, label: 'Lectura' },
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
    private dialogService: DialogService,
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
    this.dialogService.confirm({
      title: 'Detalles del Log de Auditoría',
      message: this.formatLogDetails(log),
      confirmText: 'Cerrar',
      cancelText: '',
      // showCancel: false,
      // size: 'lg',
    });
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
        return { text: 'Crear', class: 'bg-green-100 text-green-800' };
      case AuditAction.UPDATE:
        return { text: 'Actualizar', class: 'bg-blue-100 text-blue-800' };
      case AuditAction.DELETE:
        return { text: 'Eliminar', class: 'bg-red-100 text-red-800' };
      case AuditAction.LOGIN:
        return { text: 'Login', class: 'bg-purple-100 text-purple-800' };
      case AuditAction.LOGOUT:
        return { text: 'Logout', class: 'bg-gray-100 text-gray-800' };
      case AuditAction.READ:
        return { text: 'Lectura', class: 'bg-yellow-100 text-yellow-800' };
      default:
        return { text: 'Desconocido', class: 'bg-gray-100 text-gray-800' };
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

  formatLogDetails(log: AuditLog): string {
    return `
      <div class="space-y-2">
        <div><strong>Usuario:</strong> ${log.user_name} (${log.user_email})</div>
        <div><strong>Acción:</strong> ${this.getActionDisplay(log.action).text}</div>
        <div><strong>Recurso:</strong> ${this.getResourceDisplay(log.resource)}</div>
        <div><strong>ID Recurso:</strong> ${log.resource_id}</div>
        <div><strong>Organización:</strong> ${log.organization_name || 'N/A'}</div>
        <div><strong>Tienda:</strong> ${log.store_name || 'N/A'}</div>
        <div><strong>IP:</strong> ${log.ip_address}</div>
        <div><strong>User Agent:</strong> ${log.user_agent}</div>
        <div><strong>Fecha:</strong> ${this.formatDate(log.created_at)}</div>
        ${log.old_data ? `<div><strong>Datos Anteriores:</strong><pre class="mt-1 p-2 bg-gray-100 rounded text-xs">${JSON.stringify(log.old_data, null, 2)}</pre></div>` : ''}
        ${log.new_data ? `<div><strong>Datos Nuevos:</strong><pre class="mt-1 p-2 bg-gray-100 rounded text-xs">${JSON.stringify(log.new_data, null, 2)}</pre></div>` : ''}
      </div>
    `;
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
