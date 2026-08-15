import {
  Invoice,
  InvoiceResolution,
  InvoiceStats,
  DianConfig,
  DianDocumentEvent,
} from '../interfaces/invoice.interface';
import { DianRejection } from '../utils/invoicing-errors.util';

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

  // DIAN configs (gate pre-factura)
  dianConfigs: DianConfig[];
  dianConfigsLoading: boolean;
  dianConfigsError: string | null;

  /**
   * Ultimo rechazo de la DIAN con sus motivos enumerados. Vive en el state —y
   * no en un toast— porque es la unica informacion que dice QUE corregir, y
   * tiene que seguir disponible mientras el usuario lee la factura.
   */
  dianRejection: DianRejection | null;

  /**
   * Eventos RADIAN de la factura abierta, con la factura a la que pertenecen.
   *
   * `dianEventsInvoiceId` no es redundante: sin el, los eventos de la factura A
   * seguirian en el store al abrir la B y el detalle los pintaria como suyos —
   * el mismo fallo que `dianRejection` ya resuelve con `invoiceId`.
   */
  dianEvents: DianDocumentEvent[];
  dianEventsInvoiceId: number | null;
  dianEventsLoading: boolean;

  /**
   * Regeneracion del PDF en curso. Bandera propia y NO `loading`: reusar la de
   * la lista cambiaria la tabla por un spinner mientras se rearma un PDF.
   */
  pdfRegenerating: boolean;

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

  dianConfigs: [],
  dianConfigsLoading: false,
  dianConfigsError: null,
  dianRejection: null,

  dianEvents: [],
  dianEventsInvoiceId: null,
  dianEventsLoading: false,
  pdfRegenerating: false,

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
