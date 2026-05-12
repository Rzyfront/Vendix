import {
  Component,
  DestroyRef,
  OnInit,
  inject,
  signal,
  computed,
} from '@angular/core';
import { FormBuilder, FormGroup } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { environment } from '../../../../../environments/environment';

import {
  OrderListItem,
  OrderStats,
  OrderStatus,
  PaymentStatus,
  OrderType,
} from './interfaces/order.interface';

import {
  TableColumn,
  TableAction,
  InputsearchComponent,
  ButtonComponent,
  IconComponent,
  ResponsiveDataViewComponent,
  ItemListCardConfig,
} from '../../../../shared/components/index';

import { OrderStatsComponent } from './components/order-stats.component';
import { CurrencyFormatService } from '../../../../shared/pipes/currency/currency.pipe';
import { OrderCreateModalComponent } from './components/order-create-modal.component';
import { OrganizationOrdersService } from './services/organization-orders.service';

import './orders-list.component.css';

@Component({
  selector: 'app-orders-list',
  standalone: true,
  imports: [
    InputsearchComponent,
    ButtonComponent,
    OrderStatsComponent,
    OrderCreateModalComponent,
    IconComponent,
    ResponsiveDataViewComponent,
  ],
  templateUrl: './orders-list.component.html',
})
export class OrdersListComponent implements OnInit {
  private ordersService = inject(OrganizationOrdersService);
  private currencyService = inject(CurrencyFormatService);
  private fb = inject(FormBuilder);
  private destroyRef = inject(DestroyRef);

  readonly orders = signal<OrderListItem[]>([]);
  readonly isLoading = signal(false);
  readonly stats = signal<OrderStats>({
    total_orders: 0,
    pending_orders: 0,
    confirmed_orders: 0,
    processing_orders: 0,
    shipped_orders: 0,
    delivered_orders: 0,
    cancelled_orders: 0,
    refunded_orders: 0,
    total_revenue: 0,
    pending_revenue: 0,
    average_order_value: 0,
    orders_by_status: {} as any,
    orders_by_payment_status: {} as any,
    orders_by_store: [],
    recent_orders: [],
  });

  searchTerm = '';
  selectedStatus = '';
  selectedPaymentStatus = '';
  selectedStore = '';
  selectedOrderType = '';
  selectedDateFrom = '';
  selectedDateTo = '';

  cardConfig!: ItemListCardConfig;

  tableColumns: TableColumn[] = [
    {
      key: 'order_number',
      label: 'Order #',
      sortable: true,
      width: '120px',
      priority: 1,
    },
    {
      key: 'customer',
      label: 'Customer',
      sortable: true,
      priority: 1,
      transform: (customer: any) =>
        customer ? `${customer.first_name} ${customer.last_name}` : 'Guest',
    },
    {
      key: 'store',
      label: 'Store',
      sortable: true,
      priority: 2,
      transform: (store: any) => store?.name || 'N/A',
    },
    {
      key: 'order_date',
      label: 'Date',
      sortable: true,
      width: '120px',
      priority: 3,
      transform: (date: string) => this.formatDate(date),
    },
    {
      key: 'total_amount',
      label: 'Total',
      sortable: true,
      align: 'right',
      width: '120px',
      priority: 1,
      transform: (value: number) => this.formatCurrency(value),
    },
    {
      key: 'estimated_delivered_at',
      label: 'ETA',
      sortable: false,
      width: '100px',
      priority: 3,
      transform: (_: any, item: any) =>
        this.formatEta(item?.estimated_ready_at, item?.estimated_delivered_at),
    },
    {
      key: 'status',
      label: 'Status',
      sortable: true,
      width: '120px',
      badge: true,
      priority: 1,
      badgeConfig: {
        type: 'status',
        size: 'sm',
      },
      transform: (value: string) =>
        value ? value.charAt(0) + value.slice(1).toLowerCase() : 'Unknown',
    },
    {
      key: 'payment_status',
      label: 'Payment',
      sortable: true,
      width: '120px',
      badge: true,
      priority: 2,
      badgeConfig: {
        type: 'status',
        size: 'sm',
      },
      transform: (value: string) => value?.replace('_', ' ') || 'Unknown',
    },
  ];

  tableActions: TableAction[] = [
    {
      label: 'View Details',
      icon: 'eye',
      action: (order: OrderListItem) => this.viewOrderDetails(order),
      variant: 'ghost',
    },
    {
      label: 'Print Invoice',
      icon: 'file-text',
      action: (order: OrderListItem) => this.printInvoice(order),
      variant: 'ghost',
    },
  ];

  availableStores: Array<{ id: string; name: string }> = [];

  showCreateOrderModal = false;
  storeOptionsForModal: Array<{ label: string; value: string }> = [];

  filterForm!: FormGroup;

  constructor() {
    this.initializeFilterForm();
    this.initializeTableConfig();
  }

  private initializeTableConfig(): void {
    this.cardConfig = {
      titleKey: 'order_number',
      subtitleKey: 'customer',
      subtitleTransform: (c: any) =>
        c ? `${c.first_name} ${c.last_name}` : 'Guest',
      badgeKey: 'status',
      badgeConfig: {
        type: 'custom',
        size: 'sm',
        colorMap: {
          pending: '#eab308',
          confirmed: '#3b82f6',
          processing: '#8b5cf6',
          shipped: '#6366f1',
          delivered: '#22c55e',
          cancelled: '#ef4444',
          refunded: '#f97316',
        },
      },
      badgeTransform: (value: string) =>
        value ? value.charAt(0).toUpperCase() + value.slice(1).toLowerCase() : 'Unknown',
      detailKeys: [
        { key: 'store.name', label: 'Store', icon: 'shopping-bag' },
        {
          key: 'total_amount',
          label: 'Total',
          transform: (v: number) => this.formatCurrency(v),
        },
        {
          key: 'order_date',
          label: 'Date',
          transform: (v: string) => this.formatDate(v),
        },
        {
          key: 'estimated_delivered_at',
          label: 'ETA',
          transform: (_: any, item: any) =>
            this.formatEta(item?.estimated_ready_at, item?.estimated_delivered_at),
        },
      ],
    };
  }

  ngOnInit(): void {
    this.currencyService.loadCurrency();
    this.loadOrders();
    this.loadStats();
    this.loadAvailableStores();
  }

  private initializeFilterForm(): void {
    this.filterForm = this.fb.group({
      search: [''],
      status: [''],
      payment_status: [''],
      store_id: [''],
      order_type: [''],
      date_from: [''],
      date_to: [''],
    });
  }

  get hasFilters(): boolean {
    return !!(
      this.searchTerm ||
      this.selectedStatus ||
      this.selectedPaymentStatus ||
      this.selectedStore ||
      this.selectedOrderType ||
      this.selectedDateFrom ||
      this.selectedDateTo
    );
  }

  loadAvailableStores(): void {
    this.availableStores = [];
    this.storeOptionsForModal = [];
  }

  loadOrders(): void {
    this.isLoading.set(true);

    const queryParams: any = {
      page: 1,
      limit: 100,
    };

    if (this.searchTerm) queryParams.search = this.searchTerm;
    if (this.selectedStatus) queryParams.status = this.selectedStatus;
    if (this.selectedPaymentStatus) queryParams.payment_status = this.selectedPaymentStatus;
    if (this.selectedStore) queryParams.store_id = this.selectedStore;
    if (this.selectedOrderType) queryParams.order_type = this.selectedOrderType;
    if (this.selectedDateFrom) queryParams.date_from = this.selectedDateFrom;
    if (this.selectedDateTo) queryParams.date_to = this.selectedDateTo;

    this.ordersService
      .getOrders(queryParams)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          if (response.success && response.data) {
            this.orders.set(response.data);
          } else {
            this.orders.set([]);
          }
          this.isLoading.set(false);
        },
        error: (error) => {
          console.error('Error loading orders:', error);
          this.orders.set([]);
          this.isLoading.set(false);
        },
      });
  }

  loadStats(): void {
    const params: any = {};
    if (this.selectedStore) params.store_id = this.selectedStore;
    if (this.selectedDateFrom) params.date_from = this.selectedDateFrom;
    if (this.selectedDateTo) params.date_to = this.selectedDateTo;

    this.ordersService
      .getOrderStats(params.date_from, params.date_to, params.store_id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (response) => {
          if (response.success && response.data) {
            this.stats.set({
              ...response.data,
              orders_by_store: response.data.orders_by_store || [],
              recent_orders: [],
            });
          }
        },
        error: (error) => {
          console.error('Error loading stats:', error);
        },
      });
  }

  refreshOrders(): void {
    this.loadOrders();
    this.loadStats();
  }

  clearFilters(): void {
    this.searchTerm = '';
    this.selectedStatus = '';
    this.selectedPaymentStatus = '';
    this.selectedStore = '';
    this.selectedOrderType = '';
    this.selectedDateFrom = '';
    this.selectedDateTo = '';
    this.filterForm.reset();
    this.loadOrders();
  }

  onSearchChange(searchTerm: string): void {
    this.searchTerm = searchTerm;
    this.loadOrders();
  }

  onStatusChange(event: any): void {
    this.selectedStatus = event.target.value;
    this.loadOrders();
  }

  onPaymentStatusChange(event: any): void {
    this.selectedPaymentStatus = event.target.value;
    this.loadOrders();
  }

  onStoreChange(event: any): void {
    this.selectedStore = event.target.value;
    this.loadOrders();
  }

  onOrderTypeChange(event: any): void {
    this.selectedOrderType = event.target.value;
    this.loadOrders();
  }

  onDateFromChange(event: any): void {
    this.selectedDateFrom = event.target.value;
    this.loadOrders();
  }

  onDateToChange(event: any): void {
    this.selectedDateTo = event.target.value;
    this.loadOrders();
  }

  viewOrderDetails(order: OrderListItem): void {
    console.log('View order details:', order);
  }

  printInvoice(order: OrderListItem): void {
    this.ordersService
      .printInvoice(order.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (blob) => {
          const url = window.URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = url;
          link.download = `invoice-${order.order_number}.pdf`;
          link.click();
          window.URL.revokeObjectURL(url);
        },
        error: (error) => {
          console.error('Error printing invoice:', error);
        },
      });
  }

  exportOrders(): void {
    if (this.orders().length === 0) {
      return;
    }

    const csvContent = this.generateCSV();
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);

    link.setAttribute('href', url);
    link.setAttribute(
      'download',
      `orders_export_${new Date().toISOString().split('T')[0]}.csv`,
    );
    link.style.visibility = 'hidden';

    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  private generateCSV(): string {
    const headers = [
      'Order Number',
      'Customer Name',
      'Store',
      'Order Type',
      'Status',
      'Payment Status',
      'Total Amount',
      'Order Date',
    ];

    const rows = this.orders().map((order) => [
      order.order_number,
      order.customer ? `${order.customer.first_name} ${order.customer.last_name}` : 'Guest',
      order.store?.name || 'N/A',
      order.order_type,
      order.status,
      order.payment_status,
      order.total_amount.toString(),
      this.formatDate(order.order_date),
    ]);

    return [headers, ...rows]
      .map((row) => row.map((cell) => `"${cell}"`).join(','))
      .join('\n');
  }

  formatDate(dateString: string): string {
    if (!dateString) return 'N/A';
    return new Date(dateString).toLocaleDateString('es-CO', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  }

  formatEta(estimatedReadyAt?: string, estimatedDeliveredAt?: string): string {
    const target = estimatedDeliveredAt || estimatedReadyAt;
    if (!target) return '-';
    const date = new Date(target);
    const now = new Date();
    const diffMs = date.getTime() - now.getTime();
    const diffMin = Math.round(Math.abs(diffMs) / 60000);
    const prefix = diffMs > 0 ? 'in' : 'ago';
    if (diffMin < 60) return `${prefix} ${diffMin} min`;
    const diffHours = Math.floor(diffMin / 60);
    const remainMin = diffMin % 60;
    return `${prefix} ${diffHours}h ${remainMin}m`;
  }

  formatCurrency(amount: number): string {
    return this.currencyService.format(amount);
  }

  onTableSort(sortEvent: {
    column: string;
    direction: 'asc' | 'desc' | null;
  }): void {
    this.loadOrders();
  }

  getEmptyStateTitle(): string {
    if (this.hasFilters) {
      return 'No orders match your filters';
    }
    return 'No orders found';
  }

  getEmptyStateDescription(): string {
    if (this.hasFilters) {
      return 'Try adjusting your search terms or filters';
    }
    return 'Orders will appear here when customers make purchases';
  }

  createOrder(): void {
    this.showCreateOrderModal = true;
  }

  openCreateOrderModal(): void {
    this.showCreateOrderModal = true;
  }

  onCreateOrderModalChange(isOpen: boolean): void {
    this.showCreateOrderModal = isOpen;
  }

  onOrderCreated(orderData: any): void {
    const newOrder: OrderListItem = {
      id: orderData.id?.toString() || `order_${Date.now()}`,
      order_number: orderData.order_number || `ORD-${String(this.orders().length + 1).padStart(5, '0')}`,
      customer: orderData.customer || { id: '1', first_name: 'Guest', last_name: '', email: '' },
      store: orderData.store || { id: '1', name: 'Store', slug: 'store' },
      order_type: orderData.order_type || OrderType.SALE,
      status: orderData.status || OrderStatus.PENDING,
      payment_status: orderData.payment_status || PaymentStatus.PENDING,
      total_amount: parseFloat(orderData.total_amount) || 0,
      subtotal: parseFloat(orderData.subtotal) || 0,
      tax_amount: parseFloat(orderData.tax_amount) || 0,
      shipping_amount: parseFloat(orderData.shipping_amount) || 0,
      discount_amount: parseFloat(orderData.discount_amount) || 0,
      currency: orderData.currency || this.currencyService.currencyCode() || 'COP',
      order_date: orderData.created_at || new Date().toISOString(),
      items_count: orderData.items?.length || 1,
      notes: orderData.notes || '',
      created_at: orderData.created_at || new Date().toISOString(),
      updated_at: orderData.updated_at || new Date().toISOString(),
    };

    this.orders.update((list) => [newOrder, ...list]);
    this.loadStats();
  }
}
