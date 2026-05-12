import { apiClient, Endpoints } from '@/core/api';
import { unwrapPaginated } from '@/core/api/pagination';
import type {
  ApiResponse,
  PaginatedResponse,
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
  PurchaseOrder,
  CreatePurchaseOrderDto,
  ReceivePurchaseOrderItemDto,
  Product,
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

function getStockQuantity(product: Product): number {
  return Number(product.total_stock_available ?? product.stock_quantity ?? 0);
}

function buildInventoryStats(
  products: Product[],
  totalProducts: number,
  totalLocations: number,
): InventoryStats {
  return products.reduce<InventoryStats>(
    (stats, product) => {
      if (product.track_inventory === false) return stats;

      const stock = getStockQuantity(product);
      const cost = Number(product.cost_price ?? product.base_price ?? 0);
      stats.totalValue += Math.max(stock, 0) * cost;

      if (stock <= 0) {
        stats.outOfStock += 1;
      } else if (stock <= 5) {
        stats.lowStock += 1;
      }

      return stats;
    },
    {
      totalProducts,
      lowStock: 0,
      outOfStock: 0,
      totalValue: 0,
      totalLocations,
    },
  );
}

function normalizeTransfer(raw: Record<string, any>): StockTransfer {
  const status = raw.status === 'draft' ? 'pending' : raw.status;

  return {
    id: String(raw.id),
    origin_location_id: String(raw.origin_location_id ?? raw.from_location_id ?? ''),
    origin_location_name: raw.origin_location_name ?? raw.from_location?.name ?? 'Origen',
    destination_location_id: String(raw.destination_location_id ?? raw.to_location_id ?? ''),
    destination_location_name: raw.destination_location_name ?? raw.to_location?.name ?? 'Destino',
    product_count: Number(raw.product_count ?? raw.stock_transfer_items?.length ?? 0),
    state: status ?? 'pending',
    created_at: raw.created_at ?? raw.transfer_date ?? new Date().toISOString(),
  };
}

function toStockTransferPayload(dto: CreateTransferDto) {
  return {
    from_location_id: Number(dto.origin_location_id),
    to_location_id: Number(dto.destination_location_id),
    items: dto.items.map((item) => ({
      product_id: Number(item.product_id),
      product_variant_id: item.variant_id ? Number(item.variant_id) : undefined,
      quantity: Number(item.quantity) || 1,
    })),
  };
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
  movement_type?: MovementType;
  product_id?: number;
  from_location_id?: number;
  to_location_id?: number;
  user_id?: number;
  start_date?: string;
  end_date?: string;
  page?: number;
  limit?: number;
}

function normalizeMovement(raw: Record<string, any>): StockMovement {
  const movementType = raw.movement_type as MovementType;
  const fromLoc = raw.from_location ?? null;
  const toLoc = raw.to_location ?? null;
  const isInbound = movementType === 'stock_in' || movementType === 'return';
  const isOutbound =
    movementType === 'stock_out' ||
    movementType === 'sale' ||
    movementType === 'damage' ||
    movementType === 'expiration';
  const preferred = isInbound ? toLoc : isOutbound ? fromLoc : null;
  const operative = preferred ?? fromLoc ?? toLoc ?? null;
  const product = raw.products ?? raw.product ?? null;
  const user = raw.users ?? raw.user ?? null;
  const userName = user
    ? [user.first_name, user.last_name].filter(Boolean).join(' ').trim() || null
    : null;

  return {
    id: Number(raw.id),
    product_id: Number(raw.product_id ?? product?.id ?? 0),
    product_name: product?.name ?? raw.product_name ?? '',
    movement_type: movementType,
    quantity: Number(raw.quantity ?? 0),
    location_id: operative?.id ?? null,
    location_name: operative?.name ?? null,
    store_id: operative?.store_id ?? null,
    store_name: operative?.stores?.name ?? null,
    reference: raw.reason ?? raw.reference ?? null,
    notes: raw.notes ?? null,
    user_id: raw.user_id ?? null,
    user_name: userName,
    source_module: raw.source_module ?? null,
    created_at: typeof raw.created_at === 'string'
      ? raw.created_at
      : raw.created_at?.toISOString?.() ?? new Date().toISOString(),
  };
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
  items: {
    product_id: string;
    variant_id?: string;
    quantity: number;
  }[];
}

export interface CreateSupplierDto {
  name: string;
  code?: string;
  email?: string;
  phone?: string;
  address?: string;
}

export type UpdateSupplierDto = Partial<CreateSupplierDto>;

export interface CreateLocationDto {
  name: string;
  code?: string;
  type: 'warehouse' | 'store' | 'virtual';
  address?: string;
}

export type UpdateLocationDto = Partial<CreateLocationDto>;

export const InventoryService = {
  async getStats(): Promise<InventoryStats> {
    try {
      const res = await apiClient.get(Endpoints.STORE.INVENTORY.STATS);
      return unwrap<InventoryStats>(res);
    } catch {
      const [productsResult, locationsResult] = await Promise.allSettled([
        apiClient.get(`${Endpoints.STORE.PRODUCTS.LIST}${buildQuery({ page: 1, limit: 200, include_stock: true })}`),
        apiClient.get(`${Endpoints.STORE.INVENTORY.LOCATIONS.LIST}${buildQuery({ page: 1, limit: 1 })}`),
      ]);

      const productsPage =
        productsResult.status === 'fulfilled'
          ? unwrapPaginated<Product>(productsResult.value, { page: 1, limit: 200 })
          : undefined;
      const locationsPage =
        locationsResult.status === 'fulfilled'
          ? unwrapPaginated<Location>(locationsResult.value, { page: 1, limit: 1 })
          : undefined;

      return buildInventoryStats(
        productsPage?.data ?? [],
        productsPage?.pagination.total ?? productsPage?.data.length ?? 0,
        locationsPage?.pagination.total ?? locationsPage?.data.length ?? 0,
      );
    }
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
    return unwrapPaginated<StockAdjustment>(res, { page: query?.page ?? 1, limit: query?.limit ?? 20 });
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
      status: query?.state === 'pending' ? 'draft' : query?.state,
    };
    const res = await apiClient.get(`${Endpoints.STORE.INVENTORY.TRANSFERS.LIST}${buildQuery(params)}`);
    const page = unwrapPaginated<Record<string, any>>(res, { page: query?.page ?? 1, limit: query?.limit ?? 20 });
    return {
      ...page,
      data: page.data.map(normalizeTransfer),
    };
  },

  async createTransfer(dto: CreateTransferDto): Promise<StockTransfer> {
    const res = await apiClient.post(Endpoints.STORE.INVENTORY.TRANSFERS.CREATE, toStockTransferPayload(dto));
    return normalizeTransfer(unwrap<Record<string, any>>(res));
  },

  async getMovements(query?: MovementQuery): Promise<PaginatedResponse<StockMovement>> {
    const params: Record<string, unknown> = {
      search: query?.search,
      movement_type: query?.movement_type,
      product_id: query?.product_id,
      from_location_id: query?.from_location_id,
      to_location_id: query?.to_location_id,
      user_id: query?.user_id,
      start_date: query?.start_date,
      end_date: query?.end_date,
    };
    const res = await apiClient.get(`${Endpoints.STORE.INVENTORY.MOVEMENTS.LIST}${buildQuery(params)}`);
    const page = unwrapPaginated<Record<string, any>>(res, { page: query?.page ?? 1, limit: query?.limit ?? 20 });
    return {
      ...page,
      data: page.data.map(normalizeMovement),
    };
  },

  async getSuppliers(query?: SupplierQuery): Promise<PaginatedResponse<Supplier>> {
    const params: Record<string, unknown> = {
      page: query?.page ?? 1,
      limit: query?.limit ?? 20,
      search: query?.search,
    };
    const res = await apiClient.get(`${Endpoints.STORE.INVENTORY.SUPPLIERS.LIST}${buildQuery(params)}`);
    return unwrapPaginated<Supplier>(res, { page: query?.page ?? 1, limit: query?.limit ?? 20 });
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
    return unwrapPaginated<Location>(res, { page: query?.page ?? 1, limit: query?.limit ?? 20 });
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

  async createPurchaseOrder(dto: CreatePurchaseOrderDto): Promise<PurchaseOrder> {
    const res = await apiClient.post(Endpoints.STORE.PURCHASE_ORDERS.CREATE, dto);
    return unwrap<PurchaseOrder>(res);
  },

  async receivePurchaseOrder(
    id: number,
    items: ReceivePurchaseOrderItemDto[],
    notes?: string,
  ): Promise<PurchaseOrder> {
    const endpoint = Endpoints.STORE.PURCHASE_ORDERS.RECEIVE.replace(':id', String(id));
    const res = await apiClient.patch(endpoint, { items, notes });
    return unwrap<PurchaseOrder>(res);
  },
};
