import { apiGet } from '@/core/api/http';
import { Endpoints } from '@/core/api/endpoints';
import type { OrganizationDashboardStats, RecentOrder, StorePerformance } from '@/core/models/org-admin/dashboard.types';

export const OrgDashboardService = {
  // Endpoint del backend: GET /organization/organizations/:id/stats
  // (ver apps/backend/src/domains/organization/organizations/organizations.controller.ts)
  // Aún no hay constante equivalente en Endpoints.ORGANIZATION.* — cuando se
  // agregue, reemplazar el path literal por la constante.
  getStats: async (organizationId: string) =>
    apiGet<OrganizationDashboardStats>(`/organization/organizations/${organizationId}/stats`),
  getRecentOrders: async (limit = 10) =>
    apiGet<RecentOrder[]>(Endpoints.ORGANIZATION.DASHBOARD.RECENT, { limit }),
  getStorePerformance: async () =>
    apiGet<StorePerformance[]>('/organization/dashboard/store-performance'),
};
