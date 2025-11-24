import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { OrderStatsComponent } from '../components/order-stats';

@Component({
  selector: 'app-orders',
  standalone: true,
  imports: [CommonModule, OrderStatsComponent],
  templateUrl: './orders.component.html',
  styleUrls: ['./orders.component.css'],
})
export class OrdersComponent {}
