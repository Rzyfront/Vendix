import { apiGet, apiPut, ListParams } from '@/core/api/http';
import { Endpoints } from '@/core/api/endpoints';
import type { PayrollEmployee, PayrollPeriod, PayrollProvision, PayrollSettings } from '@/core/models/org-admin/payroll.types';

export const OrgPayrollService = {
  getSettings: async () =>
    apiGet<PayrollSettings>(Endpoints.ORGANIZATION.PAYROLL.SETTINGS_GET),
  updateSettings: async (body: Partial<PayrollSettings>) =>
    apiPut<PayrollSettings>(Endpoints.ORGANIZATION.PAYROLL.SETTINGS_UPDATE, body),
  listEmployees: async (params?: ListParams) =>
    apiGet<PayrollEmployee[]>(Endpoints.ORGANIZATION.PAYROLL.EMPLOYEES, params),
  listPeriods: async (params?: ListParams) =>
    apiGet<PayrollPeriod[]>(Endpoints.ORGANIZATION.PAYROLL.PERIODS, params),
  listProvisions: async (params?: ListParams) =>
    apiGet<PayrollProvision[]>(Endpoints.ORGANIZATION.PAYROLL.PROVISIONS, params),
  runPayroll: async (body: { period_id: string; employee_ids?: string[] }) =>
    apiPut(Endpoints.ORGANIZATION.PAYROLL.RUN_PAYROLL, body),
};
