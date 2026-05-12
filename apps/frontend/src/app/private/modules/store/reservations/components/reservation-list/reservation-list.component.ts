import { Component, inject, viewChild, input, output, effect, signal, computed, TemplateRef } from '@angular/core';

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
  BadgeComponent,
  TooltipComponent,
} from '../../../../../../shared/components';
import { Booking, BookingStatus } from '../../interfaces/reservation.interface';
import { ReservationPrintService } from '../../services/reservation-print.service';
import { formatDateOnlyUTC } from '../../../../../../shared/utils/date.util';

@Component({
  selector: 'app-reservation-list',
  standalone: true,
imports: [
    FormsModule,
    CardComponent,
    ResponsiveDataViewComponent,
    InputsearchComponent,
    OptionsDropdownComponent,
    PaginationComponent,
    EmptyStateComponent,
    BadgeComponent,
    TooltipComponent
  ],
  templateUrl: './reservation-list.component.html',
  styleUrls: ['./reservation-list.component.scss'],
})
export class ReservationListComponent {
  private printService = inject(ReservationPrintService);

  readonly serviceTemplate = viewChild<TemplateRef<any>>('serviceTemplate');

  readonly bookings = input<Booking[]>([]);
  readonly loadingInput = input(false, { alias: 'loading' });
  private readonly internalLoading = signal(false);
  readonly loading = computed(() => this.loadingInput() || this.internalLoading());
  readonly totalItems = input(0);
  readonly page = input(1);
  readonly limit = input(10);

  readonly search = output<string>();
  readonly pageChange = output<number>();
  readonly statusFilter = output<BookingStatus | ''>();
  readonly create = output<void>();
  readonly confirm = output<Booking>();
  readonly cancel = output<Booking>();
  readonly complete = output<Booking>();
  readonly noShow = output<Booking>();
  readonly reschedule = output<Booking>();
  readonly attendConsultation = output<Booking>();

  get totalPages(): number {
    return Math.ceil(this.totalItems() / this.limit());
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
        val ? formatDateOnlyUTC(val) : '-',
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
      key: 'provider',
      label: 'Proveedor',
      priority: 2,
      transform: (val: any) =>
        val?.display_name || (val?.employee ? `${val.employee.first_name} ${val.employee.last_name}` : '\u2014'),
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
        infoIconTransform: (v: any) => v?.is_consultation ? 'stethoscope' : undefined,
        infoIconVariantTransform: (v: any) => v?.is_consultation ? 'primary' : undefined,
      },
      {
        key: 'date',
        label: 'Fecha',
        icon: 'calendar',
        transform: (v: any) =>
          v ? formatDateOnlyUTC(v) : '-',
      },
      {
        key: 'start_time',
        label: 'Hora',
        icon: 'clock',
        transform: (v: any) => (v ? v.substring(0, 5) : '-'),
      },
      {
        key: 'provider',
        label: 'Proveedor',
        icon: 'user-circle',
        transform: (v: any) =>
          v?.display_name || (v?.employee ? `${v.employee.first_name} ${v.employee.last_name}` : '\u2014'),
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
      label: 'Atender Consulta',
      icon: 'stethoscope',
      variant: 'primary',
      tooltip: 'Ir a la vista de atención de consulta',
      action: (row: any) => this.attendConsultation.emit(row),
      show: (row: any) =>
        row.product?.is_consultation && (row.status === 'confirmed' || row.status === 'in_progress'),
    },
    {
      label: 'Ver Consulta',
      icon: 'eye',
      variant: 'ghost',
      action: (row: any) => this.attendConsultation.emit(row),
      show: (row: any) =>
        row.product?.is_consultation && row.status === 'completed',
    },
    {
      label: 'Confirmar',
      icon: 'check',
      variant: 'success',
      action: (row: any) => this.confirm.emit(row),
      show: (row: any) => row.status === 'pending',
    },
    {
      label: 'Completar',
      icon: 'check-circle',
      variant: 'success',
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
    {
      label: 'Imprimir',
      icon: 'printer',
      variant: 'info',
      action: (row: any) => this.printService.printReservation(row),
      show: (row: any) => !['cancelled', 'no_show'].includes(row.status),
    },
  ];

  constructor() {
    effect(() => {
      const tpl = this.serviceTemplate();
      if (tpl) {
        const productCol = this.columns.find((col) => col.key === 'product');
        if (productCol) productCol.template = tpl;
      }
    });
  }

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
