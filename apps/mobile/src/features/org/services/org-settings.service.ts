import { apiGet, apiPut, ListParams } from '@/core/api/http';
import { Endpoints } from '@/core/api/endpoints';
import type { PaymentMethod, OrganizationSettings } from '@/core/models/org-admin/config.types';

export const OrgSettingsService = {
  get: async () => apiGet<OrganizationSettings>(Endpoints.ORGANIZATION.SETTINGS.GET),
  update: async (body: Partial<OrganizationSettings>) => apiPut(Endpoints.ORGANIZATION.SETTINGS.UPDATE, body),
  listPaymentMethods: async (params?: ListParams) =>
    apiGet<PaymentMethod[]>(Endpoints.ORGANIZATION.SETTINGS.PAYMENT_POLICIES, params),
  getOperatingScope: async () => apiGet(Endpoints.ORGANIZATION.SETTINGS.OPERATING_SCOPE),
  getFiscalScope: async () => apiGet(Endpoints.ORGANIZATION.SETTINGS.FISCAL_SCOPE),
};
