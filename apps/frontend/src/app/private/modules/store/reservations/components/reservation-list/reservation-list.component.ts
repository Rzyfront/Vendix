import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CardComponent } from '../../../../../../shared/components/card/card.component';
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
  PaginationComponent,
  EmptyStateComponent,
} from '../../../../../../shared/components';
import { Booking, BookingStatus } from '../../interfaces/reservation.interface';

@Component({
  selector: 'app-reservation-list',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    CardComponent,
    ResponsiveDataViewComponent,
    InputsearchComponent,
    OptionsDropdownComponent,
    IconComponent,
    ButtonComponent,
    PaginationComponent,
    EmptyStateComponent,
  ],
  templateUrl: './reservation-list.component.html',
  styleUrls: ['./reservation-list.component.scss'],
})
export class ReservationListComponent {
  @Input() bookings: Booking[] = [];
  @Input() loading = false;
  @Input() totalItems = 0;
  @Input() page = 1;
  @Input() limit = 10;

  @Output() search = new EventEmitter<string>();
  @Output() pageChange = new EventEmitter<number>();
  @Output() statusFilter = new EventEmitter<BookingStatus | ''>();
  @Output() create = new EventEmitter<void>();
  @Output() confirm = new EventEmitter<Booking>();
  @Output() cancel = new EventEmitter<Booking>();
  @Output() complete = new EventEmitter<Booking>();
  @Output() noShow = new EventEmitter<Booking>();
  @Output() reschedule = new EventEmitter<Booking>();

  get totalPages(): number {
    return Math.ceil(this.totalItems / this.limit);
  }

  // Filter configuration
  filterConfigs: FilterConfig[] = [
    {
      key: 'status',
      label: 'Estado',
      type: 'select',
      options: [
        { value: '', label: 'Todos' },
        { value: 'pending', label: 'Pendiente' },
        { value: 'confirmed', label: 'Confirmada' },
        { value: 'in_progress', label: 'En Progreso' },
        { value: 'completed', label: 'Completada' },
        { value: 'cancelled', label: 'Cancelada' },
        { value: 'no_show', label: 'No Show' },
      ],
    },
    {
      key: 'channel',
      label: 'Canal',
      type: 'select',
      options: [
        { value: '', label: 'Todos' },
        { value: 'pos', label: 'POS' },
        { value: 'ecommerce', label: 'E-commerce' },
        { value: 'whatsapp', label: 'WhatsApp' },
      ],
    },
  ];

  filterValues: FilterValues = {};

  dropdownActions: DropdownAction[] = [
    {
      label: 'Nueva Reserva',
      icon: 'plus',
      action: 'create',
      variant: 'primary',
    },
  ];

  columns: TableColumn[] = [
    { key: 'booking_number', label: 'N. Reserva', sortable: true, priority: 1 },
    {
      key: 'date',
      label: 'Fecha',
      sortable: true,
      priority: 1,
      transform: (val: any) =>
        val ? new Date(val + 'T00:00:00').toLocaleDateString('es-CO') : '-',
    },
    {
      key: 'start_time',
      label: 'Hora',
      priority: 1,
      transform: (val: any, row: any) => {
        if (!val) return '-';
        const start = val.substring(0, 5);
        const end = row?.end_time ? row.end_time.substring(0, 5) : '';
        return end ? `${start} - ${end}` : start;
      },
    },
    {
      key: 'product',
      label: 'Servicio',
      priority: 2,
      transform: (val: any) => val?.name || '-',
    },
    {
      key: 'customer',
      label: 'Cliente',
      priority: 1,
      transform: (val: any) =>
        val ? `${val.first_name} ${val.last_name}` : '-',
    },
    {
      key: 'status',
      label: 'Estado',
      priority: 1,
      transform: (val: any) => this.getStatusLabel(val),
    },
    {
      key: 'channel',
      label: 'Canal',
      priority: 3,
      transform: (val: any) => this.getChannelLabel(val),
    },
  ];

  cardConfig: ItemListCardConfig = {
    titleKey: 'booking_number',
    titleTransform: (item: any) => `#${item.booking_number}`,
    subtitleKey: 'customer',
    subtitleTransform: (item: any) =>
      item.customer
        ? `${item.customer.first_name} ${item.customer.last_name}`
        : 'Sin cliente',
    avatarFallbackIcon: 'calendar',
    avatarShape: 'square',
    badgeKey: 'status',
    badgeConfig: { type: 'status', size: 'sm' },
    badgeTransform: (v: any) => this.getStatusLabel(v),
    detailKeys: [
      {
        key: 'product',
        label: 'Servicio',
        icon: 'package',
        transform: (v: any) => v?.name || '-',
      },
      {
        key: 'date',
        label: 'Fecha',
        icon: 'calendar',
        transform: (v: any) =>
          v ? new Date(v + 'T00:00:00').toLocaleDateString('es-CO') : '-',
      },
      {
        key: 'start_time',
        label: 'Hora',
        icon: 'clock',
        transform: (v: any) => (v ? v.substring(0, 5) : '-'),
      },
      {
        key: 'channel',
        label: 'Canal',
        transform: (v: any) => this.getChannelLabel(v),
      },
    ],
  };

  actions: TableAction[] = [
    {
      label: 'Confirmar',
      icon: 'check',
      variant: 'ghost',
      action: (row: any) => this.confirm.emit(row),
      show: (row: any) => row.status === 'pending',
    },
    {
      label: 'Completar',
      icon: 'check-circle',
      variant: 'ghost',
      action: (row: any) => this.complete.emit(row),
      show: (row: any) =>
        row.status === 'confirmed' || row.status === 'in_progress',
    },
    {
      label: 'No Show',
      icon: 'user-x',
      variant: 'ghost',
      action: (row: any) => this.noShow.emit(row),
      show: (row: any) =>
        row.status === 'confirmed' || row.status === 'in_progress',
    },
    {
      label: 'Reprogramar',
      icon: 'refresh-cw',
      variant: 'ghost',
      action: (row: any) => this.reschedule.emit(row),
      show: (row: any) =>
        row.status === 'pending' || row.status === 'confirmed',
    },
    {
      label: 'Cancelar',
      icon: 'x',
      variant: 'danger',
      action: (row: any) => this.cancel.emit(row),
      show: (row: any) =>
        row.status === 'pending' || row.status === 'confirmed',
    },
  ];

  onSearch(query: string): void {
    this.search.emit(query);
  }

  onPageChangeAction(page: number): void {
    this.pageChange.emit(page);
  }

  onFilterChange(values: FilterValues): void {
    this.filterValues = values;
    if (values['status'] !== undefined) {
      this.statusFilter.emit((values['status'] as BookingStatus) || '');
    }
  }

  onClearFilters(): void {
    this.filterValues = {};
    this.statusFilter.emit('');
  }

  onActionClick(action: string): void {
    if (action === 'create') {
      this.create.emit();
    }
  }

  getStatusLabel(status: string): string {
    const labels: Record<string, string> = {
      pending: 'Pendiente',
      confirmed: 'Confirmada',
      in_progress: 'En Progreso',
      completed: 'Completada',
      cancelled: 'Cancelada',
      no_show: 'No Show',
    };
    return labels[status] || status;
  }

  get hasFilters(): boolean {
    return !!Object.keys(this.filterValues).some((k) => this.filterValues[k]);
  }

  getEmptyStateTitle(): string {
    return this.hasFilters
      ? 'Ninguna reserva coincide con sus filtros'
      : 'No se encontraron reservas';
  }

  getEmptyStateDescription(): string {
    return this.hasFilters
      ? 'Intente ajustar sus términos de búsqueda o filtros'
      : 'Comienza creando una nueva reserva.';
  }

  getChannelLabel(channel: string): string {
    const labels: Record<string, string> = {
      pos: 'POS',
      ecommerce: 'E-commerce',
      whatsapp: 'WhatsApp',
    };
    return labels[channel] || channel || '-';
  }
}
