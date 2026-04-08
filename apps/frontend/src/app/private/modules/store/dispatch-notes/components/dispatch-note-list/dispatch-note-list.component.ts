import {
  Component,
  Output,
  EventEmitter,
  OnInit,
  OnDestroy,
  inject,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subject, takeUntil } from 'rxjs';

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
} from '../../constants/dispatch-note.constants';
import { DispatchNotePrintService } from '../../services/dispatch-note-print.service';
import {
  DispatchNote,
  DispatchNoteStatus,
} from '../../interfaces/dispatch-note.interface';
import { CurrencyFormatService } from '../../../../../../shared/pipes/currency';

@Component({
  selector: 'app-dispatch-note-list',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ResponsiveDataViewComponent,
    InputsearchComponent,
    OptionsDropdownComponent,
    ButtonComponent,
    IconComponent,
    PaginationComponent,
    EmptyStateComponent,
    CardComponent,
  ],
  templateUrl: './dispatch-note-list.component.html',
  styleUrls: ['./dispatch-note-list.component.scss'],
})
export class DispatchNoteListComponent implements OnInit, OnDestroy {
  private currencyService = inject(CurrencyFormatService);
  private dispatchNotesService = inject(DispatchNotesService);
  private printService = inject(DispatchNotePrintService);
  private dialogService = inject(DialogService);
  private toastService = inject(ToastService);

  @Output() viewDetail = new EventEmitter<DispatchNote>();
  @Output() create = new EventEmitter<void>();
  @Output() refresh = new EventEmitter<void>();

  private destroy$ = new Subject<void>();

  // Data
  dispatch_notes: DispatchNote[] = [];
  loading = false;
  total_items = 0;

  // Pagination
  filters = { page: 1, limit: 10 };

  // Filter state
  search_term = '';
  selected_status = '';

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
        { value: 'invoiced', label: 'Facturada' },
        { value: 'voided', label: 'Anulada' },
      ],
    },
  ];

  filter_values: FilterValues = {};

  dropdown_actions: DropdownAction[] = [];

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
        value ? new Date(value).toLocaleDateString() : '-',
    },
    {
      key: 'agreed_delivery_date',
      label: 'Entrega Acordada',
      priority: 3,
      transform: (value: string) =>
        value ? new Date(value).toLocaleDateString() : '-',
    },
    {
      key: 'grand_total',
      label: 'Total',
      align: 'right',
      priority: 1,
      transform: (value: any) => this.formatCurrency(value),
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
      variant: 'ghost',
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
      show: (dn: DispatchNote) => dn.status === 'confirmed',
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
      variant: 'ghost',
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
    subtitleTransform: (item: any) => item.customer_name || 'Sin cliente',
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
        key: 'emission_date',
        label: 'Fecha',
        transform: (val: any) =>
          val ? new Date(val).toLocaleDateString() : '-',
      },
      {
        key: 'agreed_delivery_date',
        label: 'Entrega',
        transform: (val: any) =>
          val ? new Date(val).toLocaleDateString() : '-',
      },
    ],
  };

  ngOnInit(): void {
    this.loadDispatchNotes();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  loadDispatchNotes(): void {
    this.loading = true;

    const query: any = {
      page: this.filters.page,
      limit: this.filters.limit,
    };
    if (this.selected_status) {
      query.status = this.selected_status;
    }
    if (this.search_term) {
      query.search = this.search_term;
    }

    this.dispatchNotesService
      .getDispatchNotes(query)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response: any) => {
          const notes = response.data || response;
          this.dispatch_notes = Array.isArray(notes) ? notes : [];
          this.total_items =
            response.meta?.pagination?.total ??
            response.meta?.total ??
            response.pagination?.total ??
            this.dispatch_notes.length;
          this.loading = false;
        },
        error: (error: any) => {
          console.error('Error loading dispatch notes:', error);
          this.toastService.error(
            'Error al cargar las remisiones. Por favor intenta nuevamente.',
          );
          this.loading = false;
        },
      });
  }

  // Pagination
  get totalPages(): number {
    return Math.ceil(this.total_items / (this.filters.limit || 10));
  }

  onPageChange(page: number): void {
    this.filters.page = page;
    this.loadDispatchNotes();
  }

  onSearchChange(term: string): void {
    this.search_term = term;
    this.filters.page = 1;
    this.loadDispatchNotes();
  }

  onFilterChange(values: FilterValues): void {
    this.filter_values = values;
    this.selected_status = (values['status'] as string) || '';
    this.filters.page = 1;
    this.loadDispatchNotes();
  }

  clearFilters(): void {
    this.search_term = '';
    this.selected_status = '';
    this.filter_values = {};
    this.filters.page = 1;
    this.loadDispatchNotes();
  }

  onActionClick(action: string): void {
    switch (action) {
      case 'create':
        this.create.emit();
        break;
    }
  }

  get hasFilters(): boolean {
    return !!(this.search_term || this.selected_status);
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
      .pipe(takeUntil(this.destroy$))
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
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.toastService.success('Remision marcada como entregada');
          this.loadDispatchNotes();
        },
        error: () => this.toastService.error('Error al entregar la remision'),
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
      .pipe(takeUntil(this.destroy$))
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
      .pipe(takeUntil(this.destroy$))
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
      .pipe(takeUntil(this.destroy$))
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
}
