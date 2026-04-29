import { apiClient, Endpoints } from '@/core/api';
import type {
  ApiResponse,
  PaginatedResponse,
} from '../types/api.types';
import type {
  Invoice,
  InvoiceStats,
  InvoiceQuery,
  Resolution,
  DianConfig,
  CreateInvoiceDto,
  CreateResolutionDto,
} from '../types/invoice.types';

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

export const InvoiceService = {
  async stats(): Promise<InvoiceStats> {
    const res = await apiClient.get(Endpoints.STORE.INVOICES.STATS);
    return unwrap<InvoiceStats>(res);
  },

  async list(query?: InvoiceQuery): Promise<PaginatedResponse<Invoice>> {
    const params: Record<string, unknown> = {
      page: query?.page ?? 1,
      limit: query?.limit ?? 20,
      search: query?.search,
      status: query?.status,
      type: query?.type,
    };
    const res = await apiClient.get(`${Endpoints.STORE.INVOICES.LIST}${buildQuery(params)}`);
    return unwrap<PaginatedResponse<Invoice>>(res);
  },

  async getById(id: string): Promise<Invoice> {
    const endpoint = Endpoints.STORE.INVOICES.GET.replace(':id', id);
    const res = await apiClient.get(endpoint);
    return unwrap<Invoice>(res);
  },

  async create(dto: CreateInvoiceDto): Promise<Invoice> {
    const res = await apiClient.post(Endpoints.STORE.INVOICES.CREATE, dto);
    return unwrap<Invoice>(res);
  },

  async send(id: string): Promise<Invoice> {
    const endpoint = Endpoints.STORE.INVOICES.SEND.replace(':id', id);
    const res = await apiClient.post(endpoint);
    return unwrap<Invoice>(res);
  },

  async void(id: string, reason: string): Promise<Invoice> {
    const endpoint = Endpoints.STORE.INVOICES.VOID.replace(':id', id);
    const res = await apiClient.post(endpoint, { reason });
    return unwrap<Invoice>(res);
  },

  async getResolutions(): Promise<Resolution[]> {
    const res = await apiClient.get(Endpoints.STORE.INVOICES.RESOLUTIONS);
    return unwrap<Resolution[]>(res);
  },

  async createResolution(dto: CreateResolutionDto): Promise<Resolution> {
    const res = await apiClient.post(Endpoints.STORE.INVOICES.CREATE_RESOLUTION, dto);
    return unwrap<Resolution>(res);
  },

  async getDianConfig(): Promise<DianConfig> {
    const res = await apiClient.get(Endpoints.STORE.INVOICES.DIAN_CONFIG);
    return unwrap<DianConfig>(res);
  },

  async updateDianConfig(dto: Partial<DianConfig>): Promise<DianConfig> {
    const res = await apiClient.put(Endpoints.STORE.INVOICES.DIAN_CONFIG, dto);
    return unwrap<DianConfig>(res);
  },
};
