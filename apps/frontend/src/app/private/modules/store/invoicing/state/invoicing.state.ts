import {
  Invoice,
  InvoiceResolution,
  InvoiceStats,
} from '../interfaces/invoice.interface';

export interface InvoicingState {
  invoices: Invoice[];
  resolutions: InvoiceResolution[];
  loading: boolean;
  resolutionsLoading: boolean;
  currentInvoice: Invoice | null;
  currentInvoiceLoading: boolean;
  error: string | null;
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  } | null;

  // Stats from backend
  stats: InvoiceStats | null;
  loadingStats: boolean;

  // Filter-as-state
  search: string;
  page: number;
  limit: number;
  sortBy: string;
  sortOrder: 'asc' | 'desc';
  statusFilter: string;
  typeFilter: string;
  dateFrom: string;
  dateTo: string;
}

export const initialInvoicingState: InvoicingState = {
  invoices: [],
  resolutions: [],
  loading: false,
  resolutionsLoading: false,
  currentInvoice: null,
  currentInvoiceLoading: false,
  error: null,
  meta: null,

  stats: null,
  loadingStats: false,

  search: '',
  page: 1,
  limit: 10,
  sortBy: 'created_at',
  sortOrder: 'desc',
  statusFilter: '',
  typeFilter: '',
  dateFrom: '',
  dateTo: '',
};
