import { Component, OnInit, OnDestroy, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { FormBuilder, FormGroup } from '@angular/forms';
import { Subscription } from 'rxjs';
import { environment } from '../../../../../environments/environment';

import {
  OrderListItem,
  OrderStats,
  OrderStatus,
  PaymentStatus,
  OrderType,
  OrderStore,
} from './interfaces/order.interface';

// Import shared components
import {
  TableColumn,
  TableAction,
  InputsearchComponent,
  ButtonComponent,
  IconComponent,
  ResponsiveDataViewComponent,
  ItemListCardConfig,
} from '../../../../shared/components/index';

// Import order components
import { OrderStatsComponent } from './components/order-stats.component';
import { CurrencyFormatService } from '../../../../shared/pipes/currency/currency.pipe';
import { OrderCreateModalComponent } from './components/order-create-modal.component';

// Import styles
import './orders-list.component.css';

@Component({
  selector: 'app-orders-list',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    InputsearchComponent,
    ButtonComponent,
    OrderStatsComponent,
    OrderCreateModalComponent,
    IconComponent,
    ResponsiveDataViewComponent,
  ],
  templateUrl: './orders-list.component.html',
})
export class OrdersListComponent implements OnInit, OnDestroy {
  orders: OrderListItem[] = [];
  isLoading = false;
  searchTerm = '';
  selectedStatus = '';
  selectedPaymentStatus = '';
  selectedStore = '';
  selectedOrderType = '';
  selectedDateFrom = '';
  selectedDateTo = '';

  stats: OrderStats = {
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
  };

  cardConfig!: ItemListCardConfig;

  // Table configuration
  tableColumns: TableColumn[] = [
    {
      key: 'order_date',
      label: 'Date & Time',
      sortable: true,
      width: '180px',
      transform: (value: string) => this.formatDate(value),
    },
    {
      key: 'customer',
      label: 'Customer',
      sortable: true,
      width: '150px',
      transform: (customer: any) =>
        `${customer.first_name} ${customer.last_name}`,
    },
    {
      key: 'order_number',
      label: 'Order #',
      sortable: true,
      width: '120px',
    },
    {
      key: 'store',
      label: 'Store',
      sortable: true,
      width: '120px',
      transform: (store: any) => store.name,
    },
    {
      key: 'order_type',
      label: 'Type',
      sortable: true,
      width: '100px',
    },
    {
      key: 'status',
      label: 'Status',
      sortable: true,
      width: '100px',
      align: 'center',
      badge: true,
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
      transform: (value: string) =>
        value.charAt(0) + value.slice(1).toLowerCase(),
    },
    {
      key: 'payment_status',
      label: 'Payment',
      sortable: true,
      width: '100px',
      align: 'center',
      badge: true,
      badgeConfig: {
        type: 'custom',
        size: 'sm',
        colorMap: {
          pending: '#eab308',
          paid: '#22c55e',
          failed: '#ef4444',
          refunded: '#f97316',
          partially_refunded: '#f59e0b',
        },
      },
      transform: (value: string) => value.replace('_', ' '),
    },
    {
      key: 'total_amount',
      label: 'Total',
      sortable: true,
      align: 'right',
      width: '120px',
      transform: (value: number) => `$${value.toFixed(2)}`,
    },
  ];

  tableActions: TableAction[] = [
    {
      label: 'View Details',
      icon: 'eye',
      action: (order: OrderListItem) => this.viewOrderDetails(order),
      variant: 'primary',
    },
    {
      label: 'Print Invoice',
      icon: 'file-text',
      action: (order: OrderListItem) => this.printInvoice(order),
      variant: 'ghost',
    },
  ];

  // Available stores for filter
  availableStores: Array<{ id: string; name: string }> = [];

  // Create Order Modal
  showCreateOrderModal = false;
  storeOptionsForModal: Array<{ label: string; value: string }> = [];

  // Filter form
  filterForm!: FormGroup;

  private subscriptions: Subscription[] = [];
  private currencyService = inject(CurrencyFormatService);

  constructor(private fb: FormBuilder) {
    this.initializeFilterForm();
    this.initializeTableConfig();
  }

  private initializeTableConfig(): void {
    this.tableColumns = [
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
          `${customer.first_name} ${customer.last_name}`,
      },
      {
        key: 'store',
        label: 'Store',
        sortable: true,
        priority: 2,
        transform: (store: any) => store.name,
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
        transform: (value: number) => `$${value.toFixed(2)}`,
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
          value.charAt(0) + value.slice(1).toLowerCase(),
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
        transform: (value: string) => value.replace('_', ' '),
      },
    ];

    this.tableActions = [
      {
        label: 'View Details',
        icon: '👁️',
        action: (order: OrderListItem) => this.viewOrderDetails(order),
        variant: 'ghost',
      },
      {
        label: 'Print Invoice',
        icon: '🖨️',
        action: (order: OrderListItem) => this.printInvoice(order),
        variant: 'ghost',
      },
    ];

    // Card configuration for mobile
    this.cardConfig = {
      titleKey: 'order_number',
      subtitleKey: 'customer',
      subtitleTransform: (c: any) => `${c.first_name} ${c.last_name}`,
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
        value.charAt(0).toUpperCase() + value.slice(1).toLowerCase(),
      detailKeys: [
        { key: 'store.name', label: 'Store', icon: 'shopping-bag' },
        { key: 'total_amount', label: 'Total', transform: (v: number) => `$${v.toFixed(2)}` },
        { key: 'order_date', label: 'Date', transform: (v: string) => this.formatDate(v) },
      ],
    };
  }

  ngOnInit(): void {
    this.currencyService.loadCurrency();
    this.loadOrders();
    this.loadStats();
    this.loadAvailableStores();
  }

  ngOnDestroy(): void {
    this.subscriptions.forEach((sub) => sub.unsubscribe());
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
    // TODO: Replace with actual API call
    // For now, generate mock stores
    this.availableStores = [
      { id: 'store_1', name: 'Main Street Store' },
      { id: 'store_2', name: 'Downtown Store' },
      { id: 'store_3', name: 'Mall Store' },
      { id: 'store_4', name: 'Online Store' },
    ];

    // Also populate store options for modal
    this.storeOptionsForModal = this.availableStores.map((store) => ({
      label: store.name,
      value: store.id,
    }));
  }

  loadOrders(): void {
    this.isLoading = true;

    // Build query parameters
    const params = new URLSearchParams();
    if (this.searchTerm) params.append('search', this.searchTerm);
    if (this.selectedStatus) params.append('status', this.selectedStatus);
    if (this.selectedPaymentStatus)
      params.append('payment_status', this.selectedPaymentStatus);
    if (this.selectedStore) params.append('store_id', this.selectedStore);
    if (this.selectedOrderType)
      params.append('order_type', this.selectedOrderType);
    if (this.selectedDateFrom)
      params.append('date_from', this.selectedDateFrom);
    if (this.selectedDateTo) params.append('date_to', this.selectedDateTo);
    params.append('page', '1');
    params.append('limit', '100');

    // Make real API call
    fetch(`${environment.apiUrl}/orders?${params.toString()}`, {
      headers: {
        Authorization: `Bearer ${localStorage.getItem('token')}`,
        'Content-Type': 'application/json',
      },
    })
      .then((response) => response.json())
      .then((response: any) => {
        console.log('API Response:', response); // Debug log
        if (response.data && response.data.length > 0) {
          console.log('Using REAL data from API'); // Debug log
          // Transform backend data to frontend format
          this.orders = response.data.map((order: any) => ({
            id: order.id.toString(),
            order_number: order.order_number,
            customer: {
              id: order.customer_id.toString(),
              first_name: `Customer${order.customer_id}`,
              last_name: 'User',
              email: `customer${order.customer_id}@example.com`,
            },
            store: {
              id: order.store.id.toString(),
              name: order.store.name,
              slug:
                order.store.store_code ||
                order.store.name.toLowerCase().replace(/\s+/g, '-'),
            },
            order_type: order.order_type || 'sale',
            status: order.state,
            payment_status: order.payment_status || 'pending',
            total_amount: parseFloat(order.grand_total),
            subtotal: parseFloat(order.subtotal_amount),
            tax_amount: parseFloat(order.tax_amount),
            shipping_amount: parseFloat(order.shipping_cost),
            discount_amount: parseFloat(order.discount_amount),
            currency: order.currency,
            order_date: order.created_at,
            items_count: order.order_items?.length || 0,
            notes: order.internal_notes || '',
            created_at: order.created_at,
            updated_at: order.updated_at,
          }));
        } else {
          console.log('Using MOCK data - API returned no data'); // Debug log
          // Fallback to mock data if API fails
          this.orders = this.generateMockOrders();
        }
        this.isLoading = false;
      })
      .catch((error) => {
        console.error('Error loading orders:', error);
        console.log('Using MOCK data - API call failed'); // Debug log
        // Fallback to mock data
        this.orders = this.generateMockOrders();
        this.isLoading = false;
      });
  }

  private generateMockOrders(): OrderListItem[] {
    const mockOrders: OrderListItem[] = [];
    const statuses = Object.values(OrderStatus);
    const paymentStatuses = Object.values(PaymentStatus);

    for (let i = 0; i < 50; i++) {
      const date = new Date();
      date.setDate(date.getDate() - Math.floor(Math.random() * 30));

      mockOrders.push({
        id: `order_${i + 1}`,
        order_number: `ORD-${String(i + 1).padStart(5, '0')}`,
        customer: {
          id: `customer_${Math.floor(Math.random() * 100)}`,
          first_name: `Customer${Math.floor(Math.random() * 100)}`,
          last_name: `Name${Math.floor(Math.random() * 100)}`,
          email: `customer${Math.floor(Math.random() * 100)}@example.com`,
        },
        store: {
          id: `store_${Math.floor(Math.random() * 10)}`,
          name: `Store ${Math.floor(Math.random() * 10) + 1}`,
          slug: `store-${Math.floor(Math.random() * 10) + 1}`,
        },
        order_type: OrderType.SALE,
        status: statuses[
          Math.floor(Math.random() * statuses.length)
        ] as OrderStatus,
        payment_status: paymentStatuses[
          Math.floor(Math.random() * paymentStatuses.length)
        ] as PaymentStatus,
        total_amount: Math.floor(Math.random() * 1000) + 50,
        subtotal: 0,
        tax_amount: 0,
        shipping_amount: 0,
        discount_amount: 0,
        currency: this.currencyService.currencyCode() || 'USD',
        order_date: date.toISOString(),
        items_count: Math.floor(Math.random() * 10) + 1,
        notes: '',
        created_at: date.toISOString(),
        updated_at: date.toISOString(),
      });
    }

    return mockOrders.sort(
      (a, b) =>
        new Date(b.order_date).getTime() - new Date(a.order_date).getTime(),
    );
  }

  loadStats(): void {
    // TODO: Replace with actual API call
    // For now, calculate from loaded data
    this.updateStats();
  }

  updateStats(): void {
    this.stats.total_orders = this.orders.length;
    this.stats.pending_orders = this.orders.filter(
      (order) => order.status === OrderStatus.PENDING,
    ).length;
    this.stats.confirmed_orders = this.orders.filter(
      (order) => order.status === OrderStatus.CONFIRMED,
    ).length;
    this.stats.processing_orders = this.orders.filter(
      (order) => order.status === OrderStatus.PROCESSING,
    ).length;
    this.stats.shipped_orders = this.orders.filter(
      (order) => order.status === OrderStatus.SHIPPED,
    ).length;
    this.stats.delivered_orders = this.orders.filter(
      (order) => order.status === OrderStatus.DELIVERED,
    ).length;
    this.stats.cancelled_orders = this.orders.filter(
      (order) => order.status === OrderStatus.CANCELLED,
    ).length;
    this.stats.refunded_orders = this.orders.filter(
      (order) => order.status === OrderStatus.REFUNDED,
    ).length;

    this.stats.total_revenue = this.orders
      .filter((order) => order.payment_status === PaymentStatus.PAID)
      .reduce((sum, order) => sum + order.total_amount, 0);

    this.stats.pending_revenue = this.orders
      .filter((order) => order.payment_status === PaymentStatus.PENDING)
      .reduce((sum, order) => sum + order.total_amount, 0);

    this.stats.average_order_value =
      this.orders.length > 0
        ? this.orders.reduce((sum, order) => sum + order.total_amount, 0) /
        this.orders.length
        : 0;
  }

  refreshOrders(): void {
    this.loadOrders();
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

  exportOrders(): void {
    if (this.orders.length === 0) {
      console.log('No orders to export');
      return;
    }

    try {
      // Create CSV content
      const csvContent = this.generateCSV();

      // Create blob and download
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      const url = URL.createObjectURL(blob);

      link.setAttribute('href', url);
      link.setAttribute(
        'download',
        `orders_export_${new Date().toISOString().split('T')[0]}.csv`,
      );
      link.style.visibility = 'hidden';

      // Append to body, click, and clean up
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      console.log('Orders exported successfully');
    } catch (error) {
      console.error('Error exporting orders:', error);
    }
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

    const rows = this.orders.map((order) => [
      order.order_number,
      `${order.customer.first_name} ${order.customer.last_name}`,
      order.store.name,
      order.order_type,
      order.status,
      order.payment_status,
      order.total_amount.toString(),
      this.formatDate(order.order_date),
    ]);

    // Combine headers and rows
    const csvContent = [headers, ...rows]
      .map((row) => row.map((cell) => `"${cell}"`).join(','))
      .join('\n');

    return csvContent;
  }

  // Helper methods
  formatDate(dateString: string): string {
    return new Date(dateString).toLocaleDateString('es-ES', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  }

  formatCurrency(amount: number): string {
    return this.currencyService.format(amount);
  }

  getStatusClass(status: string): string {
    const colorMap: Record<string, string> = {
      pending: 'text-yellow-600 bg-yellow-100',
      confirmed: 'text-blue-600 bg-blue-100',
      processing: 'text-purple-600 bg-purple-100',
      shipped: 'text-indigo-600 bg-indigo-100',
      delivered: 'text-green-600 bg-green-100',
      cancelled: 'text-red-600 bg-red-100',
      refunded: 'text-orange-600 bg-orange-100',
    };
    return colorMap[status] || 'text-gray-600 bg-gray-100';
  }

  getPaymentStatusClass(status: string): string {
    const colorMap: Record<string, string> = {
      pending: 'text-yellow-600 bg-yellow-100',
      paid: 'text-green-600 bg-green-100',
      failed: 'text-red-600 bg-red-100',
      refunded: 'text-orange-600 bg-orange-100',
      partially_refunded: 'text-orange-500 bg-orange-100',
    };
    return colorMap[status] || 'text-gray-600 bg-gray-100';
  }

  printInvoice(order: OrderListItem): void {
    console.log(`Printing invoice for order ${order.order_number}`);
  }

  onTableSort(sortEvent: {
    column: string;
    direction: 'asc' | 'desc' | null;
  }): void {
    console.log('Sort event:', sortEvent);
    // TODO: Implement server-side sorting
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

  // Create Order Modal Methods
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
    console.log('New order created:', orderData);

    // Transform the created order data to match frontend format
    const newOrder: OrderListItem = {
      id: orderData.id?.toString() || `order_${Date.now()}`,
      order_number:
        orderData.order_number ||
        `ORD-${String(this.orders.length + 1).padStart(5, '0')}`,
      customer: {
        id: orderData.customer_id?.toString() || '1',
        first_name: `Customer${orderData.customer_id || 1}`,
        last_name: 'New',
        email: `customer${orderData.customer_id || 1}@example.com`,
      },
      store: {
        id: orderData.store_id?.toString() || '1',
        name: orderData.stores?.name || `Store ${orderData.store_id || 1}`,
        slug:
          orderData.stores?.store_code || `store-${orderData.store_id || 1}`,
      },
      order_type: orderData.order_type || 'sale',
      status: orderData.state || OrderStatus.PENDING,
      payment_status: orderData.payment_status || PaymentStatus.PENDING,
      total_amount: parseFloat(orderData.grand_total) || 0,
      subtotal: parseFloat(orderData.subtotal_amount) || 0,
      tax_amount: parseFloat(orderData.tax_amount) || 0,
      shipping_amount: parseFloat(orderData.shipping_cost) || 0,
      discount_amount: parseFloat(orderData.discount_amount) || 0,
      currency: orderData.currency || this.currencyService.currencyCode() || 'USD',
      order_date: orderData.created_at || new Date().toISOString(),
      items_count: orderData.order_items?.length || 1,
      notes: orderData.internal_notes || '',
      created_at: orderData.created_at || new Date().toISOString(),
      updated_at: orderData.updated_at || new Date().toISOString(),
    };

    // Add the new order to the beginning of the list
    this.orders.unshift(newOrder);

    // Refresh stats to include the new order
    this.updateStats();
  }
}
