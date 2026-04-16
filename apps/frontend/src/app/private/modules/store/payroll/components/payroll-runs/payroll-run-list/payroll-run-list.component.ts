import { Component, Input, Output, EventEmitter, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Store } from '@ngrx/store';
import { Observable } from 'rxjs';

import { PayrollRun } from '../../../interfaces/payroll.interface';
import { CurrencyFormatService } from '../../../../../../../shared/pipes/currency/currency.pipe';
import { formatDateOnlyUTC } from '../../../../../../../shared/utils/date.util';
import * as PayrollActions from '../../../state/actions/payroll.actions';
import {
  selectPayrollRunSearch,
  selectPayrollRunStatusFilter,
  selectPayrollRunMeta,
  selectPayrollRunPage,
} from '../../../state/selectors/payroll.selectors';

import { CardComponent } from '../../../../../../../shared/components/card/card.component';
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
} from '../../../../../../../shared/components/index';

@Component({
  selector: 'app-payroll-run-list',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    CardComponent,
    InputsearchComponent,
    OptionsDropdownComponent,
    ResponsiveDataViewComponent,
    ButtonComponent,
    IconComponent,
    PaginationComponent,
  ],
  templateUrl: './payroll-run-list.component.html',
})
export class PayrollRunListComponent {
  @Input() payrollRuns: PayrollRun[] = [];
  @Input() loading = false;

  @Output() create = new EventEmitter<void>();
  @Output() detail = new EventEmitter<PayrollRun>();
  @Output() refresh = new EventEmitter<void>();

  private store = inject(Store);
  private currencyService = inject(CurrencyFormatService);

  search$: Observable<string> = this.store.select(selectPayrollRunSearch);
  statusFilter$: Observable<string> = this.store.select(
    selectPayrollRunStatusFilter,
  );
  meta$ = this.store.select(selectPayrollRunMeta);
  page$ = this.store.select(selectPayrollRunPage);

  searchTerm = '';
  filterValues: FilterValues = {};

  filterConfigs: FilterConfig[] = [
    {
      key: 'status',
      label: 'Estado',
      type: 'select',
      options: [
        { value: '', label: 'Todos los Estados' },
        { value: 'draft', label: 'Borrador' },
        { value: 'calculated', label: 'Calculada' },
        { value: 'approved', label: 'Aprobada' },
        { value: 'sent', label: 'Enviada' },
        { value: 'paid', label: 'Pagada' },
        { value: 'cancelled', label: 'Cancelada' },
      ],
    },
    {
      key: 'frequency',
      label: 'Frecuencia',
      type: 'select',
      options: [
        { value: '', label: 'Todas' },
        { value: 'monthly', label: 'Mensual' },
        { value: 'biweekly', label: 'Quincenal' },
        { value: 'weekly', label: 'Semanal' },
      ],
    },
  ];

  dropdownActions: DropdownAction[] = [];

  tableActions: TableAction[] = [
    {
      label: 'Ver Detalle',
      icon: 'eye',
      variant: 'secondary',
      action: (row: PayrollRun) => this.detail.emit(row),
    },
  ];

  columns: TableColumn[] = [
    { key: 'payroll_number', label: 'Número', sortable: true, priority: 1 },
    {
      key: 'frequency',
      label: 'Frecuencia',
      priority: 2,
      transform: (val: any) => this.getFrequencyLabel(val),
    },
    {
      key: 'period_start',
      label: 'Periodo',
      sortable: true,
      priority: 1,
      transform: (val: any, row: any) => {
        const start = val ? formatDateOnlyUTC(val) : '';
        const end = row.period_end
          ? formatDateOnlyUTC(row.period_end)
          : '';
        return `${start} - ${end}`;
      },
    },
    {
      key: 'total_net_pay',
      label: 'Neto Total',
      sortable: true,
      align: 'right',
      priority: 1,
      transform: (val: any) =>
        this.currencyService.format(Number(val) || 0),
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
          calculated: 'info',
          approved: 'success',
          sent: 'info',
          accepted: 'success',
          rejected: 'danger',
          paid: 'success',
          cancelled: 'default',
        },
      },
      transform: (val: any) => this.getStatusLabel(val),
    },
  ];

  cardConfig: ItemListCardConfig = {
    titleKey: 'payroll_number',
    subtitleTransform: (item: any) => {
      const start = item.period_start
        ? formatDateOnlyUTC(item.period_start)
        : '';
      const end = item.period_end
        ? formatDateOnlyUTC(item.period_end)
        : '';
      return `${start} - ${end}`;
    },
    badgeKey: 'status',
    badgeConfig: {
      type: 'status',
      colorMap: {
        draft: 'default',
        calculated: 'info',
        approved: 'success',
        sent: 'info',
        accepted: 'success',
        rejected: 'danger',
        paid: 'success',
        cancelled: 'default',
      },
    },
    badgeTransform: (val: any) => this.getStatusLabel(val),
    footerKey: 'total_net_pay',
    footerLabel: 'Neto Total',
    footerStyle: 'prominent',
    footerTransform: (val: any) => this.currencyService.format(Number(val) || 0),
    detailKeys: [
      {
        key: 'frequency',
        label: 'Frecuencia',
        icon: 'repeat',
        transform: (val: any) => this.getFrequencyLabel(val),
      },
    ],
  };

  onSearchChange(term: string): void {
    this.searchTerm = term;
    this.store.dispatch(PayrollActions.setPayrollRunSearch({ search: term }));
  }

  onFilterChange(values: FilterValues): void {
    this.filterValues = { ...values };
    const statusFilter = (values['status'] as string) || '';
    const frequencyFilter = (values['frequency'] as string) || '';
    if (statusFilter !== undefined) {
      this.store.dispatch(
        PayrollActions.setPayrollRunStatusFilter({ statusFilter }),
      );
    }
    if (frequencyFilter !== undefined) {
      this.store.dispatch(
        PayrollActions.setPayrollRunFrequencyFilter({ frequencyFilter }),
      );
    }
  }

  onClearFilters(): void {
    this.searchTerm = '';
    this.filterValues = {};
    this.store.dispatch(PayrollActions.clearPayrollRunFilters());
  }

  onActionClick(action: string): void {
    switch (action) {
      case 'create':
        // TODO: The 'emit' function requires a mandatory void argument
        // TODO: The 'emit' function requires a mandatory void argument
        // TODO: The 'emit' function requires a mandatory void argument
        // TODO: The 'emit' function requires a mandatory void argument
        // TODO: The 'emit' function requires a mandatory void argument
        this.create.emit();
        break;
    }
  }

  onRowClick(payrollRun: PayrollRun): void {
    this.detail.emit(payrollRun);
  }

  onPageChange(page: number): void {
    this.store.dispatch(PayrollActions.setPayrollRunPage({ page }));
  }

  getStatusLabel(status: string): string {
    const labels: Record<string, string> = {
      draft: 'Borrador',
      calculated: 'Calculada',
      approved: 'Aprobada',
      sent: 'Enviada',
      accepted: 'Aceptada',
      rejected: 'Rechazada',
      paid: 'Pagada',
      cancelled: 'Cancelada',
    };
    return labels[status] || status;
  }

  getFrequencyLabel(frequency: string): string {
    const labels: Record<string, string> = {
      monthly: 'Mensual',
      biweekly: 'Quincenal',
      weekly: 'Semanal',
    };
    return labels[frequency] || frequency;
  }

  get hasFilters(): boolean {
    return !!(
      this.searchTerm ||
      this.filterValues['status'] ||
      this.filterValues['frequency']
    );
  }

  getEmptyStateTitle(): string {
    return this.hasFilters
      ? 'Ninguna nomina coincide con sus filtros'
      : 'No hay nominas registradas';
  }

  getEmptyStateDescription(): string {
    return this.hasFilters
      ? 'Intente ajustar sus términos de búsqueda o filtros'
      : 'Comience creando su primera nómina.';
  }
}
