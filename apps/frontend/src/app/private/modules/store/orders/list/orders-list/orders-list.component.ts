import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-orders-list',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './orders-list.component.html',
  styleUrls: ['./orders-list.component.css'],
})
export class OrdersListComponent {}
