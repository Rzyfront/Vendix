import { apiClient, Endpoints } from '@/core/api';
import { unwrapPaginated } from '@/core/api/pagination';
import type {
  ApiResponse,
  CategoryQuery,
  CategoryStats,
  CreateCategoryDto,
  PaginatedResponse,
  ProductCategory,
  UpdateCategoryDto,
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

export const CategoryService = {
  async list(query?: CategoryQuery): Promise<PaginatedResponse<ProductCategory>> {
    const params: Record<string, unknown> = {
      page: query?.page ?? 1,
      limit: query?.limit ?? 20,
      search: query?.search,
      state: query?.state,
      is_featured: query?.is_featured,
      sort_by: query?.sort_by,
      sort_order: query?.sort_order,
    };
    const res = await apiClient.get(`${Endpoints.STORE.CATEGORIES.LIST}${buildQuery(params)}`);
    return unwrapPaginated<ProductCategory>(res, { page: query?.page ?? 1, limit: query?.limit ?? 20 });
  },

  async getById(id: number): Promise<ProductCategory> {
    const endpoint = Endpoints.STORE.CATEGORIES.GET.replace(':id', String(id));
    const res = await apiClient.get(endpoint);
    return unwrap<ProductCategory>(res);
  },

  async create(data: CreateCategoryDto): Promise<ProductCategory> {
    const res = await apiClient.post(Endpoints.STORE.CATEGORIES.CREATE, data);
    return unwrap<ProductCategory>(res);
  },

  async update(id: number, data: UpdateCategoryDto): Promise<ProductCategory> {
    const endpoint = Endpoints.STORE.CATEGORIES.UPDATE.replace(':id', String(id));
    const res = await apiClient.patch(endpoint, data);
    return unwrap<ProductCategory>(res);
  },

  async delete(id: number, force = false): Promise<void> {
    const endpoint = `${Endpoints.STORE.CATEGORIES.DELETE.replace(':id', String(id))}${force ? '?force=true' : ''}`;
    await apiClient.delete(endpoint);
  },

  async stats(query?: { state?: string; is_featured?: boolean }): Promise<CategoryStats> {
    const res = await apiClient.get(`${Endpoints.STORE.CATEGORIES.LIST}/stats${buildQuery(query as Record<string, unknown>)}`);
    return unwrap<CategoryStats>(res);
  },

  async getAllActive(): Promise<ProductCategory[]> {
    const res = await apiClient.get(`${Endpoints.STORE.CATEGORIES.LIST}${buildQuery({ state: 'active', limit: 100 })}`);
    return unwrapPaginated<ProductCategory>(res, { page: 1, limit: 100 }).data;
  },
};

export type { CategoryService as CategoryServiceType };