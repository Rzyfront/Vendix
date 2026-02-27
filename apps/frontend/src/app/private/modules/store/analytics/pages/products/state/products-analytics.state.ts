import { DateRangeFilter } from '../../../interfaces/analytics.interface';
import { ProductsSummary, TopSellingProduct, ProductAnalyticsRow, ProductTrend } from '../../../interfaces/products-analytics.interface';

export interface ProductsAnalyticsState {
  summary: ProductsSummary | null;
  topSellers: TopSellingProduct[];
  trends: ProductTrend[];
  products: ProductAnalyticsRow[];
  totalProducts: number;
  dateRange: DateRangeFilter;
  granularity: string;
  search: string;
  page: number;
  limit: number;
  sortBy: string;
  sortOrder: 'asc' | 'desc';
  loading: boolean;
  loadingTopSellers: boolean;
  loadingTrends: boolean;
  loadingTable: boolean;
  exporting: boolean;
  error: string | null;
}

export const initialProductsAnalyticsState: ProductsAnalyticsState = {
  summary: null,
  topSellers: [],
  trends: [],
  products: [],
  totalProducts: 0,
  dateRange: {
    start_date: getDefaultStartDate(),
    end_date: getDefaultEndDate(),
    preset: 'thisMonth',
  },
  granularity: 'day',
  search: '',
  page: 1,
  limit: 20,
  sortBy: 'revenue',
  sortOrder: 'desc',
  loading: false,
  loadingTopSellers: false,
  loadingTrends: false,
  loadingTable: false,
  exporting: false,
  error: null,
};

function getDefaultStartDate(): string {
  const date = new Date();
  date.setDate(1);
  return date.toISOString().split('T')[0];
}

function getDefaultEndDate(): string {
  return new Date().toISOString().split('T')[0];
}
