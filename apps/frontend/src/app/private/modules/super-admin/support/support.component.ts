import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule, FormBuilder, FormGroup } from '@angular/forms';
import { debounceTime, distinctUntilChanged, Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
import { Router } from '@angular/router';

// Import types
import {
  Ticket,
  TicketStats,
  TicketQueryDto,
  TicketStatus,
  TicketPriority,
  TicketCategory,
} from './interfaces/ticket.interface';

// Import service
import { SupportService } from './services/support.service';
import { UsersService } from '../users/services/users.service';

// Import shared components
import {
  TableColumn,
  TableAction,
  InputsearchComponent,
  ButtonComponent,
  ToastService,
  StatsComponent,
  SelectorComponent,
  ResponsiveDataViewComponent,
  ModalComponent,
  ItemListCardConfig,
  IconComponent,
} from '../../../../shared/components/index';

@Component({
  selector: 'app-support',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    InputsearchComponent,
    ButtonComponent,
    StatsComponent,
    SelectorComponent,
    ResponsiveDataViewComponent,
    ModalComponent,
    IconComponent,
  ],
  templateUrl: './support.component.html',
  styleUrls: ['./support.component.css'],
})
export class SupportComponent implements OnInit {
  private router = inject(Router);
  private supportService = inject(SupportService);
  private usersService = inject(UsersService);
  private toastService = inject(ToastService);
  private fb = inject(FormBuilder);

  // Data
  tickets: Ticket[] = [];
  users: any[] = [];
  loadingUsers = false;
  ticketStats: TicketStats = {
    total: 0,
    by_status: {},
    by_priority: {},
    by_category: {},
    overdue: 0,
    avg_resolution_time: 0,
    open_tickets: 0,
    resolved: 0,
    pending: 0,
  };

  // User search debounce
  private userSearchSubject = new Subject<string>();
  private userSearchDestroy$ = new Subject<void>();

  // UI State
  isLoading = false;
  isDeleting = false;
  searchQuery = '';
  currentPage = 1;
  pageSize = 10;
  totalItems = 0;

  // Modals
  showAssignModal = false;
  selectedTicket: Ticket | null = null;

  // Forms
  filterForm: FormGroup;
  assignForm: FormGroup;

  // Table configuration
  columns: TableColumn[] = [
    { key: 'ticket_number', label: '# Ticket', sortable: true },
    { key: 'title', label: 'Asunto', sortable: true },
    {
      key: 'organization',
      label: 'Organización',
      sortable: false,
      transform: (value: any) => value?.name || '-'
    },
    {
      key: 'store',
      label: 'Tienda',
      sortable: false,
      transform: (value: any) => value?.name || '-'
    },
    {
      key: 'priority',
      label: 'Prioridad',
      sortable: true,
      badge: true,
      badgeConfig: {
        type: 'custom',
        colorMap: {
          'P0': '#dc2626',
          'P1': '#f97316',
          'P2': '#f59e0b',
          'P3': '#22c55e',
          'P4': '#6b7280',
        }
      },
      transform: (value: any) => this.getPriorityLabel(value)
    },
    {
      key: 'status',
      label: 'Estado',
      sortable: true,
      badge: true,
      badgeConfig: {
        type: 'custom',
        colorMap: {
          'NEW': '#10b981',
          'OPEN': '#22c55e',
          'IN_PROGRESS': '#eab308',
          'WAITING_RESPONSE': '#f97316',
          'RESOLVED': '#14b8a6',
          'CLOSED': '#6b7280',
          'REOPENED': '#ef4444',
        }
      },
      transform: (value: any) => this.getStatusLabel(value)
    },
    {
      key: 'created_at',
      label: 'Creado',
      sortable: true,
      transform: (value: string) => this.formatDate(value)
    },
  ];

  actions: TableAction[] = [
    {
      label: 'Ver',
      icon: 'eye',
      variant: 'ghost',
      action: (row: any) => this.viewTicket(row),
    },
    {
      label: 'Asignar',
      icon: 'user-plus',
      variant: 'ghost',
      action: (row: any) => this.openAssignModal(row),
    },
  ];

  // Card configuration for mobile view
  cardConfig: ItemListCardConfig = {
    titleKey: 'title',
    subtitleKey: 'ticket_number',
    avatarFallbackIcon: 'ticket',
    badgeKey: 'status',
    badgeConfig: {
      type: 'custom',
      colorMap: {
        'Nuevo': '#10b981',
        'Abierto': '#22c55e',
        'En Progreso': '#eab308',
        'Esperando': '#f97316',
        'Resuelto': '#14b8a6',
        'Cerrado': '#6b7280',
        'Reabierto': '#ef4444',
      }
    },
    badgeTransform: (v: any) => this.getStatusLabel(v),
    detailKeys: [
      { key: 'organization', label: 'Organización', transform: (v: any) => v?.name || '-' },
      { key: 'store', label: 'Tienda', transform: (v: any) => v?.name || '-' },
      { key: 'priority', label: 'Prioridad', transform: (v: any) => this.getPriorityLabel(v) },
      { key: 'created_at', label: 'Creado', transform: (v: string) => this.formatDate(v) },
    ],
  };

  // Filter options
  statusOptions = [
    { value: '', label: 'Todos los estados' },
    { value: TicketStatus.NEW, label: 'Nuevo' },
    { value: TicketStatus.OPEN, label: 'Abierto' },
    { value: TicketStatus.IN_PROGRESS, label: 'En Progreso' },
    { value: TicketStatus.WAITING_RESPONSE, label: 'Esperando Respuesta' },
    { value: TicketStatus.RESOLVED, label: 'Resuelto' },
    { value: TicketStatus.CLOSED, label: 'Cerrado' },
    { value: TicketStatus.REOPENED, label: 'Reabierto' },
  ];

  priorityOptions = [
    { value: '', label: 'Todas las prioridades' },
    { value: TicketPriority.P0, label: 'P0 - Crítica' },
    { value: TicketPriority.P1, label: 'P1 - Urgente' },
    { value: TicketPriority.P2, label: 'P2 - Alta' },
    { value: TicketPriority.P3, label: 'P3 - Normal' },
    { value: TicketPriority.P4, label: 'P4 - Baja' },
  ];

  categoryOptions = [
    { value: '', label: 'Todas las categorías' },
    { value: TicketCategory.INCIDENT, label: 'Incidente' },
    { value: TicketCategory.SERVICE_REQUEST, label: 'Solicitud de Servicio' },
    { value: TicketCategory.PROBLEM, label: 'Problema' },
    { value: TicketCategory.CHANGE, label: 'Cambio' },
    { value: TicketCategory.QUESTION, label: 'Consulta' },
  ];

  private destroy$ = new Subject<void>();

  constructor() {
    this.filterForm = this.fb.group({
      status: [''],
      priority: [''],
      category: [''],
    });

    this.assignForm = this.fb.group({
      assigned_to_user_id: [null],
    });

    // Subscribe to filter changes
    this.filterForm.valueChanges
      .pipe(debounceTime(300), distinctUntilChanged(), takeUntil(this.destroy$))
      .subscribe(() => {
        this.currentPage = 1;
        this.loadTickets();
      });
  }

  ngOnInit(): void {
    this.loadStats();
    this.loadTickets();

    // Setup user search debounce
    this.userSearchSubject.pipe(
      debounceTime(400),
      distinctUntilChanged(),
      takeUntil(this.userSearchDestroy$)
    ).subscribe(searchTerm => {
      this.loadUsers(searchTerm);
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.userSearchDestroy$.next();
    this.userSearchDestroy$.complete();
  }

  loadStats(): void {
    this.supportService.getTicketStats().subscribe({
      next: (stats) => {
        this.ticketStats = stats;
      },
      error: (err) => {
        console.error('Error loading stats:', err);
      },
    });
  }

  loadTickets(): void {
    this.isLoading = true;
    const filters = this.filterForm.value;

    const queryParams: TicketQueryDto = {
      page: this.currentPage,
      limit: this.pageSize,
      search: this.searchQuery || undefined,
      status: filters.status || undefined,
      priority: filters.priority || undefined,
      category: filters.category || undefined,
    };

    this.supportService.getTickets(queryParams).subscribe({
      next: (response) => {
        this.tickets = response.data;
        this.totalItems = response.meta.total;
        this.isLoading = false;
      },
      error: (err) => {
        console.error('Error loading tickets:', err);
        this.toastService.error('Error al cargar tickets');
        this.isLoading = false;
      },
    });
  }

  onSearch(query: string): void {
    this.searchQuery = query;
    this.currentPage = 1;
    this.loadTickets();
  }

  onPageChange(page: number): void {
    this.currentPage = page;
    this.loadTickets();
  }

  viewTicket(ticket: Ticket): void {
    this.router.navigate([`/super-admin/support/tickets/${ticket.id}`]);
  }

  openAssignModal(ticket: Ticket): void {
    this.selectedTicket = ticket;
    this.showAssignModal = true;
    this.loadUsers();
  }

  loadUsers(search = ''): void {
    this.loadingUsers = true;
    this.usersService.getUsers({ search, limit: 50 }).subscribe({
      next: (response) => {
        this.users = response.data;
        this.loadingUsers = false;
      },
      error: () => {
        this.loadingUsers = false;
      },
    });
  }

  onUserSearch(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.userSearchSubject.next(input.value);
  }

  selectUser(userId: number): void {
    this.assignForm.patchValue({ assigned_to_user_id: userId });
  }

  assignTicket(): void {
    if (!this.selectedTicket) return;

    const assigned_to_user_id = this.assignForm.get('assigned_to_user_id')?.value;
    if (!assigned_to_user_id) {
      this.toastService.error('Selecciona un usuario para asignar');
      return;
    }

    this.supportService.assignTicket(this.selectedTicket.id, { assigned_to_user_id }).subscribe({
      next: () => {
        this.toastService.success('Ticket asignado correctamente');
        this.showAssignModal = false;
        this.assignForm.reset();
        this.loadTickets();
      },
      error: (err) => {
        console.error('Error assigning ticket:', err);
        this.toastService.error('Error al asignar ticket');
      },
    });
  }

  getStatusLabel(status: TicketStatus): string {
    const labels: Record<TicketStatus, string> = {
      [TicketStatus.NEW]: 'Nuevo',
      [TicketStatus.OPEN]: 'Abierto',
      [TicketStatus.IN_PROGRESS]: 'En Progreso',
      [TicketStatus.WAITING_RESPONSE]: 'Esperando',
      [TicketStatus.RESOLVED]: 'Resuelto',
      [TicketStatus.CLOSED]: 'Cerrado',
      [TicketStatus.REOPENED]: 'Reabierto',
    };
    return labels[status] || status;
  }

  getStatusBadgeClass(status: TicketStatus): string {
    const classes: Record<TicketStatus, string> = {
      [TicketStatus.NEW]: 'bg-emerald-100 text-emerald-700',
      [TicketStatus.OPEN]: 'bg-green-100 text-green-700',
      [TicketStatus.IN_PROGRESS]: 'bg-yellow-100 text-yellow-700',
      [TicketStatus.WAITING_RESPONSE]: 'bg-orange-100 text-orange-700',
      [TicketStatus.RESOLVED]: 'bg-teal-100 text-teal-700',
      [TicketStatus.CLOSED]: 'bg-gray-100 text-gray-700',
      [TicketStatus.REOPENED]: 'bg-red-100 text-red-700',
    };
    return classes[status] || 'bg-gray-100 text-gray-700';
  }

  getPriorityLabel(priority: TicketPriority): string {
    const labels: Record<TicketPriority, string> = {
      [TicketPriority.P0]: 'Crítica',
      [TicketPriority.P1]: 'Urgente',
      [TicketPriority.P2]: 'Alta',
      [TicketPriority.P3]: 'Normal',
      [TicketPriority.P4]: 'Baja',
    };
    return labels[priority] || 'Normal';
  }

  getPriorityBadgeClass(priority: TicketPriority): string {
    const classes: Record<TicketPriority, string> = {
      [TicketPriority.P0]: 'bg-red-100 text-red-700',
      [TicketPriority.P1]: 'bg-orange-100 text-orange-700',
      [TicketPriority.P2]: 'bg-yellow-100 text-yellow-700',
      [TicketPriority.P3]: 'bg-emerald-100 text-emerald-700',
      [TicketPriority.P4]: 'bg-gray-100 text-gray-700',
    };
    return classes[priority] || 'bg-gray-100 text-gray-700';
  }

  formatDate(dateString: string): string {
    const date = new Date(dateString);
    return date.toLocaleDateString('es-ES', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  }

  canCloseTicket(ticket: Ticket): boolean {
    return ticket.status !== TicketStatus.CLOSED && ticket.status !== TicketStatus.RESOLVED;
  }

  canAssignTicket(ticket: Ticket): boolean {
    return ticket.status !== TicketStatus.CLOSED;
  }
}
