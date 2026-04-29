import { apiClient, Endpoints } from '@/core/api';
import type {
  ApiResponse,
  PaginatedResponse,
} from '../types';
import type {
  InventoryStats,
  StockAdjustment,
  StockTransfer,
  StockMovement,
  Supplier,
  Location,
  AdjustmentType,
  AdjustmentState,
  TransferState,
  MovementType,
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

export interface AdjustmentQuery {
  search?: string;
  type?: AdjustmentType;
  state?: AdjustmentState;
  page?: number;
  limit?: number;
}

export interface TransferQuery {
  search?: string;
  state?: TransferState;
  page?: number;
  limit?: number;
}

export interface MovementQuery {
  search?: string;
  type?: MovementType;
  page?: number;
  limit?: number;
}

export interface SupplierQuery {
  search?: string;
  page?: number;
  limit?: number;
}

export interface LocationQuery {
  search?: string;
  page?: number;
  limit?: number;
}

export interface CreateAdjustmentDto {
  product_id: string;
  description: string;
  type: AdjustmentType;
  quantity: number;
  reason?: string;
  location_id?: string;
}

export interface CreateTransferDto {
  origin_location_id: string;
  destination_location_id: string;
  items: Array<{
    product_id: string;
    variant_id?: string;
    quantity: number;
  }>;
}

export interface CreateSupplierDto {
  name: string;
  code?: string;
  email?: string;
  phone?: string;
  address?: string;
}

export interface UpdateSupplierDto extends Partial<CreateSupplierDto> {}

export interface CreateLocationDto {
  name: string;
  code?: string;
  type: 'warehouse' | 'store' | 'virtual';
  address?: string;
}

export interface UpdateLocationDto extends Partial<CreateLocationDto> {}

export const InventoryService = {
  async getStats(): Promise<InventoryStats> {
    const res = await apiClient.get(Endpoints.STORE.INVENTORY.STATS);
    return unwrap<InventoryStats>(res);
  },

  async getAdjustments(query?: AdjustmentQuery): Promise<PaginatedResponse<StockAdjustment>> {
    const params: Record<string, unknown> = {
      page: query?.page ?? 1,
      limit: query?.limit ?? 20,
      search: query?.search,
      type: query?.type,
      state: query?.state,
    };
    const res = await apiClient.get(`${Endpoints.STORE.INVENTORY.ADJUSTMENTS.LIST}${buildQuery(params)}`);
    return unwrap<PaginatedResponse<StockAdjustment>>(res);
  },

  async createAdjustment(dto: CreateAdjustmentDto): Promise<StockAdjustment> {
    const res = await apiClient.post(Endpoints.STORE.INVENTORY.ADJUSTMENTS.CREATE, dto);
    return unwrap<StockAdjustment>(res);
  },

  async getTransfers(query?: TransferQuery): Promise<PaginatedResponse<StockTransfer>> {
    const params: Record<string, unknown> = {
      page: query?.page ?? 1,
      limit: query?.limit ?? 20,
      search: query?.search,
      state: query?.state,
    };
    const res = await apiClient.get(`${Endpoints.STORE.INVENTORY.TRANSFERS.LIST}${buildQuery(params)}`);
    return unwrap<PaginatedResponse<StockTransfer>>(res);
  },

  async createTransfer(dto: CreateTransferDto): Promise<StockTransfer> {
    const res = await apiClient.post(Endpoints.STORE.INVENTORY.TRANSFERS.CREATE, dto);
    return unwrap<StockTransfer>(res);
  },

  async getMovements(query?: MovementQuery): Promise<PaginatedResponse<StockMovement>> {
    const params: Record<string, unknown> = {
      page: query?.page ?? 1,
      limit: query?.limit ?? 20,
      search: query?.search,
      type: query?.type,
    };
    const res = await apiClient.get(`${Endpoints.STORE.INVENTORY.MOVEMENTS.LIST}${buildQuery(params)}`);
    return unwrap<PaginatedResponse<StockMovement>>(res);
  },

  async getSuppliers(query?: SupplierQuery): Promise<PaginatedResponse<Supplier>> {
    const params: Record<string, unknown> = {
      page: query?.page ?? 1,
      limit: query?.limit ?? 20,
      search: query?.search,
    };
    const res = await apiClient.get(`${Endpoints.STORE.INVENTORY.SUPPLIERS.LIST}${buildQuery(params)}`);
    return unwrap<PaginatedResponse<Supplier>>(res);
  },

  async createSupplier(dto: CreateSupplierDto): Promise<Supplier> {
    const res = await apiClient.post(Endpoints.STORE.INVENTORY.SUPPLIERS.CREATE, dto);
    return unwrap<Supplier>(res);
  },

  async updateSupplier(id: string, dto: UpdateSupplierDto): Promise<Supplier> {
    const endpoint = Endpoints.STORE.INVENTORY.SUPPLIERS.UPDATE.replace(':id', id);
    const res = await apiClient.put(endpoint, dto);
    return unwrap<Supplier>(res);
  },

  async deleteSupplier(id: string): Promise<void> {
    const endpoint = Endpoints.STORE.INVENTORY.SUPPLIERS.DELETE.replace(':id', id);
    await apiClient.delete(endpoint);
  },

  async getLocations(query?: LocationQuery): Promise<PaginatedResponse<Location>> {
    const params: Record<string, unknown> = {
      page: query?.page ?? 1,
      limit: query?.limit ?? 20,
      search: query?.search,
    };
    const res = await apiClient.get(`${Endpoints.STORE.INVENTORY.LOCATIONS.LIST}${buildQuery(params)}`);
    return unwrap<PaginatedResponse<Location>>(res);
  },

  async createLocation(dto: CreateLocationDto): Promise<Location> {
    const res = await apiClient.post(Endpoints.STORE.INVENTORY.LOCATIONS.CREATE, dto);
    return unwrap<Location>(res);
  },

  async updateLocation(id: string, dto: UpdateLocationDto): Promise<Location> {
    const endpoint = Endpoints.STORE.INVENTORY.LOCATIONS.UPDATE.replace(':id', id);
    const res = await apiClient.put(endpoint, dto);
    return unwrap<Location>(res);
  },
};
