import { createAction, props } from '@ngrx/store';
import {
  Invoice,
  InvoiceResolution,
  InvoiceStats,
  CreateInvoiceDto,
  UpdateInvoiceDto,
  CreateCreditNoteDto,
  CreateDebitNoteDto,
  CreateResolutionDto,
  UpdateResolutionDto,
  DianConfig,
  DianDocumentEvent,
  RegisterDianEventRequest,
} from '../../interfaces/invoice.interface';
import { DianRejection } from '../../utils/invoicing-errors.util';

/**
 * Payload de fallo de las mutaciones que un modal debe poder interpretar.
 *
 * `error` (mensaje UX) es lo que el reducer guarda; `errorCode` y `details`
 * viajan para que el modal que origino la mutacion pueda mapear
 * `SYS_VALIDATION_001` a sus `FormControl` en vez de tragarse el detalle. Son
 * datos planos: `strictActionSerializability` esta desactivado, pero aun asi no
 * se mete aqui el `HttpErrorResponse` crudo.
 */
export interface MutationFailure {
  error: string;
  errorCode?: string | null;
  details?: unknown;
}

// ── Load Invoices ───────────────────────────────────────────

export const loadInvoices = createAction('[Invoicing] Load Invoices');
export const loadInvoicesSuccess = createAction(
  '[Invoicing] Load Invoices Success',
  props<{ invoices: Invoice[]; meta: any }>(),
);
export const loadInvoicesFailure = createAction(
  '[Invoicing] Load Invoices Failure',
  props<{ error: string }>(),
);

// ── Load Single Invoice ─────────────────────────────────────

export const loadInvoice = createAction(
  '[Invoicing] Load Invoice',
  props<{ id: number }>(),
);
export const loadInvoiceSuccess = createAction(
  '[Invoicing] Load Invoice Success',
  props<{ invoice: Invoice }>(),
);
export const loadInvoiceFailure = createAction(
  '[Invoicing] Load Invoice Failure',
  props<{ error: string }>(),
);

// ── Create Invoice ──────────────────────────────────────────

export const createInvoice = createAction(
  '[Invoicing] Create Invoice',
  props<{ invoice: CreateInvoiceDto }>(),
);
export const createInvoiceSuccess = createAction(
  '[Invoicing] Create Invoice Success',
  props<{ invoice: Invoice }>(),
);
export const createInvoiceFailure = createAction(
  '[Invoicing] Create Invoice Failure',
  props<MutationFailure>(),
);

// ── Create From Order ───────────────────────────────────────

export const createFromOrder = createAction(
  '[Invoicing] Create From Order',
  props<{ orderId: number }>(),
);
export const createFromOrderSuccess = createAction(
  '[Invoicing] Create From Order Success',
  props<{ invoice: Invoice }>(),
);
export const createFromOrderFailure = createAction(
  '[Invoicing] Create From Order Failure',
  props<MutationFailure>(),
);

// ── Create From Sales Order ─────────────────────────────────

export const createFromSalesOrder = createAction(
  '[Invoicing] Create From Sales Order',
  props<{ salesOrderId: number }>(),
);
export const createFromSalesOrderSuccess = createAction(
  '[Invoicing] Create From Sales Order Success',
  props<{ invoice: Invoice }>(),
);
export const createFromSalesOrderFailure = createAction(
  '[Invoicing] Create From Sales Order Failure',
  props<MutationFailure>(),
);

// ── Update Invoice ──────────────────────────────────────────

export const updateInvoice = createAction(
  '[Invoicing] Update Invoice',
  props<{ id: number; invoice: UpdateInvoiceDto }>(),
);
export const updateInvoiceSuccess = createAction(
  '[Invoicing] Update Invoice Success',
  props<{ invoice: Invoice }>(),
);
export const updateInvoiceFailure = createAction(
  '[Invoicing] Update Invoice Failure',
  props<{ error: string }>(),
);

// ── Delete Invoice ──────────────────────────────────────────

export const deleteInvoice = createAction(
  '[Invoicing] Delete Invoice',
  props<{ id: number }>(),
);
export const deleteInvoiceSuccess = createAction(
  '[Invoicing] Delete Invoice Success',
  props<{ id: number }>(),
);
export const deleteInvoiceFailure = createAction(
  '[Invoicing] Delete Invoice Failure',
  props<{ error: string }>(),
);

// ── Validate Invoice ────────────────────────────────────────

export const validateInvoice = createAction(
  '[Invoicing] Validate Invoice',
  props<{ id: number }>(),
);
export const validateInvoiceSuccess = createAction(
  '[Invoicing] Validate Invoice Success',
  props<{ invoice: Invoice }>(),
);
export const validateInvoiceFailure = createAction(
  '[Invoicing] Validate Invoice Failure',
  props<{ error: string }>(),
);

// ── Send Invoice ────────────────────────────────────────────

export const sendInvoice = createAction(
  '[Invoicing] Send Invoice',
  props<{ id: number }>(),
);
export const sendInvoiceSuccess = createAction(
  '[Invoicing] Send Invoice Success',
  props<{ invoice: Invoice }>(),
);
export const sendInvoiceFailure = createAction(
  '[Invoicing] Send Invoice Failure',
  props<{ error: string }>(),
);

// ── Accept Invoice ─────────────────────────────────────────
export const acceptInvoice = createAction(
  '[Invoicing] Accept Invoice',
  props<{ id: number }>(),
);
export const acceptInvoiceSuccess = createAction(
  '[Invoicing] Accept Invoice Success',
  props<{ invoice: Invoice }>(),
);
export const acceptInvoiceFailure = createAction(
  '[Invoicing] Accept Invoice Failure',
  props<{ error: string }>(),
);

// ── Reject Invoice ─────────────────────────────────────────
export const rejectInvoice = createAction(
  '[Invoicing] Reject Invoice',
  props<{ id: number }>(),
);
export const rejectInvoiceSuccess = createAction(
  '[Invoicing] Reject Invoice Success',
  props<{ invoice: Invoice }>(),
);
export const rejectInvoiceFailure = createAction(
  '[Invoicing] Reject Invoice Failure',
  props<{ error: string }>(),
);

// ── Cancel Invoice ─────────────────────────────────────────
export const cancelInvoice = createAction(
  '[Invoicing] Cancel Invoice',
  props<{ id: number }>(),
);
export const cancelInvoiceSuccess = createAction(
  '[Invoicing] Cancel Invoice Success',
  props<{ invoice: Invoice }>(),
);
export const cancelInvoiceFailure = createAction(
  '[Invoicing] Cancel Invoice Failure',
  props<{ error: string }>(),
);

// ── Void Invoice ───────────────────────────────────────────
export const voidInvoice = createAction(
  '[Invoicing] Void Invoice',
  props<{ id: number }>(),
);
export const voidInvoiceSuccess = createAction(
  '[Invoicing] Void Invoice Success',
  props<{ invoice: Invoice }>(),
);
export const voidInvoiceFailure = createAction(
  '[Invoicing] Void Invoice Failure',
  props<{ error: string }>(),
);

// ── Credit Note ─────────────────────────────────────────────

export const createCreditNote = createAction(
  '[Invoicing] Create Credit Note',
  props<{ dto: CreateCreditNoteDto }>(),
);
export const createCreditNoteSuccess = createAction(
  '[Invoicing] Create Credit Note Success',
  props<{ invoice: Invoice }>(),
);
export const createCreditNoteFailure = createAction(
  '[Invoicing] Create Credit Note Failure',
  props<MutationFailure>(),
);

// ── Debit Note ──────────────────────────────────────────────

export const createDebitNote = createAction(
  '[Invoicing] Create Debit Note',
  props<{ dto: CreateDebitNoteDto }>(),
);
export const createDebitNoteSuccess = createAction(
  '[Invoicing] Create Debit Note Success',
  props<{ invoice: Invoice }>(),
);
export const createDebitNoteFailure = createAction(
  '[Invoicing] Create Debit Note Failure',
  props<MutationFailure>(),
);

// ── Rechazo de la DIAN (INVOICING_PROVIDER_004) ─────────────
//
// El motivo real del rechazo llega en `details.dian_errors[]` y NO cabe en un
// toast de dos segundos: son N reglas con codigo y texto, y son justo lo que el
// comerciante tiene que corregir. Se guarda en el state para pintarlo, completo
// y persistente, en el detalle de la factura que lo produjo.

export const dianDocumentRejected = createAction(
  '[Invoicing] DIAN Document Rejected',
  props<{ rejection: DianRejection }>(),
);

export const clearDianRejection = createAction(
  '[Invoicing] Clear DIAN Rejection',
);

// ── Eventos RADIAN (Res. 000085/2022) ───────────────────────
//
// `GET /store/invoicing/:id/events` existia en el backend desde siempre y NO
// tenia un solo cliente: la pista de auditoria del titulo valor —acuse, recibo,
// aceptacion, endoso, pago— era invisible desde el panel.
//
// `invoiceId` viaja en success y failure a proposito: el detalle lo compara con
// la factura abierta antes de pintar, igual que hace con `dianRejection`. Sin
// ese amarre, los eventos de una factura se pintarian sobre la siguiente que el
// usuario abriera.

export const loadDianEvents = createAction(
  '[Invoicing] Load DIAN Events',
  props<{ invoiceId: number }>(),
);
export const loadDianEventsSuccess = createAction(
  '[Invoicing] Load DIAN Events Success',
  props<{ invoiceId: number; events: DianDocumentEvent[] }>(),
);
export const loadDianEventsFailure = createAction(
  '[Invoicing] Load DIAN Events Failure',
  props<{ invoiceId: number; error: string }>(),
);

// REGISTRAR un evento RADIAN (`POST /store/invoicing/:id/events`). El endpoint
// existia y la UI solo sabia LEER: la pista de auditoria del titulo valor se
// podia mirar pero no alimentar, asi que acusar recibo o aceptar expresamente una
// factura solo era posible por `curl`.
//
// `event` viaja entero —no solo el codigo— porque el backend exige combinaciones
// por evento (tipo de operacion, listID del endoso, montos de la negociacion) y
// resumirlo aqui obligaria a reconstruirlo en el effect.

export const registerDianEvent = createAction(
  '[Invoicing] Register DIAN Event',
  props<{ invoiceId: number; event: RegisterDianEventRequest }>(),
);
/**
 * El backend NO lanza cuando RADIAN rechaza: persiste la fila con
 * `status: 'rejected'` y la devuelve con 200. Por eso el desenlace de exito
 * TRANSPORTA el evento: quien lo escuche decide si celebrar o avisar, y el modal
 * solo se cierra cuando el evento quedo realmente aceptado.
 */
export const registerDianEventSuccess = createAction(
  '[Invoicing] Register DIAN Event Success',
  // `event: null` es un caso real, no defensa de más: significa que el POST
  // respondió 200 sin cuerpo reconocible. El modal necesita distinguirlo de un
  // evento aceptado, porque en ese caso NO puede cantar éxito ni cerrarse.
  props<{ invoiceId: number; event: DianDocumentEvent | null }>(),
);
export const registerDianEventFailure = createAction(
  '[Invoicing] Register DIAN Event Failure',
  props<{ invoiceId: number } & MutationFailure>(),
);

// ── Regenerar PDF ───────────────────────────────────────────
//
// `POST /store/invoicing/:id/pdf/regenerate` tampoco tenia cliente. Es una
// MUTACION (reconstruye el PDF y lo sube a S3 pisando el anterior), asi que
// pasa por accion + effect como el resto: un `subscribe` directo desde el
// componente se saltaria el reporte de error unico de `InvoicingEffects`.

export const regenerateInvoicePdf = createAction(
  '[Invoicing] Regenerate Invoice PDF',
  props<{ id: number }>(),
);
export const regenerateInvoicePdfSuccess = createAction(
  '[Invoicing] Regenerate Invoice PDF Success',
  props<{ id: number; url: string | null }>(),
);
export const regenerateInvoicePdfFailure = createAction(
  '[Invoicing] Regenerate Invoice PDF Failure',
  props<{ id: number; error: string }>(),
);

// ── Stats ───────────────────────────────────────────────────

export const loadInvoiceStats = createAction('[Invoicing] Load Stats');
export const loadInvoiceStatsSuccess = createAction(
  '[Invoicing] Load Stats Success',
  props<{ stats: InvoiceStats }>(),
);
export const loadInvoiceStatsFailure = createAction(
  '[Invoicing] Load Stats Failure',
  props<{ error: string }>(),
);

// ── Resolutions ─────────────────────────────────────────────

export const loadResolutions = createAction('[Invoicing] Load Resolutions');
export const loadResolutionsSuccess = createAction(
  '[Invoicing] Load Resolutions Success',
  props<{ resolutions: InvoiceResolution[] }>(),
);
export const loadResolutionsFailure = createAction(
  '[Invoicing] Load Resolutions Failure',
  props<{ error: string }>(),
);

export const createResolution = createAction(
  '[Invoicing] Create Resolution',
  props<{ resolution: CreateResolutionDto }>(),
);
export const createResolutionSuccess = createAction(
  '[Invoicing] Create Resolution Success',
  props<{ resolution: InvoiceResolution }>(),
);
export const createResolutionFailure = createAction(
  '[Invoicing] Create Resolution Failure',
  props<{ error: string }>(),
);

export const updateResolution = createAction(
  '[Invoicing] Update Resolution',
  props<{ id: number; resolution: UpdateResolutionDto }>(),
);
export const updateResolutionSuccess = createAction(
  '[Invoicing] Update Resolution Success',
  props<{ resolution: InvoiceResolution }>(),
);
export const updateResolutionFailure = createAction(
  '[Invoicing] Update Resolution Failure',
  props<{ error: string }>(),
);

export const deleteResolution = createAction(
  '[Invoicing] Delete Resolution',
  props<{ id: number }>(),
);
export const deleteResolutionSuccess = createAction(
  '[Invoicing] Delete Resolution Success',
  props<{ id: number }>(),
);
export const deleteResolutionFailure = createAction(
  '[Invoicing] Delete Resolution Failure',
  props<{ error: string }>(),
);

// ── Filter setters (filter-as-state pattern) ────────────────

export const setSearch = createAction(
  '[Invoicing] Set Search',
  props<{ search: string }>(),
);
export const setPage = createAction(
  '[Invoicing] Set Page',
  props<{ page: number }>(),
);
export const setSort = createAction(
  '[Invoicing] Set Sort',
  props<{ sortBy: string; sortOrder: 'asc' | 'desc' }>(),
);
export const setStatusFilter = createAction(
  '[Invoicing] Set Status Filter',
  props<{ statusFilter: string }>(),
);
export const setTypeFilter = createAction(
  '[Invoicing] Set Type Filter',
  props<{ typeFilter: string }>(),
);
export const setDateRange = createAction(
  '[Invoicing] Set Date Range',
  props<{ dateFrom: string; dateTo: string }>(),
);
export const clearFilters = createAction('[Invoicing] Clear Filters');

// ── DIAN Configs (gate pre-factura) ─────────────────────────

export const loadDianConfigs = createAction('[Invoicing] Load DIAN Configs');
export const loadDianConfigsSuccess = createAction(
  '[Invoicing] Load DIAN Configs Success',
  props<{ configs: DianConfig[] }>(),
);
export const loadDianConfigsFailure = createAction(
  '[Invoicing] Load DIAN Configs Failure',
  props<{ error: string }>(),
);

// ── Clear State ─────────────────────────────────────────────

export const clearInvoicingState = createAction('[Invoicing] Clear State');
