import { apiClient, Endpoints } from '@/core/api';
import type { ApiResponse } from '../types';

function unwrap<T>(response: { data: T | ApiResponse<T> }): T {
  const d = response.data as ApiResponse<T>;
  if (d && typeof d === 'object' && 'success' in d) return d.data;
  return response.data as T;
}

export interface StoreShippingMethod {
  id: number;
  store_id: string;
  name: string;
  description: string | null;
  is_enabled: boolean;
  is_system: boolean;
  processing_time_days: number;
  price: number;
  created_at: string;
  updated_at: string;
}

export const ShippingService = {
  async list(): Promise<StoreShippingMethod[]> {
    const res = await apiClient.get(Endpoints.STORE.SHIPPING_METHODS.LIST);
    return unwrap<StoreShippingMethod[]>(res);
  },

  async enable(methodId: number, dto: { price?: number; processing_time_days?: number }): Promise<StoreShippingMethod> {
    const endpoint = Endpoints.STORE.SHIPPING_METHODS.ENABLE;
    const res = await apiClient.post(endpoint, { method_id: methodId, ...dto });
    return unwrap<StoreShippingMethod>(res);
  },
};
