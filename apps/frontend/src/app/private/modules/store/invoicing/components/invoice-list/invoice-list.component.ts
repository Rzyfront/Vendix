import { Component, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Store } from '@ngrx/store';
import { Observable } from 'rxjs';
import { toSignal } from '@angular/core/rxjs-interop';

import { Invoice } from '../../interfaces/invoice.interface';
import * as InvoicingActions from '../../state/actions/invoicing.actions';
import {
  selectSearch,
  selectStatusFilter,
  selectTypeFilter,
  selectInvoicesMeta,
  selectPage,
} from '../../state/selectors/invoicing.selectors';

import {
  InputsearchComponent,
  ButtonComponent,
  TableColumn,
  TableAction,
  ResponsiveDataViewComponent,
  ItemListCardConfig,
  OptionsDropdownComponent,
  FilterConfig,
  DropdownAction,
  FilterValues,
  IconComponent,
  PaginationComponent,
  EmptyStateComponent,
  CardComponent,
} from '../../../../../../shared/components/index';
import { CurrencyFormatService } from '../../../../../../shared/pipes/currency';
import { formatDateOnlyUTC } from '../../../../../../shared/utils/date.util';

@Component({
  selector: 'app-invoice-list',
  standalone: true,
  imports: [
    FormsModule,
    InputsearchComponent,
    OptionsDropdownComponent,
    ResponsiveDataViewComponent,
    PaginationComponent,
    EmptyStateComponent,
    CardComponent
],
  templateUrl: './invoice-list.component.html',
})
export class InvoiceListComponent {
  readonly invoices = input<Invoice[]>([]);
  readonly loading = input<boolean>(false);

  readonly create = output<void>();
  readonly view = output<Invoice>();
  readonly refresh = output<void>();

  private store = inject(Store);
  private currencyService = inject(CurrencyFormatService);

  // Observables from store for current filter values
  search$: Observable<string> = this.store.select(selectSearch);
  statusFilter$: Observable<string> = this.store.select(selectStatusFilter);
  typeFilter$: Observable<string> = this.store.select(selectTypeFilter);
  meta$ = this.store.select(selectInvoicesMeta);
  readonly meta = toSignal(this.meta$, { initialValue: null as any });
  page$ = this.store.select(selectPage);

  // Local tracking for template binding
  readonly searchTerm = signal('');
  readonly filterValues = signal<FilterValues>({});

  // Filter configuration for the options dropdown
  filterConfigs: FilterConfig[] = [
    {
      key: 'status',
      label: 'Estado',
      type: 'select',
      options: [
        { value: '', label: 'Todos los Estados' },
        { value: 'draft', label: 'Borrador' },
        { value: 'validated', label: 'Validada' },
        { value: 'sent', label: 'Enviada' },
        { value: 'accepted', label: 'Aceptada' },
        { value: 'rejected', label: 'Rechazada' },
        { value: 'cancelled', label: 'Cancelada' },
        { value: 'voided', label: 'Anulada' },
      ],
    },
    {
      key: 'invoice_type',
      label: 'Tipo',
      type: 'select',
      options: [
        { value: '', label: 'Todos los Tipos' },
        { value: 'sales_invoice', label: 'Factura de Venta' },
        { value: 'purchase_invoice', label: 'Factura de Compra' },
        { value: 'credit_note', label: 'Nota Crédito' },
        { value: 'debit_note', label: 'Nota Débito' },
        { value: 'export_invoice', label: 'Factura de Exportación' },
      ],
    },
  ];

  // Dropdown actions
  dropdownActions: DropdownAction[] = [
    {
      label: 'Nueva Factura',
      icon: 'plus',
      action: 'create',
      variant: 'primary',
    },
  ];

  // Table actions
  tableActions: TableAction[] = [
    {
      label: 'Ver detalle',
      icon: 'eye',
      variant: 'primary',
      action: (row: Invoice) => this.view.emit(row),
    },
  ];

  // Table columns
  columns: TableColumn[] = [
    { key: 'invoice_number', label: 'N° Factura', sortable: true, priority: 1 },
    {
      key: 'invoice_type',
      label: 'Tipo',
      priority: 2,
      transform: (val: any) => this.getTypeLabel(val),
    },
    {
      key: 'customer_name',
      label: 'Cliente',
      sortable: true,
      priority: 1,
      defaultValue: 'Sin cliente',
    },
    {
      key: 'total_amount',
      label: 'Total',
      sortable: true,
      align: 'right',
      priority: 1,
      transform: (val: any) => this.currencyService.format(Number(val) || 0),
    },
    {
      key: 'issue_date',
      label: 'Fecha',
      sortable: true,
      align: 'center',
      priority: 2,
      transform: (val: any) => (val ? formatDateOnlyUTC(val) : ''),
    },
    {
      key: 'status',
      label: 'Estado',
      align: 'center',
      priority: 1,
      badgeConfig: {
        type: 'status',
        colorMap: {
          draft: 'default',
          validated: 'info',
          sent: 'info',
          accepted: 'success',
          rejected: 'danger',
          cancelled: 'warn',
          voided: 'default',
        },
      },
      transform: (val: any) => this.getStatusLabel(val),
    },
  ];

  // Card Config for mobile
  cardConfig: ItemListCardConfig = {
    titleKey: 'invoice_number',
    subtitleTransform: (item: any) => item?.customer_name || 'Sin cliente',
    badgeKey: 'status',
    badgeConfig: {
      type: 'status',
      colorMap: {
        draft: 'default',
        validated: 'info',
        sent: 'info',
        accepted: 'success',
        rejected: 'danger',
        cancelled: 'warn',
        voided: 'default',
      },
    },
    badgeTransform: (val: any) => this.getStatusLabel(val),
    footerKey: 'total_amount',
    footerLabel: 'Total',
    footerStyle: 'prominent',
    footerTransform: (val: any) => this.currencyService.format(Number(val) || 0),
    detailKeys: [
      {
        key: 'issue_date',
        label: 'Fecha',
        icon: 'calendar',
        transform: (val: any) =>
          val ? formatDateOnlyUTC(val) : '-',
      },
      {
        key: 'invoice_type',
        label: 'Tipo',
        icon: 'file-text',
        transform: (val: any) => this.getTypeLabel(val),
      },
    ],
  };

  // Event handlers — dispatch NgRx actions instead of local state
  onSearchChange(term: string): void {
    this.searchTerm.set(term);
    this.store.dispatch(InvoicingActions.setSearch({ search: term }));
  }

  onFilterChange(values: FilterValues): void {
    this.filterValues.set({ ...values });
    const statusFilter = (values['status'] as string) || '';
    const typeFilter = (values['invoice_type'] as string) || '';
    this.store.dispatch(InvoicingActions.setStatusFilter({ statusFilter }));
    this.store.dispatch(InvoicingActions.setTypeFilter({ typeFilter }));
  }

  onClearFilters(): void {
    this.searchTerm.set('');
    this.filterValues.set({});
    this.store.dispatch(InvoicingActions.clearFilters());
  }

  onActionClick(action: string): void {
    switch (action) {
      case 'create':
        this.create.emit();
        break;
    }
  }

  onRowClick(invoice: Invoice): void {
    this.view.emit(invoice);
  }

  onPageChange(page: number): void {
    this.store.dispatch(InvoicingActions.setPage({ page }));
  }

  // Helpers
  getStatusLabel(status: string): string {
    const labels: Record<string, string> = {
      draft: 'Borrador',
      validated: 'Validada',
      sent: 'Enviada',
      accepted: 'Aceptada',
      rejected: 'Rechazada',
      cancelled: 'Cancelada',
      voided: 'Anulada',
    };
    return labels[status] || status;
  }

  getTypeLabel(type: string): string {
    const labels: Record<string, string> = {
      sales_invoice: 'Venta',
      purchase_invoice: 'Compra',
      credit_note: 'Nota Crédito',
      debit_note: 'Nota Débito',
      export_invoice: 'Exportación',
    };
    return labels[type] || type;
  }

  get hasFilters(): boolean {
    return !!(
      this.searchTerm() ||
      this.filterValues()['status'] ||
      this.filterValues()['invoice_type']
    );
  }

  getEmptyStateTitle(): string {
    return this.hasFilters
      ? 'Ninguna factura coincide con sus filtros'
      : 'No hay facturas registradas';
  }

  getEmptyStateDescription(): string {
    return this.hasFilters
      ? 'Intente ajustar sus términos de búsqueda o filtros'
      : 'Comience creando su primera factura.';
  }
}
