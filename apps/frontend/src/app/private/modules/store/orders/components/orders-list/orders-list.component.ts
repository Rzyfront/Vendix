import {
  Component,
  OnInit,
  OnDestroy,
  Input,
  Output,
  EventEmitter,
  inject,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Subject, takeUntil, forkJoin } from 'rxjs';

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
} from '../../../../../../shared/components/index';

import { OrderEmptyStateComponent } from '../order-empty-state';
import { StoreOrdersService } from '../../services/store-orders.service';
import { CustomersService } from '../../../../store/customers/services/customers.service';
import {
  Order,
  OrderQuery,
  OrderState,
  OrderChannel,
  PaymentStatus,
} from '../../interfaces/order.interface';
import { CurrencyFormatService } from '../../../../../../shared/pipes/currency';

@Component({
  selector: 'app-orders-list',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ResponsiveDataViewComponent,
    InputsearchComponent,
    OptionsDropdownComponent,
    OrderEmptyStateComponent,
    ButtonComponent,
    IconComponent,
    PaginationComponent,
  ],
  templateUrl: './orders-list.component.html',
  styleUrls: ['./orders-list.component.css'],
})
export class OrdersListComponent implements OnInit, OnDestroy {
  private currencyService = inject(CurrencyFormatService);

  // State
  orders: Order[] = [];
  loading = false;
  totalItems = 0;
  searchTerm = '';
  selectedStatus = '';
  selectedChannel = '';
  selectedPaymentStatus = '';
  selectedDateRange = '';

  // Lifecycle
  private destroy$ = new Subject<void>();

  // Outputs
  @Output() create = new EventEmitter<void>();
  @Output() viewOrder = new EventEmitter<string>();
  @Output() refresh = new EventEmitter<void>();

  @Input() filters: OrderQuery = {
    search: '',
    status: undefined,
    channel: undefined,
    payment_status: undefined,
    date_range: undefined,
    page: 1,
    limit: 10,
    sort_by: 'created_at',
    sort_order: 'desc',
  };

  // Filter configuration for the options dropdown
  filterConfigs: FilterConfig[] = [
    {
      key: 'status',
      label: 'Estado',
      type: 'select',
      options: [
        { value: '', label: 'Todos los Estados' },
        { value: 'created', label: 'Creada' },
        { value: 'pending_payment', label: 'Pago Pendiente' },
        { value: 'processing', label: 'Procesando' },
        { value: 'shipped', label: 'Enviada' },
        { value: 'delivered', label: 'Entregada' },
        { value: 'cancelled', label: 'Cancelada' },
        { value: 'refunded', label: 'Reembolsada' },
        { value: 'finished', label: 'Finalizada' },
      ],
    },
    {
      key: 'channel',
      label: 'Canal',
      type: 'select',
      options: [
        { value: '', label: 'Todos los Canales' },
        { value: 'pos', label: 'Punto de Venta' },
        { value: 'ecommerce', label: 'Tienda Online' },
      ],
    },
    {
      key: 'payment_status',
      label: 'Estado de Pago',
      type: 'select',
      options: [
        { value: '', label: 'Todos los Estados de Pago' },
        { value: 'pending', label: 'Pendiente' },
        { value: 'processing', label: 'Procesando' },
        { value: 'completed', label: 'Completado' },
        { value: 'failed', label: 'Fallido' },
        { value: 'refunded', label: 'Reembolsado' },
        { value: 'cancelled', label: 'Cancelado' },
      ],
    },
    {
      key: 'date_range',
      label: 'Período',
      type: 'select',
      options: [
        { value: '', label: 'Todo el Período' },
        { value: 'today', label: 'Hoy' },
        { value: 'yesterday', label: 'Ayer' },
        { value: 'thisWeek', label: 'Esta Semana' },
        { value: 'lastWeek', label: 'Semana Pasada' },
        { value: 'thisMonth', label: 'Este Mes' },
        { value: 'lastMonth', label: 'Mes Pasado' },
        { value: 'thisYear', label: 'Este Año' },
        { value: 'lastYear', label: 'Año Pasado' },
      ],
    },
  ];

  // Current filter values
  filterValues: FilterValues = {};

  // Dropdown actions
  dropdownActions: DropdownAction[] = [
    { label: 'Nueva Orden', icon: 'plus', action: 'create', variant: 'primary' },
  ];

  // Table configuration
  columns: TableColumn[] = [
    { key: 'order_number', label: 'Order ID', sortable: true, priority: 1 },
    {
      key: 'customer_name',
      label: 'Customer',
      sortable: true,
      priority: 2,
    },
    {
      key: 'channel',
      label: 'Canal',
      sortable: true,
      badge: true,
      priority: 2,
      badgeConfig: {
        type: 'custom',
        size: 'sm',
        colorMap: {
          pos: '#6366f1',
          ecommerce: '#10b981',
          agent: '#8b5cf6',
          whatsapp: '#22c55e',
          marketplace: '#f59e0b',
        },
      },
      transform: (value: any) => this.formatChannel(value),
    },
    {
      key: 'state',
      label: 'Status',
      sortable: true,
      badge: true,
      priority: 1,
      badgeConfig: {
        type: 'custom',
        size: 'sm',
        colorMap: {
          created: '#6b7280',
          pending_payment: '#f59e0b',
          processing: '#3b82f6',
          shipped: '#06b6d4',
          delivered: '#10b981',
          cancelled: '#ef4444',
          refunded: '#f97316',
          finished: '#8b5cf6',
        },
      },
      transform: (value: any) => this.formatStatus(value),
    },
    {
      key: 'grand_total',
      label: 'Total',
      sortable: true,
      priority: 1,
      transform: (value: any) => this.currencyService.format(value || 0),
    },
    {
      key: 'created_at',
      label: 'Date',
      sortable: true,
      priority: 3,
      transform: (value: any) => {
        if (!value) return 'N/A';
        const date = new Date(value);
        return isNaN(date.getTime()) ? 'Invalid Date' : date.toLocaleDateString();
      },
    },
  ];

  actions: TableAction[] = [
    {
      label: 'View Details',
      icon: 'eye',
      action: (order: Order) => this.viewOrderDetails(order),
      variant: 'ghost',
    },
    {
      label: 'Cancel Order',
      icon: 'x-circle',
      action: (order: Order) => this.cancelOrder(order),
      variant: 'danger',
      show: (order: Order) => ['created', 'pending_payment', 'processing'].includes(order.state),
    },
  ];

  // Card configuration for mobile
  cardConfig: ItemListCardConfig = {
    titleKey: 'order_number',
    titleTransform: (item) => `#${item.order_number}`,
    subtitleKey: 'customer_name',
    avatarFallbackIcon: 'shopping-bag',
    avatarShape: 'circle',
    badgeKey: 'state',
    badgeConfig: {
      type: 'custom',
      size: 'sm',
      colorMap: {
        created: '#6b7280',
        pending_payment: '#f59e0b',
        processing: '#3b82f6',
        shipped: '#06b6d4',
        delivered: '#10b981',
        cancelled: '#ef4444',
        refunded: '#f97316',
        finished: '#8b5cf6',
      },
    },
    badgeTransform: (value: any) => this.formatStatus(value),
    footerKey: 'grand_total',
    footerLabel: 'Total',
    footerStyle: 'prominent',
    footerTransform: (value: any) => `$${(value || 0).toFixed(2)}`,
    detailKeys: [
      {
        key: 'channel',
        label: 'Canal',
        transform: (value: any) => this.formatChannel(value),
        infoIconTransform: (value: any) => this.getChannelIcon(value),
        infoIconVariantTransform: (value: any) => this.getChannelVariant(value),
      },
      {
        key: 'created_at',
        label: 'Fecha',
        transform: (value: any) => {
          if (!value) return 'N/A';
          const date = new Date(value);
          return isNaN(date.getTime()) ? 'Invalid Date' : date.toLocaleDateString();
        },
      },
    ],
  };

  constructor(
    private ordersService: StoreOrdersService,
    private customersService: CustomersService,
    private dialogService: DialogService,
    private toastService: ToastService,
  ) { }

  ngOnInit(): void {
    this.loadOrders();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  // Computed property for hasFilters
  get hasFilters(): boolean {
    return !!(
      this.searchTerm ||
      this.selectedStatus ||
      this.selectedChannel ||
      this.selectedPaymentStatus ||
      this.selectedDateRange
    );
  }

  getEmptyStateTitle(): string {
    return this.hasFilters
      ? 'Ninguna orden coincide con sus filtros'
      : 'No se encontraron órdenes';
  }

  getEmptyStateDescription(): string {
    return this.hasFilters
      ? 'Intente ajustar sus términos de búsqueda o filtros'
      : 'Comience creando su primera orden.';
  }

  // Event handlers
  onSearchChange(term: string): void {
    this.searchTerm = term;
    this.filters.search = term;
    this.filters.page = 1;
    this.loadOrders();
  }

  onFilterChange(values: FilterValues): void {
    this.filterValues = values;
    this.selectedStatus = (values['status'] as string) || '';
    this.selectedChannel = (values['channel'] as string) || '';
    this.selectedPaymentStatus = (values['payment_status'] as string) || '';
    this.selectedDateRange = (values['date_range'] as string) || '';

    this.filters.status = this.selectedStatus ? (this.selectedStatus as OrderState) : undefined;
    this.filters.channel = this.selectedChannel ? (this.selectedChannel as OrderChannel) : undefined;
    this.filters.payment_status = this.selectedPaymentStatus ? (this.selectedPaymentStatus as PaymentStatus) : undefined;
    this.filters.date_range = this.selectedDateRange || undefined;
    this.filters.page = 1;

    this.loadOrders();
  }

  clearFilters(): void {
    this.searchTerm = '';
    this.selectedStatus = '';
    this.selectedChannel = '';
    this.selectedPaymentStatus = '';
    this.selectedDateRange = '';
    this.filterValues = {};

    this.filters.search = '';
    this.filters.status = undefined;
    this.filters.channel = undefined;
    this.filters.payment_status = undefined;
    this.filters.date_range = undefined;
    this.filters.page = 1;

    this.loadOrders();
  }

  onActionClick(action: string): void {
    switch (action) {
      case 'create':
        this.create.emit();
        break;
      case 'export':
        this.exportOrders();
        break;
    }
  }

  // Load orders with current filters
  loadOrders(): void {
    this.loading = true;

    this.ordersService
      .getOrders(this.filters)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response: any) => {
          // Unwrap ResponseService wrapper if present
          const paginatedData = response.data || response;

          const rawOrders = paginatedData.data || paginatedData || [];

          // Normalize numeric strings to numbers
          const normalizedOrders = rawOrders.map((order: any) => ({
            ...order,
            customer_id: typeof order.customer_id === 'string' ? parseInt(order.customer_id) : order.customer_id,
            grand_total: typeof order.grand_total === 'string' ? parseFloat(order.grand_total) : order.grand_total,
            subtotal_amount: typeof order.subtotal_amount === 'string' ? parseFloat(order.subtotal_amount) : order.subtotal_amount,
            tax_amount: typeof order.tax_amount === 'string' ? parseFloat(order.tax_amount) : order.tax_amount,
            shipping_cost: typeof order.shipping_cost === 'string' ? parseFloat(order.shipping_cost) : order.shipping_cost,
            discount_amount: typeof order.discount_amount === 'string' ? parseFloat(order.discount_amount) : order.discount_amount,
          }));

          // Get pagination info safely
          const paginationInfo = paginatedData.pagination || { total: rawOrders.length };
          this.totalItems = paginationInfo.total || 0;

          // Fetch customer details
          const customerIds: number[] = [...new Set<number>(normalizedOrders.map((o: any) => o.customer_id).filter((id: number) => id))];
          if (customerIds.length > 0) {
            forkJoin(customerIds.map(id => this.customersService.getCustomer(id)))
              .pipe(takeUntil(this.destroy$))
              .subscribe({
                next: (customers) => {
                  const customerMap = new Map(customers.map(c => [c.id, c]));
                  this.orders = normalizedOrders.map((order: any) => ({
                    ...order,
                    // Show "Consumidor Final" for anonymous sales (no customer_id), otherwise show customer name
                    customer_name: order.customer_id ? `${customerMap.get(order.customer_id)?.first_name || ''} ${customerMap.get(order.customer_id)?.last_name || ''}`.trim() || 'N/A' : 'Consumidor Final'
                  }));

                  this.loading = false;
                },
                error: (error) => {
                  console.error('Error loading customers:', error);
                  this.orders = normalizedOrders.map((order: any) => ({
                    ...order,
                    customer_name: order.customer_id ? 'N/A' : 'Consumidor Final'
                  }));
                  this.loading = false;
                }
              });
          } else {
            // No customer IDs to fetch, show "Consumidor Final" for orders without customer
            this.orders = normalizedOrders.map((order: any) => ({
              ...order,
              customer_name: order.customer_id ? 'N/A' : 'Consumidor Final'
            }));
            this.loading = false;
          }
        },
        error: (error: any) => {
          console.error('Error loading orders:', error);
          this.toastService.error('Failed to load orders. Please try again.');
          this.loading = false;
        },
      });
  }

  // Pagination and sorting
  onPageChange(page: number): void {
    if (this.filters.page !== undefined) {
      this.filters.page = page;
      this.loadOrders();
    }
  }

  onSort(event: { column: string; direction: 'asc' | 'desc' | null }): void {
    if (event.direction) {
      this.filters.sort_by = event.column as any;
      this.filters.sort_order = event.direction;
      this.loadOrders();
    }
  }

  // Actions
  handleViewOrder(orderId: string): void {
    this.viewOrder.emit(orderId);
  }

  viewOrderDetails(order: Order): void {
    this.viewOrder.emit(order.id.toString());
  }

  async cancelOrder(order: Order): Promise<void> {
    const confirmed = await this.dialogService.confirm({
      title: 'Cancelar Orden',
      message: `¿Estás seguro de que deseas cancelar la orden ${order.order_number}? Esta acción no se puede deshacer.`,
      confirmText: 'Cancelar Orden',
      cancelText: 'Volver',
    });

    if (confirmed) {
      this.ordersService.updateOrderStatus(order.id.toString(), 'cancelled').pipe(takeUntil(this.destroy$)).subscribe({
        next: () => {
          this.toastService.success('Orden cancelada exitosamente');
          this.loadOrders();
          this.refresh.emit();
        },
        error: (error: any) => {
          console.error('Error cancelling order:', error);
          this.toastService.error('Error al cancelar la orden. Por favor intenta nuevamente.');
        }
      });
    }
  }

  exportOrders(): void {
    this.ordersService
      .exportOrders(this.filters)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: (response: any) => {
          // Handle file download
          const blob = new Blob([response], { type: 'text/csv' });
          const url = window.URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `orders_${new Date().toISOString().split('T')[0]}.csv`;
          a.click();
          window.URL.revokeObjectURL(url);
        },
        error: (error: any) => {
          console.error('Error exporting orders:', error);
          this.toastService.error('Failed to export orders. Please try again.');
        },
      });
  }

  // Helper methods for formatting
  formatStatus(status: string | undefined): string {
    if (!status) return 'Unknown';
    const statusMap: Record<string, string> = {
      created: 'Creada',
      pending_payment: 'Pago Pendiente',
      processing: 'Procesando',
      shipped: 'Enviada',
      delivered: 'Entregada',
      cancelled: 'Cancelada',
      refunded: 'Reembolsada',
      finished: 'Finalizada',
    };
    return statusMap[status] || status.charAt(0).toUpperCase() + status.slice(1);
  }

  formatChannel(channel: string | undefined): string {
    if (!channel) return 'N/A';
    const channelMap: Record<string, string> = {
      pos: 'POS',
      ecommerce: 'Online',
      agent: 'IA',
      whatsapp: 'WhatsApp',
      marketplace: 'Marketplace',
    };
    return channelMap[channel] || channel.charAt(0).toUpperCase() + channel.slice(1);
  }

  getChannelIcon(channel: string | undefined): string | undefined {
    if (!channel) return undefined;
    const iconMap: Record<string, string> = {
      pos: 'monitor',
      ecommerce: 'shopping-cart',
      agent: 'cpu',
      whatsapp: 'message-circle',
      marketplace: 'shopping-bag',
    };
    return iconMap[channel] || 'globe';
  }

  getChannelVariant(channel: string | undefined): 'primary' | 'warning' | 'danger' | 'success' | 'default' | undefined {
    if (!channel) return undefined;
    const variantMap: Record<string, 'primary' | 'warning' | 'danger' | 'success' | 'default'> = {
      pos: 'primary',
      ecommerce: 'success',
      agent: 'warning',
      whatsapp: 'success',
      marketplace: 'warning',
    };
    return variantMap[channel] || 'default';
  }

  // Math utility for template
  get totalPages(): number {
    return Math.ceil(this.totalItems / (this.filters.limit || 10));
  }
}
