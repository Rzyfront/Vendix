import { apiClient, Endpoints } from '@/core/api';
import { unwrap } from '@/core/api/http';

export type SerialStatus =
  | 'in_stock'
  | 'reserved'
  | 'sold'
  | 'damaged'
  | 'returned'
  | 'in_repair'
  | 'written_off';

export interface SerialNumber {
  id: number;
  product_id: number;
  product_variant_id?: number | null;
  location_id?: number | null;
  serial: string;
  status: SerialStatus;
  notes?: string | null;
  warranty_expires_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface SerialNumberSummary {
  total: number;
  in_stock: number;
  sold: number;
  reserved: number;
  damaged: number;
  returned: number;
  in_repair: number;
  written_off: number;
  warranty_expiring_soon: number;
  warranty_expired: number;
}

export interface SerialNumbersListResponse {
  data: SerialNumber[];
  total: number;
  page: number;
  limit: number;
}

export interface ListSerialNumbersParams {
  product_id?: number;
  product_variant_id?: number;
  status?: SerialStatus;
  page?: number;
  limit?: number;
  search?: string;
}

function buildQuery(params: Record<string, unknown>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') sp.append(k, String(v));
  }
  const qs = sp.toString();
  return qs ? `?${qs}` : '';
}

export const SerialNumbersService = {
  /**
   * Lista seriales con paginación y filtros.
   * GET /store/inventory/serial-numbers?product_id=X&...
   */
  async list(
    params: ListSerialNumbersParams = {},
  ): Promise<SerialNumbersListResponse> {
    const url =
      Endpoints.STORE.INVENTORY.SERIAL_NUMBERS.LIST +
      buildQuery(params as Record<string, unknown>);
    const res = await apiClient.get(url);
    return unwrap<SerialNumbersListResponse>(res);
  },

  /**
   * Resumen del pool de seriales de un producto (totales por estado +
   * warranty expiring/expired). Usado en product-upsert-form stats.
   * GET /store/inventory/serial-numbers/summary?product_id=X
   */
  async summary(
    productId: number,
    productVariantId?: number,
  ): Promise<SerialNumberSummary> {
    const url =
      Endpoints.STORE.INVENTORY.SERIAL_NUMBERS.SUMMARY +
      buildQuery({ product_id: productId, product_variant_id: productVariantId });
    const res = await apiClient.get(url);
    const payload = unwrap<{ data?: SerialNumberSummary } | SerialNumberSummary>(res);
    return (payload as { data?: SerialNumberSummary }).data ?? (payload as SerialNumberSummary);
  },

  /**
   * Registra un nuevo serial en el pool.
   * POST /store/inventory/serial-numbers
   */
  async create(input: {
    product_id: number;
    serial: string;
    location_id?: number;
    product_variant_id?: number;
    notes?: string;
  }): Promise<SerialNumber> {
    const res = await apiClient.post(
      Endpoints.STORE.INVENTORY.SERIAL_NUMBERS.CREATE,
      input,
    );
    const payload = unwrap<{ data?: SerialNumber } | SerialNumber>(res);
    return (payload as { data?: SerialNumber }).data ?? (payload as SerialNumber);
  },

  /**
   * Carga masiva de seriales para un producto.
   * POST /store/inventory/serial-numbers/bulk
   */
  async bulkCreate(input: {
    product_id: number;
    serials: string[];
    location_id?: number;
  }): Promise<{ created: number; skipped: number; errors: string[] }> {
    const res = await apiClient.post(
      Endpoints.STORE.INVENTORY.SERIAL_NUMBERS.BULK,
      input,
    );
    return unwrap<{ created: number; skipped: number; errors: string[] }>(res);
  },
};
