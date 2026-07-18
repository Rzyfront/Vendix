import { apiGet, apiPost, apiPut, ListParams } from '@/core/api/http';
import { Endpoints } from '@/core/api/endpoints';
import type {
  OrganizationSettings,
  OrganizationSettingsFull,
  OrganizationBranding,
  PaymentMethod,
  FiscalScopeInfo,
  FiscalManagementStatus,
  OperatingScopeInfo,
  OperatingScopeCurrentState,
  OperatingScopePreview,
  OperatingScopeApplyResult,
  ApplyOperatingScopeDto,
  OperatingScopeValue,
} from '@/core/models/org-admin/config.types';

export const OrgConfigService = {
  // Application / General (branding + appearance)
  getSettings: async () =>
    apiGet<OrganizationSettings>(Endpoints.ORGANIZATION.SETTINGS.GET),
  updateSettings: async (body: Partial<OrganizationSettings>) =>
    apiPut<OrganizationSettings>(Endpoints.ORGANIZATION.SETTINGS.UPDATE, body),

  // Full settings (branding + inventory + fonts + panel_ui + payroll)
  getFullSettings: async () =>
    apiGet<OrganizationSettingsFull>(Endpoints.ORGANIZATION.SETTINGS.GET),
  saveBranding: async (branding: OrganizationBranding) =>
    apiPut<OrganizationSettingsFull>(Endpoints.ORGANIZATION.SETTINGS.UPDATE, {
      settings: { branding },
    }),

  // Operating scope (paridad visual con web)
  // PR #15: getOperatingScope ahora retorna el nuevo contrato `OperatingScopeCurrentState`
  // (current, is_partner, editable, audit_log_recent) en lugar del legacy `OperatingScopeInfo`.
  // Consumido por `settings/operating-scope.tsx` (paridad 1:1 con web).
  getOperatingScope: async () =>
    apiGet<OperatingScopeCurrentState>(Endpoints.ORGANIZATION.SETTINGS.OPERATING_SCOPE),
  previewOperatingScope: async (targetScope: OperatingScopeValue, reason?: string) =>
    apiPost<OperatingScopePreview>(Endpoints.ORGANIZATION.SETTINGS.OPERATING_SCOPE_PREVIEW, {
      target_scope: targetScope,
      reason: reason?.trim() || undefined,
    } as ApplyOperatingScopeDto),
  applyOperatingScope: async (
    targetScope: OperatingScopeValue,
    reason?: string,
    force = false,
  ) => {
    const body: ApplyOperatingScopeDto = {
      target_scope: targetScope,
      reason: reason?.trim() || undefined,
    };
    if (force === true) body.force = true;
    return apiPost<OperatingScopeApplyResult>(
      Endpoints.ORGANIZATION.SETTINGS.OPERATING_SCOPE_APPLY,
      body,
    );
  },

  // Fiscal scope
  getFiscalScope: async () =>
    apiGet<FiscalScopeInfo>(Endpoints.ORGANIZATION.SETTINGS.FISCAL_SCOPE),
  getFiscalData: async () =>
    apiGet<unknown>(Endpoints.ORGANIZATION.SETTINGS.FISCAL_DATA),
  updateFiscalData: async (body: unknown) =>
    apiPut(Endpoints.ORGANIZATION.SETTINGS.FISCAL_DATA, body),
  getFiscalStatus: async () =>
    apiGet<FiscalManagementStatus>(Endpoints.ORGANIZATION.SETTINGS.FISCAL_STATUS),

  // Payment methods (legacy — via /organization/payment-policies)
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
      Endpoints.ORGANIZATION.FISCAL.WIZARD_IRREVERSIBILITY.replace(':area', area),
    ),
  getWizardPrefill: async () =>
    apiGet<unknown>(Endpoints.ORGANIZATION.FISCAL.WIZARD_PREFLL),
};
