import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, ActivatedRoute } from '@angular/router';
import { AccountService, OrderDetail } from '../../../services/account.service';

@Component({
  selector: 'app-order-detail',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './order-detail.component.html',
  styleUrls: ['./order-detail.component.scss'],
})
export class OrderDetailComponent implements OnInit {
  order: OrderDetail | null = null;
  is_loading = true;
  is_new_order = false;

  constructor(
    private account_service: AccountService,
    private route: ActivatedRoute,
  ) { }

  ngOnInit(): void {
    const order_id = this.route.snapshot.params['id'];
    this.is_new_order = this.route.snapshot.queryParams['success'] === 'true';
    this.loadOrder(+order_id);
  }

  loadOrder(order_id: number): void {
    this.is_loading = true;
    this.account_service.getOrderDetail(order_id).subscribe({
      next: (response) => {
        if (response.success) {
          this.order = response.data;
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
    };
    return classes[state] || 'default';
  }
}
