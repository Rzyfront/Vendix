import { apiGet, apiPost, apiPut, ListParams } from '@/core/api/http';
import { Endpoints } from '@/core/api/endpoints';
import type {
  OrganizationSettings,
  PaymentMethod,
  OperatingScopeInfo,
  FiscalScopeInfo,
  FiscalManagementStatus,
} from '@/core/models/org-admin/config.types';

export const OrgConfigService = {
  // Application (general settings)
  getSettings: async () =>
    apiGet<OrganizationSettings>(Endpoints.ORGANIZATION.SETTINGS.GET),
  updateSettings: async (body: Partial<OrganizationSettings>) =>
    apiPut<OrganizationSettings>(Endpoints.ORGANIZATION.SETTINGS.UPDATE, body),
  // Operating scope
  getOperatingScope: async () =>
    apiGet<OperatingScopeInfo>(Endpoints.ORGANIZATION.SETTINGS.OPERATING_SCOPE),
  // Fiscal scope
  getFiscalScope: async () =>
    apiGet<FiscalScopeInfo>(Endpoints.ORGANIZATION.SETTINGS.FISCAL_SCOPE),
  getFiscalData: async () =>
    apiGet<unknown>(Endpoints.ORGANIZATION.SETTINGS.FISCAL_DATA),
  updateFiscalData: async (body: unknown) =>
    apiPut(Endpoints.ORGANIZATION.SETTINGS.FISCAL_DATA, body),
  getFiscalStatus: async () =>
    apiGet<FiscalManagementStatus>(Endpoints.ORGANIZATION.SETTINGS.FISCAL_STATUS),
  // Payment methods
  listPaymentMethods: async (params?: ListParams) =>
    apiGet<PaymentMethod[]>(Endpoints.ORGANIZATION.SETTINGS.PAYMENT_POLICIES, params),
  // Fiscal management wizard
  startWizard: async (area: string) =>
    apiPost(Endpoints.ORGANIZATION.FISCAL.WIZARD_START.replace(':area', area)),
  markStepCompleted: async (area: string, body: unknown) =>
    apiPost(Endpoints.ORGANIZATION.FISCAL.WIZARD_STEP.replace(':area', area), body),
  deactivateWizard: async (area: string) =>
    apiPost(Endpoints.ORGANIZATION.FISCAL.WIZARD_DEACTIVATE.replace(':area', area)),
  finalizeWizard: async (area: string) =>
    apiPost(Endpoints.ORGANIZATION.FISCAL.WIZARD_FINALIZE.replace(':area', area)),
  checkIrreversibility: async (area: string) =>
    apiGet<{ irreversible: boolean; reason?: string }>(
      Endpoints.ORGANIZATION.FISCAL.WIZARD_IRREVERSIBILITY.replace(':area', area)
    ),
  getWizardPrefill: async () =>
    apiGet<unknown>(Endpoints.ORGANIZATION.FISCAL.WIZARD_PREFLL),
};
