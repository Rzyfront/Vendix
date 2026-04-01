import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule, ActivatedRoute } from '@angular/router';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';
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
export class OrderDetailComponent implements OnInit, OnDestroy {
  order: OrderDetail | null = null;
  is_loading = true;
  is_new_order = false;

  // Wompi callback state
  verifyingWompiPayment = false;
  wompiPaymentVerified = false;
  private wompiPollTimer: ReturnType<typeof setInterval> | null = null;
  private destroy$ = new Subject<void>();

  constructor(
    private account_service: AccountService,
    private route: ActivatedRoute,
  ) { }

  ngOnInit(): void {
    const order_id = this.route.snapshot.params['id'];
    this.is_new_order = this.route.snapshot.queryParams['success'] === 'true';

    // Handle Wompi payment callback
    this.route.queryParams.pipe(takeUntil(this.destroy$)).subscribe(params => {
      if (params['wompi_callback'] === 'true' && !this.wompiPaymentVerified) {
        this.verifyingWompiPayment = true;
        this.pollOrderPaymentStatus(+order_id);
      }
    });

    this.loadOrder(+order_id);
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    if (this.wompiPollTimer) {
      clearInterval(this.wompiPollTimer);
    }
  }

  /**
   * Polls the order detail to check if payment status has been updated by the webhook.
   * Stops polling after payment is no longer pending or after 60 attempts (5 minutes).
   */
  private pollOrderPaymentStatus(orderId: number): void {
    let attempts = 0;
    const maxAttempts = 60;

    this.wompiPollTimer = setInterval(() => {
      attempts++;

      this.account_service.getOrderDetail(orderId).subscribe({
        next: (response) => {
          if (response.success) {
            this.order = response.data;

            // Check if any payment is no longer pending
            const hasCompletedPayment = this.order.payments?.some(
              (p: any) => p.state === 'completed' || p.state === 'paid'
            );
            const hasFailedPayment = this.order.payments?.some(
              (p: any) => p.state === 'failed' || p.state === 'declined'
            );

            if (hasCompletedPayment || hasFailedPayment || attempts >= maxAttempts) {
              this.verifyingWompiPayment = false;
              this.wompiPaymentVerified = true;
              if (hasCompletedPayment) {
                this.is_new_order = true;
              }
              if (this.wompiPollTimer) {
                clearInterval(this.wompiPollTimer);
                this.wompiPollTimer = null;
              }
            }
          }
        },
        error: () => {
          if (attempts >= maxAttempts) {
            this.verifyingWompiPayment = false;
            if (this.wompiPollTimer) {
              clearInterval(this.wompiPollTimer);
              this.wompiPollTimer = null;
            }
          }
        },
      });
    }, 5000); // Poll every 5 seconds
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

  /** Whether the order contains only service items */
  get hasOnlyServices(): boolean {
    if (!this.order) return false;
    return this.order.items.every(item => item.product_type === 'service');
  }

  /** Whether the order contains at least one service item */
  get hasServiceItems(): boolean {
    if (!this.order) return false;
    return this.order.items.some(item => item.product_type === 'service');
  }

  /** Whether the order contains at least one physical item */
  get hasPhysicalItems(): boolean {
    if (!this.order) return false;
    return this.order.items.some(item => item.product_type !== 'service');
  }

  /** Returns the appropriate post-purchase message */
  get postPurchaseMessage(): string {
    if (this.hasOnlyServices) {
      return 'Recibirás instrucciones para tu servicio por correo electrónico.';
    }
    if (this.hasServiceItems && this.hasPhysicalItems) {
      return 'Los productos serán enviados y recibirás instrucciones para los servicios.';
    }
    return 'Te notificaremos cuando esté en camino.';
  }

  /** Returns the item type label for badge display */
  getItemTypeLabel(item: any): string {
    return item.product_type === 'service' ? 'Servicio' : 'Producto';
  }

  /** Returns true if item is a service */
  isServiceItem(item: any): boolean {
    return item.product_type === 'service';
  }
}
