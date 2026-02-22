import { Component, EventEmitter, Input, Output, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  ResponsiveDataViewComponent,
  InputsearchComponent,
  IconComponent,
  ButtonComponent,
  TableColumn,
  TableAction,
  ItemListCardConfig,
  OptionsDropdownComponent,
  FilterConfig,
  DropdownAction,
  FilterValues,
} from '../../../../../../../shared/components';
import { Ticket, TicketStatus, TicketPriority, TicketCategory } from '../../models/ticket.model';

@Component({
  selector: 'app-ticket-list',
  standalone: true,
  imports: [
    CommonModule,
    ResponsiveDataViewComponent,
    InputsearchComponent,
    OptionsDropdownComponent,
    IconComponent,
    ButtonComponent,
  ],
  template: `
    <div class="md:bg-surface md:rounded-xl md:shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:border md:border-border md:min-h-[600px]">
      <!-- Search Section (sticky on mobile) -->
      <div class="sticky top-[99px] bg-background px-2 py-1.5 -mt-[5px] md:static md:bg-transparent md:px-6 md:py-4 md:border-b md:border-border">
        <div class="flex flex-col gap-2 md:flex-row md:justify-between md:items-center md:gap-4">
          <h2 class="text-[13px] font-bold text-gray-600 tracking-wide md:text-lg md:font-semibold md:text-text-primary">
            Todos los Tickets ({{ totalItems }})
          </h2>

          <div class="flex items-center gap-2 w-full md:w-auto">
            <app-inputsearch
              class="flex-1 md:w-64 shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:shadow-none rounded-[10px]"
              size="sm"
              placeholder="Buscar tickets..."
              (search)="onSearch($event)"
            ></app-inputsearch>

            <app-options-dropdown
              class="shadow-[0_2px_8px_rgba(0,0,0,0.07)] md:shadow-none rounded-[10px]"
              [filters]="filterConfigs"
              [filterValues]="filterValues"
              [actions]="dropdownActions"
              [isLoading]="loading"
              (filterChange)="onFilterChange($event)"
              (clearAllFilters)="onClearFilters()"
              (actionClick)="onActionClick($event)"
            ></app-options-dropdown>
          </div>
        </div>
      </div>

      <!-- Loading State -->
      <div *ngIf="loading" class="p-4 md:p-6 text-center">
        <div class="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
        <p class="mt-2 text-text-secondary">Cargando tickets...</p>
      </div>

      <!-- Empty State -->
      <div *ngIf="!loading && tickets.length === 0" class="p-12 text-center text-gray-500">
        <app-icon name="ticket" [size]="48" class="mx-auto mb-4 text-gray-300"></app-icon>
        <h3 class="text-lg font-medium text-gray-900">No hay tickets aún</h3>
        <p class="mt-1">Crea tu primer ticket y te ayudaremos lo antes posible.</p>
        <div class="mt-6 flex justify-center">
          <app-button variant="primary" (clicked)="create.emit()">
            <app-icon slot="icon" name="plus" [size]="16"></app-icon>
            Crear Ticket
          </app-button>
        </div>
      </div>

      <!-- Responsive Data View -->
      <div *ngIf="!loading && tickets.length > 0" class="px-2 pb-2 pt-1 md:p-4">
        <app-responsive-data-view
          [data]="tickets"
          [columns]="columns"
          [cardConfig]="cardConfig"
          [loading]="loading"
          [hoverable]="true"
          [striped]="true"
          [emptyMessage]="'No se encontraron tickets'"
          [emptyIcon]="'ticket'"
          tableSize="md"
          (rowClick)="onRowClick($event)"
        ></app-responsive-data-view>
      </div>
    </div>
  `,
})
export class TicketListComponent implements OnInit {
  @Input() tickets: Ticket[] = [];
  @Input() loading = false;
  @Input() totalItems = 0;

  @Output() search = new EventEmitter<string>();
  @Output() filter = new EventEmitter<FilterValues>();
  @Output() create = new EventEmitter<void>();
  @Output() viewDetail = new EventEmitter<Ticket>();

  filterConfigs: FilterConfig[] = [
    {
      key: 'status',
      label: 'Estado',
      type: 'select',
      options: [
        { value: '', label: 'Todos' },
        { value: 'NEW', label: 'Nuevos' },
        { value: 'OPEN', label: 'Abiertos' },
        { value: 'IN_PROGRESS', label: 'En Progreso' },
        { value: 'WAITING_RESPONSE', label: 'Esperando Respuesta' },
        { value: 'RESOLVED', label: 'Resueltos' },
        { value: 'CLOSED', label: 'Cerrados' },
      ],
    },
    {
      key: 'priority',
      label: 'Prioridad',
      type: 'select',
      options: [
        { value: '', label: 'Todas' },
        { value: 'P0', label: 'Crítica' },
        { value: 'P1', label: 'Urgente' },
        { value: 'P2', label: 'Alta' },
        { value: 'P3', label: 'Normal' },
        { value: 'P4', label: 'Baja' },
      ],
    },
    {
      key: 'category',
      label: 'Categoría',
      type: 'select',
      options: [
        { value: '', label: 'Todas' },
        { value: 'QUESTION', label: 'Duda' },
        { value: 'SERVICE_REQUEST', label: 'Solicitud' },
        { value: 'INCIDENT', label: 'Incidente' },
        { value: 'PROBLEM', label: 'Problema' },
        { value: 'CHANGE', label: 'Cambio' },
      ],
    },
  ];

  filterValues: FilterValues = {};

  dropdownActions: DropdownAction[] = [
    { label: 'Nuevo Ticket', icon: 'plus', action: 'create', variant: 'primary' },
  ];

  columns: TableColumn[] = [
    {
      key: 'ticket_number',
      label: 'Nº',
      sortable: true,
      priority: 1,
      transform: (val: any) => `#${val}`,
    },
    { key: 'title', label: 'Asunto', sortable: true, priority: 1 },
    {
      key: 'status',
      label: 'Estado',
      sortable: true,
      priority: 2,
      badge: true,
      badgeConfig: {
        type: 'custom',
        colorMap: {
          NEW: '#3b82f6',
          OPEN: '#22c55e',
          IN_PROGRESS: '#eab308',
          WAITING_RESPONSE: '#f97316',
          RESOLVED: '#a855f7',
          CLOSED: '#6b7280',
          REOPENED: '#ef4444',
        },
        size: 'sm',
      },
      transform: (val: any) => this.getStatusLabel(val),
    },
    {
      key: 'priority',
      label: 'Prioridad',
      sortable: true,
      priority: 2,
      badge: true,
      badgeConfig: {
        type: 'custom',
        colorMap: {
          P0: '#dc2626',
          P1: '#f97316',
          P2: '#eab308',
          P3: '#3b82f6',
          P4: '#6b7280',
        },
        size: 'sm',
      },
      transform: (val: any) => this.getPriorityLabel(val),
    },
    {
      key: 'category',
      label: 'Categoría',
      priority: 3,
      transform: (val: any) => val ? this.getCategoryLabel(val) : '-',
    },
    {
      key: 'created_at',
      label: 'Creado',
      sortable: true,
      priority: 3,
      transform: (val: any) => this.formatDate(val),
    },
  ];

  cardConfig: ItemListCardConfig = {
    titleKey: 'title',
    subtitleKey: 'ticket_number',
    subtitleTransform: (v: any) => `#${v}`,
    avatarFallbackIcon: 'ticket',
    avatarShape: 'circle',
    badgeKey: 'status',
    badgeConfig: { type: 'status', size: 'sm' },
    badgeTransform: (v: any) => this.getStatusLabel(v),
    detailKeys: [
      { key: 'priority', label: 'Prioridad', transform: (v: any) => this.getPriorityLabel(v) },
      { key: 'category', label: 'Categoría', transform: (v: any) => this.getCategoryLabel(v) },
      {
        key: 'created_at',
        label: 'Creado',
        transform: (v: any) => this.formatDate(v),
      },
    ],
    footerKey: '_count.comments',
    footerLabel: 'Comentarios',
    footerStyle: 'default',
    footerTransform: (v: any) => (v ? `${v} ${v === 1 ? 'comentario' : 'comentarios'}` : 'Sin comentarios'),
  };

  actions: TableAction[] = [];

  ngOnInit(): void {}

  onSearch(query: string) {
    this.search.emit(query);
  }

  onFilterChange(values: FilterValues): void {
    this.filterValues = values;
    this.filter.emit(values);
  }

  onClearFilters(): void {
    this.filterValues = {};
    this.filter.emit({});
  }

  onActionClick(action: string): void {
    if (action === 'create') {
      this.create.emit();
    }
  }

  onRowClick(row: any): void {
    this.viewDetail.emit(row);
  }

  getStatusLabel(status: TicketStatus): string {
    const labels: Record<TicketStatus, string> = {
      NEW: 'Nuevo',
      OPEN: 'Abierto',
      IN_PROGRESS: 'En Progreso',
      WAITING_RESPONSE: 'Esperando',
      RESOLVED: 'Resuelto',
      CLOSED: 'Cerrado',
      REOPENED: 'Reabierto',
    };
    return labels[status] || status;
  }

  getPriorityLabel(priority: TicketPriority): string {
    const labels: Record<TicketPriority, string> = {
      P0: 'Crítica',
      P1: 'Urgente',
      P2: 'Alta',
      P3: 'Normal',
      P4: 'Baja',
    };
    return labels[priority] || priority;
  }

  getCategoryLabel(category: TicketCategory): string {
    const labels: Record<TicketCategory, string> = {
      QUESTION: 'Duda',
      SERVICE_REQUEST: 'Solicitud',
      INCIDENT: 'Incidente',
      PROBLEM: 'Problema',
      CHANGE: 'Cambio',
    };
    return labels[category] || category;
  }

  formatDate(dateString: string): string {
    if (!dateString) return '-';
    const date = new Date(dateString);
    const now = new Date();
    const diffTime = Math.abs(now.getTime() - date.getTime());
    const diffHours = diffTime / (1000 * 60 * 60);
    const diffDays = Math.floor(diffHours / 24);

    // Menos de 1 hora: mostrar minutos
    if (diffHours < 1) {
      const diffMinutes = Math.floor(diffTime / (1000 * 60));
      if (diffMinutes < 1) return 'Ahora mismo';
      return `Hace ${diffMinutes} min`;
    }

    // Menos de 24 horas: mostrar horas
    if (diffHours < 24) {
      return `Hace ${Math.floor(diffHours)} h`;
    }

    // 1 día
    if (diffDays === 1) return 'Ayer';

    // Menos de 7 días: mostrar días
    if (diffDays < 7) return `Hace ${diffDays} días`;

    // Formato de fecha para tickets más antiguos
    return date.toLocaleDateString('es-ES', { day: '2-digit', month: 'short' });
  }
}
