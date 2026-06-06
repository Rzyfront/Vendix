import { apiGet, ListParams } from '@/core/api/http';
import { Endpoints } from '@/core/api/endpoints';
import type {
  FiscalDashboardSummary,
  FiscalObligation,
  FiscalDeclaration,
  FiscalClose,
  FiscalEvidence,
  FiscalHistoryEntry,
  FiscalRule,
} from '@/core/models/org-admin/fiscal.types';

export const OrgFiscalService = {
  getDashboard: async () =>
    apiGet<FiscalDashboardSummary>(Endpoints.ORGANIZATION.FISCAL.DASHBOARD),
  listObligations: async (params?: ListParams) =>
    apiGet<FiscalObligation[]>(Endpoints.ORGANIZATION.FISCAL.OBLIGATIONS, params),
  listDeclarations: async (params?: ListParams) =>
    apiGet<FiscalDeclaration[]>(Endpoints.ORGANIZATION.FISCAL.DECLARATIONS, params),
  listCloses: async (params?: ListParams) =>
    apiGet<FiscalClose[]>(Endpoints.ORGANIZATION.FISCAL.CLOSE, params),
  listEvidence: async (params?: ListParams) =>
    apiGet<FiscalEvidence[]>(Endpoints.ORGANIZATION.FISCAL.EVIDENCE, params),
  listHistory: async (params?: ListParams) =>
    apiGet<FiscalHistoryEntry[]>(Endpoints.ORGANIZATION.FISCAL.HISTORY, params),
  listRules: async (params?: ListParams) =>
    apiGet<FiscalRule[]>(Endpoints.ORGANIZATION.FISCAL.RULES, params),
};
