import { apiGet } from '@/core/api/http';
import { Endpoints } from '@/core/api/endpoints';
import type { OrganizationDashboardStats, RecentOrder, StorePerformance } from '@/core/models/org-admin/dashboard.types';

export const OrgDashboardService = {
  getStats: async () =>
    apiGet<OrganizationDashboardStats>(Endpoints.ORGANIZATION.DASHBOARD.STATS),
  getRecentOrders: async (limit = 10) =>
    apiGet<RecentOrder[]>(Endpoints.ORGANIZATION.DASHBOARD.RECENT, { limit }),
  getStorePerformance: async () =>
    apiGet<StorePerformance[]>('/organization/dashboard/store-performance'),
};
