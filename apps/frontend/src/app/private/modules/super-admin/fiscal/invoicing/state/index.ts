/**
 * CP-platform-fiscal-invoicing-mvp · Phase C.1
 *
 * NgRx feature key dedicada `platform-fiscal-invoicing`. Aislada del
 * slice `'invoicing'` del rail tienda (que sigue operativo en
 * `apps/frontend/src/app/private/modules/store/invoicing/state/`).
 *
 * Que vive acá:
 *   - List page state (paginacion + filtros + rows): `list.*`
 *   - Detail page state (transmission.id + synthetic invoice): `detail.*`
 *   - Pre-validacion (`blockers[]` + `warnings[]` + `computed`):
 *     `readiness.*`
 *   - Acquirer picker state (query + results + loading): `acquirerSearch.*`
 *
 * Que NO vive aca: el form de crear invoice (lo maneja el create
 * page con signals locales por simplicidad, y se serializa en el
 * submit a la facade backend).
 *
 * Effects operan solo HTTP. Sin timers, sin polling — el detail page
 * hace polling local con `interval()` de RxJS.
 */

import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Action, createActionGroup, createFeatureSelector, createReducer, createSelector, on, props } from '@ngrx/store';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { Observable, catchError, map, mergeMap, of } from 'rxjs';
import { environment } from '../../../../../../../environments/environment';

// ── Tipos del rail super-admin (reusables UI-side) ──────────────────────────

/**
 * Discriminated union que el frontend maneja. ADR-7. La backend shape
 * viene del snapshot (kind='platform_acquirer_snapshot') que el
 * servicio devuelve en /customers/search y /customers/:kind/:id.
 */
export type AcquirerKind = 'store' | 'organization' | 'user' | 'external';

export interface PlatformAcquirer {
  id: string; // compuesto: 'store:<n>' u 'org:<n>'
  kind: AcquirerKind;
  tenant_id: number;
  name: string;
  slug: string;
  legal_name: string;
  tax_id: string | null;
  tax_id_dv: string | null;
  document_type: string | null;
  person_type: string | null;
  tax_regime_code: string | null;
  fiscal_responsibilities: string[];
  email: string | null;
  phone: string | null;
  address: { line: string | null; city: string | null; department_code: string | null };
  organization: { id: number; name: string | null };
  fiscal_data_complete: boolean;
}

/**
 * Shape sintetizada que el detail endpoint devuelve. Mismo shape que
 * el rail tienda (SubscriptionInvoiceDetail) con el discriminador del
 * route data `kind: 'platform' | 'subscription'`.
 */
export interface PlatformInvoiceSummary {
  invoice: {
    id: number;
    invoice_number: string;
    state: string;
    issued_at: string | null;
    due_at: string;
    period_start: string;
    period_end: string;
    subtotal: string;
    tax_amount: string;
    total: string;
    amount_paid: string;
    currency: string;
    line_items: unknown[];
  };
  transmissions: Array<{
    id: number;
    transmission_status: string;
    dian_status: string;
    accounting_status: string;
    document_number: string;
    cufe: string | null;
    qr_code: string | null;
    tracking_id: string | null;
    accepted_at: string | null;
    rejected_at: string | null;
    error_message: string | null;
    created_at: string;
  }>;
  evidences: Array<{
    id: number;
    fiscal_transmission_id: number;
    evidence_type: string;
    content_hash: string | null;
    storage_key: string | null;
    metadata: unknown;
    created_at: string;
  }>;
  plan: { name: string; code: string; billing_cycle: string } | null;
  organization: {
    id: number;
    name: string;
    legal_name: string | null;
    tax_id: string | null;
    email: string | null;
  } | null;
}

export interface PlatformInvoiceRow {
  id: number;
  document_number: string;
  document_type: 'sales_invoice' | 'support_document';
  source_type: 'platform_invoice' | 'platform_support_document';
  dian_status: string;
  transmission_status: string;
  accounting_status: string;
  // Otros campos reducidos; el detail los hidrata.
  created_at: string;
  total_amount: string;
  currency: string;
  acquirer_legal_name: string | null;
  acquirer_tax_id: string | null;
}

export interface PlatformReadiness {
  blockers: Array<{ code: string; problem: string; fix?: string }>;
  warnings: Array<{ code: string; problem: string; fix?: string }>;
  computed: unknown;
  document_number_preview?: string;
}

export interface ListFilters {
  status?: string;
  document_type?: 'sales_invoice' | 'support_document';
  q?: string;
  page: number;
  limit: number;
}

// ── Actions ──────────────────────────────────────────────────────────────

export const PlatformFiscalInvoicingActions = createActionGroup({
  source: 'PlatformFiscalInvoicing',
  events: {
    // LIST
    'Load Invoices': props<{ filters: Partial<ListFilters> }>(),
    'Load Invoices Success': props<{ rows: PlatformInvoiceRow[]; total: number }>(),
    'Load Invoices Failure': props<{ error: string }>(),
    'Set Filters': props<{ filters: Partial<ListFilters> }>(),

    // DETAIL
    'Load Detail': props<{ id: number }>(),
    'Load Detail Success': props<{ data: PlatformInvoiceSummary }>(),
    'Load Detail Failure': props<{ id: number; error: string }>(),

    // READINESS
    'Evaluate Readiness': props<{ id: number }>(),
    'Evaluate Readiness Success': props<{ id: number; data: PlatformReadiness }>(),
    'Evaluate Readiness Failure': props<{ id: number; error: string }>(),

    // SEND / CANCEL / RETRY
    'Send Invoice': props<{ id: number }>(),
    'Send Invoice Success': props<{ id: number }>(),
    'Send Invoice Failure': props<{ id: number; error: string }>(),

    'Cancel Invoice': props<{ id: number; reason?: string }>(),
    'Cancel Invoice Success': props<{ id: number }>(),
    'Cancel Invoice Failure': props<{ id: number; error: string }>(),

    'Retry Transmission': props<{ id: number }>(),
    'Retry Transmission Success': props<{ id: number }>(),
    'Retry Transmission Failure': props<{ id: number; error: string }>(),

    // ACQUIRER SEARCH (TenantPicker)
    'Search Acquirers': props<{ q: string; kind?: AcquirerKind | null }>(),
    'Search Acquirers Success': props<{ q: string; kind?: AcquirerKind | null; results: PlatformAcquirer[] }>(),
    'Search Acquirers Failure': props<{ error: string }>(),

    // ACQUIRER LOCKED (user picks one)
    'Lock Acquirer': props<{ acquirer: PlatformAcquirer | null }>(),
  },
});

// Tipos de cada action creator individual (exported para consumers)
export type PlatformLoadInvoicesAction = ReturnType<typeof PlatformFiscalInvoicingActions.loadInvoices>;
export type PlatformLoadInvoicesSuccessAction = ReturnType<typeof PlatformFiscalInvoicingActions.loadInvoicesSuccess>;
export type PlatformLoadDetailSuccessAction = ReturnType<typeof PlatformFiscalInvoicingActions.loadDetailSuccess>;
export type PlatformEvaluateReadinessAction = ReturnType<typeof PlatformFiscalInvoicingActions.evaluateReadiness>;
export type PlatformSendInvoiceAction = ReturnType<typeof PlatformFiscalInvoicingActions.sendInvoice>;
export type PlatformCancelInvoiceAction = ReturnType<typeof PlatformFiscalInvoicingActions.cancelInvoice>;
export type PlatformRetryTransmissionAction = ReturnType<typeof PlatformFiscalInvoicingActions.retryTransmission>;
export type PlatformSearchAcquirersAction = ReturnType<typeof PlatformFiscalInvoicingActions.searchAcquirers>;
export type PlatformSearchAcquirersSuccessAction = ReturnType<typeof PlatformFiscalInvoicingActions.searchAcquirersSuccess>;
export type PlatformLockAcquirerAction = ReturnType<typeof PlatformFiscalInvoicingActions.lockAcquirer>;

// Union tipado via ReturnType (reemplaza el Action<X> que no compila con ActionCreator)
export type PlatformFiscalInvoicingAction =
  | PlatformLoadInvoicesAction
  | PlatformLoadInvoicesSuccessAction
  | PlatformLoadDetailSuccessAction
  | PlatformEvaluateReadinessAction
  | PlatformSendInvoiceAction
  | PlatformCancelInvoiceAction
  | PlatformRetryTransmissionAction
  | PlatformSearchAcquirersAction
  | PlatformSearchAcquirersSuccessAction
  | PlatformLockAcquirerAction;

// ── State ────────────────────────────────────────────────────────────────

export interface PlatformInvoiceListState {
  rows: PlatformInvoiceRow[];
  total: number;
  filters: ListFilters;
  loading: boolean;
  error: string | null;
}

export interface PlatformInvoiceDetailState {
  byId: Record<number, PlatformInvoiceSummary | null>;
  loadingById: Record<number, boolean>;
  errorById: Record<number, string | null>;
}

export interface PlatformReadinessState {
  byId: Record<number, PlatformReadiness | null>;
  loadingById: Record<number, boolean>;
  errorById: Record<number, string | null>;
}

export interface PlatformAcquirerSearchState {
  query: string;
  kind: AcquirerKind | null;
  results: PlatformAcquirer[];
  loading: boolean;
  error: string | null;
  locked: PlatformAcquirer | null;
}

export interface PlatformFiscalInvoicingState {
  list: PlatformInvoiceListState;
  detail: PlatformInvoiceDetailState;
  readiness: PlatformReadinessState;
  acquirerSearch: PlatformAcquirerSearchState;
}

const initialListState: PlatformInvoiceListState = {
  rows: [],
  total: 0,
  filters: { page: 1, limit: 25 },
  loading: false,
  error: null,
};

const initialDetailState: PlatformInvoiceDetailState = {
  byId: {},
  loadingById: {},
  errorById: {},
};

const initialReadinessState: PlatformReadinessState = {
  byId: {},
  loadingById: {},
  errorById: {},
};

const initialAcquirerSearchState: PlatformAcquirerSearchState = {
  query: '',
  kind: null,
  results: [],
  loading: false,
  error: null,
  locked: null,
};

export const initialPlatformFiscalInvoicingState: PlatformFiscalInvoicingState = {
  list: initialListState,
  detail: initialDetailState,
  readiness: initialReadinessState,
  acquirerSearch: initialAcquirerSearchState,
};

// ── Reducer ─────────────────────────────────────────────────────────────

export const platformFiscalInvoicingReducer = createReducer<PlatformFiscalInvoicingState>(
  initialPlatformFiscalInvoicingState,
  on(PlatformFiscalInvoicingActions.loadInvoices, (state, { filters }) => ({
    ...state,
    list: {
      ...state.list,
      filters: { ...state.list.filters, ...filters },
      loading: true,
      error: null,
    },
  })),
  on(PlatformFiscalInvoicingActions.loadInvoicesSuccess, (state, { rows, total }) => ({
    ...state,
    list: { ...state.list, rows, total, loading: false, error: null },
  })),
  on(PlatformFiscalInvoicingActions.loadInvoicesFailure, (state, { error }) => ({
    ...state,
    list: { ...state.list, loading: false, error },
  })),
  on(PlatformFiscalInvoicingActions.setFilters, (state, { filters }) => ({
    ...state,
    list: {
      ...state.list,
      filters: { ...state.list.filters, ...filters, page: 1 },
    },
  })),

  on(PlatformFiscalInvoicingActions.loadDetail, (state, { id }) => ({
    ...state,
    detail: {
      ...state.detail,
      loadingById: { ...state.detail.loadingById, [id]: true },
      errorById: { ...state.detail.errorById, [id]: null },
    },
  })),
  on(PlatformFiscalInvoicingActions.loadDetailSuccess, (state, { data }) => ({
    ...state,
    detail: {
      ...state.detail,
      byId: { ...state.detail.byId, [data.invoice.id]: data },
      loadingById: { ...state.detail.loadingById, [data.invoice.id]: false },
      errorById: { ...state.detail.errorById, [data.invoice.id]: null },
    },
  })),
  on(PlatformFiscalInvoicingActions.loadDetailFailure, (state, { id, error }) => ({
    ...state,
    detail: {
      ...state.detail,
      loadingById: { ...state.detail.loadingById, [id]: false },
      errorById: { ...state.detail.errorById, [id]: error },
      byId: { ...state.detail.byId, [id]: null },
    },
  })),

  on(PlatformFiscalInvoicingActions.evaluateReadiness, (state, { id }) => ({
    ...state,
    readiness: {
      ...state.readiness,
      loadingById: { ...state.readiness.loadingById, [id]: true },
      errorById: { ...state.readiness.errorById, [id]: null },
    },
  })),
  on(PlatformFiscalInvoicingActions.evaluateReadinessSuccess, (state, { id, data }) => ({
    ...state,
    readiness: {
      ...state.readiness,
      byId: { ...state.readiness.byId, [id]: data },
      loadingById: { ...state.readiness.loadingById, [id]: false },
      errorById: { ...state.readiness.errorById, [id]: null },
    },
  })),
  on(PlatformFiscalInvoicingActions.evaluateReadinessFailure, (state, { id, error }) => ({
    ...state,
    readiness: {
      ...state.readiness,
      loadingById: { ...state.readiness.loadingById, [id]: false },
      errorById: { ...state.readiness.errorById, [id]: error },
      byId: { ...state.readiness.byId, [id]: null },
    },
  })),

  on(PlatformFiscalInvoicingActions.searchAcquirers, (state, { q, kind }) => ({
    ...state,
    acquirerSearch: { ...state.acquirerSearch, query: q, kind: kind ?? null, loading: true, error: null },
  })),
  on(PlatformFiscalInvoicingActions.searchAcquirersSuccess, (state, { results }) => ({
    ...state,
    acquirerSearch: { ...state.acquirerSearch, results, loading: false, error: null },
  })),
  on(PlatformFiscalInvoicingActions.searchAcquirersFailure, (state, { error }) => ({
    ...state,
    acquirerSearch: { ...state.acquirerSearch, loading: false, error },
  })),

  on(PlatformFiscalInvoicingActions.lockAcquirer, (state, { acquirer }) => ({
    ...state,
    acquirerSearch: { ...state.acquirerSearch, locked: acquirer },
  })),

  // send/cancel/retry success no tocan state (el detail lo refetchea);
  // dejamos el loading marker en false para que la UI pueda pintar
  // un toast y refetchear via Load Detail.
  on(PlatformFiscalInvoicingActions.sendInvoiceSuccess, (state, { id }) => state),
  on(PlatformFiscalInvoicingActions.sendInvoiceFailure, (state, { id, error }) => ({
    ...state,
    detail: { ...state.detail, errorById: { ...state.detail.errorById, [id]: error } },
  })),
  on(PlatformFiscalInvoicingActions.cancelInvoiceSuccess, (state, { id }) => state),
  on(PlatformFiscalInvoicingActions.cancelInvoiceFailure, (state, { id, error }) => ({
    ...state,
    detail: { ...state.detail, errorById: { ...state.detail.errorById, [id]: error } },
  })),
  on(PlatformFiscalInvoicingActions.retryTransmissionSuccess, (state, { id }) => state),
  on(PlatformFiscalInvoicingActions.retryTransmissionFailure, (state, { id, error }) => ({
    ...state,
    detail: { ...state.detail, errorById: { ...state.detail.errorById, [id]: error } },
  })),
);

// ── Selectors ────────────────────────────────────────────────────────────

export const PLATFORM_FISCAL_INVOICING_FEATURE = 'platform-fiscal-invoicing';

export const selectPlatformFiscalInvoicingState = createFeatureSelector<PlatformFiscalInvoicingState>(
  PLATFORM_FISCAL_INVOICING_FEATURE,
);

export const selectPlatformInvoices = createSelector(
  selectPlatformFiscalInvoicingState,
  (s) => s.list.rows,
);

export const selectPlatformInvoicesTotal = createSelector(
  selectPlatformFiscalInvoicingState,
  (s) => s.list.total,
);

export const selectPlatformInvoicesLoading = createSelector(
  selectPlatformFiscalInvoicingState,
  (s) => s.list.loading,
);

export const selectPlatformInvoicesError = createSelector(
  selectPlatformFiscalInvoicingState,
  (s) => s.list.error,
);

export const selectPlatformInvoicesFilters = createSelector(
  selectPlatformFiscalInvoicingState,
  (s) => s.list.filters,
);

export const selectPlatformInvoiceDetail = (id: number) =>
  createSelector(selectPlatformFiscalInvoicingState, (s) => s.detail.byId[id] ?? null);

export const selectPlatformInvoiceDetailLoading = (id: number) =>
  createSelector(selectPlatformFiscalInvoicingState, (s) => s.detail.loadingById[id] ?? false);

export const selectPlatformInvoiceDetailError = (id: number) =>
  createSelector(selectPlatformFiscalInvoicingState, (s) => s.detail.errorById[id] ?? null);

export const selectPlatformReadiness = (id: number) =>
  createSelector(selectPlatformFiscalInvoicingState, (s) => s.readiness.byId[id] ?? null);

export const selectPlatformAcquirerResults = createSelector(
  selectPlatformFiscalInvoicingState,
  (s) => s.acquirerSearch.results,
);

export const selectPlatformAcquirerSearchLoading = createSelector(
  selectPlatformFiscalInvoicingState,
  (s) => s.acquirerSearch.loading,
);

export const selectPlatformAcquirerLocked = createSelector(
  selectPlatformFiscalInvoicingState,
  (s) => s.acquirerSearch.locked,
);

// ── Effects ──────────────────────────────────────────────────────────────

const BASE = `${environment.apiUrl}/superadmin/subscriptions/fiscal`;

interface ApiEnvelope<T> {
  success: boolean;
  data: T;
  message?: string;
}

@Injectable()
export class PlatformFiscalInvoicingEffects {
  private readonly actions$ = inject(Actions);
  private readonly http = inject(HttpClient);

  loadInvoices$ = createEffect(() =>
    this.actions$.pipe(
      ofType(PlatformFiscalInvoicingActions.loadInvoices),
      mergeMap(({ filters }) => {
        const params: Record<string, string | number> = {};
        if (filters.status) params['status'] = filters.status;
        if (filters.document_type) params['document_type'] = filters.document_type;
        if (filters.q) params['q'] = filters.q;
        params['page'] = filters.page ?? 1;
        params['limit'] = filters.limit ?? 25;
        return this.http
          .get<ApiEnvelope<{ data: PlatformInvoiceRow[]; meta: { total: number } }>>(
            `${BASE}/invoices`,
            { params },
          )
          .pipe(
            map((res) =>
              PlatformFiscalInvoicingActions.loadInvoicesSuccess({
                rows: res.data.data ?? [],
                total: res.data.meta?.total ?? 0,
              }),
            ),
            catchError((err: HttpErrorResponse) =>
              of(PlatformFiscalInvoicingActions.loadInvoicesFailure({ error: err.message ?? 'Error' })),
            ),
          );
      }),
    ),
  );

  loadDetail$ = createEffect(() =>
    this.actions$.pipe(
      ofType(PlatformFiscalInvoicingActions.loadDetail),
      mergeMap(({ id }) =>
        this.http
          .get<ApiEnvelope<PlatformInvoiceSummary>>(`${BASE}/platform-invoices/${id}`)
          .pipe(
            map((res) =>
              PlatformFiscalInvoicingActions.loadDetailSuccess({ data: res.data }),
            ),
            catchError((err: HttpErrorResponse) =>
              of(
                PlatformFiscalInvoicingActions.loadDetailFailure({
                  id,
                  error: err.message ?? 'Error',
                }),
              ),
            ),
          ),
      ),
    ),
  );

  evaluateReadiness$ = createEffect(() =>
    this.actions$.pipe(
      ofType(PlatformFiscalInvoicingActions.evaluateReadiness),
      mergeMap(({ id }) =>
        this.http
          .get<ApiEnvelope<PlatformReadiness>>(`${BASE}/invoices/${id}/emit-readiness`)
          .pipe(
            map((res) =>
              PlatformFiscalInvoicingActions.evaluateReadinessSuccess({
                id,
                data: res.data,
              }),
            ),
            catchError((err: HttpErrorResponse) =>
              of(
                PlatformFiscalInvoicingActions.evaluateReadinessFailure({
                  id,
                  error: err.message ?? 'Error',
                }),
              ),
            ),
          ),
      ),
    ),
  );

  sendInvoice$ = createEffect(() =>
    this.actions$.pipe(
      ofType(PlatformFiscalInvoicingActions.sendInvoice),
      mergeMap(({ id }) =>
        this.http
          .post(`${BASE}/invoices/${id}/send`, {})
          .pipe(
            map(() => PlatformFiscalInvoicingActions.sendInvoiceSuccess({ id })),
            catchError((err: HttpErrorResponse) =>
              of(
                PlatformFiscalInvoicingActions.sendInvoiceFailure({
                  id,
                  error: err.message ?? 'Error',
                }),
              ),
            ),
          )
      ),
    ),
  );

  cancelInvoice$ = createEffect(() =>
    this.actions$.pipe(
      ofType(PlatformFiscalInvoicingActions.cancelInvoice),
      mergeMap(({ id, reason }) =>
        this.http
          .post(`${BASE}/invoices/${id}/cancel`, { reason })
          .pipe(
            map(() => PlatformFiscalInvoicingActions.cancelInvoiceSuccess({ id })),
            catchError((err: HttpErrorResponse) =>
              of(
                PlatformFiscalInvoicingActions.cancelInvoiceFailure({
                  id,
                  error: err.message ?? 'Error',
                }),
              ),
            ),
          )
      ),
    ),
  );

  retryTransmission$ = createEffect(() =>
    this.actions$.pipe(
      ofType(PlatformFiscalInvoicingActions.retryTransmission),
      mergeMap(({ id }) =>
        this.http
          .post(`${BASE}/transmissions/${id}/retry`, {})
          .pipe(
            map(() => PlatformFiscalInvoicingActions.retryTransmissionSuccess({ id })),
            catchError((err: HttpErrorResponse) =>
              of(
                PlatformFiscalInvoicingActions.retryTransmissionFailure({
                  id,
                  error: err.message ?? 'Error',
                }),
              ),
            ),
          )
      ),
    ),
  );

  searchAcquirers$ = createEffect(() =>
    this.actions$.pipe(
      ofType(PlatformFiscalInvoicingActions.searchAcquirers),
      mergeMap(({ q, kind }) => {
        const params: Record<string, string> = {};
        if (q) params['q'] = q;
        if (kind) params['kind'] = kind;
        return this.http
          .get<ApiEnvelope<{ data: PlatformAcquirer[] }>>(`${BASE}/customers/search`, { params })
          .pipe(
            map((res) =>
              PlatformFiscalInvoicingActions.searchAcquirersSuccess({
                q,
                kind: kind ?? null,
                results: (res as any).data?.data ?? [],
              }),
            ),
            catchError((err: HttpErrorResponse) =>
              of(PlatformFiscalInvoicingActions.searchAcquirersFailure({ error: err.message ?? 'Error' })),
            ),
          );
      }),
    ),
  );
}
