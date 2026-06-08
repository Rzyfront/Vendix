import { apiGet } from '@/core/api/http';
import { Endpoints } from '@/core/api/endpoints';
import type { SalesReport, InventoryReport, FinancialReport, ReportFilter } from '@/core/models/org-admin/reports.types';

export const OrgReportsService = {
  getSales: async (filter: ReportFilter) =>
    apiGet<SalesReport>(Endpoints.ORGANIZATION.REPORTS.SALES, filter as any),
  getSalesByChannel: async (filter: ReportFilter) =>
    apiGet<SalesReport>(Endpoints.ORGANIZATION.REPORTS.SALES_BY_CHANNEL, filter as any),
  getSalesByStore: async (filter: ReportFilter) =>
    apiGet<SalesReport>(Endpoints.ORGANIZATION.REPORTS.SALES_BY_STORE, filter as any),
  getSalesTopProducts: async (filter: ReportFilter) =>
    apiGet<SalesReport>(Endpoints.ORGANIZATION.REPORTS.SALES_TOP_PRODUCTS, filter as any),
  getInventory: async (filter: ReportFilter) =>
    apiGet<InventoryReport>(Endpoints.ORGANIZATION.REPORTS.INVENTORY, filter as any),
  getInventoryValuation: async (filter: ReportFilter) =>
    apiGet<InventoryReport>(Endpoints.ORGANIZATION.REPORTS.INVENTORY_VALUATION, filter as any),
  getFinancial: async (filter: ReportFilter) =>
    apiGet<FinancialReport>(Endpoints.ORGANIZATION.REPORTS.FINANCIAL, filter as any),
  getIncomeStatement: async (filter: ReportFilter) =>
    apiGet<FinancialReport>(Endpoints.ORGANIZATION.REPORTS.FINANCIAL_INCOME, filter as any),
  getBalanceSheet: async (filter: ReportFilter) =>
    apiGet<FinancialReport>(Endpoints.ORGANIZATION.REPORTS.FINANCIAL_BALANCE, filter as any),
  getTrialBalance: async (filter: ReportFilter) =>
    apiGet<FinancialReport>(Endpoints.ORGANIZATION.REPORTS.FINANCIAL_TRIAL, filter as any),
  getGeneralLedger: async (filter: ReportFilter) =>
    apiGet<FinancialReport>(Endpoints.ORGANIZATION.REPORTS.FINANCIAL_LEDGER, filter as any),
  getPayroll: async (filter: ReportFilter) =>
    apiGet<FinancialReport>(Endpoints.ORGANIZATION.REPORTS.PAYROLL, filter as any),
  getPayrollByEmployee: async (filter: ReportFilter) =>
    apiGet<FinancialReport>(Endpoints.ORGANIZATION.REPORTS.PAYROLL_BY_EMPLOYEE, filter as any),
};
