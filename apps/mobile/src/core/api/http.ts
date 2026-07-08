import apiClient from './client';
import { ApiError } from './errors';
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

/**
 * Extract the typed payload from a backend response, or throw ApiError if the
 * envelope signals failure. Backend returns one of:
 *   - { success: true,  data: T }            → unwrap to T
 *   - { success: false, message, error, ... } → throw ApiError
 *   - bare payload (no envelope)             → return as-is
 *
 * Some backend controllers catch thrown exceptions and wrap them in
 * ResponseService.error(), returning HTTP 200 with success:false. Without
 * this throw, callers used to receive that envelope as if it were T — which
 * blew up at runtime when the consumer expected e.g. an array.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function unwrap<T>(payload: any): T {
  if (payload && typeof payload === 'object' && 'success' in payload) {
    if (payload.success === false) {
      const message =
        (typeof payload.message === 'string' && payload.message) ||
        (typeof payload.error === 'string' && payload.error) ||
        'Request failed';
      throw new ApiError(message, payload);
    }
    if ('data' in payload) {
      return payload.data as T;
    }
  }
  return payload as T;
}

export async function apiGet<T>(path: string, params?: ListParams): Promise<T> {
  const res = await apiClient.get<ApiEnvelope<T> | T>(`${path}${buildQuery(params)}`);
  return unwrap<T>(res.data);
}

export async function apiGetRaw<T = unknown>(path: string, params?: ListParams): Promise<T> {
  const res = await apiClient.get<T>(`${path}${buildQuery(params)}`);
  return res.data;
}

export async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  const res = await apiClient.post<ApiEnvelope<T> | T>(path, body);
  return unwrap<T>(res.data);
}

export async function apiPut<T>(path: string, body?: unknown): Promise<T> {
  const res = await apiClient.put<ApiEnvelope<T> | T>(path, body);
  return unwrap<T>(res.data);
}

export async function apiPatch<T>(path: string, body?: unknown): Promise<T> {
  const res = await apiClient.patch<ApiEnvelope<T> | T>(path, body);
  return unwrap<T>(res.data);
}

export async function apiDelete<T = void>(path: string): Promise<T> {
  const res = await apiClient.delete<ApiEnvelope<T> | T>(path);
  // apiDelete historically returned undefined for empty bodies; preserve that.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const payload: any = res.data;
  if (payload == null) return undefined as unknown as T;
  return unwrap<T>(payload);
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
