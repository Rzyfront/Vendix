import {
  Component,
  OnInit,
  OnDestroy,
  inject,
  signal,
  computed,
} from '@angular/core';

import { FormsModule } from '@angular/forms';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';

import { CarteraService } from '../../services/cartera.service';
import { CurrencyFormatService } from '../../../../../../shared/pipes/currency/currency.pipe';
import {
  AccountReceivable,
  ArQueryParams,
  CarteraDashboard,
} from '../../interfaces/cartera.interface';
import { ReceivablePaymentModalComponent } from './receivable-payment-modal.component';
import { ReceivableDetailModalComponent } from './receivable-detail-modal.component';
import {
  CardComponent,
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
  selector: 'vendix-receivables',
  standalone: true,
  imports: [
    FormsModule,
    ReceivablePaymentModalComponent,
    ReceivableDetailModalComponent,
    CardComponent,
    StatsComponent,
    InputsearchComponent,
    ResponsiveDataViewComponent,
    OptionsDropdownComponent,
    PaginationComponent,
    EmptyStateComponent,
  ],
  templateUrl: './receivables.component.html',
})
export class ReceivablesComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();
  private carteraService = inject(CarteraService);
  private currencyService = inject(CurrencyFormatService);
  private dialogService = inject(DialogService);
  private toastService = inject(ToastService);

  // Data
  readonly receivables = signal<AccountReceivable[]>([]);
  readonly is_loading = signal(false);
  readonly dashboard = signal<CarteraDashboard | null>(null);

  // Pagination
  readonly meta = signal({ total: 0, page: 1, limit: 20, totalPages: 0 });

  // Filters
  search_term = '';
  filter_values: FilterValues = {};
  query_params: ArQueryParams = { page: 1, limit: 20 };

  // Modals
  is_payment_modal_open = false;
  is_detail_modal_open = false;
  selected_receivable: AccountReceivable | null = null;

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
      key: 'customer_name',
      label: 'Cliente',
      priority: 1,
      transform: (_val: any, row: any) => row?.customer?.name || '—',
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
      key: 'days_overdue',
      label: 'Dias Vencido',
      align: 'center',
      priority: 2,
      transform: (val: any) => (Number(val) > 0 ? `${val} dias` : '—'),
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
    subtitleTransform: (item: any) => item?.customer?.name || '—',
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
        key: 'days_overdue',
        label: 'Dias Vencido',
        icon: 'alert-triangle',
        transform: (val: any) => (Number(val) > 0 ? `${val} dias` : 'Al dia'),
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
      variant: 'secondary',
      action: (row: AccountReceivable) => this.openDetailModal(row),
    },
    {
      label: 'Registrar Pago',
      icon: 'banknote',
      variant: 'primary',
      action: (row: AccountReceivable) => this.openPaymentModal(row),
      show: (row: AccountReceivable) =>
        row.status !== 'paid' && row.status !== 'written_off',
    },
    {
      label: 'Castigar',
      icon: 'x-circle',
      variant: 'danger',
      action: (row: AccountReceivable) => this.confirmWriteOff(row),
      show: (row: AccountReceivable) =>
        row.status !== 'paid' && row.status !== 'written_off',
    },
  ];

  ngOnInit(): void {
    this.loadReceivables();
    this.loadDashboard();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  loadReceivables(): void {
    this.is_loading.set(true);
    this.carteraService
      .getReceivables(this.query_params)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response) => {
          this.receivables.set(response.data);
          this.meta.set(response.meta);
          this.is_loading.set(false);
        },
        error: () => {
          this.is_loading.set(false);
        },
      });
  }

  loadDashboard(): void {
    this.carteraService
      .getArDashboard()
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response) => {
          this.dashboard.set(response.data);
        },
      });
  }

  // ── Filter handlers ──────────────────────────────────

  onSearchChange(term: string): void {
    this.search_term = term;
    this.query_params = { ...this.query_params, search: term, page: 1 };
    this.loadReceivables();
  }

  onFilterChange(values: FilterValues): void {
    this.filter_values = { ...values };
    this.query_params = {
      ...this.query_params,
      status: (values['status'] as string) || undefined,
      page: 1,
    };
    this.loadReceivables();
  }

  onClearFilters(): void {
    this.search_term = '';
    this.filter_values = {};
    this.query_params = { page: 1, limit: 20 };
    this.loadReceivables();
  }

  onPageChange(page: number): void {
    this.query_params = { ...this.query_params, page };
    this.loadReceivables();
  }

  onSort(event: { sort_by: string; sort_order: 'asc' | 'desc' }): void {
    this.query_params = {
      ...this.query_params,
      sort_by: event.sort_by,
      sort_order: event.sort_order,
    };
    this.loadReceivables();
  }

  onRowClick(receivable: AccountReceivable): void {
    this.openDetailModal(receivable);
  }

  // ── Modal management ──────────────────────────────────

  openPaymentModal(receivable: AccountReceivable): void {
    this.selected_receivable = receivable;
    this.is_payment_modal_open = true;
  }

  openDetailModal(receivable: AccountReceivable): void {
    this.selected_receivable = receivable;
    this.is_detail_modal_open = true;
  }

  onPaymentRegistered(): void {
    this.is_payment_modal_open = false;
    this.loadReceivables();
    this.loadDashboard();
  }

  async confirmWriteOff(receivable: AccountReceivable): Promise<void> {
    const confirmed = await this.dialogService.confirm({
      title: 'Castigar Cuenta por Cobrar',
      message: `Esta seguro que desea castigar la cuenta ${receivable.document_number || '#' + receivable.id}? Esta accion no se puede deshacer.`,
      confirmText: 'Castigar',
      cancelText: 'Cancelar',
      confirmVariant: 'danger',
    });

    if (!confirmed) return;

    this.carteraService
      .writeOffAr(receivable.id)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: () => {
          this.toastService.success('Cuenta castigada exitosamente');
          this.loadReceivables();
          this.loadDashboard();
        },
        error: () => {
          this.toastService.error('Error al castigar la cuenta');
        },
      });
  }

  // ── Helpers ──────────────────────────────────────────

  readonly formatted_total_pending = computed(() =>
    this.currencyService.format(this.dashboard()?.total_pending || 0),
  );
  readonly formatted_total_overdue = computed(() =>
    this.currencyService.format(this.dashboard()?.total_overdue || 0),
  );
  readonly formatted_due_soon = computed(() =>
    this.currencyService.format(this.dashboard()?.due_soon || 0),
  );
  readonly formatted_collected_this_month = computed(() =>
    this.currencyService.format(this.dashboard()?.collected_this_month || 0),
  );

  get hasFilters(): boolean {
    return !!(this.search_term || this.filter_values['status']);
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
}
