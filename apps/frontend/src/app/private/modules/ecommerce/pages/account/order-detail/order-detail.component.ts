import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, ActivatedRoute } from '@angular/router';
import { AccountService, OrderDetail } from '../../../services/account.service';
import { IconComponent } from '../../../../../../shared/components/icon/icon.component';
import { CurrencyPipe } from '../../../../../../shared/pipes/currency';

@Component({
  selector: 'app-order-detail',
  standalone: true,
  imports: [CommonModule, RouterModule, IconComponent, CurrencyPipe],
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

  get totalItems(): number {
    if (!this.order) return 0;
    return this.order.items.reduce((sum, item) => sum + item.quantity, 0);
  }

  getVariantLabel(item: any): string {
    if (item.variant_attributes && typeof item.variant_attributes === 'object') {
      const values = Object.values(item.variant_attributes);
      if (values.length > 0) return values.join(' · ');
    }
    return item.variant_sku || '';
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

  getStateIcon(state: string): string {
    const icons: Record<string, string> = {
      pending: 'clock',
      confirmed: 'check-circle',
      processing: 'loader-2',
      shipped: 'truck',
      delivered: 'package-check',
      completed: 'check-circle',
      cancelled: 'circle-x',
    };
    return icons[state] || 'circle';
  }

  getPaymentMethodLabel(method: string | null): string {
    if (!method) return 'Método de pago';
    const labels: Record<string, string> = {
      cash: 'Efectivo',
      card: 'Tarjeta',
      transfer: 'Transferencia',
      cash_on_delivery: 'Contra entrega',
    };
    return labels[method] || method;
  }

  getPaymentIcon(method: string | null): string {
    if (!method) return 'credit-card';
    const icons: Record<string, string> = {
      cash: 'banknote',
      card: 'credit-card',
      transfer: 'send',
      cash_on_delivery: 'coins',
    };
    return icons[method] || 'credit-card';
  }
}
