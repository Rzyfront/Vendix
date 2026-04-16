import { createActionGroup, emptyProps, props } from '@ngrx/store';
import { ReportCategoryId } from '../interfaces/report.interface';
import { DateRangeFilter } from '../../analytics/interfaces/analytics.interface';

export const ReportsActions = createActionGroup({
  source: 'Reports',
  events: {
    // Category & selection
    'Set Category': props<{ category: ReportCategoryId | null }>(),
    'Select Report': props<{ reportId: string }>(),
    'Clear Report': emptyProps(),

    // Filters
    'Set Date Range': props<{ dateRange: DateRangeFilter }>(),
    'Set Fiscal Period': props<{ fiscalPeriodId: number | null }>(),

    // Pagination
    'Set Page': props<{ page: number }>(),
    'Set Items Per Page': props<{ itemsPerPage: number }>(),

    // Load report data
    'Load Report Data': emptyProps(),
    'Load Report Data Success': props<{ data: any[]; meta?: Record<string, any>; isSummary?: boolean; summaryData?: Record<string, any> }>(),
    'Load Report Data Failure': props<{ error: string }>(),

    // Export
    'Export Report': emptyProps(),
    'Export Report Success': emptyProps(),
    'Export Report Failure': props<{ error: string }>(),
  },
});
