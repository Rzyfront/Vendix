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
  ConsolidatedStock,
  StockAlert,
  SourcingSuggestion,
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
  const items = Array.isArray(raw.stock_transfer_items) ? raw.stock_transfer_items : [];

  return {
    id: String(raw.id),
    transfer_number: raw.transfer_number ?? raw.code ?? undefined,
    origin_location_id: String(raw.origin_location_id ?? raw.from_location_id ?? ''),
    origin_location_name: raw.origin_location_name ?? raw.from_location?.name ?? 'Origen',
    destination_location_id: String(raw.destination_location_id ?? raw.to_location_id ?? ''),
    destination_location_name: raw.destination_location_name ?? raw.to_location?.name ?? 'Destino',
    product_count: Number(raw.product_count ?? items.length ?? 0),
    items_count: items.length || undefined,
    transfer_date: raw.transfer_date ?? raw.created_at ?? undefined,
    expected_date: raw.expected_date ?? undefined,
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

function normalizeAdjustment(raw: Record<string, any>): StockAdjustment {
  const product = raw.products ?? raw.product ?? null;
  const location = raw.inventory_locations ?? null;
  return {
    id: Number(raw.id),
    organization_id: Number(raw.organization_id ?? 0),
    product_id: Number(raw.product_id ?? product?.id ?? 0),
    product_variant_id: raw.product_variant_id ?? null,
    location_id: Number(raw.location_id ?? location?.id ?? 0),
    batch_id: raw.batch_id ?? null,
    adjustment_type: raw.adjustment_type as AdjustmentType,
    quantity_before: Number(raw.quantity_before ?? raw.quantity ?? 0),
    quantity_after: Number(raw.quantity_after ?? 0),
    quantity_change: Number(raw.quantity_change ?? raw.quantity ?? 0),
    reason_code: raw.reason_code ?? raw.reason ?? null,
    description: raw.description ?? null,
    approved_by_user_id: raw.approved_by_user_id ?? null,
    created_by_user_id: raw.created_by_user_id ?? null,
    approved_at: raw.approved_at ?? null,
    created_at: typeof raw.created_at === 'string'
      ? raw.created_at
      : raw.created_at?.toISOString?.() ?? new Date().toISOString(),
    products: product ? { id: Number(product.id), name: product.name, sku: product.sku ?? null } : null,
    product_variants: raw.product_variants ?? null,
    inventory_locations: location ? { id: Number(location.id), name: location.name, store_id: location.store_id != null ? Number(location.store_id) : null } : null,
  };
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

export interface CreateAdjustmentItem {
  product_id: number;
  type: AdjustmentType;
  /** Final stock quantity (NOT the change). Backend computes `quantity_change = quantity_after - quantity_before`. */
  quantity_after: number;
  reason_code?: string;
  description?: string;
}

export interface CreateAdjustmentDto {
  location_id: number;
  items: CreateAdjustmentItem[];
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
  contact_person?: string;
  email?: string;
  phone?: string;
  mobile?: string;
  website?: string;
  tax_id?: string;
  payment_terms?: string;
  currency?: string;
  lead_time_days?: number | null;
  notes?: string;
  address?: string;
  is_active?: boolean;
}

export type UpdateSupplierDto = Partial<CreateSupplierDto>;

export interface CreateLocationDto {
  name: string;
  code?: string;
  type: 'warehouse' | 'store' | 'virtual';
  address?: string;
  is_active?: boolean;
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
    // Backend returns `successResponse<AdjustmentResponse>` where data is
    // `{ adjustments: [...], total: number, hasMore: boolean }` — NOT a plain array.
    // Standard `unwrapPaginated` expects `{ data: T[] }`, so we custom-unwrap here.
    const body = res.data as
      | { success?: boolean; data?: { adjustments?: Record<string, any>[]; total?: number; hasMore?: boolean } }
      | { adjustments?: Record<string, any>[]; total?: number; hasMore?: boolean };
    const payload =
      body && typeof body === 'object' && 'success' in body && (body as any).success
        ? (body as any).data
        : body;
    const adjustments = Array.isArray((payload as any)?.adjustments)
      ? (payload as any).adjustments
      : [];
    const total = Number((payload as any)?.total ?? adjustments.length);
    const hasMore = Boolean((payload as any)?.hasMore);
    const page = Number(query?.page ?? 1);
    const limit = Number(query?.limit ?? 20);

    return {
      data: adjustments.map(normalizeAdjustment),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
        hasNext: hasMore,
        hasPrev: page > 1,
      },
    };
  },

  async createAdjustment(dto: CreateAdjustmentDto): Promise<StockAdjustment> {
    // POST /store/inventory/adjustments/batch-complete — creates AND applies immediately.
    // Backend expects `BatchCreateAdjustmentsDto`: { location_id, items: [{ product_id, type, quantity_after, ... }] }.
    // The `quantity_after` field is the final stock (not the change); backend computes the delta.
    const res = await apiClient.post(Endpoints.STORE.INVENTORY.ADJUSTMENTS.CREATE, dto);
    // The batch-complete endpoint returns `{ adjustments: [...], ... }` — unwrap to first item.
    const payload = unwrap<Record<string, any> | { adjustments?: Record<string, any>[] }>(res);
    const firstItem = (payload as any)?.adjustments?.[0] ?? payload;
    return normalizeAdjustment(firstItem as Record<string, any>);
  },

  async createAdjustmentDraft(dto: CreateAdjustmentDto): Promise<StockAdjustment> {
    // POST /store/inventory/adjustments/batch — creates as PENDING (draft, not applied).
    const res = await apiClient.post(Endpoints.STORE.INVENTORY.ADJUSTMENTS.CREATE_DRAFT, dto);
    const payload = unwrap<Record<string, any> | { adjustments?: Record<string, any>[] }>(res);
    const firstItem = (payload as any)?.adjustments?.[0] ?? payload;
    return normalizeAdjustment(firstItem as Record<string, any>);
  },

  async approveAdjustment(id: number, approvedByUserId: number): Promise<StockAdjustment> {
    const endpoint = Endpoints.STORE.INVENTORY.ADJUSTMENTS.APPROVE.replace(':id', String(id));
    const res = await apiClient.patch(endpoint, { approvedByUserId });
    const payload = unwrap<Record<string, any>>(res);
    return normalizeAdjustment(payload);
  },

  async deleteAdjustment(id: number): Promise<void> {
    const endpoint = Endpoints.STORE.INVENTORY.ADJUSTMENTS.DELETE.replace(':id', String(id));
    await apiClient.delete(endpoint);
  },

  async downloadAdjustmentTemplate(locationId?: number): Promise<Blob> {
    const params = locationId ? `?location_id=${locationId}` : '';
    const res = await apiClient.get(
      `${Endpoints.STORE.INVENTORY.ADJUSTMENTS.BULK_TEMPLATE}${params}`,
      { responseType: 'blob' },
    );
    return res.data as Blob;
  },

  async uploadBulkAdjustments(
    file: { uri: string; name: string; type?: string },
    locationId: number,
    adjustmentType: string,
    description?: string,
  ): Promise<{ total_processed: number; successful: number; failed: number; results: any[] }> {
    const formData = new FormData();
    // @ts-expect-error - React Native FormData accepts file objects
    formData.append('file', {
      uri: file.uri,
      name: file.name,
      type: file.type || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    formData.append('location_id', String(locationId));
    formData.append('adjustment_type', adjustmentType);
    if (description) formData.append('description', description);

    const res = await apiClient.post(
      Endpoints.STORE.INVENTORY.ADJUSTMENTS.BULK_UPLOAD,
      formData,
      {
        headers: { 'Content-Type': 'multipart/form-data' },
      },
    );
    return unwrap<{ total_processed: number; successful: number; failed: number; results: any[] }>(res);
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

  async approveTransfer(id: string | number): Promise<StockTransfer> {
    const endpoint = Endpoints.STORE.INVENTORY.TRANSFERS.APPROVE.replace(':id', String(id));
    const res = await apiClient.patch(endpoint, {});
    return normalizeTransfer(unwrap<Record<string, any>>(res));
  },

  async completeTransfer(
    id: string | number,
    items: Array<{ id: number; quantity_received: number }>,
  ): Promise<StockTransfer> {
    const endpoint = Endpoints.STORE.INVENTORY.TRANSFERS.COMPLETE.replace(':id', String(id));
    const res = await apiClient.patch(endpoint, { items });
    return normalizeTransfer(unwrap<Record<string, any>>(res));
  },

  async cancelTransfer(id: string | number): Promise<StockTransfer> {
    const endpoint = Endpoints.STORE.INVENTORY.TRANSFERS.CANCEL.replace(':id', String(id));
    const res = await apiClient.patch(endpoint, {});
    return normalizeTransfer(unwrap<Record<string, any>>(res));
  },

  async getMovements(query?: MovementQuery): Promise<PaginatedResponse<StockMovement>> {
    const page = query?.page ?? 1;
    const limit = query?.limit ?? 20;
    const params: Record<string, unknown> = {
      page,
      limit,
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
    const pageResult = unwrapPaginated<Record<string, any>>(res, { page, limit });
    return {
      ...pageResult,
      data: pageResult.data.map(normalizeMovement),
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
    const res = await apiClient.patch(endpoint, dto);
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
    const res = await apiClient.patch(endpoint, dto);
    return unwrap<Location>(res);
  },

  async deleteLocation(id: string): Promise<void> {
    const endpoint = Endpoints.STORE.INVENTORY.LOCATIONS.DELETE.replace(':id', id);
    await apiClient.delete(endpoint);
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

  async getPurchaseOrders(query?: { page?: number; limit?: number; search?: string; status?: string }): Promise<PaginatedResponse<PurchaseOrder>> {
    const params: Record<string, unknown> = {
      page: query?.page ?? 1,
      limit: query?.limit ?? 20,
      search: query?.search,
      status: query?.status,
    };
    const res = await apiClient.get(`${Endpoints.STORE.PURCHASE_ORDERS.LIST}${buildQuery(params)}`);
    return unwrapPaginated<PurchaseOrder>(res, { page: query?.page ?? 1, limit: query?.limit ?? 20 });
  },

  async getPurchaseOrderById(id: number): Promise<PurchaseOrder> {
    const endpoint = Endpoints.STORE.PURCHASE_ORDERS.GET.replace(':id', String(id));
    const res = await apiClient.get(endpoint);
    return unwrap<PurchaseOrder>(res);
  },

  async updatePurchaseOrder(id: number, dto: Partial<CreatePurchaseOrderDto>): Promise<PurchaseOrder> {
    const endpoint = Endpoints.STORE.PURCHASE_ORDERS.UPDATE.replace(':id', String(id));
    const res = await apiClient.patch(endpoint, dto);
    return unwrap<PurchaseOrder>(res);
  },

  async getConsolidatedStock(productId: number, organizationId?: number): Promise<ConsolidatedStock> {
    const endpoint = Endpoints.STORE.INVENTORY.CONSOLIDATED_STOCK.replace(':productId', String(productId));
    const query = organizationId ? `?organization_id=${organizationId}` : '';
    const res = await apiClient.get(`${endpoint}${query}`);
    return unwrap<ConsolidatedStock>(res);
  },

  async getStockAlerts(query?: { location_id?: number; page?: number; limit?: number }): Promise<PaginatedResponse<StockAlert>> {
    const params: Record<string, unknown> = { ...query };
    const res = await apiClient.get(`${Endpoints.STORE.INVENTORY.STOCK_ALERTS}${buildQuery(params)}`);
    return unwrapPaginated<StockAlert>(res, { page: query?.page ?? 1, limit: query?.limit ?? 20 });
  },

  async getSourcingSuggestion(productId: number, quantity: number, variantId?: number): Promise<SourcingSuggestion> {
    const params: Record<string, unknown> = { product_id: productId, quantity };
    if (variantId) params.product_variant_id = variantId;
    const res = await apiClient.get(`${Endpoints.STORE.INVENTORY.SOURCING_SUGGESTION}${buildQuery(params)}`);
    return unwrap<SourcingSuggestion>(res);
  },
};
