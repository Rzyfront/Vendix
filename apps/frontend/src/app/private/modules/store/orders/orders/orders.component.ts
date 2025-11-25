import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { OrderStatsComponent } from '../components/order-stats';
import { OrdersListComponent } from '../list/orders-list';
import { OrderDetailsComponent } from '../details/order-details';
import { Order } from '../interfaces/order.interface';

@Component({
  selector: 'app-orders',
  standalone: true,
  imports: [
    CommonModule,
    OrderStatsComponent,
    OrdersListComponent,
    OrderDetailsComponent,
  ],
  templateUrl: './orders.component.html',
  styleUrls: ['./orders.component.css'],
})
export class OrdersComponent {
  selectedOrderId: string | null = null;
  showOrderDetails = false;

  constructor(private router: Router) {}

  // Navigate to POS for new order
  createNewOrder(): void {
    this.router.navigate(['/admin/pos']);
  }

  // Show order details modal
  viewOrderDetails(orderId: string): void {
    this.selectedOrderId = orderId;
    this.showOrderDetails = true;
  }

  // Close order details modal
  closeOrderDetails(): void {
    this.showOrderDetails = false;
    this.selectedOrderId = null;
  }

  // Handle order update from details modal
  onOrderUpdated(updatedOrder: Order): void {
    // The orders list will automatically refresh when the modal closes
    // You could emit an event to refresh the list if needed
    console.log('Order updated:', updatedOrder);
  }
}
