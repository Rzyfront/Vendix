import { apiGet, ListParams } from '@/core/api/http';
import { Endpoints } from '@/core/api/endpoints';
import type { OrganizationOrder, OrderStats } from '@/core/models/org-admin/orders.types';

export const OrgOrdersService = {
  list: async (params?: ListParams) =>
    apiGet<OrganizationOrder[]>(Endpoints.ORGANIZATION.ORDERS.LIST, params),
  get: async (id: string) =>
    apiGet<OrganizationOrder>(Endpoints.ORGANIZATION.ORDERS.GET.replace(':id', id)),
  getStats: async () =>
    apiGet<OrderStats>(Endpoints.ORGANIZATION.ORDERS.STATS),
  getByStore: async () =>
    apiGet<unknown>(Endpoints.ORGANIZATION.ORDERS.BY_STORE),
};
