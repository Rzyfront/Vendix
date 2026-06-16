import { apiClient } from '@/core/api';
import { unwrapPaginated } from '@/core/api/pagination';
import type { ApiResponse, PaginatedResponse } from '../types';
import type { MetadataField, DataCollectionTemplate, DataCollectionSubmission } from '../types/data-collection.types';

const TEMPLATES_BASE = '/store/data-collection/templates';
const SUBMISSIONS_BASE = '/store/data-collection/submissions';
const FIELDS_BASE = '/store/metadata-fields';

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

export const DataCollectionService = {
  fields: {
    async list(entityType?: string): Promise<MetadataField[]> {
      const params = entityType ? `?entity_type=${entityType}` : '';
      const res = await apiClient.get(`${FIELDS_BASE}${params}`);
      return unwrap<MetadataField[]>(res);
    },

    async create(data: Partial<MetadataField>): Promise<MetadataField> {
      const res = await apiClient.post(FIELDS_BASE, data);
      return unwrap<MetadataField>(res);
    },

    async update(id: number, data: Partial<MetadataField>): Promise<MetadataField> {
      const res = await apiClient.patch(`${FIELDS_BASE}/${id}`, data);
      return unwrap<MetadataField>(res);
    },

    async toggle(id: number): Promise<MetadataField> {
      const res = await apiClient.patch(`${FIELDS_BASE}/${id}/toggle`, {});
      return unwrap<MetadataField>(res);
    },

    async delete(id: number): Promise<void> {
      await apiClient.delete(`${FIELDS_BASE}/${id}`);
    },
  },

  templates: {
    async list(status?: string): Promise<DataCollectionTemplate[]> {
      const params = status ? `?status=${status}` : '';
      const res = await apiClient.get(`${TEMPLATES_BASE}${params}`);
      return unwrap<DataCollectionTemplate[]>(res);
    },

    async getOne(id: number): Promise<DataCollectionTemplate> {
      const res = await apiClient.get(`${TEMPLATES_BASE}/${id}`);
      return unwrap<DataCollectionTemplate>(res);
    },

    async create(data: Partial<DataCollectionTemplate>): Promise<DataCollectionTemplate> {
      const res = await apiClient.post(TEMPLATES_BASE, data);
      return unwrap<DataCollectionTemplate>(res);
    },

    async update(id: number, data: Partial<DataCollectionTemplate>): Promise<DataCollectionTemplate> {
      const res = await apiClient.patch(`${TEMPLATES_BASE}/${id}`, data);
      return unwrap<DataCollectionTemplate>(res);
    },

    async delete(id: number): Promise<void> {
      await apiClient.delete(`${TEMPLATES_BASE}/${id}`);
    },

    async duplicate(id: number): Promise<DataCollectionTemplate> {
      const res = await apiClient.post(`${TEMPLATES_BASE}/${id}/duplicate`, {});
      return unwrap<DataCollectionTemplate>(res);
    },
  },

  submissions: {
    async list(): Promise<PaginatedResponse<DataCollectionSubmission>> {
      const res = await apiClient.get(SUBMISSIONS_BASE);
      return unwrapPaginated<DataCollectionSubmission>(res, { page: 1, limit: 20 });
    },

    async getOne(id: number): Promise<DataCollectionSubmission> {
      const res = await apiClient.get(`${SUBMISSIONS_BASE}/${id}`);
      return unwrap<DataCollectionSubmission>(res);
    },
  },
};
