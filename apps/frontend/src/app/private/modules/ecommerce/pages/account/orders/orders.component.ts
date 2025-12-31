import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { AccountService, Order } from '../../../services/account.service';

@Component({
  selector: 'app-orders',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './orders.component.html',
  styleUrls: ['./orders.component.scss'],
})
export class OrdersComponent implements OnInit {
  orders: Order[] = [];
  is_loading = true;

  current_page = 1;
  total_pages = 1;

  constructor(private account_service: AccountService) { }

  ngOnInit(): void {
    this.loadOrders();
  }

  loadOrders(): void {
    this.is_loading = true;
    this.account_service.getOrders(this.current_page).subscribe({
      next: (response) => {
        if (response.success) {
          this.orders = response.data;
          this.total_pages = response.meta?.total_pages || 1;
        }
        this.is_loading = false;
      },
      error: () => {
        this.is_loading = false;
      },
    });
  }

  getStateLabel(state: string): string {
    const labels: Record<string, string> = {
      pending: 'Pendiente',
      confirmed: 'Confirmado',
      processing: 'En proceso',
      shipped: 'Enviado',
      delivered: 'Entregado',
      completed: 'Completado',
      cancelled: 'Cancelado',
      refunded: 'Reembolsado',
    };
    return labels[state] || state;
  }

  getStateClass(state: string): string {
    const classes: Record<string, string> = {
      pending: 'warning',
      confirmed: 'info',
      processing: 'info',
      shipped: 'info',
      delivered: 'success',
      completed: 'success',
      cancelled: 'error',
      refunded: 'error',
    };
    return classes[state] || 'default';
  }

  goToPage(page: number): void {
    if (page >= 1 && page <= this.total_pages) {
      this.current_page = page;
      this.loadOrders();
    }
  }
}
