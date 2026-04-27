import { apiClient, Endpoints } from '@/core/api';
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
    return unwrap<PaginatedResponse<Order>>(res);
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

  async delete(orderId: number): Promise<void> {
    const endpoint = Endpoints.STORE.ORDERS.DELETE.replace(':id', String(orderId));
    await apiClient.delete(endpoint);
  },
};
