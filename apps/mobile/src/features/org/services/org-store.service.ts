import { apiClient, Endpoints } from '@/core/api';
import { unwrapPaginated } from '@/core/api/pagination';
import type { ApiResponse, PaginatedResponse } from '@/features/store/types';
import type {
  Store,
  StoreListItem,
  CreateStoreDto,
  UpdateStoreDto,
  StoreStats,
  StoreDashboardResponse,
  StoreSettings,
  StoreSettingsUpdateDto,
  StoreQueryDto,
} from '../types/store.types';

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

export interface OrgStore {
  id: number;
  name: string;
  store_type: string;
  state: string;
  is_active: boolean;
  store_code: string;
  slug: string;
  logo_url: string | null;
  primary_address: string | null;
  products_count: number;
  orders_count: number;
  users_count: number;
}

export interface OrgStoreStats {
  total_stores: number;
  active_stores: number;
  total_orders: number;
  total_revenue: number;
}

export const OrgStoreService = {
  async list(query?: StoreQueryDto): Promise<PaginatedResponse<OrgStore>> {
    const params: Record<string, unknown> = {
      page: query?.page ?? 1,
      limit: query?.limit ?? 50,
      search: query?.search,
      store_type: query?.store_type,
      is_active: query?.is_active,
    };
    const res = await apiClient.get(`${Endpoints.ORGANIZATION.STORES.LIST}${buildQuery(params)}`);
    return unwrapPaginated<OrgStore>(res, { page: query?.page ?? 1, limit: query?.limit ?? 50 });
  },

  async getById(id: number): Promise<OrgStore> {
    const endpoint = Endpoints.ORGANIZATION.STORES.GET.replace(':id', String(id));
    const res = await apiClient.get(endpoint);
    return unwrap<OrgStore>(res);
  },

  async stats(): Promise<OrgStoreStats> {
    const res = await apiClient.get(Endpoints.ORGANIZATION.STORES.STATS);
    return unwrap<OrgStoreStats>(res);
  },

  async create(data: CreateStoreDto): Promise<Store> {
    const res = await apiClient.post(Endpoints.ORGANIZATION.STORES.CREATE, data);
    return unwrap<Store>(res);
  },

  async update(id: number, data: UpdateStoreDto): Promise<Store> {
    const endpoint = Endpoints.ORGANIZATION.STORES.UPDATE.replace(':id', String(id));
    const res = await apiClient.patch(endpoint, data);
    return unwrap<Store>(res);
  },

  async deleteStore(id: number): Promise<void> {
    const endpoint = Endpoints.ORGANIZATION.STORES.DELETE.replace(':id', String(id));
    await apiClient.delete(endpoint);
  },

  async activate(id: number): Promise<Store> {
    return OrgStoreService.update(id, { is_active: true });
  },

  async deactivate(id: number): Promise<Store> {
    return OrgStoreService.update(id, { is_active: false });
  },

  async getSettings(id: number): Promise<StoreSettings> {
    const endpoint = Endpoints.ORGANIZATION.STORES.SETTINGS.replace(':id', String(id));
    const res = await apiClient.get(endpoint);
    return unwrap<StoreSettings>(res);
  },

  async updateSettings(id: number, data: StoreSettingsUpdateDto): Promise<any> {
    const endpoint = Endpoints.ORGANIZATION.STORES.SETTINGS.replace(':id', String(id));
    const res = await apiClient.patch(endpoint, data);
    return unwrap<any>(res);
  },

  async resetSettings(id: number): Promise<StoreSettings> {
    const endpoint = Endpoints.ORGANIZATION.STORES.SETTINGS_RESET.replace(':id', String(id));
    const res = await apiClient.post(endpoint);
    return unwrap<StoreSettings>(res);
  },

  async getDashboard(id: number): Promise<StoreDashboardResponse> {
    const endpoint = Endpoints.ORGANIZATION.STORES.DASHBOARD.replace(':id', String(id));
    const res = await apiClient.get(endpoint);
    return unwrap<StoreDashboardResponse>(res);
  },

  async checkCode(code: string): Promise<boolean> {
    const res = await apiClient.get(`${Endpoints.ORGANIZATION.STORES.CHECK_CODE}?code=${encodeURIComponent(code)}`);
    const data = unwrap<{ available: boolean }>(res);
    return data.available !== false;
  },

  getStoreTypeOptions(): Array<{ value: string; label: string }> {
    return [
      { value: 'physical', label: 'Tienda Física' },
      { value: 'online', label: 'Tienda Online' },
      { value: 'hybrid', label: 'Tienda Híbrida' },
      { value: 'popup', label: 'Tienda Temporal' },
      { value: 'kiosko', label: 'Kiosko' },
    ];
  },

  getTimezoneOptions(): Array<{ value: string; label: string }> {
    return [
      { value: 'America/Bogota', label: 'Bogotá (UTC-5)' },
      { value: 'America/Medellin', label: 'Medellín (UTC-5)' },
      { value: 'America/Cali', label: 'Cali (UTC-5)' },
      { value: 'America/New_York', label: 'Nueva York (UTC-5)' },
      { value: 'America/Mexico_City', label: 'Ciudad de México (UTC-6)' },
      { value: 'Europe/Madrid', label: 'Madrid (UTC+1)' },
    ];
  },
};
