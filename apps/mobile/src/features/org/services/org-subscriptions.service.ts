import { apiGet, ListParams } from '@/core/api/http';
import { Endpoints } from '@/core/api/endpoints';
import type { Subscription, SubscriptionPlan, SubscriptionUsage } from '@/core/models/org-admin/subscriptions.types';

export const OrgSubscriptionsService = {
  list: async (params?: ListParams) =>
    apiGet<Subscription[]>(Endpoints.ORGANIZATION.SUBSCRIPTIONS.LIST, params),
  get: async (id: string) =>
    apiGet<Subscription>(Endpoints.ORGANIZATION.SUBSCRIPTIONS.GET.replace(':id', id)),
  listPlans: async () =>
    apiGet<SubscriptionPlan[]>(Endpoints.ORGANIZATION.SUBSCRIPTIONS.PLANS),
  getCurrent: async () =>
    apiGet<Subscription>(Endpoints.ORGANIZATION.SUBSCRIPTIONS.CURRENT),
  getUsage: async () =>
    apiGet<SubscriptionUsage>(Endpoints.ORGANIZATION.SUBSCRIPTIONS.USAGE),
};
