import { apiClient, Endpoints } from '@/core/api';

function unwrap<T>(response: { data: T | { success: boolean; data: T } }): T {
  const d = response.data as { success: boolean; data: T };
  if (d && 'success' in d) return d.data;
  return response.data as T;
}

export interface MemberProfile {
  id?: string;
  customer_id: string;
  member_number?: string;
  join_date?: string;
  plan_id?: string;
  plan_name?: string;
  status?: string;
  // flexible fields from extra_data
  [key: string]: string | undefined;
}

export const MembershipService = {
  async getProfile(customerId: string): Promise<MemberProfile | null> {
    const endpoint = Endpoints.STORE.CUSTOMERS.MEMBERSHIP_PROFILE.replace(':customerId', customerId);
    try {
      const res = await apiClient.get(endpoint);
      return unwrap<MemberProfile>(res as any);
    } catch (err: any) {
      if (err?.response?.status === 404) return null;
      throw err;
    }
  },
};
