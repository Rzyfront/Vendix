import { Component, ChangeDetectionStrategy, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';
import { AccountService, Order } from '../../../services/account.service';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { ButtonComponent } from '../../../../../../shared/components/button/button.component';

@Component({
  selector: 'app-orders',
  standalone: true,
  imports: [CommonModule, RouterModule, IconComponent, ButtonComponent],
  templateUrl: './orders.component.html',
  styleUrls: ['./orders.component.scss'],
})
export class OrdersComponent implements OnInit {
  readonly orders = signal<Order[]>([]);
  readonly is_loading = signal(true);

  readonly current_page = signal(1);
  readonly total_pages = signal(1);

  constructor(private account_service: AccountService) { }

  ngOnInit(): void {
    this.loadOrders();
  }

  loadOrders(): void {
    this.is_loading.set(true);
    this.account_service.getOrders(this.current_page()).subscribe({
      next: (response) => {
        if (response.success) {
          this.orders.set(response.data);
          this.total_pages.set(response.meta?.total_pages || 1);
        }
        this.is_loading.set(false);
      },
      error: () => {
        this.is_loading.set(false);
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
    if (page >= 1 && page <= this.total_pages()) {
      this.current_page.set(page);
      this.loadOrders();
    }
  }
}
