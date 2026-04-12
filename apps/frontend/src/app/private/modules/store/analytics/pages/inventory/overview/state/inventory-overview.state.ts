import { DateRangeFilter } from '../../../../interfaces/analytics.interface';
import { getDefaultStartDate, getDefaultEndDate } from '../../../../../../../../shared/utils/date.util';
import {
  InventorySummary,
  MovementTrend,
  MovementSummaryItem,
  InventoryValuation,
} from '../../../../interfaces/inventory-analytics.interface';

export interface InventoryOverviewState {
  summary: InventorySummary | null;
  movementTrends: MovementTrend[];
  movementSummary: MovementSummaryItem[];
  valuations: InventoryValuation[];
  dateRange: DateRangeFilter;
  granularity: string;
  locationId: number | null;
  loading: boolean;
  loadingTrends: boolean;
  loadingValuation: boolean;
  exporting: boolean;
  error: string | null;
}

export const initialInventoryOverviewState: InventoryOverviewState = {
  summary: null,
  movementTrends: [],
  movementSummary: [],
  valuations: [],
  dateRange: {
    start_date: getDefaultStartDate(),
    end_date: getDefaultEndDate(),
    preset: 'thisMonth',
  },
  granularity: 'day',
  locationId: null,
  loading: false,
  loadingTrends: false,
  loadingValuation: false,
  exporting: false,
  error: null,
};
