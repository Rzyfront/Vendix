export interface OrderCreatedEvent {
  store_id: number;
  order_id: number;
  order_number: string;
  customer_name?: string;
  grand_total: number;
  currency: string;
}

export interface OrderStatusChangedEvent {
  store_id: number;
  order_id: number;
  order_number: string;
  old_state: string;
  new_state: string;
  /**
   * T9 — paso 3: marca el origen del cambio. Solo `kitchen_bridge`
   * (puente KDS → orden desde `markKitchenOrderDelivered`) se silencia
   * en el listener — entregado no es una alerta para el operador. Si
   * el campo falta, se asume un cambio normal y se notifica igual que
   * antes. Mantener opcional preserva TODOS los emisores existentes
   * sin tocar su código.
   */
  source?: 'kitchen_bridge' | string;
}

export interface PaymentReceivedEvent {
  store_id: number;
  order_id: number;
  order_number: string;
  amount: number;
  currency: string;
  payment_method: string;
}

export interface NewCustomerEvent {
  store_id: number;
  customer_id: number;
  first_name: string;
  last_name: string;
  email: string;
}

export interface LowStockEvent {
  store_id: number;
  product_id: number;
  product_name: string;
  quantity: number;
  threshold: number;
}

export interface SseNotificationPayload {
  id: number;
  type: string;
  title: string;
  body: string;
  data?: any;
  created_at: string;
}
