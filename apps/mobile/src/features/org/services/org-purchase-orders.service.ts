import { apiGet, apiPost, apiPut, ListParams } from '@/core/api/http';
import { Endpoints } from '@/core/api/endpoints';
import type {
  PurchaseOrder,
  PurchaseOrderCreate,
  PurchaseOrderStatus,
} from '@/core/models/org-admin/purchase-orders.types';

/**
 * Backend emits `PurchaseOrder` with:
 *   - `status` in **lowercase** (Prisma enum: `draft`, `approved`, `partial`,
 *     `received`, `cancelled`)
 *   - nested `suppliers: { name }` and `location: { name, stores: { name } }`
 *     — no flat `supplier_name`, `location_name`, `store_name`
 *
 * Mobile consumers (`index.tsx`, `[id].tsx`) read flat fields and uppercase
 * status. Centralize the normalization here so the rest of the app keeps a
 * clean, ergonomic surface and never sees the raw backend shape.
 */
const PO_STATUS_MAP: Record<string, PurchaseOrderStatus> = {
  draft: 'DRAFT',
  pending: 'PENDING',
  approved: 'APPROVED',
  in_transit: 'IN_TRANSIT',
  partial: 'PARTIAL',
  received: 'RECEIVED',
  cancelled: 'CANCELLED',
};

function normalizePoStatus(raw: string | null | undefined): PurchaseOrderStatus {
  if (!raw) return 'DRAFT';
  const key = String(raw).toLowerCase();
  return PO_STATUS_MAP[key] ?? (key.toUpperCase() as PurchaseOrderStatus);
}

/**
 * Shape we actually receive from the backend before normalization.
 * Keep this strict-but-defensive: properties are optional because the
 * backend may evolve and the type system shouldn't lie.
 */
type BackendPurchaseOrder = Partial<PurchaseOrder> & {
  status?: string;
  suppliers?: { id?: string | number; name?: string };
  location?: {
    id?: string | number;
    name?: string;
    code?: string;
    store_id?: string | number;
    stores?: { id?: string | number; name?: string };
  };
};

function normalizePurchaseOrder(raw: BackendPurchaseOrder): PurchaseOrder {
  const { suppliers, location, status, ...rest } = raw;
  return {
    ...(rest as PurchaseOrder),
    status: normalizePoStatus(status),
    supplier_name: suppliers?.name ?? '',
    location_name: location?.name ?? rest.location_name ?? '',
    store_name: location?.stores?.name ?? rest.store_name ?? '',
  };
}

export const OrgPurchaseOrdersService = {
  list: async (params?: ListParams) => {
    const raw = await apiGet<BackendPurchaseOrder[]>(
      Endpoints.ORGANIZATION.PURCHASE_ORDERS.LIST,
      params,
    );
    return Array.isArray(raw) ? raw.map(normalizePurchaseOrder) : [];
  },
  get: async (id: string) => {
    const raw = await apiGet<BackendPurchaseOrder>(
      Endpoints.ORGANIZATION.PURCHASE_ORDERS.GET.replace(':id', id),
    );
    return normalizePurchaseOrder(raw);
  },
  create: async (body: PurchaseOrderCreate) => {
    const raw = await apiPost<BackendPurchaseOrder>(
      Endpoints.ORGANIZATION.PURCHASE_ORDERS.CREATE,
      body,
    );
    return normalizePurchaseOrder(raw);
  },
  update: async (id: string, body: Partial<PurchaseOrder>) =>
    apiPut<PurchaseOrder>(
      Endpoints.ORGANIZATION.PURCHASE_ORDERS.UPDATE.replace(':id', id),
      body,
    ),
  approve: async (id: string) =>
    apiPost(Endpoints.ORGANIZATION.PURCHASE_ORDERS.APPROVE.replace(':id', id)),
  cancel: async (id: string) =>
    apiPost(Endpoints.ORGANIZATION.PURCHASE_ORDERS.CANCEL.replace(':id', id)),
  receive: async (
    id: string,
    body?: { items?: Array<{ product_id: string; quantity: number }> },
  ) =>
    apiPost(
      Endpoints.ORGANIZATION.PURCHASE_ORDERS.RECEIVE.replace(':id', id),
      body,
    ),
};
