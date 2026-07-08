import { apiClient } from '@/core/api';
import { unwrapPaginated } from '@/core/api/pagination';
import type { ApiResponse, PaginatedResponse } from '../types';
import type { Review, ReviewStats, ReviewFilters } from '../types/review.types';

const BASE = '/store/reviews';

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

export const ReviewService = {
  async list(filters?: ReviewFilters): Promise<PaginatedResponse<Review>> {
    const params: Record<string, unknown> = {
      page: filters?.page ?? 1,
      limit: filters?.limit ?? 20,
      search: filters?.search,
      state: filters?.state,
      rating: filters?.rating,
      sort_by: filters?.sort_by,
      sort_order: filters?.sort_order,
      user_id: filters?.user_id,
    };
    const res = await apiClient.get(`${BASE}${buildQuery(params)}`);
    return unwrapPaginated<Review>(res, { page: filters?.page ?? 1, limit: filters?.limit ?? 20 });
  },

  async stats(): Promise<ReviewStats> {
    const res = await apiClient.get(`${BASE}/stats`);
    return unwrap<ReviewStats>(res);
  },

  async getOne(id: number): Promise<Review> {
    const res = await apiClient.get(`${BASE}/${id}`);
    return unwrap<Review>(res);
  },

  async approve(id: number): Promise<void> {
    await apiClient.patch(`${BASE}/${id}/approve`, {});
  },

  async reject(id: number): Promise<void> {
    await apiClient.patch(`${BASE}/${id}/reject`, {});
  },

  async hide(id: number): Promise<void> {
    await apiClient.patch(`${BASE}/${id}/hide`, {});
  },

  async delete(id: number): Promise<void> {
    await apiClient.delete(`${BASE}/${id}`);
  },

  async createResponse(reviewId: number, content: string): Promise<void> {
    await apiClient.post(`${BASE}/${reviewId}/response`, { content });
  },

  async updateResponse(reviewId: number, content: string): Promise<void> {
    await apiClient.patch(`${BASE}/${reviewId}/response`, { content });
  },

  async deleteResponse(reviewId: number): Promise<void> {
    await apiClient.delete(`${BASE}/${reviewId}/response`);
  },
};
