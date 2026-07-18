import {
  Component,
  DestroyRef,
  inject,
  output,
  signal,
  computed,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import {
  TableColumn,
  TableAction,
  DialogService,
  ToastService,
  ResponsiveDataViewComponent,
  ItemListCardConfig,
  InputsearchComponent,
  OptionsDropdownComponent,
  FilterConfig,
  FilterValues,
  DropdownAction,
  ButtonComponent,
  IconComponent,
  PaginationComponent,
  EmptyStateComponent,
  CardComponent,
} from '../../../../../../shared/components/index';

import { DispatchNotesService } from '../../services/dispatch-notes.service';
import {
  STATUS_LABELS,
  STATUS_COLORS,
  DIRECTION_LABELS,
  SUBTYPE_LABELS,
  SUBTYPE_COLORS,
  SUBTYPE_BG_CLASSES,
  REASON_LABELS,
} from '../../constants/dispatch-note.constants';
import { DispatchNotePrintService } from '../../services/dispatch-note-print.service';
import {
  DispatchNote,
  DispatchNoteStatus,
  DispatchNoteDirection,
  DispatchNoteSubtype,
  DispatchNoteReason,
} from '../../interfaces/dispatch-note.interface';
import { CurrencyFormatService } from '../../../../../../shared/pipes/currency';
import { formatDateOnlyUTC } from '../../../../../../shared/utils/date.util';

@Component({
  selector: 'app-dispatch-note-list',
  standalone: true,
  imports: [
    FormsModule,
    ResponsiveDataViewComponent,
    InputsearchComponent,
    OptionsDropdownComponent,
    PaginationComponent,
    EmptyStateComponent,
    CardComponent,
  ],
  templateUrl: './dispatch-note-list.component.html',
  styleUrls: ['./dispatch-note-list.component.scss'],
})
export class DispatchNoteListComponent {
  private currencyService = inject(CurrencyFormatService);
  private dispatchNotesService = inject(DispatchNotesService);
  private printService = inject(DispatchNotePrintService);
  private dialogService = inject(DialogService);
  private toastService = inject(ToastService);
  private destroyRef = inject(DestroyRef);

  readonly viewDetail = output<DispatchNote>();
  readonly create = output<void>();
  readonly refresh = output<void>();

  // Data
  dispatch_notes = signal<DispatchNote[]>([]);
  loading = signal(false);
  total_items = signal(0);

  // Pagination
  readonly filters = signal<{ page: number; limit: number }>({ page: 1, limit: 10 });

  // Filter state
  search_term = signal('');
  selected_status = '';
  selected_direction = '';
  selected_subtype = '';
  selected_reason = '';

  // Filter configuration
  filter_configs: FilterConfig[] = [
    {
      key: 'status',
      label: 'Estado',
      type: 'select',
      options: [
        { value: '', label: 'Todos los Estados' },
        { value: 'draft', label: 'Borrador' },
        { value: 'confirmed', label: 'Confirmada' },
        { value: 'delivered', label: 'Entregada' },
        { value: 'received', label: 'Recibida' },
        { value: 'invoiced', label: 'Facturada' },
        { value: 'voided', label: 'Anulada' },
      ],
    },
    {
      key: 'direction',
      label: 'Dirección',
      type: 'select',
      options: [
        { value: '', label: 'Todas las Direcciones' },
        { value: 'outbound', label: 'Salida' },
        { value: 'inbound', label: 'Entrada' },
      ],
    },
    {
      key: 'subtype',
      label: 'Tipo',
      type: 'select',
      options: [
        { value: '', label: 'Todos los Tipos' },
        { value: 'customer_delivery', label: 'Entrega a cliente' },
        { value: 'customer_return', label: 'Devolución de cliente' },
        { value: 'transfer_out', label: 'Traslado saliente' },
        { value: 'transfer_in', label: 'Traslado entrante' },
        { value: 'purchase_receipt', label: 'Recepción de compra' },
      ],
    },
    {
      key: 'reason',
      label: 'Razón',
      type: 'select',
      options: [
        { value: '', label: 'Todas las Razones' },
        { value: 'sale', label: 'Venta' },
        { value: 'sample', label: 'Muestra' },
        { value: 'consignment', label: 'Consignación' },
        { value: 'replacement_shipment', label: 'Envío de reposición' },
        { value: 'loan', label: 'Préstamo' },
        { value: 'transfer_to_consignee', label: 'Traslado a consignatario' },
        { value: 'defective', label: 'Producto defectuoso' },
        { value: 'wrong_item', label: 'Producto equivocado' },
        { value: 'cancellation', label: 'Cancelación' },
        { value: 'warranty', label: 'Garantía' },
        { value: 'overdelivery_return', label: 'Devolución por sobre-entrega' },
        { value: 'returned_from_consignee', label: 'Retorno de consignatario' },
        { value: 'replenishment', label: 'Reabastecimiento' },
        { value: 'rebalancing', label: 'Rebalanceo' },
        { value: 'normal_purchase', label: 'Compra normal' },
        { value: 'replacement_for_damage', label: 'Reposición por daño' },
        { value: 'sample_received', label: 'Muestra recibida' },
      ],
    },
  ];

  readonly filter_values = signal<FilterValues>({});

  dropdown_actions: DropdownAction[] = [
    {
      label: 'Nueva Remisión',
      icon: 'plus',
      action: 'create',
      variant: 'primary',
    },
  ];

  // Table configuration
  table_columns: TableColumn[] = [
    {
      key: 'dispatch_number',
      label: 'No. Remision',
      sortable: true,
      width: '130px',
      priority: 1,
    },
    {
      key: 'direction',
      label: 'Dir.',
      sortable: false,
      width: '90px',
      priority: 1,
      badge: true,
      badgeConfig: {
        type: 'custom',
        size: 'sm',
        colorMap: {
          outbound: '#3b82f6',
          inbound: '#f59e0b',
        },
      },
      transform: (value: DispatchNoteDirection) =>
        DIRECTION_LABELS[value] ?? value ?? '—',
    },
    {
      key: 'subtype',
      label: 'Tipo',
      sortable: false,
      width: '130px',
      priority: 1,
      badge: true,
      badgeConfig: {
        type: 'custom',
        size: 'sm',
        colorMap: SUBTYPE_COLORS,
      },
      transform: (value: DispatchNoteSubtype) =>
        SUBTYPE_LABELS[value] ?? value ?? '—',
    },
    {
      key: 'customer_name',
      label: 'Cliente',
      sortable: true,
      defaultValue: '-',
      priority: 2,
    },
    {
      key: 'emission_date',
      label: 'Fecha',
      sortable: true,
      priority: 3,
      transform: (value: string) =>
        value ? formatDateOnlyUTC(value) : '-',
    },
    {
      key: 'agreed_delivery_date',
      label: 'Entrega Acordada',
      priority: 3,
      transform: (value: string) =>
        value ? formatDateOnlyUTC(value) : '-',
    },
    {
      key: 'grand_total',
      label: 'Total',
      align: 'right',
      priority: 1,
      transform: (value: any) => this.formatCurrency(value),
    },
    {
      key: 'dispatch_route_stops',
      label: 'Planilla',
      priority: 2,
      transform: (_value: any, row: DispatchNote) =>
        this.activeRouteLabel(row),
    },
    {
      key: 'status',
      label: 'Estado',
      badge: true,
      priority: 1,
      badgeConfig: {
        type: 'custom',
        size: 'sm',
        colorMap: STATUS_COLORS,
      },
      transform: (value: DispatchNoteStatus) => this.getStatusLabel(value),
    },
  ];

  table_actions: TableAction[] = [
    {
      label: 'Ver Detalle',
      icon: 'eye',
      action: (dn: DispatchNote) => this.viewDetail.emit(dn),
      variant: 'secondary',
    },
    {
      label: 'Confirmar',
      icon: 'check',
      action: (dn: DispatchNote) => this.confirmDispatchNote(dn),
      variant: 'primary',
      show: (dn: DispatchNote) => dn.status === 'draft',
    },
    {
      label: 'Entregar',
      icon: 'truck',
      action: (dn: DispatchNote) => this.deliverDispatchNote(dn),
      variant: 'primary',
      show: (dn: DispatchNote) => dn.status === 'confirmed' && dn.direction === 'outbound',
    },
    {
      label: 'Recibir',
      icon: 'package-check',
      action: (dn: DispatchNote) => this.receiveDispatchNote(dn),
      variant: 'primary',
      show: (dn: DispatchNote) => dn.status === 'confirmed' && dn.direction === 'inbound',
    },
    {
      label: 'Facturar',
      icon: 'file-plus',
      action: (dn: DispatchNote) => this.invoiceDispatchNote(dn),
      variant: 'primary',
      show: (dn: DispatchNote) => dn.status === 'delivered',
    },
    {
      label: 'Imprimir',
      icon: 'printer',
      action: (dn: DispatchNote) => this.printService.printDispatchNote(dn),
      variant: 'info',
      show: (dn: DispatchNote) => ['delivered', 'invoiced'].includes(dn.status),
    },
    {
      label: 'Anular',
      icon: 'x-circle',
      action: (dn: DispatchNote) => this.voidDispatchNote(dn),
      variant: 'danger',
      show: (dn: DispatchNote) => dn.status === 'confirmed',
    },
    {
      label: 'Eliminar',
      icon: 'trash-2',
      action: (dn: DispatchNote) => this.deleteDispatchNote(dn),
      variant: 'danger',
      show: (dn: DispatchNote) => dn.status === 'draft',
    },
  ];

  card_config: ItemListCardConfig = {
    titleKey: 'dispatch_number',
    titleTransform: (item: any) => `#${item.dispatch_number}`,
    subtitleTransform: (item: any) => {
      const sub = item.subtype ? (SUBTYPE_LABELS[item.subtype as DispatchNoteSubtype] ?? '') : '';
      const name = item.customer_name || (item.supplier_id ? `Proveedor #${item.supplier_id}` : 'Sin cliente');
      return sub ? `${sub} · ${name}` : name;
    },
    avatarFallbackIcon: 'file-text',
    avatarShape: 'square',
    badgeKey: 'status',
    badgeConfig: {
      type: 'custom',
      size: 'sm',
      colorMap: STATUS_COLORS,
    },
    badgeTransform: (val: any) => this.getStatusLabel(val),
    footerKey: 'grand_total',
    footerLabel: 'Total',
    footerStyle: 'prominent',
    footerTransform: (val: any) => this.formatCurrency(val),
    detailKeys: [
      {
        key: 'direction',
        label: 'Dir.',
        transform: (val: any) =>
          val ? (DIRECTION_LABELS[val as DispatchNoteDirection] ?? val) : '—',
      },
      {
        key: 'emission_date',
        label: 'Fecha',
        transform: (val: any) =>
          val ? formatDateOnlyUTC(val) : '-',
      },
      {
        key: 'agreed_delivery_date',
        label: 'Entrega',
        transform: (val: any) =>
          val ? formatDateOnlyUTC(val) : '-',
      },
      {
        key: 'dispatch_route_stops',
        label: 'Planilla',
        transform: (_val: any, item: DispatchNote) =>
          this.activeRouteLabel(item),
        icon: 'truck',
      },
    ],
  };

  constructor() {
    this.loadDispatchNotes();
  }

  loadDispatchNotes(): void {
    this.loading.set(true);

    const query: any = {
      page: this.filters().page,
      limit: this.filters().limit,
    };
    if (this.selected_status) {
      query.status = this.selected_status;
    }
    if (this.selected_direction) {
      query.direction = this.selected_direction;
    }
    if (this.selected_subtype) {
      query.subtype = this.selected_subtype;
    }
    if (this.selected_reason) {
      query.reason = this.selected_reason;
    }
    if (this.search_term()) {
      query.search = this.search_term();
    }

    this.dispatchNotesService
      .getDispatchNotes(query)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response: any) => {
          const notes = response.data || response;
          const arr = Array.isArray(notes) ? notes : [];
          this.dispatch_notes.set(arr);
          this.total_items.set(
            response.meta?.pagination?.total ??
            response.meta?.total ??
            response.pagination?.total ??
            arr.length
          );
          this.loading.set(false);
        },
        error: (error: any) => {
          console.error('Error loading dispatch notes:', error);
          this.toastService.error(
            'Error al cargar las remisiones. Por favor intenta nuevamente.',
          );
          this.loading.set(false);
        },
      });
  }

  // Pagination
  readonly totalPages = computed(
    () => Math.ceil(this.total_items() / (this.filters().limit || 10)),
  );

  onPageChange(page: number): void {
    this.filters.update((f) => ({ ...f, page }));
    this.loadDispatchNotes();
  }

  /**
   * Change the page size and reload from page 1.
   */
  onLimitChange(limit: number): void {
    this.filters.update((f) => ({ ...f, page: 1, limit }));
    this.loadDispatchNotes();
  }

  onSearchChange(term: string): void {
    this.search_term.set(term);
    this.filters.update((f) => ({ ...f, page: 1 }));
    this.loadDispatchNotes();
  }

  onFilterChange(values: FilterValues): void {
    this.filter_values.set(values);
    this.selected_status = (values['status'] as string) || '';
    this.selected_direction = (values['direction'] as string) || '';
    this.selected_subtype = (values['subtype'] as string) || '';
    this.selected_reason = (values['reason'] as string) || '';
    this.filters.update((f) => ({ ...f, page: 1 }));
    this.loadDispatchNotes();
  }

  clearFilters(): void {
    this.search_term.set('');
    this.selected_status = '';
    this.selected_direction = '';
    this.selected_subtype = '';
    this.selected_reason = '';
    this.filter_values.set({});
    this.filters.update((f) => ({ ...f, page: 1 }));
    this.loadDispatchNotes();
  }

  onActionClick(action: string): void {
    switch (action) {
      case 'create':
        this.create.emit(undefined);
        break;
    }
  }

  get hasFilters(): boolean {
    return !!(this.search_term() || this.selected_status || this.selected_direction || this.selected_subtype || this.selected_reason);
  }

  getEmptyStateTitle(): string {
    if (this.hasFilters) {
      return 'No se encontraron remisiones';
    }
    return 'No hay remisiones';
  }

  getEmptyStateDescription(): string {
    if (this.hasFilters) {
      return 'Intenta ajustar tus filtros para ver mas resultados';
    }
    return 'Comienza creando tu primera remision para despachar productos.';
  }

  // Actions
  async confirmDispatchNote(dn: DispatchNote): Promise<void> {
    const confirmed = await this.dialogService.confirm({
      title: 'Confirmar Remision',
      message: `Confirmar la remision ${dn.dispatch_number}?`,
      confirmText: 'Confirmar',
      cancelText: 'Volver',
    });
    if (!confirmed) return;

    this.dispatchNotesService
      .confirm(dn.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.toastService.success('Remision confirmada');
          this.loadDispatchNotes();
        },
        error: () => this.toastService.error('Error al confirmar la remision'),
      });
  }

  async deliverDispatchNote(dn: DispatchNote): Promise<void> {
    const confirmed = await this.dialogService.confirm({
      title: 'Marcar como Entregada',
      message: `Marcar la remision ${dn.dispatch_number} como entregada?`,
      confirmText: 'Entregar',
      cancelText: 'Volver',
    });
    if (!confirmed) return;

    this.dispatchNotesService
      .deliver(dn.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.toastService.success('Remision marcada como entregada');
          this.loadDispatchNotes();
        },
        error: () => this.toastService.error('Error al entregar la remision'),
      });
  }

  async receiveDispatchNote(dn: DispatchNote): Promise<void> {
    const confirmed = await this.dialogService.confirm({
      title: 'Recibir Remisión',
      message: `Marcar la remisión ${dn.dispatch_number} como recibida?`,
      confirmText: 'Recibir',
      cancelText: 'Volver',
    });
    if (!confirmed) return;

    this.dispatchNotesService
      .receive(dn.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.toastService.success('Remisión marcada como recibida');
          this.loadDispatchNotes();
        },
        error: () => this.toastService.error('Error al recibir la remisión'),
      });
  }

  async invoiceDispatchNote(dn: DispatchNote): Promise<void> {
    const confirmed = await this.dialogService.confirm({
      title: 'Facturar Remision',
      message: `Generar factura para la remision ${dn.dispatch_number}?`,
      confirmText: 'Facturar',
      cancelText: 'Volver',
    });
    if (!confirmed) return;

    this.dispatchNotesService
      .invoice(dn.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.toastService.success('Factura generada exitosamente');
          this.loadDispatchNotes();
        },
        error: () => this.toastService.error('Error al facturar la remision'),
      });
  }

  async voidDispatchNote(dn: DispatchNote): Promise<void> {
    const confirmed = await this.dialogService.confirm({
      title: 'Anular Remision',
      message: `Anular la remision ${dn.dispatch_number}? Esta accion no se puede deshacer.`,
      confirmText: 'Anular',
      cancelText: 'Volver',
      confirmVariant: 'danger',
    });
    if (!confirmed) return;

    this.dispatchNotesService
      .void(dn.id, { void_reason: 'Anulada por usuario' })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.toastService.success('Remision anulada');
          this.loadDispatchNotes();
        },
        error: () => this.toastService.error('Error al anular la remision'),
      });
  }

  async deleteDispatchNote(dn: DispatchNote): Promise<void> {
    const confirmed = await this.dialogService.confirm({
      title: 'Eliminar Remision',
      message: `Eliminar la remision ${dn.dispatch_number}? Esta accion no se puede deshacer.`,
      confirmText: 'Eliminar',
      cancelText: 'Cancelar',
      confirmVariant: 'danger',
    });
    if (!confirmed) return;

    this.dispatchNotesService
      .remove(dn.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.toastService.success('Remision eliminada');
          this.loadDispatchNotes();
        },
        error: () => this.toastService.error('Error al eliminar la remision'),
      });
  }

  // Helpers
  formatCurrency(value: any): string {
    const num_value =
      typeof value === 'string' ? parseFloat(value) : value || 0;
    return this.currencyService.format(num_value);
  }

  getStatusLabel(status: DispatchNoteStatus): string {
    return STATUS_LABELS[status] || status;
  }

  /** Active assignment of a dispatch note to a dispatch route. Returns the
   *  non-released stop with the parent route summary, or `null` if the note
   *  is not currently assigned (e.g. confirmed and waiting to be assigned
   *  to a planilla, or fully released and never reassigned). */
  activeRoute(dn: DispatchNote): {
    stop_id: number;
    route_id: number;
    route_number: string;
    route_code?: string | null;
    stop_sequence: number;
    route_status: string;
  } | null {
    if (!dn.dispatch_route_stops || dn.dispatch_route_stops.length === 0) {
      return null;
    }
    const active = dn.dispatch_route_stops.find(
      (s) => s.status !== 'released',
    );
    if (!active || !active.route) return null;
    return {
      stop_id: active.id,
      route_id: active.route.id,
      route_number: active.route.route_number,
      route_code: active.route.route_code,
      stop_sequence: active.stop_sequence,
      route_status: active.route.status,
    };
  }

  activeRouteLabel(dn: DispatchNote): string {
    const a = this.activeRoute(dn);
    return a ? a.route_number : '—';
  }

  /** Returns a clickable HTML string for the table cell. We bypass the
   *  component template (ResponsiveDataView renders plain text from
   *  `transform`) and surface the chip via a small event hook on row
   *  click. Keeping it as a string here means we still render something
   *  sensible when the user doesn't click. */
  // activeRouteCell kept for the card-view path below
}
