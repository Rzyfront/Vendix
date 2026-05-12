import { apiClient, Endpoints } from '@/core/api';
import type {
  ApiResponse,
  PaginatedResponse,
  ListQuery,
} from '../types';
import type {
  StoreSettings,
  StoreUser,
  StoreRole,
  SettingsPaymentMethod,
  CreateStoreUserDto,
  UpdateStoreUserDto,
  CreateStoreRoleDto,
  UpdateStoreRoleDto,
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
      parts.push(`${key}=${encodeURIComponent(String(value))}`);
    }
  }
  return parts.length > 0 ? `?${parts.join('&')}` : '';
}

export const SettingsService = {
  async getSettings(): Promise<StoreSettings> {
    const res = await apiClient.get(Endpoints.STORE.SETTINGS.GET);
    return unwrap<StoreSettings>(res);
  },

  async updateSettings(data: Partial<StoreSettings>): Promise<StoreSettings> {
    const res = await apiClient.patch(Endpoints.STORE.SETTINGS.UPDATE, data);
    return unwrap<StoreSettings>(res);
  },

  async getUsers(query?: ListQuery): Promise<PaginatedResponse<StoreUser>> {
    const params: Record<string, unknown> = {
      page: query?.page ?? 1,
      limit: query?.limit ?? 20,
      search: query?.search,
    };
    const res = await apiClient.get(
      `${Endpoints.STORE.SETTINGS.USERS_LIST}${buildQuery(params)}`,
    );
    return unwrap<PaginatedResponse<StoreUser>>(res);
  },

  async createUser(data: CreateStoreUserDto): Promise<StoreUser> {
    const res = await apiClient.post(Endpoints.STORE.SETTINGS.USER_CREATE, data);
    return unwrap<StoreUser>(res);
  },

  async updateUser(id: string, data: UpdateStoreUserDto): Promise<StoreUser> {
    const endpoint = Endpoints.STORE.SETTINGS.USER_UPDATE.replace(':id', id);
    const res = await apiClient.patch(endpoint, data);
    return unwrap<StoreUser>(res);
  },

  async toggleUserState(id: string): Promise<StoreUser> {
    const endpoint = Endpoints.STORE.SETTINGS.USER_TOGGLE_STATE.replace(':id', id);
    const res = await apiClient.patch(endpoint);
    return unwrap<StoreUser>(res);
  },

  async getRoles(): Promise<StoreRole[]> {
    const res = await apiClient.get(Endpoints.STORE.SETTINGS.ROLES_LIST);
    return unwrap<StoreRole[]>(res);
  },

  async createRole(data: CreateStoreRoleDto): Promise<StoreRole> {
    const res = await apiClient.post(Endpoints.STORE.SETTINGS.ROLE_CREATE, data);
    return unwrap<StoreRole>(res);
  },

  async updateRole(id: string, data: UpdateStoreRoleDto): Promise<StoreRole> {
    const endpoint = Endpoints.STORE.SETTINGS.ROLE_UPDATE.replace(':id', id);
    const res = await apiClient.patch(endpoint, data);
    return unwrap<StoreRole>(res);
  },

  async deleteRole(id: string): Promise<void> {
    const endpoint = Endpoints.STORE.SETTINGS.ROLE_DELETE.replace(':id', id);
    await apiClient.delete(endpoint);
  },

  async getPaymentMethods(): Promise<SettingsPaymentMethod[]> {
    const res = await apiClient.get(Endpoints.STORE.PAYMENT_METHODS.LIST);
    return unwrap<SettingsPaymentMethod[]>(res);
  },

  async togglePaymentMethod(id: string): Promise<SettingsPaymentMethod> {
    const endpoint = Endpoints.STORE.PAYMENT_METHODS.LIST;
    const res = await apiClient.patch(`${endpoint}/${id}/toggle`);
    return unwrap<SettingsPaymentMethod>(res);
  },
};
