import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { ButtonComponent } from '../../../../../shared/components/button/button.component';
import { OrdersService } from '../services/orders.service';
import { SalesOrder } from '../interfaces/order.interface';

@Component({
  selector: 'app-order-details',
  standalone: true,
  imports: [CommonModule, ButtonComponent],
  template: `
    <div class="p-6">
      <div class="mb-6">
        <app-button (clicked)="goBack()" variant="ghost" class="mb-4">
          ← Back to Orders
        </app-button>
        <h1 class="text-3xl font-bold text-gray-900 mb-2">Order Details</h1>
        <p class="text-gray-600">View and manage order information</p>
      </div>

      <div *ngIf="order" class="space-y-6">
        <!-- Order Header -->
        <div class="bg-white rounded-lg shadow-sm border p-6">
          <div class="flex justify-between items-start">
            <div>
              <h2 class="text-xl font-semibold text-gray-900">
                Order #{{ order.orderNumber }}
              </h2>
              <p class="text-gray-600">Customer: {{ order.customer?.name }}</p>
              <p class="text-gray-600">
                Created: {{ order.createdAt | date: 'medium' }}
              </p>
            </div>
            <div class="text-right">
              <span
                class="inline-flex px-3 py-1 text-sm font-medium rounded-full"
                [class]="'status-' + order.status.toLowerCase()"
              >
                {{ order.status }}
              </span>
              <p class="text-2xl font-bold text-gray-900 mt-2">
                \${{ order.totalAmount.toFixed(2) }}
              </p>
            </div>
          </div>
        </div>

        <!-- Order Items -->
        <div class="bg-white rounded-lg shadow-sm border p-6">
          <h3 class="text-lg font-semibold text-gray-900 mb-4">Order Items</h3>
          <div class="overflow-x-auto">
            <table class="min-w-full divide-y divide-gray-200">
              <thead class="bg-gray-50">
                <tr>
                  <th
                    class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                  >
                    Product
                  </th>
                  <th
                    class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                  >
                    Quantity
                  </th>
                  <th
                    class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                  >
                    Unit Price
                  </th>
                  <th
                    class="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                  >
                    Total
                  </th>
                </tr>
              </thead>
              <tbody class="bg-white divide-y divide-gray-200">
                <tr *ngFor="let item of order.items">
                  <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {{ item.product?.name }}
                  </td>
                  <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    {{ item.quantity }}
                  </td>
                  <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    \${{ item.unitPrice.toFixed(2) }}
                  </td>
                  <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                    \${{ item.totalPrice.toFixed(2) }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- Actions -->
        <div class="flex justify-end space-x-2">
          <app-button (clicked)="editOrder()" variant="secondary"
            >Edit Order</app-button
          >
          <app-button
            (clicked)="cancelOrder()"
            variant="danger"
            *ngIf="order.status !== 'CANCELLED'"
            >Cancel Order</app-button
          >
        </div>
      </div>

      <div *ngIf="loading" class="text-center py-12">
        <p class="text-gray-600">Loading order details...</p>
      </div>

      <div *ngIf="error" class="bg-red-50 border border-red-200 rounded-md p-4">
        <p class="text-red-800">{{ error }}</p>
      </div>
    </div>
  `,
  styles: [
    `
      .status-pending {
        background-color: #fef3c7;
        color: #92400e;
      }
      .status-confirmed {
        background-color: #dbeafe;
        color: #1e40af;
      }
      .status-shipped {
        background-color: #e0e7ff;
        color: #3730a3;
      }
      .status-invoiced {
        background-color: #d1fae5;
        color: #065f46;
      }
      .status-cancelled {
        background-color: #fee2e2;
        color: #991b1b;
      }
    `,
  ],
})
export class OrderDetailsComponent implements OnInit {
  order: SalesOrder | null = null;
  loading = false;
  error: string | null = null;

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private ordersService: OrdersService,
  ) {}

  ngOnInit() {
    const orderId = this.route.snapshot.paramMap.get('id');
    if (orderId) {
      this.loadOrder(+orderId);
    }
  }

  loadOrder(id: number) {
    this.loading = true;
    this.error = null;

    this.ordersService.getSalesOrder(id).subscribe({
      next: (order) => {
        this.order = order;
        this.loading = false;
      },
      error: (error) => {
        this.error = 'Failed to load order details';
        this.loading = false;
        console.error('Error loading order:', error);
      },
    });
  }

  goBack() {
    this.router.navigate(['/store/orders/list']);
  }

  editOrder() {
    if (this.order) {
      console.log('Edit order:', this.order.id);
      // Implement edit functionality
    }
  }

  cancelOrder() {
    if (this.order && confirm('Are you sure you want to cancel this order?')) {
      console.log('Cancel order:', this.order.id);
      // Implement cancel functionality
    }
  }
}
