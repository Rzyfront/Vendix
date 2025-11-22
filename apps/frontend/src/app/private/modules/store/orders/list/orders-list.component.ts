import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  TableComponent,
  TableColumn,
  TableAction,
} from '../../../../../shared/components/table/table.component';
import { ButtonComponent } from '../../../../../shared/components/button/button.component';
import { ModalComponent } from '../../../../../shared/components/modal/modal.component';
import { OrdersService } from '../services/orders.service';
import { SalesOrder } from '../interfaces/order.interface';

@Component({
  selector: 'app-orders-list',
  standalone: true,
  imports: [CommonModule, TableComponent, ButtonComponent, ModalComponent],
  template: `
    <div class="p-6">
      <div class="mb-6 flex justify-between items-center">
        <div>
          <h1 class="text-3xl font-bold text-gray-900 mb-2">Sales Orders</h1>
          <p class="text-gray-600">Manage customer orders and fulfillment</p>
        </div>
        <app-button (clicked)="openCreateOrderModal()" variant="primary">
          <span slot="icon">+</span> Create Order
        </app-button>
      </div>

      <app-table
        [data]="orders"
        [columns]="columns"
        [actions]="actions"
        [loading]="loading"
        (sort)="onSort($event)"
        (rowClick)="viewOrder($event)"
      ></app-table>

      <!-- Create Order Modal -->
      <app-modal
        [(isOpen)]="showCreateModal"
        title="Create Sales Order"
        size="lg"
        (closed)="closeCreateModal()"
      >
        <div class="space-y-4">
          <p>Create order functionality will be implemented here.</p>
          <p>
            This will include customer selection, product selection, and order
            details.
          </p>
        </div>
        <div slot="footer" class="flex justify-end space-x-2">
          <app-button (clicked)="closeCreateModal()" variant="ghost"
            >Cancel</app-button
          >
          <app-button (clicked)="createOrder()" variant="primary"
            >Create Order</app-button
          >
        </div>
      </app-modal>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        width: 100%;
      }
    `,
  ],
})
export class OrdersListComponent implements OnInit {
  orders: SalesOrder[] = [];
  loading = false;
  showCreateModal = false;

  columns: TableColumn[] = [
    {
      key: 'orderNumber',
      label: 'Order #',
      sortable: true,
      width: '120px',
    },
    {
      key: 'customer.name',
      label: 'Customer',
      sortable: true,
    },
    {
      key: 'totalAmount',
      label: 'Total',
      sortable: true,
      align: 'right',
      width: '120px',
      transform: (value: number) => `$${value.toFixed(2)}`,
    },
    {
      key: 'status',
      label: 'Status',
      sortable: true,
      width: '120px',
      badge: true,
      badgeConfig: {
        type: 'status',
        size: 'sm',
      },
      transform: (value: string) =>
        value.charAt(0) + value.slice(1).toLowerCase(),
    },
    {
      key: 'createdAt',
      label: 'Created',
      sortable: true,
      width: '150px',
      transform: (value: string) => new Date(value).toLocaleDateString(),
    },
  ];

  actions: TableAction[] = [
    {
      label: 'View',
      icon: '👁️',
      action: (order: SalesOrder) => this.viewOrder(order),
      variant: 'ghost',
    },
    {
      label: 'Edit',
      icon: '✏️',
      action: (order: SalesOrder) => this.editOrder(order),
      variant: 'ghost',
      disabled: (order: SalesOrder) => order.status === 'CANCELLED',
    },
    {
      label: 'Delete',
      icon: '🗑️',
      action: (order: SalesOrder) => this.deleteOrder(order),
      variant: 'danger',
      disabled: (order: SalesOrder) => order.status !== 'PENDING',
    },
  ];

  constructor(private ordersService: OrdersService) {}

  ngOnInit() {
    this.loadOrders();
  }

  loadOrders() {
    this.loading = true;
    this.ordersService.getSalesOrders().subscribe({
      next: (response) => {
        this.orders = response.data;
        this.loading = false;
      },
      error: (error) => {
        console.error('Error loading orders:', error);
        this.loading = false;
      },
    });
  }

  onSort(event: { column: string; direction: 'asc' | 'desc' | null }) {
    console.log('Sort:', event);
    // Implement sorting logic
  }

  viewOrder(order: SalesOrder) {
    console.log('View order:', order);
    // Navigate to order details
  }

  editOrder(order: SalesOrder) {
    console.log('Edit order:', order);
    // Open edit modal
  }

  deleteOrder(order: SalesOrder) {
    console.log('Delete order:', order);
    // Show confirmation dialog
  }

  openCreateOrderModal() {
    this.showCreateModal = true;
  }

  closeCreateModal() {
    this.showCreateModal = false;
  }

  createOrder() {
    console.log('Creating order...');
    // Implement create order logic
    this.closeCreateModal();
  }
}
