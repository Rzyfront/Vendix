import { apiClient, Endpoints } from '@/core/api';

function unwrap<T>(response: { data: T | { success: boolean; data: T } }): T {
  const d = response.data as { success: boolean; data: T };
  if (d && 'success' in d) return d.data;
  return response.data as T;
}

export interface MetadataField {
  id: number;
  field_key: string;
  label: string;
  field_type: string;
  entity_type: string;
  display_mode: string;
  options?: string;
  is_required: boolean;
  is_active: boolean;
}

export interface MetadataValue {
  field_id: number;
  field_label: string;
  field_key: string;
  value: string;
  created_at: string;
}

export const MetadataService = {
  async getValues(entityType: string, entityId: string): Promise<MetadataValue[]> {
    const endpoint = Endpoints.STORE.CUSTOMERS.METADATA_VALUES.replace(':entityType', entityType).replace(':entityId', entityId);
    const res = await apiClient.get(endpoint);
    return unwrap<MetadataValue[]>(res as any);
  },
};
