import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { NotificationsService } from './notifications.service';
import { GlobalPrismaService } from '../../../prisma/services/global-prisma.service';
import {
  OrderCreatedEvent,
  OrderStatusChangedEvent,
  PaymentReceivedEvent,
  NewCustomerEvent,
} from './interfaces/notification-events.interface';

@Injectable()
export class NotificationsEventsListener {
  constructor(
    private readonly notifications_service: NotificationsService,
    private readonly global_prisma: GlobalPrismaService,
  ) {}

  @OnEvent('order.created')
  async handleOrderCreated(event: OrderCreatedEvent) {
    const customer_text = event.customer_name
      ? ` de ${event.customer_name}`
      : '';

    await this.notifications_service.createAndBroadcast(
      event.store_id,
      'new_order',
      'Nueva Orden',
      `Orden #${event.order_number}${customer_text} por $${event.grand_total} ${event.currency}`,
      { order_id: event.order_id, order_number: event.order_number },
    );
  }

  @OnEvent('order.status_changed')
  async handleOrderStatusChanged(event: OrderStatusChangedEvent) {
    await this.notifications_service.createAndBroadcast(
      event.store_id,
      'order_status_change',
      'Estado de Orden Actualizado',
      `Orden #${event.order_number}: ${event.old_state} → ${event.new_state}`,
      { order_id: event.order_id, order_number: event.order_number },
    );
  }

  @OnEvent('payment.received')
  async handlePaymentReceived(event: PaymentReceivedEvent) {
    await this.notifications_service.createAndBroadcast(
      event.store_id,
      'payment_received',
      'Pago Recibido',
      `Pago de $${event.amount} ${event.currency} para orden #${event.order_number}`,
      { order_id: event.order_id, payment_method: event.payment_method },
    );
  }

  @OnEvent('customer.created')
  async handleNewCustomer(event: NewCustomerEvent) {
    await this.notifications_service.createAndBroadcast(
      event.store_id,
      'new_customer',
      'Nuevo Cliente',
      `${event.first_name} ${event.last_name} se registró`,
      { customer_id: event.customer_id, email: event.email },
    );
  }

  @OnEvent('stock.low')
  async handleLowStock(event: {
    store_id: number;
    product_id: number;
    product_name: string;
    quantity: number;
    threshold: number;
  }) {
    await this.notifications_service.createAndBroadcast(
      event.store_id,
      'low_stock',
      'Stock Bajo',
      `${event.product_name} tiene solo ${event.quantity} unidades (umbral: ${event.threshold})`,
      { product_id: event.product_id, quantity: event.quantity },
    );
  }
}
