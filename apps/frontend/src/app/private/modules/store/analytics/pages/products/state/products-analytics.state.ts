import { DateRangeFilter } from '../../../interfaces/analytics.interface';
import { ProductsSummary, TopSellingProduct, ProductAnalyticsRow } from '../../../interfaces/products-analytics.interface';

export interface ProductsAnalyticsState {
  summary: ProductsSummary | null;
  topSellers: TopSellingProduct[];
  products: ProductAnalyticsRow[];
  totalProducts: number;
  dateRange: DateRangeFilter;
  search: string;
  page: number;
  limit: number;
  sortBy: string;
  sortOrder: 'asc' | 'desc';
  loading: boolean;
  loadingTopSellers: boolean;
  loadingTable: boolean;
  exporting: boolean;
  error: string | null;
}

export const initialProductsAnalyticsState: ProductsAnalyticsState = {
  summary: null,
  topSellers: [],
  products: [],
  totalProducts: 0,
  dateRange: {
    start_date: getDefaultStartDate(),
    end_date: getDefaultEndDate(),
    preset: 'thisMonth',
  },
  search: '',
  page: 1,
  limit: 20,
  sortBy: 'revenue',
  sortOrder: 'desc',
  loading: false,
  loadingTopSellers: false,
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
