import { Component, inject, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';

import { CurrencyFormatService } from '../../../../../../../shared/pipes/currency';
import { CardComponent } from '../../../../../../../shared/components/card/card.component';
import { InputsearchComponent } from '../../../../../../../shared/components/inputsearch/inputsearch.component';
import { OptionsDropdownComponent } from '../../../../../../../shared/components/options-dropdown/options-dropdown.component';
import {
  FilterConfig,
  FilterValues,
  DropdownAction,
} from '../../../../../../../shared/components/options-dropdown/options-dropdown.interfaces';
import {
  ResponsiveDataViewComponent,
  TableColumn,
  TableAction,
  ItemListCardConfig,
} from '../../../../../../../shared/components/responsive-data-view/responsive-data-view.component';
import { ButtonComponent } from '../../../../../../../shared/components/button/button.component';
import { IconComponent } from '../../../../../../../shared/components/icon/icon.component';

import { EmployeeAdvance } from '../../../interfaces/payroll.interface';

@Component({
  selector: 'app-advance-list',
  standalone: true,
  imports: [
    CommonModule,
    CardComponent,
    InputsearchComponent,
    OptionsDropdownComponent,
    ResponsiveDataViewComponent,
    ButtonComponent,
    IconComponent,
  ],
  templateUrl: './advance-list.component.html',
})
export class AdvanceListComponent {
  private currencyService = inject(CurrencyFormatService);

  // Inputs
  advances = input.required<EmployeeAdvance[]>();
  loading = input<boolean>(false);

  // Outputs
  create = output<void>();
  search = output<string>();
  filter = output<FilterValues>();
  viewDetail = output<EmployeeAdvance>();
  quickApprove = output<EmployeeAdvance>();
  quickReject = output<EmployeeAdvance>();

  // Filter state
  filterValues: FilterValues = {};

  // Table columns (desktop)
  columns: TableColumn[] = [
    { key: 'advance_number', label: '# Adelanto', sortable: true },
    {
      key: 'employee',
      label: 'Empleado',
      transform: (val: any) =>
        val ? `${val.first_name} ${val.last_name}` : '-',
    },
    {
      key: 'amount_requested',
      label: 'Solicitado',
      transform: (val: any) => this.currencyService.format(Number(val) || 0),
    },
    {
      key: 'amount_approved',
      label: 'Aprobado',
      transform: (val: any) => this.currencyService.format(Number(val) || 0),
    },
    {
      key: 'amount_pending',
      label: 'Pendiente',
      transform: (val: any) => this.currencyService.format(Number(val) || 0),
    },
    {
      key: 'installments',
      label: 'Cuotas',
      transform: (val: any) => `${val || 0}`,
    },
    {
      key: 'status',
      label: 'Estado',
      badge: true,
      badgeConfig: {
        type: 'custom',
        colorMap: {
          pending: '#eab308',
          approved: '#3b82f6',
          repaying: '#a855f7',
          paid: '#22c55e',
          rejected: '#ef4444',
          cancelled: '#9ca3af',
        },
      },
      transform: (val: string) => this.getStatusLabel(val),
    },
  ];

  // Card config (mobile)
  cardConfig: ItemListCardConfig = {
    titleKey: 'advance_number',
    subtitleKey: 'employee',
    subtitleTransform: (val: any) =>
      val ? `${val.first_name} ${val.last_name}` : '-',
    badgeKey: 'status',
    badgeConfig: {
      type: 'custom',
      size: 'sm',
      colorMap: {
        pending: '#eab308',
        approved: '#3b82f6',
        repaying: '#a855f7',
        paid: '#22c55e',
        rejected: '#ef4444',
        cancelled: '#9ca3af',
      },
    },
    badgeTransform: (val: string) => this.getStatusLabel(val),
    detailKeys: [
      {
        key: 'amount_requested',
        label: 'Solicitado',
        transform: (v: any) => this.currencyService.format(Number(v) || 0),
      },
    ],
    footerKey: 'amount_pending',
    footerLabel: 'Pendiente',
    footerStyle: 'prominent',
    footerTransform: (v: any) => this.currencyService.format(Number(v) || 0),
  };

  // Actions
  actions: TableAction[] = [
    {
      label: 'Ver',
      icon: 'eye',
      variant: 'primary',
      action: (item: EmployeeAdvance) => this.viewDetail.emit(item),
    },
    {
      label: 'Aprobar',
      icon: 'check-circle',
      variant: 'success',
      show: (item: EmployeeAdvance) => item.status === 'pending',
      action: (item: EmployeeAdvance) => this.quickApprove.emit(item),
    },
    {
      label: 'Rechazar',
      icon: 'x-circle',
      variant: 'danger',
      show: (item: EmployeeAdvance) => item.status === 'pending',
      action: (item: EmployeeAdvance) => this.quickReject.emit(item),
    },
  ];

  // Filter configs
  filterConfigs: FilterConfig[] = [
    {
      key: 'status',
      label: 'Estado',
      type: 'select',
      placeholder: 'Todos',
      options: [
        { label: 'Pendiente', value: 'pending' },
        { label: 'Aprobado', value: 'approved' },
        { label: 'En Pago', value: 'repaying' },
        { label: 'Pagado', value: 'paid' },
        { label: 'Rechazado', value: 'rejected' },
        { label: 'Cancelado', value: 'cancelled' },
      ],
    },
  ];

  // Dropdown actions
  dropdownActions: DropdownAction[] = [
    {
      label: 'Nuevo Adelanto',
      icon: 'plus',
      action: 'create',
      variant: 'primary',
    },
  ];

  onSearch(term: string): void {
    this.search.emit(term);
  }

  onFilterChange(values: FilterValues): void {
    this.filterValues = values;
    this.filter.emit(values);
  }

  clearFilters(): void {
    this.filterValues = {};
    this.filter.emit({});
  }

  onActionClick(action: string): void {
    if (action === 'create') {
      this.create.emit();
    }
  }

  private getStatusLabel(status: string): string {
    const labels: Record<string, string> = {
      pending: 'Pendiente',
      approved: 'Aprobado',
      repaying: 'En Pago',
      paid: 'Pagado',
      rejected: 'Rechazado',
      cancelled: 'Cancelado',
    };
    return labels[status] || status;
  }
}
