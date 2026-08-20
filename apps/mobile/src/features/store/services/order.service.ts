import { apiClient, Endpoints } from '@/core/api';
import { unwrapPaginated } from '@/core/api/pagination';
import type {
  ApiResponse,
  PaginatedResponse,
  Order,
  OrderStats,
  OrderQuery,
  OrderTimelineEntry,
  PayOrderDto,
  ShipOrderDto,
  CancelOrderDto,
  RefundOrderDto,
  PaymentMethod,
  CreatePosPaymentDto,
  PosPaymentResponse,
  UpdateOrderEditorPayload,
} from '../types';

function unwrap<T>(response: { data: T | ApiResponse<T> }): T {
  const d = response.data as ApiResponse<T>;
  if (d && typeof d === 'object' && 'success' in d) return d.data;
  return response.data as T;
}

function buildQuery(params?: Record<string, unknown>): string {
  if (!params) return '';
  const parts: string[] = [];
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      if (Array.isArray(value)) {
        value.forEach((v) => parts.push(`${key}=${encodeURIComponent(String(v))}`));
      } else {
        parts.push(`${key}=${encodeURIComponent(String(value))}`);
      }
    }
  }
  return parts.length > 0 ? `?${parts.join('&')}` : '';
}

export const OrderService = {
  async list(query?: OrderQuery): Promise<PaginatedResponse<Order>> {
    const params: Record<string, unknown> = {
      page: query?.page ?? 1,
      limit: query?.limit ?? 20,
      search: query?.search,
      status: query?.status,
      channel: query?.channel,
      payment_status: query?.payment_status,
      date_from: query?.date_from,
      date_to: query?.date_to,
      missing_shipping_method: query?.missing_shipping_method,
      sort: query?.sort,
      sort_order: query?.sort_order,
    };
    const res = await apiClient.get(`${Endpoints.STORE.ORDERS.LIST}${buildQuery(params)}`);
    return unwrapPaginated<Order>(res, { page: query?.page ?? 1, limit: query?.limit ?? 20 });
  },

  async getById(id: number): Promise<Order> {
    const endpoint = Endpoints.STORE.ORDERS.GET.replace(':id', String(id));
    const res = await apiClient.get(endpoint);
    return unwrap<Order>(res);
  },

  async stats(): Promise<OrderStats> {
    const res = await apiClient.get(Endpoints.STORE.ORDERS.STATS);
    return unwrap<OrderStats>(res);
  },

  async timeline(orderId: number): Promise<OrderTimelineEntry[]> {
    const endpoint = Endpoints.STORE.ORDERS.TIMELINE.replace(':id', String(orderId));
    const res = await apiClient.get(endpoint);
    return unwrap<OrderTimelineEntry[]>(res);
  },

  async pay(orderId: number, dto: PayOrderDto): Promise<Order> {
    const endpoint = Endpoints.STORE.ORDERS.FLOW_PAY.replace(':id', String(orderId));
    const res = await apiClient.post(endpoint, dto);
    return unwrap<Order>(res);
  },

  /**
   * CP-POS-CREAR-EDITAR-COBRAR-001 — alias semánticamente explícito de
   * `pay()` que nombra el endpoint canónico `POST /api/store/orders/:id/flow/pay`.
   * Usado por el POS mobile para cobrar un draft existente después de un
   * `updateOrderEditor` (paridad web `flowPayOrder`). Sin esta ruta, el modal
   * de pago en modo edición cae a `processPosPayment` y crea una orden nueva
   * en vez de cargar al draft.
   */
  async flowPayOrder(orderId: number, dto: PayOrderDto): Promise<Order> {
    return this.pay(orderId, dto);
  },

  async ship(orderId: number, dto: ShipOrderDto): Promise<Order> {
    const endpoint = Endpoints.STORE.ORDERS.FLOW_SHIP.replace(':id', String(orderId));
    const res = await apiClient.post(endpoint, dto);
    return unwrap<Order>(res);
  },

  async deliver(orderId: number, deliveryNotes?: string): Promise<Order> {
    const endpoint = Endpoints.STORE.ORDERS.FLOW_DELIVER.replace(':id', String(orderId));
    const res = await apiClient.post(endpoint, { delivery_notes: deliveryNotes });
    return unwrap<Order>(res);
  },

  async cancel(orderId: number, dto: CancelOrderDto): Promise<Order> {
    const endpoint = Endpoints.STORE.ORDERS.FLOW_CANCEL.replace(':id', String(orderId));
    const res = await apiClient.post(endpoint, dto);
    return unwrap<Order>(res);
  },

  async refund(orderId: number, dto: RefundOrderDto): Promise<Order> {
    const endpoint = Endpoints.STORE.ORDERS.FLOW_REFUND.replace(':id', String(orderId));
    const res = await apiClient.post(endpoint, dto);
    return unwrap<Order>(res);
  },

  async fastTrack(orderId: number, dto?: Record<string, unknown>): Promise<Order> {
    const endpoint = Endpoints.STORE.ORDERS.FLOW_FAST_TRACK.replace(':id', String(orderId));
    const res = await apiClient.post(endpoint, dto || {});
    return unwrap<Order>(res);
  },

  /**
   * CP-POS-CREAR-EDITAR-COBRAR-001 — fase C.1 · editor atómico de negocio.
   *
   * `PUT /api/store/orders/:id/editor` reemplaza items, cliente, notas,
   * envío y promoción/cupón en una sola transacción. No edita state,
   * payment ni flags KDS/fiscales (esos pasan por `flow/pay`).
   *
   * Errores tipados que el caller puede mapear:
   *  - `POS_CUSTOMER_REQUIRED_001` (422) si el customer_id falta/no pertenece al store.
   *  - `ORD_EDIT_NOT_ALLOWED_001` (409) si la orden ya no es `created`/`draft`.
   *  - `ORD_EDIT_STATE_CHANGED_001` (409) si otro operador cambió el estado.
   *  - `ORD_EDIT_CUSTOMER_STORE_MISMATCH_001` (403).
   *  - `ORD_EDIT_INVALID_SHIPPING_001` (422).
   *  - `POS_STOCK_INSUFFICIENT_001` (409).
   */
  async updateOrderEditor(orderId: number, dto: UpdateOrderEditorPayload): Promise<Order> {
    const endpoint = `/store/orders/${orderId}/editor`;
    const res = await apiClient.put(endpoint, dto);
    return unwrap<Order>(res);
  },

  async delete(orderId: number): Promise<void> {
    const endpoint = Endpoints.STORE.ORDERS.DELETE.replace(':id', String(orderId));
    await apiClient.delete(endpoint);
  },

  async create(dto: {
    customer_id?: string;
    items: {
      product_id: string;
      variant_id?: string;
      quantity: number;
      unit_price: number;
      tax_amount: number;
    }[];
    notes?: string;
    subtotal: number;
    tax_amount: number;
    discount_amount: number;
    total: number;
    payment_method_id?: string;
  }): Promise<Order> {
    const res = await apiClient.post(Endpoints.STORE.ORDERS.CREATE, dto);
    return unwrap<Order>(res);
  },

  async getPaymentMethods(): Promise<PaymentMethod[]> {
    const res = await apiClient.get(Endpoints.STORE.PAYMENT_METHODS.LIST);
    return unwrap<PaymentMethod[]>(res);
  },

  async processPosPayment(dto: CreatePosPaymentDto): Promise<PosPaymentResponse> {
    const res = await apiClient.post(Endpoints.STORE.PAYMENTS.POS, dto);
    return unwrap<PosPaymentResponse>(res);
  },
};
