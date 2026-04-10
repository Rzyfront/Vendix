import {
  Component,
  inject,
  input,
  output,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import {
  PayrollSettlement,
} from '../../../interfaces/payroll.interface';
import { CurrencyFormatService } from '../../../../../../../shared/pipes/currency';
import {
  InputsearchComponent,
  OptionsDropdownComponent,
  FilterConfig,
  FilterValues,
  ResponsiveDataViewComponent,
  TableColumn,
  TableAction,
  ItemListCardConfig,
  ButtonComponent,
  IconComponent,
  CardComponent,
  EmptyStateComponent,
} from '../../../../../../../shared/components/index';

@Component({
  selector: 'app-settlement-list',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    InputsearchComponent,
    OptionsDropdownComponent,
    EmptyStateComponent,
    ResponsiveDataViewComponent,
    ButtonComponent,
    IconComponent,
    CardComponent,
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

  // ── Local state ───────────────────────────────────────
  searchTerm = '';
  filterValues: FilterValues = {};

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
      transform: (val: string) =>
        val
          ? new Date(val).toLocaleDateString('es-CO', {
              day: '2-digit',
              month: '2-digit',
              year: 'numeric',
            })
          : '-',
    },
    {
      key: 'termination_reason',
      label: 'Motivo',
      transform: (val: string) => this.getReasonLabel(val),
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
        colorMap: {
          draft: 'gray',
          calculated: 'blue',
          approved: 'yellow',
          paid: 'green',
          cancelled: 'gray',
        },
      },
      transform: (val: string) => this.getStatusLabel(val),
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
      colorMap: {
        draft: '#9ca3af',
        calculated: '#3b82f6',
        approved: '#eab308',
        paid: '#22c55e',
        cancelled: '#9ca3af',
      },
    },
    badgeTransform: (val: string) => this.getStatusLabel(val),
    detailKeys: [
      {
        key: 'termination_reason',
        label: 'Motivo',
        transform: (v: any) => this.getReasonLabel(v),
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
    this.searchTerm = term;
    this.search.emit(term);
  }

  onFilterChange(values: FilterValues): void {
    this.filterValues = values;
    this.filter.emit(values);
  }

  // ── Helpers ───────────────────────────────────────────
  getStatusLabel(status: string): string {
    const labels: Record<string, string> = {
      draft: 'Borrador',
      calculated: 'Calculada',
      approved: 'Aprobada',
      paid: 'Pagada',
      cancelled: 'Cancelada',
    };
    return labels[status] || status;
  }

  getReasonLabel(reason: string): string {
    const labels: Record<string, string> = {
      voluntary_resignation: 'Renuncia Voluntaria',
      just_cause: 'Despido con Justa Causa',
      without_just_cause: 'Despido sin Justa Causa',
      mutual_agreement: 'Mutuo Acuerdo',
      contract_expiry: 'Vencimiento Contrato',
      retirement: 'Jubilacion',
      death: 'Muerte del Trabajador',
    };
    return labels[reason] || reason || '-';
  }
}
