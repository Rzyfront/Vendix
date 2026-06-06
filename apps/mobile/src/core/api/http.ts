import apiClient from './client';
import type { ApiEnvelope, PaginatedResponse } from '@/core/models/org-admin/common.types';

export interface ListParams {
  page?: number;
  pageSize?: number;
  search?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  [key: string]: unknown;
}

function buildQuery(params?: ListParams): string {
  if (!params) return '';
  const usp = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v === undefined || v === null || v === '') return;
    if (Array.isArray(v)) {
      v.forEach((item) => usp.append(k, String(item)));
    } else {
      usp.append(k, String(v));
    }
  });
  const s = usp.toString();
  return s ? `?${s}` : '';
}

export async function apiGet<T>(path: string, params?: ListParams): Promise<T> {
  const res = await apiClient.get<ApiEnvelope<T> | T>(`${path}${buildQuery(params)}`);
  const data = res.data as any;
  if (data && typeof data === 'object' && 'success' in data && 'data' in data) {
    return data.data as T;
  }
  return data as T;
}

export async function apiGetRaw<T = unknown>(path: string, params?: ListParams): Promise<T> {
  const res = await apiClient.get<T>(`${path}${buildQuery(params)}`);
  return res.data;
}

export async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  const res = await apiClient.post<ApiEnvelope<T> | T>(path, body);
  const data = res.data as any;
  if (data && typeof data === 'object' && 'success' in data && 'data' in data) {
    return data.data as T;
  }
  return data as T;
}

export async function apiPut<T>(path: string, body?: unknown): Promise<T> {
  const res = await apiClient.put<ApiEnvelope<T> | T>(path, body);
  const data = res.data as any;
  if (data && typeof data === 'object' && 'success' in data && 'data' in data) {
    return data.data as T;
  }
  return data as T;
}

export async function apiPatch<T>(path: string, body?: unknown): Promise<T> {
  const res = await apiClient.patch<ApiEnvelope<T> | T>(path, body);
  const data = res.data as any;
  if (data && typeof data === 'object' && 'success' in data && 'data' in data) {
    return data.data as T;
  }
  return data as T;
}

export async function apiDelete<T = void>(path: string): Promise<T> {
  const res = await apiClient.delete<ApiEnvelope<T> | T>(path);
  const data = res.data as any;
  if (data && typeof data === 'object' && 'success' in data && 'data' in data) {
    return data.data as T;
  }
  return (data ?? (undefined as unknown)) as T;
}

export function unwrapList<T>(raw: T[] | PaginatedResponse<T> | ApiEnvelope<T[] | PaginatedResponse<T>>): T[] {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === 'object' && 'data' in raw) {
    const inner = (raw as any).data;
    if (Array.isArray(inner)) return inner;
    if (inner && typeof inner === 'object' && Array.isArray(inner.data)) return inner.data;
  }
  if (raw && typeof raw === 'object' && 'data' in raw && Array.isArray((raw as any).data)) {
    return (raw as any).data;
  }
  return [];
}

export { buildQuery };
