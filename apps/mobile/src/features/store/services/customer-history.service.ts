import { apiClient, Endpoints } from '@/core/api';

function unwrap<T>(response: { data: T | { success: boolean; data: T } }): T {
  const d = response.data as { success: boolean; data: T };
  if (d && 'success' in d) return d.data;
  return response.data as T;
}

export interface CustomerHistoryBooking {
  id: string;
  state: string;
  created_at: string;
  customer_id: string;
  store_id: string;
  provider_id?: string;
  total_price?: number;
  product?: { name: string };
  provider?: { first_name: string; last_name: string };
  intake_submission_status?: string;
  has_snapshot?: boolean;
  notes_count?: number;
}

export interface CustomerHistorySummary {
  notes: Array<{
    id: string;
    note_key: string;
    note_value: string;
    created_at: string;
    include_in_summary: boolean;
  }>;
}

export interface CustomerHistoryContext {
  metadata_values: Array<{
    field_id: number;
    field_label: string;
    field_key: string;
    value: string;
    created_at: string;
  }>;
  summary_notes: CustomerHistorySummary['notes'];
  recent_bookings: CustomerHistoryBooking[];
}

export const CustomerHistoryService = {
  async getTimeline(
    customerId: string,
    page = 1,
    limit = 20,
  ): Promise<{ data: CustomerHistoryBooking[]; pagination: any }> {
    const endpoint = Endpoints.STORE.CUSTOMERS.HISTORY.replace(':customerId', customerId);
    const res = await apiClient.get(`${endpoint}?page=${page}&limit=${limit}`);
    const d = res.data as { success: boolean; data: { data: CustomerHistoryBooking[]; pagination: any } };
    return d.data;
  },

  async getSummary(customerId: string): Promise<CustomerHistorySummary> {
    const endpoint = Endpoints.STORE.CUSTOMERS.HISTORY.replace(':customerId', customerId);
    const res = await apiClient.get(`${endpoint}/summary`);
    return unwrap<CustomerHistorySummary>(res as any);
  },

  async getContext(customerId: string): Promise<CustomerHistoryContext> {
    const endpoint = Endpoints.STORE.CUSTOMERS.HISTORY_CONTEXT.replace(':customerId', customerId);
    const res = await apiClient.get(endpoint);
    return unwrap<CustomerHistoryContext>(res as any);
  },
};
