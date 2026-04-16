import { ReportCategoryId } from '../interfaces/report.interface';
import { DateRangeFilter } from '../../analytics/interfaces/analytics.interface';
import { toLocalDateString } from '../../../../../shared/utils/date.util';

export interface ReportsState {
  selectedCategory: ReportCategoryId | null;
  selectedReportId: string | null;
  dateRange: DateRangeFilter;
  fiscalPeriodId: number | null;
  reportData: any[] | null;
  reportMeta: Record<string, any> | null;
  isSummary: boolean;
  summaryData: Record<string, any> | null;
  loading: boolean;
  exporting: boolean;
  error: string | null;
  currentPage: number;
  totalPages: number;
  totalItems: number;
  itemsPerPage: number;
}

function getDefaultDateRange(): DateRangeFilter {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  return {
    start_date: toLocalDateString(start),
    end_date: toLocalDateString(now),
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
  isSummary: false,
  summaryData: null,
  loading: false,
  exporting: false,
  error: null,
  currentPage: 1,
  totalPages: 1,
  totalItems: 0,
  itemsPerPage: 25,
};
