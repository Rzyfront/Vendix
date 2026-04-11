export type ReportCategoryId =
  | 'sales'
  | 'inventory'
  | 'products'
  | 'customers'
  | 'accounting'
  | 'payroll'
  | 'financial';

export type ReportType = 'summary' | 'list' | 'nested';

export interface SummaryField {
  key: string;
  label: string;
  type: 'currency' | 'number' | 'text' | 'percentage';
  format?: string;
}

export interface SummaryLayoutConfig {
  sections?: { title: string; fields: SummaryField[] }[];
  fields: SummaryField[];
}

export interface ReportDefinition {
  id: string;
  category: ReportCategoryId;
  title: string;
  description: string;
  detailedDescription: string;
  icon: string; // Lucide icon name
  requiresDateRange: boolean;
  requiresFiscalPeriod: boolean;
  columns: ReportColumn[];
  exportFilename: string;
  dataEndpoint: string;
  exportEndpoint?: string;
  fullViewRoute?: string;
  type?: ReportType;
  keyMapping?: Record<string, string>;
  trackKey?: string;
  summaryLayout?: SummaryLayoutConfig;
}

export interface ReportAdaptedData {
  data: any[];
  meta?: Record<string, any>;
  isSummary?: boolean;
  summaryData?: Record<string, any>;
}

export interface ReportColumn {
  key: string;
  header: string;
  type: 'text' | 'number' | 'currency' | 'date' | 'percentage';
  align?: 'left' | 'center' | 'right';
  footer?: 'sum' | 'average' | 'count';
}

export interface ReportCategory {
  id: ReportCategoryId;
  label: string;
  icon: string;
  color: string;
}
