import { Component, computed, inject, input, output } from '@angular/core';

import { CurrencyFormatService } from '../../../../../../shared/pipes/currency';
import { CardComponent } from '../../../../../../shared/components/card/card.component';
import { InputsearchComponent } from '../../../../../../shared/components/inputsearch/inputsearch.component';
import { OptionsDropdownComponent } from '../../../../../../shared/components/options-dropdown/options-dropdown.component';
import {
  FilterConfig,
  FilterValues,
  DropdownAction,
} from '../../../../../../shared/components/options-dropdown/options-dropdown.interfaces';
import {
  ResponsiveDataViewComponent,
  TableColumn,
  TableAction,
  ItemListCardConfig,
} from '../../../../../../shared/components/responsive-data-view/responsive-data-view.component';
import { formatDateOnlyUTC } from '../../../../../../shared/utils/date.util';

import { PayrollNovelty } from '../../interfaces/payroll.interface';
import {
  NOVELTY_TYPE_CONFIG,
  NOVELTY_TYPE_COLOR_MAP,
  NOVELTY_STATUS_COLOR_MAP,
  getNoveltyTypeLabel,
  getNoveltyStatusLabel,
  getNoveltyUnit,
} from './novelty-labels';

@Component({
  selector: 'app-novelties-list',
  standalone: true,
  imports: [
    CardComponent,
    InputsearchComponent,
    OptionsDropdownComponent,
    ResponsiveDataViewComponent,
  ],
  templateUrl: './novelties-list.component.html',
})
export class NoveltiesListComponent {
  private currencyService = inject(CurrencyFormatService);

  // Inputs
  novelties = input.required<PayrollNovelty[]>();
  loading = input<boolean>(false);
  employeeOptions = input<Array<{ label: string; value: number }>>([]);

  // Outputs
  create = output<void>();
  search = output<string>();
  filter = output<FilterValues>();
  edit = output<PayrollNovelty>();
  remove = output<PayrollNovelty>();

  // Filter state
  filterValues: FilterValues = {};

  // Filter configs (employee options arrive async)
  readonly filterConfigs = computed<FilterConfig[]>(() => [
    {
      key: 'employee_id',
      label: 'Empleado',
      type: 'select',
      placeholder: 'Todos',
      options: this.employeeOptions(),
    },
    {
      key: 'novelty_type',
      label: 'Tipo',
      type: 'select',
      placeholder: 'Todos',
      options: Object.entries(NOVELTY_TYPE_CONFIG).map(([value, cfg]) => ({
        label: cfg.label,
        value,
      })),
    },
    {
      key: 'status',
      label: 'Estado',
      type: 'select',
      placeholder: 'Todos',
      options: [
        { label: 'Pendiente', value: 'pending' },
        { label: 'Aplicada', value: 'applied' },
        { label: 'Cancelada', value: 'cancelled' },
      ],
    },
  ]);

  // Table columns (desktop)
  columns: TableColumn[] = [
    {
      key: 'employee',
      label: 'Empleado',
      transform: (val: any) =>
        val ? `${val.first_name} ${val.last_name}` : '-',
    },
    {
      key: 'novelty_type',
      label: 'Tipo',
      badge: true,
      badgeConfig: {
        type: 'custom',
        colorMap: NOVELTY_TYPE_COLOR_MAP,
      },
      transform: (val: string) => getNoveltyTypeLabel(val),
    },
    {
      key: 'date_start',
      label: 'Fechas',
      transform: (_val: any, row: any) => this.getDatesLabel(row),
    },
    {
      key: 'quantity',
      label: 'Cantidad',
      align: 'right',
      transform: (_val: any, row: any) => this.getQuantityLabel(row),
    },
    {
      key: 'status',
      label: 'Estado',
      badge: true,
      badgeConfig: {
        type: 'custom',
        colorMap: NOVELTY_STATUS_COLOR_MAP,
      },
      transform: (val: string) => getNoveltyStatusLabel(val),
    },
    {
      key: 'notes',
      label: 'Notas',
      priority: 3,
      transform: (val: any) => val || '-',
    },
  ];

  // Card config (mobile)
  cardConfig: ItemListCardConfig = {
    titleKey: 'employee',
    titleTransform: (item: any) =>
      item?.employee
        ? `${item.employee.first_name} ${item.employee.last_name}`
        : `Empleado #${item?.employee_id}`,
    subtitleKey: 'novelty_type',
    subtitleTransform: (item: any) => getNoveltyTypeLabel(item?.novelty_type),
    avatarFallbackIcon: 'calendar-days',
    avatarShape: 'circle',
    badgeKey: 'status',
    badgeConfig: {
      type: 'custom',
      size: 'sm',
      colorMap: NOVELTY_STATUS_COLOR_MAP,
    },
    badgeTransform: (val: string) => getNoveltyStatusLabel(val),
    detailKeys: [
      {
        key: 'date_start',
        label: 'Fechas',
        icon: 'calendar-days',
        transform: (_v: any, row: any) => this.getDatesLabel(row),
      },
    ],
    footerKey: 'id',
    footerLabel: 'Cantidad',
    footerStyle: 'prominent',
    footerTransform: (_v: any, row: any) => this.getQuantityLabel(row),
  };

  // Actions: editar/eliminar SOLO si status pending
  actions: TableAction[] = [
    {
      label: 'Editar',
      icon: 'pencil',
      variant: 'primary',
      show: (item: PayrollNovelty) => item.status === 'pending',
      action: (item: PayrollNovelty) => this.edit.emit(item),
    },
    {
      label: 'Eliminar',
      icon: 'trash-2',
      variant: 'danger',
      show: (item: PayrollNovelty) => item.status === 'pending',
      action: (item: PayrollNovelty) => this.remove.emit(item),
    },
  ];

  // Dropdown actions
  dropdownActions: DropdownAction[] = [
    {
      label: 'Nueva Novedad',
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

  private getDatesLabel(novelty: PayrollNovelty): string {
    if (!novelty?.date_start) return '-';
    const start = formatDateOnlyUTC(novelty.date_start);
    if (novelty.date_end) {
      return `${start} — ${formatDateOnlyUTC(novelty.date_end)}`;
    }
    return start;
  }

  private getQuantityLabel(novelty: PayrollNovelty): string {
    if (!novelty) return '-';
    const unit = getNoveltyUnit(novelty.novelty_type);
    if (unit === 'hours') {
      return novelty.hours != null ? `${Number(novelty.hours)} h` : '-';
    }
    if (unit === 'days') {
      return novelty.days != null ? `${Number(novelty.days)} días` : '-';
    }
    return novelty.amount != null
      ? this.currencyService.format(Number(novelty.amount))
      : '-';
  }
}
