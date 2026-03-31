import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';

import { CarteraService } from '../../services/cartera.service';
import { CurrencyFormatService } from '../../../../../../shared/pipes/currency/currency.pipe';
import {
  AccountPayable,
  ApQueryParams,
  CarteraDashboard,
} from '../../interfaces/cartera.interface';
import { PayablePaymentModalComponent } from './payable-payment-modal.component';
import { PayableDetailModalComponent } from './payable-detail-modal.component';
import {
  ButtonComponent,
  CardComponent,
  IconComponent,
  StatsComponent,
  InputsearchComponent,
  ResponsiveDataViewComponent,
  OptionsDropdownComponent,
  PaginationComponent,
  EmptyStateComponent,
  DialogService,
  ToastService,
} from '../../../../../../shared/components/index';
import type {
  TableColumn,
  TableAction,
  ItemListCardConfig,
  FilterConfig,
  FilterValues,
  DropdownAction,
} from '../../../../../../shared/components/index';

@Component({
  selector: 'vendix-payables',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    PayablePaymentModalComponent,
    PayableDetailModalComponent,
    ButtonComponent,
    CardComponent,
    IconComponent,
    StatsComponent,
    InputsearchComponent,
    ResponsiveDataViewComponent,
    OptionsDropdownComponent,
    PaginationComponent,
    EmptyStateComponent,
  ],
  templateUrl: './payables.component.html',
})
export class PayablesComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();
  private carteraService = inject(CarteraService);
  private currencyService = inject(CurrencyFormatService);
  private dialogService = inject(DialogService);
  private toastService = inject(ToastService);

  // Data
  payables: AccountPayable[] = [];
  is_loading = false;
  dashboard: CarteraDashboard | null = null;

  // Pagination
  meta = { total: 0, page: 1, limit: 20, totalPages: 0 };

  // Filters
  search_term = '';
  filter_values: FilterValues = {};
  query_params: ApQueryParams = { page: 1, limit: 20 };

  // Modals
  is_payment_modal_open = false;
  is_detail_modal_open = false;
  selected_payable: AccountPayable | null = null;

  // Priority badge map
  private priority_badge_map: Record<string, string> = {
    urgent: 'danger',
    high: 'warn',
    normal: 'info',
    low: 'muted',
  };

  // Filter configs
  filter_configs: FilterConfig[] = [
    {
      key: 'status',
      label: 'Estado',
      type: 'select',
      options: [
        { value: '', label: 'Todos los Estados' },
        { value: 'open', label: 'Abierta' },
        { value: 'partial', label: 'Parcial' },
        { value: 'overdue', label: 'Vencida' },
        { value: 'paid', label: 'Pagada' },
        { value: 'written_off', label: 'Castigada' },
      ],
    },
    {
      key: 'priority',
      label: 'Prioridad',
      type: 'select',
      options: [
        { value: '', label: 'Todas las Prioridades' },
        { value: 'urgent', label: 'Urgente' },
        { value: 'high', label: 'Alta' },
        { value: 'normal', label: 'Normal' },
        { value: 'low', label: 'Baja' },
      ],
    },
  ];

  // Dropdown actions
  dropdown_actions: DropdownAction[] = [];

  // Table columns
  columns: TableColumn[] = [
    {
      key: 'document_number',
      label: 'Documento',
      sortable: true,
      priority: 1,
      transform: (val: any) => val || '—',
    },
    {
      key: 'supplier_name',
      label: 'Proveedor',
      priority: 1,
      transform: (_val: any, row: any) => row?.supplier?.name || '—',
    },
    {
      key: 'original_amount',
      label: 'Monto Original',
      sortable: true,
      align: 'right',
      priority: 2,
      transform: (val: any) => this.currencyService.format(Number(val) || 0),
    },
    {
      key: 'balance',
      label: 'Saldo',
      sortable: true,
      align: 'right',
      priority: 1,
      transform: (val: any) => this.currencyService.format(Number(val) || 0),
    },
    {
      key: 'due_date',
      label: 'Vencimiento',
      sortable: true,
      align: 'center',
      priority: 2,
      transform: (val: any) => (val ? new Date(val).toLocaleDateString() : '—'),
    },
    {
      key: 'priority',
      label: 'Prioridad',
      align: 'center',
      priority: 2,
      badge: true,
      badgeConfig: {
        type: 'status',
        colorMap: {
          urgent: 'danger',
          high: 'warn',
          normal: 'info',
          low: 'default',
        },
      },
      transform: (val: string) => this.getPriorityLabel(val),
    },
    {
      key: 'status',
      label: 'Estado',
      align: 'center',
      priority: 1,
      badgeConfig: {
        type: 'status',
        colorMap: {
          open: 'info',
          partial: 'warn',
          overdue: 'danger',
          paid: 'success',
          written_off: 'default',
        },
      },
      transform: (val: string) => this.getStatusLabel(val),
    },
  ];

  // Card config for mobile
  card_config: ItemListCardConfig = {
    titleKey: 'document_number',
    subtitleTransform: (item: any) => item?.supplier?.name || '—',
    badgeKey: 'status',
    badgeConfig: {
      type: 'status',
      size: 'sm',
      colorMap: {
        open: 'info',
        partial: 'warn',
        overdue: 'danger',
        paid: 'success',
        written_off: 'default',
      },
    },
    badgeTransform: (val: string) => this.getStatusLabel(val),
    detailKeys: [
      {
        key: 'due_date',
        label: 'Vencimiento',
        icon: 'calendar',
        transform: (val: any) =>
          val ? new Date(val).toLocaleDateString() : '—',
      },
      {
        key: 'priority',
        label: 'Prioridad',
        icon: 'flag',
        transform: (val: any) => this.getPriorityLabel(val),
      },
    ],
    footerKey: 'balance',
    footerLabel: 'Saldo',
    footerStyle: 'prominent' as const,
    footerTransform: (val: any) =>
      this.currencyService.format(Number(val) || 0),
  };

  // Table actions
  table_actions: TableAction[] = [
    {
      label: 'Ver Detalle',
      icon: 'eye',
      variant: 'ghost',
      action: (row: AccountPayable) => this.openDetailModal(row),
    },
    {
      label: 'Registrar Pago',
      icon: 'banknote',
      variant: 'primary',
      action: (row: AccountPayable) => this.openPaymentModal(row),
      show: (row: AccountPayable) =>
        row.status !== 'paid' && row.status !== 'written_off',
    },
    {
      label: 'Castigar',
      icon: 'x-circle',
      variant: 'danger',
      action: (row: AccountPayable) => this.confirmWriteOff(row),
      show: (row: AccountPayable) =>
        row.status !== 'paid' && row.status !== 'written_off',
    },
  ];

  ngOnInit(): void {
    this.loadPayables();
    this.loadDashboard();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  loadPayables(): void {
    this.is_loading = true;
    this.carteraService
      .getPayables(this.query_params)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response) => {
          this.payables = response.data;
          this.meta = response.meta;
          this.is_loading = false;
        },
        error: () => {
          this.is_loading = false;
        },
      });
  }

  loadDashboard(): void {
    this.carteraService
      .getApDashboard()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response) => {
          this.dashboard = response.data;
        },
      });
  }

  // ── Filter handlers ──────────────────────────────────

  onSearchChange(term: string): void {
    this.search_term = term;
    this.query_params = { ...this.query_params, search: term, page: 1 };
    this.loadPayables();
  }

  onFilterChange(values: FilterValues): void {
    this.filter_values = { ...values };
    this.query_params = {
      ...this.query_params,
      status: (values['status'] as string) || undefined,
      priority: (values['priority'] as string) || undefined,
      page: 1,
    };
    this.loadPayables();
  }

  onClearFilters(): void {
    this.search_term = '';
    this.filter_values = {};
    this.query_params = { page: 1, limit: 20 };
    this.loadPayables();
  }

  onPageChange(page: number): void {
    this.query_params = { ...this.query_params, page };
    this.loadPayables();
  }

  onSort(event: { sort_by: string; sort_order: 'asc' | 'desc' }): void {
    this.query_params = {
      ...this.query_params,
      sort_by: event.sort_by,
      sort_order: event.sort_order,
    };
    this.loadPayables();
  }

  onRowClick(payable: AccountPayable): void {
    this.openDetailModal(payable);
  }

  // ── Modal management ──────────────────────────────────

  openPaymentModal(payable: AccountPayable): void {
    this.selected_payable = payable;
    this.is_payment_modal_open = true;
  }

  openDetailModal(payable: AccountPayable): void {
    this.selected_payable = payable;
    this.is_detail_modal_open = true;
  }

  onPaymentRegistered(): void {
    this.is_payment_modal_open = false;
    this.loadPayables();
    this.loadDashboard();
  }

  async confirmWriteOff(payable: AccountPayable): Promise<void> {
    const confirmed = await this.dialogService.confirm({
      title: 'Castigar Cuenta por Pagar',
      message: `Esta seguro que desea castigar la cuenta ${payable.document_number || '#' + payable.id}? Esta accion no se puede deshacer.`,
      confirmText: 'Castigar',
      cancelText: 'Cancelar',
      confirmVariant: 'danger',
    });

    if (!confirmed) return;

    this.carteraService
      .writeOffAp(payable.id)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.toastService.success('Cuenta castigada exitosamente');
          this.loadPayables();
          this.loadDashboard();
        },
        error: () => {
          this.toastService.error('Error al castigar la cuenta');
        },
      });
  }

  // ── Helpers ──────────────────────────────────────────

  get formatted_total_pending(): string {
    return this.currencyService.format(this.dashboard?.total_pending || 0);
  }

  get formatted_total_overdue(): string {
    return this.currencyService.format(this.dashboard?.total_overdue || 0);
  }

  get formatted_scheduled(): string {
    return this.currencyService.format(this.dashboard?.due_soon || 0);
  }

  get formatted_paid_this_month(): string {
    return this.currencyService.format(this.dashboard?.paid_this_month || 0);
  }

  getStatusLabel(status: string): string {
    const labels: Record<string, string> = {
      open: 'Abierta',
      partial: 'Parcial',
      overdue: 'Vencida',
      paid: 'Pagada',
      written_off: 'Castigada',
    };
    return labels[status] || status;
  }

  getPriorityLabel(priority: string): string {
    const labels: Record<string, string> = {
      urgent: 'Urgente',
      high: 'Alta',
      normal: 'Normal',
      low: 'Baja',
    };
    return labels[priority] || priority;
  }

  get hasFilters(): boolean {
    return !!(
      this.search_term ||
      this.filter_values['status'] ||
      this.filter_values['priority']
    );
  }
}
