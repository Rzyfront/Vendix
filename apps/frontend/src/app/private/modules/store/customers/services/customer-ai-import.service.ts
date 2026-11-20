import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, catchError, concatMap, from, map, of, reduce } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import { parseApiError } from '../../../../../core/utils/parse-api-error';
import { environment } from '../../../../../../environments/environment';
import {
  AiScanJobOptions,
  AiScanJobService,
} from '../../../../../core/services/ai-scan-job.service';

interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
}

export type ImportPersonType = 'NATURAL' | 'JURIDICA';
export type ImportRowStatus = 'ready' | 'warning' | 'error';
export type ImportCommitAction =
  | 'create'
  | 'add_locations'
  | 'update_and_add_locations'
  | 'skip';

export interface ImportLocation {
  label: string | null;
  address_line_1: string | null;
  address_line_2: string | null;
  city: string | null;
  state: string | null;
  municipality_code: string | null;
  phone: string | null;
}

export interface ImportCustomer {
  person_type: ImportPersonType | null;
  first_name: string | null;
  last_name: string | null;
  legal_name: string | null;
  document_type: string | null;
  document_number: string | null;
  verification_digit: string | null;
  email: string | null;
  phone: string | null;
  locations: ImportLocation[];
  /** Filas de la hoja de las que salió el cliente (no viene en imágenes/PDF). */
  source_rows?: number[];
  /** Hoja, solo si el libro tiene varias. */
  source_sheet?: string;
}

export type ImportSkipReason =
  | 'empty'
  | 'total'
  | 'header'
  | 'limit'
  | 'unreadable'
  | 'duplicate';

/** Fila que no se cargó, con su motivo (nada se omite en silencio). */
export interface ImportSkippedRow {
  row: number;
  row_end?: number;
  sheet?: string;
  reason: ImportSkipReason;
  message: string;
}

/** Algo a revisar en una fila que sí se cargó. */
export interface ImportRowIssue {
  row: number;
  sheet?: string;
  level: 'warning' | 'error';
  field?: string;
  message: string;
}

export interface CustomerImportScanResult {
  customers: ImportCustomer[];
  warnings: string[];
  skipped?: ImportSkippedRow[];
  row_issues?: ImportRowIssue[];
  columns?: { sheet?: string; column: string; field: string | null }[];
  stats?: {
    source: 'sheet' | 'document';
    total_rows: number;
    imported_rows: number;
    skipped_rows: number;
    ai_rows: number;
    mapping: 'synonyms' | 'ai' | null;
  };
}

export interface ImportExistingLocation {
  id: number;
  label: string | null;
  address_line1: string | null;
  city: string | null;
}

export interface ImportCustomerMatch {
  existing_customer_id: number;
  display_name: string;
  in_store: boolean;
  existing_locations: ImportExistingLocation[];
  /** S8 — identificación y/o correo. */
  matched_by?: ('document' | 'email')[];
  other_matches?: {
    id: number;
    display_name: string;
    matched_by: ('document' | 'email')[];
  }[];
}

export interface AnalyzedImportLocation extends ImportLocation {
  already_registered: boolean;
  status: ImportRowStatus;
  messages: string[];
}

export interface AnalyzedImportCustomer
  extends Omit<ImportCustomer, 'locations'> {
  locations: AnalyzedImportLocation[];
  match: ImportCustomerMatch | null;
  status: ImportRowStatus;
  messages: string[];
}

export interface CustomerImportAnalysis {
  customers: AnalyzedImportCustomer[];
  summary: {
    total_customers: number;
    total_locations: number;
    existing: number;
    with_errors: number;
  };
}

/** Cuerpo de `commit`: el backend rechaza campos no declarados. */
export interface CommitCustomerItem extends ImportCustomer {
  action: ImportCommitAction;
  existing_customer_id: number | null;
}

export type CommitCustomerOutcome =
  | 'created'
  | 'updated'
  | 'locations_added'
  | 'skipped'
  | 'failed';

export interface CommitCustomerResult {
  index: number;
  display_name: string;
  outcome: CommitCustomerOutcome;
  customer_id: number | null;
  locations_added: number;
  locations_already_registered: number;
  location_errors: string[];
  error: string | null;
}

export interface CommitCustomerImportResult {
  created: number;
  updated: number;
  locations_added: number;
  locations_already_registered: number;
  skipped: number;
  failed: number;
  results: CommitCustomerResult[];
}

/** Clientes por petición de `analyze` (tope del backend: 200). */
export const ANALYZE_CHUNK_SIZE = 200;
/**
 * Tope de espera del escaneo. Una hoja de 5.000 filas con muchas filas
 * ambiguas puede tardar varios minutos; el corte real lo da el backend con
 * `stalled` (5 min sin reportar avance), no este tope.
 */
export const CUSTOMER_SCAN_TIMEOUT_MS = 30 * 60_000;
/** Clientes por petición de `commit` (patrón de cargas masivas: 100). */
export const COMMIT_CHUNK_SIZE = 100;

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Carga de clientes con IA (S7): escaneo async -> analisis -> commit.
 * Nada se persiste hasta `commit`. Permiso: `store:customers:create`.
 */
@Injectable({ providedIn: 'root' })
export class CustomerAiImportService {
  private readonly apiUrl = `${environment.apiUrl}/store/customers/ai-import`;
  private readonly http = inject(HttpClient);
  private readonly aiScanJobs = inject(AiScanJobService);

  scan(
    file: File,
    opts?: AiScanJobOptions,
  ): Observable<ApiResponse<CustomerImportScanResult>> {
    const formData = new FormData();
    formData.append('file', file);
    return this.aiScanJobs
      .enqueueAndWait<CustomerImportScanResult>(
        `${this.apiUrl}/async`,
        formData,
        { timeoutMs: CUSTOMER_SCAN_TIMEOUT_MS, ...opts },
      )
      .pipe(map((result) => ({ success: true, data: result })));
  }

  /** Re-attaches to a scan started before a reload; `null` if none (QUI-1020). */
  resumeScan(
    resumeKey: string,
    opts?: Parameters<AiScanJobService['resume']>[1],
  ): Observable<ApiResponse<CustomerImportScanResult>> | null {
    return (
      this.aiScanJobs
        .resume<CustomerImportScanResult>(resumeKey, {
          timeoutMs: CUSTOMER_SCAN_TIMEOUT_MS,
          ...opts,
        })
        ?.pipe(map((result) => ({ success: true, data: result }))) ?? null
    );
  }

  analyze(
    customers: ImportCustomer[],
  ): Observable<ApiResponse<CustomerImportAnalysis>> {
    return this.http.post<ApiResponse<CustomerImportAnalysis>>(
      `${this.apiUrl}/analyze`,
      { customers },
    );
  }

  commit(
    customers: CommitCustomerItem[],
    file?: { file_name?: string; file_hash?: string },
    session?: { session_id: string; total_customers: number },
  ): Observable<ApiResponse<CommitCustomerImportResult>> {
    // QUI-1004 — la huella que devolvió `async`, para el registro de cargas.
    const fileRef = file?.file_hash
      ? { file_name: file.file_name, file_hash: file.file_hash }
      : {};
    return this.http.post<ApiResponse<CommitCustomerImportResult>>(
      `${this.apiUrl}/commit`,
      { customers, ...fileRef, ...(session ?? {}) },
    );
  }

  /**
   * `analyze` en tramos de 200 (uno tras otro) para cargas grandes; el
   * resultado es el mismo que una sola llamada. Un tramo que falla corta la
   * cadena: la precarga necesita a todos los clientes.
   */
  analyzeInChunks(
    customers: ImportCustomer[],
    onProgress?: (done: number, total: number) => void,
  ): Observable<ApiResponse<CustomerImportAnalysis>> {
    const parts = chunks(customers, ANALYZE_CHUNK_SIZE);
    if (parts.length <= 1) return this.analyze(customers);
    let done = 0;
    onProgress?.(0, customers.length);
    return from(parts).pipe(
      concatMap((part) =>
        this.analyze(part).pipe(
          map((res) => {
            if (!res.success || !res.data) {
              throw new Error(res.message || 'Error al analizar los clientes');
            }
            done += part.length;
            onProgress?.(done, customers.length);
            return res.data;
          }),
        ),
      ),
      reduce<CustomerImportAnalysis, CustomerImportAnalysis>(
        (acc, data) => ({
          customers: [...acc.customers, ...data.customers],
          summary: {
            total_customers: acc.summary.total_customers + data.summary.total_customers,
            total_locations: acc.summary.total_locations + data.summary.total_locations,
            existing: acc.summary.existing + data.summary.existing,
            with_errors: acc.summary.with_errors + data.summary.with_errors,
          },
        }),
        {
          customers: [],
          summary: { total_customers: 0, total_locations: 0, existing: 0, with_errors: 0 },
        },
      ),
      map((data) => ({ success: true, data })),
    );
  }

  /**
   * `commit` en tramos de 100, uno tras otro. Un tramo que falla no detiene
   * los demás: sus clientes vuelven como «Con error» con el motivo (lo ya
   * confirmado no se revierte). Todos los tramos comparten `session_id`, así
   * que el registro de cargas guarda UNA fila por archivo.
   */
  commitInChunks(
    customers: CommitCustomerItem[],
    file?: { file_name?: string; file_hash?: string },
    onProgress?: (done: number, total: number) => void,
  ): Observable<ApiResponse<CommitCustomerImportResult>> {
    const parts = chunks(customers, COMMIT_CHUNK_SIZE);
    if (parts.length <= 1) return this.commit(customers, file);
    const session = {
      session_id: `customers_ai-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      total_customers: customers.length,
    };
    let offset = 0;
    onProgress?.(0, customers.length);
    return from(parts).pipe(
      concatMap((part) => {
        const start = offset;
        offset += part.length;
        return this.commit(part, file, session).pipe(
          map((res) => {
            if (!res.success || !res.data) {
              throw new Error(res.message || 'No se pudo cargar este tramo');
            }
            return res.data;
          }),
          catchError((err: unknown) => {
            const message =
              err instanceof HttpErrorResponse
                ? parseApiError(err).userMessage
                : (err as Error | null)?.message || 'No se pudo cargar este tramo';
            return of(failedChunk(part, message));
          }),
          map((data) => {
            onProgress?.(start + part.length, customers.length);
            return {
              ...data,
              results: data.results.map((r) => ({ ...r, index: r.index + start })),
            };
          }),
        );
      }),
      reduce<CommitCustomerImportResult, CommitCustomerImportResult>(
        (acc, data) => ({
          created: acc.created + data.created,
          updated: acc.updated + data.updated,
          locations_added: acc.locations_added + data.locations_added,
          locations_already_registered:
            acc.locations_already_registered + data.locations_already_registered,
          skipped: acc.skipped + data.skipped,
          failed: acc.failed + data.failed,
          results: [...acc.results, ...data.results],
        }),
        {
          created: 0,
          updated: 0,
          locations_added: 0,
          locations_already_registered: 0,
          skipped: 0,
          failed: 0,
          results: [],
        },
      ),
      map((data) => ({ success: true, data })),
    );
  }
}

/** Resultado de un tramo que no llegó al servidor: todos sus clientes con error. */
function failedChunk(
  part: CommitCustomerItem[],
  message: string,
): CommitCustomerImportResult {
  return {
    created: 0,
    updated: 0,
    locations_added: 0,
    locations_already_registered: 0,
    skipped: 0,
    failed: part.length,
    results: part.map((c, index) => ({
      index,
      display_name:
        c.legal_name ||
        [c.first_name, c.last_name].filter(Boolean).join(' ') ||
        c.document_number ||
        'Cliente sin nombre',
      outcome: 'failed' as const,
      customer_id: null,
      locations_added: 0,
      locations_already_registered: 0,
      location_errors: [],
      error: message,
    })),
  };
}
