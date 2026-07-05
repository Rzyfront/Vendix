import {
  Component,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';

import { FormsModule } from '@angular/forms';

import {
  PayrollSettlement,
} from '../../../interfaces/payroll.interface';
import { CurrencyFormatService } from '../../../../../../../shared/pipes/currency';
import { formatDateOnlyUTC } from '../../../../../../../shared/utils/date.util';
import {
  SETTLEMENT_STATUS_COLOR_MAP,
  getSettlementReasonLabel,
  getSettlementStatusLabel,
} from '../settlement-labels';
import {
  InputsearchComponent,
  OptionsDropdownComponent,
  FilterConfig,
  FilterValues,
  DropdownAction,
  ResponsiveDataViewComponent,
  TableColumn,
  TableAction,
  ItemListCardConfig,
  CardComponent,
  EmptyStateComponent,
} from '../../../../../../../shared/components/index';

@Component({
  selector: 'app-settlement-list',
  standalone: true,
  imports: [
    FormsModule,
    InputsearchComponent,
    OptionsDropdownComponent,
    EmptyStateComponent,
    ResponsiveDataViewComponent,
    CardComponent
],
  templateUrl: './settlement-list.component.html',
})
export class SettlementListComponent {
  private currencyService = inject(CurrencyFormatService);

  // ── Inputs ────────────────────────────────────────────
  settlements = input<PayrollSettlement[]>([]);
  isLoading = input(false);

  // ── Outputs ───────────────────────────────────────────
  search = output<string>();
  filter = output<FilterValues>();
  create = output<void>();
  view = output<PayrollSettlement>();
  approve = output<PayrollSettlement>();
  pay = output<PayrollSettlement>();
  cancel = output<PayrollSettlement>();

  // ── Local state (signals: zoneless-safe) ──────────────
  readonly searchTerm = signal('');
  readonly filterValues = signal<FilterValues>({});

  /** Hay busqueda o filtros activos → el vacío ofrece "limpiar filtros". */
  readonly hasFilters = computed(() => {
    if (this.searchTerm().trim().length > 0) return true;
    return Object.values(this.filterValues()).some(
      (v) => v !== null && v !== undefined && v !== '',
    );
  });

  dropdownActions: DropdownAction[] = [
    {
      label: 'Nueva Liquidación',
      icon: 'plus',
      action: 'create',
      variant: 'primary',
    },
  ];

  // ── Filter configuration ──────────────────────────────
  filterConfigs: FilterConfig[] = [
    {
      key: 'status',
      label: 'Estado',
      type: 'select',
      placeholder: 'Todos',
      options: [
        { label: 'Borrador', value: 'draft' },
        { label: 'Calculada', value: 'calculated' },
        { label: 'Aprobada', value: 'approved' },
        { label: 'Pagada', value: 'paid' },
        { label: 'Cancelada', value: 'cancelled' },
      ],
    },
  ];

  // ── Table columns ────────────────────────────────────
  columns: TableColumn[] = [
    { key: 'settlement_number', label: '# Liquidacion', sortable: true },
    {
      key: 'employee',
      label: 'Empleado',
      transform: (val: any) =>
        val ? `${val.first_name} ${val.last_name}` : '-',
    },
    {
      key: 'termination_date',
      label: 'Fecha Terminacion',
      transform: (val: string) => (val ? formatDateOnlyUTC(val) : '-'),
    },
    {
      key: 'termination_reason',
      label: 'Motivo',
      transform: (val: string) => getSettlementReasonLabel(val),
    },
    {
      key: 'gross_settlement',
      label: 'Bruto',
      transform: (val: any) => this.currencyService.format(Number(val) || 0),
    },
    {
      key: 'net_settlement',
      label: 'Neto',
      transform: (val: any) => this.currencyService.format(Number(val) || 0),
    },
    {
      key: 'status',
      label: 'Estado',
      badge: true,
      badgeConfig: {
        type: 'custom',
        size: 'sm',
        colorMap: SETTLEMENT_STATUS_COLOR_MAP,
      },
      transform: (val: string) => getSettlementStatusLabel(val),
    },
  ];

  // ── Card configuration (mobile) ───────────────────────
  cardConfig: ItemListCardConfig = {
    titleKey: 'settlement_number',
    subtitleKey: 'employee',
    subtitleTransform: (val: any) =>
      val ? `${val.first_name} ${val.last_name}` : '-',
    badgeKey: 'status',
    badgeConfig: {
      type: 'custom',
      size: 'sm',
      colorMap: SETTLEMENT_STATUS_COLOR_MAP,
    },
    badgeTransform: (val: string) => getSettlementStatusLabel(val),
    detailKeys: [
      {
        key: 'termination_reason',
        label: 'Motivo',
        transform: (v: any) => getSettlementReasonLabel(v),
      },
    ],
    footerKey: 'net_settlement',
    footerLabel: 'Neto',
    footerStyle: 'prominent',
    footerTransform: (v: any) => this.currencyService.format(Number(v) || 0),
  };

  // ── Table actions ────────────────────────────────────
  actions: TableAction[] = [
    {
      label: 'Ver',
      icon: 'eye',
      variant: 'secondary',
      action: (item: PayrollSettlement) => this.view.emit(item),
    },
    {
      label: 'Aprobar',
      icon: 'check-circle',
      variant: 'success',
      show: (item: PayrollSettlement) => item.status === 'calculated',
      action: (item: PayrollSettlement) => this.approve.emit(item),
    },
    {
      label: 'Pagar',
      icon: 'banknote',
      variant: 'success',
      show: (item: PayrollSettlement) => item.status === 'approved',
      action: (item: PayrollSettlement) => this.pay.emit(item),
    },
    {
      label: 'Cancelar',
      icon: 'x-circle',
      variant: 'danger',
      show: (item: PayrollSettlement) =>
        item.status !== 'paid' && item.status !== 'cancelled',
      action: (item: PayrollSettlement) => this.cancel.emit(item),
    },
  ];

  // ── Event handlers ────────────────────────────────────
  onSearchChange(term: string): void {
    this.searchTerm.set(term);
    this.search.emit(term);
  }

  onFilterChange(values: FilterValues): void {
    this.filterValues.set(values);
    this.filter.emit(values);
  }

  onActionClick(action: string): void {
    switch (action) {
      case 'create':
        this.create.emit();
        break;
    }
  }

  onClearFilters(): void {
    this.searchTerm.set('');
    this.filterValues.set({});
    this.search.emit('');
    this.filter.emit({});
  }
}
