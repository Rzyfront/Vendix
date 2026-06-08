import { apiGet, apiPost, apiPut, ListParams } from '@/core/api/http';
import { Endpoints } from '@/core/api/endpoints';
import type { PurchaseOrder, PurchaseOrderCreate } from '@/core/models/org-admin/purchase-orders.types';

export const OrgPurchaseOrdersService = {
  list: async (params?: ListParams) =>
    apiGet<PurchaseOrder[]>(Endpoints.ORGANIZATION.PURCHASE_ORDERS.LIST, params),
  get: async (id: string) =>
    apiGet<PurchaseOrder>(Endpoints.ORGANIZATION.PURCHASE_ORDERS.GET.replace(':id', id)),
  create: async (body: PurchaseOrderCreate) =>
    apiPost<PurchaseOrder>(Endpoints.ORGANIZATION.PURCHASE_ORDERS.CREATE, body),
  update: async (id: string, body: Partial<PurchaseOrder>) =>
    apiPut<PurchaseOrder>(Endpoints.ORGANIZATION.PURCHASE_ORDERS.UPDATE.replace(':id', id), body),
  approve: async (id: string) =>
    apiPost(Endpoints.ORGANIZATION.PURCHASE_ORDERS.APPROVE.replace(':id', id)),
  cancel: async (id: string) =>
    apiPost(Endpoints.ORGANIZATION.PURCHASE_ORDERS.CANCEL.replace(':id', id)),
  receive: async (id: string, body?: { items?: Array<{ product_id: string; quantity: number }> }) =>
    apiPost(Endpoints.ORGANIZATION.PURCHASE_ORDERS.RECEIVE.replace(':id', id), body),
};
