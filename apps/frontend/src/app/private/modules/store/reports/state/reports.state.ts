import { ReportCategoryId } from '../interfaces/report.interface';
import { DateRangeFilter } from '../../analytics/interfaces/analytics.interface';

export interface ReportsState {
  selectedCategory: ReportCategoryId | null;
  selectedReportId: string | null;
  dateRange: DateRangeFilter;
  fiscalPeriodId: number | null;
  reportData: any[] | null;
  reportMeta: Record<string, any> | null;
  loading: boolean;
  exporting: boolean;
  error: string | null;
}

function getDefaultDateRange(): DateRangeFilter {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  return {
    start_date: start.toISOString().split('T')[0],
    end_date: now.toISOString().split('T')[0],
    preset: 'thisMonth',
  };
}

export const initialReportsState: ReportsState = {
  selectedCategory: null,
  selectedReportId: null,
  dateRange: getDefaultDateRange(),
  fiscalPeriodId: null,
  reportData: null,
  reportMeta: null,
  loading: false,
  exporting: false,
  error: null,
};
