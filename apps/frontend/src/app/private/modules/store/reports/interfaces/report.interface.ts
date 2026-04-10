export type ReportCategoryId =
  | 'sales'
  | 'inventory'
  | 'products'
  | 'customers'
  | 'accounting'
  | 'payroll'
  | 'financial';

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
