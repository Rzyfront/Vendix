import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { Subject, debounceTime, distinctUntilChanged, takeUntil } from 'rxjs';
import {
  AuditLog,
  AuditQueryDto,
  AuditStats,
  AuditAction,
  AuditResource,
  PaginatedAuditResponse
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
} from '../../../../../shared/components/index';

interface StatItem {
  title: string;
  value: number;
  smallText: string;
  iconName: string;
  iconBgColor: string;
  iconColor: string;
}

@Component({
  selector: 'app-logs',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    StatsComponent,
    ModalComponent,
    ButtonComponent,
    ResponsiveDataViewComponent,
  ],
  templateUrl: './logs.component.html',
})
export class LogsComponent implements OnInit, OnDestroy {
  logs: AuditLog[] = [];
  stats: AuditStats | null = null;
  statsItems: StatItem[] = [];
  isLoading = false;
  private destroy$ = new Subject<void>();

  // Track active subscriptions to prevent duplicates
  private statsSubscription: any = null;
  private logsSubscription: any = null;

  // Modal State
  selectedLog: AuditLog | null = null;
  showDetailModal = false;

  // Filter Form
  filterForm: FormGroup;

  // Enums for dropdowns
  resources = Object.values(AuditResource).map(r => ({ value: r, label: r.charAt(0).toUpperCase() + r.slice(1).replace('_', ' ') }));
  actions = Object.values(AuditAction).map(a => ({ value: a, label: a.split('_').map(w => w.charAt(0) + w.slice(1).toLowerCase()).join(' ') }));

  // Table Configuration
  tableColumns: TableColumn[] = [
    { key: 'action', label: 'Acción', transform: (val: string) => val.replace('_', ' '), priority: 1 },
    { key: 'resource', label: 'Recurso', transform: (val: string) => val.charAt(0).toUpperCase() + val.slice(1), priority: 2 },
    {
      key: 'users',
      label: 'Usuario',
      transform: (u: any) => u ? `${u.first_name} ${u.last_name}` : 'Sistema',
      priority: 1
    },
    {
      key: 'created_at',
      label: 'Fecha',
      priority: 2,
      transform: (val: string) => new Date(val).toLocaleString()
    },
    {
      key: 'resource_id',
      label: 'ID Recurso',
      priority: 3,
      transform: (val: any) => val ? `ID: ${val}` : '-'
    }
  ];

  tableActions: TableAction[] = [
    {
      label: 'Ver Detalle',
      icon: 'eye',
      action: (log: AuditLog) => this.viewDetail(log),
      variant: 'ghost'
    }
  ];

  // Card configuration for mobile
  cardConfig: ItemListCardConfig = {
    titleKey: 'action',
    titleTransform: (val: string) => val.replace('_', ' '),
    subtitleKey: 'resource',
    subtitleTransform: (val: string) => val.charAt(0).toUpperCase() + val.slice(1),
    detailKeys: [
      { key: 'users', label: 'Usuario', transform: (u: any) => u ? `${u.first_name} ${u.last_name}` : 'Sistema' },
      { key: 'created_at', label: 'Fecha', transform: (val: string) => new Date(val).toLocaleString() },
    ],
  };

  pagination = {
    page: 1,
    limit: 10,
    total: 0,
    totalPages: 0,
  };

  constructor(
    private auditService: AuditService,
    private fb: FormBuilder
  ) {
    this.filterForm = this.fb.group({
      resource: [''],
      action: ['']
    });
  }

  ngOnInit(): void {
    this.loadLogs();
    this.loadStats();

    this.filterForm.valueChanges
      .pipe(
        debounceTime(300),
        distinctUntilChanged(),
        takeUntil(this.destroy$)
      )
      .subscribe(() => {
        this.pagination.page = 1;
        this.loadLogs();
      });
  }

  ngOnDestroy(): void {
    // Cancel active subscriptions before destroying
    if (this.logsSubscription) {
      this.logsSubscription.unsubscribe();
      this.logsSubscription = null;
    }
    if (this.statsSubscription) {
      this.statsSubscription.unsubscribe();
      this.statsSubscription = null;
    }

    this.destroy$.next();
    this.destroy$.complete();
  }

  loadLogs(): void {
    // Cancel previous subscription if exists
    if (this.logsSubscription) {
      this.logsSubscription.unsubscribe();
      this.logsSubscription = null;
    }

    this.isLoading = true;
    const filters = this.filterForm.value;
    const query: AuditQueryDto = {
      page: this.pagination.page,
      limit: this.pagination.limit,
      resource: filters.resource || undefined,
      action: filters.action || undefined,
    };

    this.logsSubscription = this.auditService.getAuditLogs(query)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response: PaginatedAuditResponse) => {
          this.logs = response.data || [];
          if (response.pagination) {
            this.pagination = response.pagination;
          } else {
            // Fallback if backend doesn't send pagination meta
            this.pagination.total = 1000; // Fake total
            this.pagination.totalPages = Math.ceil(1000 / this.pagination.limit);
          }
          this.isLoading = false;
        },
        error: (err) => {
          console.error(err);
          this.isLoading = false;
        }
      });
  }

  loadStats(): void {
    // Cancel previous subscription if exists to prevent duplicates
    if (this.statsSubscription) {
      this.statsSubscription.unsubscribe();
      this.statsSubscription = null;
    }

    this.statsSubscription = this.auditService.getAuditStats()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (stats) => {
          this.stats = stats;
          this.updateStatsItems();
        },
        error: (err) => {
          console.error('Error loading audit stats:', err);
          this.statsSubscription = null;
        }
      });
  }

  updateStatsItems(): void {
    if (!this.stats) return;

    const combined = this.stats.logs_by_action_and_resource || {};

    // Para "Usuarios", solo contar cambios reales (CREATE, UPDATE, DELETE), no vistas (VIEW, SEARCH)
    const userChanges = (combined['CREATE_users'] || 0) +
      (combined['UPDATE_users'] || 0) +
      (combined['DELETE_users'] || 0);

    // Para "Cambios Config", solo contar cambios reales en settings
    const settingsChanges = (combined['CREATE_settings'] || 0) +
      (combined['UPDATE_settings'] || 0) +
      (combined['DELETE_settings'] || 0);

    this.statsItems = [
      {
        title: 'Total Eventos',
        value: this.stats.total_logs,
        smallText: 'Registrados',
        iconName: 'list',
        iconBgColor: 'bg-blue-100',
        iconColor: 'text-blue-600'
      },
      {
        title: 'Login',
        value: this.stats.logs_by_action['LOGIN'] || 0,
        smallText: 'Accesos',
        iconName: 'log-in',
        iconBgColor: 'bg-green-100',
        iconColor: 'text-green-600'
      },
      {
        title: 'Configuración',
        value: settingsChanges,
        smallText: 'Modificaciones',
        iconName: 'settings',
        iconBgColor: 'bg-orange-100',
        iconColor: 'text-orange-600'
      },
      {
        title: 'Usuarios',
        value: userChanges,
        smallText: 'Cambios en usuarios',
        iconName: 'users',
        iconBgColor: 'bg-indigo-100',
        iconColor: 'text-indigo-600'
      }
    ];
  }

  onPageChange(page: number): void {
    this.pagination.page = page;
    this.loadLogs();
  }

  refreshLogs(): void {
    this.loadLogs();
    this.loadStats();
  }

  viewDetail(log: AuditLog): void {
    this.selectedLog = log;
    this.showDetailModal = true;
  }

  closeModal(): void {
    this.showDetailModal = false;
    this.selectedLog = null;
  }

  formatJson(data: any): string {
    return JSON.stringify(data, null, 2);
  }

  hasChanges(log: AuditLog): boolean {
    return !!(log.old_values || log.new_values);
  }
}
