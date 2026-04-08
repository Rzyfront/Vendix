import { Component, Input, Output, EventEmitter, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Store } from '@ngrx/store';
import { Observable } from 'rxjs';

import { Employee } from '../../../interfaces/payroll.interface';
import { CurrencyFormatService } from '../../../../../../../shared/pipes/currency/currency.pipe';
import * as PayrollActions from '../../../state/actions/payroll.actions';
import {
  selectEmployeeSearch,
  selectEmployeeStatusFilter,
  selectEmployeeMeta,
  selectEmployeePage,
} from '../../../state/selectors/payroll.selectors';

import { CardComponent } from '../../../../../../../shared/components/card/card.component';
import {
  InputsearchComponent,
  TableColumn,
  TableAction,
  ResponsiveDataViewComponent,
  ItemListCardConfig,
  OptionsDropdownComponent,
  FilterConfig,
  DropdownAction,
  FilterValues,
  PaginationComponent,
  EmptyStateComponent,
} from '../../../../../../../shared/components/index';

@Component({
  selector: 'app-employee-list',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    CardComponent,
    InputsearchComponent,
    OptionsDropdownComponent,
    ResponsiveDataViewComponent,
    PaginationComponent,
    EmptyStateComponent,
  ],
  templateUrl: './employee-list.component.html',
})
export class EmployeeListComponent {
  @Input() employees: Employee[] = [];
  @Input() loading = false;

  @Output() create = new EventEmitter<void>();
  @Output() edit = new EventEmitter<Employee>();
  @Output() detail = new EventEmitter<Employee>();
  @Output() refresh = new EventEmitter<void>();
  @Output() bulkUpload = new EventEmitter<void>();

  private store = inject(Store);
  private currencyService = inject(CurrencyFormatService);

  search$: Observable<string> = this.store.select(selectEmployeeSearch);
  statusFilter$: Observable<string> = this.store.select(
    selectEmployeeStatusFilter,
  );
  meta$ = this.store.select(selectEmployeeMeta);
  page$ = this.store.select(selectEmployeePage);

  searchTerm = '';
  filterValues: FilterValues = {};

  filterConfigs: FilterConfig[] = [
    {
      key: 'status',
      label: 'Estado',
      type: 'select',
      options: [
        { value: '', label: 'Todos los Estados' },
        { value: 'active', label: 'Activo' },
        { value: 'inactive', label: 'Inactivo' },
        { value: 'terminated', label: 'Terminado' },
      ],
    },
  ];

  dropdownActions: DropdownAction[] = [
    {
      label: 'Nuevo Empleado',
      icon: 'plus',
      action: 'create',
      variant: 'primary',
    },
    { label: 'Carga Masiva', icon: 'upload', action: 'bulk-upload' },
  ];

  tableActions: TableAction[] = [
    {
      label: 'Ver',
      icon: 'eye',
      variant: 'primary',
      action: (row: Employee) => this.detail.emit(row),
    },
    {
      label: 'Editar',
      icon: 'edit',
      variant: 'primary',
      action: (row: Employee) => this.edit.emit(row),
    },
  ];

  columns: TableColumn[] = [
    { key: 'employee_code', label: 'Código', sortable: true, priority: 2 },
    {
      key: 'first_name',
      label: 'Nombre',
      sortable: true,
      priority: 1,
      transform: (val: any, row: any) => `${row.first_name} ${row.last_name}`,
    },
    {
      key: 'user',
      label: 'Usuario',
      priority: 3,
      transform: (val: any) =>
        val ? `${val.first_name} ${val.last_name}` : 'No vinculado',
    },
    { key: 'position', label: 'Cargo', priority: 2, defaultValue: 'Sin cargo' },
    {
      key: 'department',
      label: 'Departamento',
      priority: 2,
      defaultValue: 'Sin departamento',
    },
    {
      key: 'cost_center',
      label: 'Centro de Costo',
      priority: 2,
      badgeConfig: {
        type: 'status',
        colorMap: {
          Administrativo: 'info',
          Operativo: 'warn',
          Ventas: 'success',
        },
      },
      transform: (val: any) => this.getCostCenterLabel(val),
    },
    {
      key: 'base_salary',
      label: 'Salario',
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
          active: 'success',
          inactive: 'warn',
          terminated: 'danger',
        },
      },
      transform: (val: any) => this.getStatusLabel(val),
    },
  ];

  cardConfig: ItemListCardConfig = {
    titleKey: 'first_name',
    titleTransform: (item: any) => `${item.first_name} ${item.last_name}`,
    subtitleTransform: (item: any) => item?.position || 'Sin cargo',
    badgeKey: 'status',
    badgeConfig: {
      type: 'status',
      colorMap: {
        active: 'success',
        inactive: 'warn',
        terminated: 'danger',
      },
    },
    badgeTransform: (val: any) => this.getStatusLabel(val),
    footerKey: 'base_salary',
    footerLabel: 'Salario',
    footerStyle: 'prominent',
    footerTransform: (val: any) => this.currencyService.format(Number(val) || 0),
    detailKeys: [
      {
        key: 'department',
        label: 'Departamento',
        icon: 'building',
        transform: (val: any) => val || 'Sin departamento',
      },
      {
        key: 'employee_code',
        label: 'Código',
        icon: 'hash',
      },
      {
        key: 'user',
        label: 'Usuario',
        icon: 'user',
        transform: (val: any) => (val ? `${val.email}` : 'No vinculado'),
      },
    ],
  };

  onSearchChange(term: string): void {
    this.searchTerm = term;
    this.store.dispatch(PayrollActions.setEmployeeSearch({ search: term }));
  }

  onFilterChange(values: FilterValues): void {
    this.filterValues = { ...values };
    const statusFilter = (values['status'] as string) || '';
    this.store.dispatch(
      PayrollActions.setEmployeeStatusFilter({ statusFilter }),
    );
  }

  onClearFilters(): void {
    this.searchTerm = '';
    this.filterValues = {};
    this.store.dispatch(PayrollActions.clearEmployeeFilters());
  }

  onActionClick(action: string): void {
    switch (action) {
      case 'create':
        this.create.emit();
        break;
      case 'bulk-upload':
        this.bulkUpload.emit();
        break;
    }
  }

  onRowClick(employee: Employee): void {
    this.detail.emit(employee);
  }

  onPageChange(page: number): void {
    this.store.dispatch(PayrollActions.setEmployeePage({ page }));
  }

  getStatusLabel(status: string): string {
    const labels: Record<string, string> = {
      active: 'Activo',
      inactive: 'Inactivo',
      terminated: 'Terminado',
    };
    return labels[status] || status;
  }

  getCostCenterLabel(cc: string): string {
    const labels: Record<string, string> = {
      administrative: 'Administrativo',
      operational: 'Operativo',
      sales: 'Ventas',
    };
    return labels[cc] || 'Administrativo';
  }

  get hasFilters(): boolean {
    return !!(this.searchTerm || this.filterValues['status']);
  }

  getEmptyStateTitle(): string {
    return this.hasFilters
      ? 'Ningun empleado coincide con sus filtros'
      : 'No hay empleados registrados';
  }

  getEmptyStateDescription(): string {
    return this.hasFilters
      ? 'Intente ajustar sus términos de búsqueda o filtros'
      : 'Comience creando su primer empleado.';
  }
}
