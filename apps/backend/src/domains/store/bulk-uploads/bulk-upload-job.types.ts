import type { BulkUploadStatus } from './bulk-upload-log.types';

/**
 * QUI-1009 — trabajos durables de carga masiva (cola BullMQ `bulk-upload-jobs`).
 * Una fila de `bulk_upload_logs` por trabajo; el cursor y el error viven en
 * `job.data` (sin migración).
 */

export const BULK_UPLOAD_JOBS_QUEUE = 'bulk-upload-jobs';

export const BULK_JOB_TYPES = [
  'products',
  'employees',
  'inventory_adjustments',
  'customers',
] as const;
export type BulkJobType = (typeof BULK_JOB_TYPES)[number];

export const isBulkJobType = (value: unknown): value is BulkJobType =>
  typeof value === 'string' &&
  (BULK_JOB_TYPES as readonly string[]).includes(value);

/** Tamaño del lote: igual al tope de página de cada servicio de carga. */
export const BULK_JOB_BATCH_SIZE = 100;
/** Espera creciente entre reintentos de un lote (máx. 3 reintentos). */
export const BULK_JOB_RETRY_DELAYS_MS = [2000, 4000, 8000] as const;
export const BULK_JOB_MAX_RETRIES = BULK_JOB_RETRY_DELAYS_MS.length;
/** Tiempo máximo de un trabajo (se reinicia en cada reintento manual). */
export const BULK_JOB_DEADLINE_MS = 60 * 60 * 1000;
/** Margen tras el cual una fila vencida sin avanzar se reconcilia a fallo técnico. */
export const BULK_JOB_RECONCILE_GRACE_MS = 5 * 60 * 1000;
/** Retención de BullMQ y del hash de resultados. */
export const BULK_JOB_RETENTION_SECONDS = 7 * 24 * 60 * 60;
/** El candado vive más que el plazo para no caducar con el trabajo en marcha. */
export const BULK_JOB_LOCK_TTL_SECONDS = 70 * 60;

/** Clientes no reintenta solo: un lote a medias pudo aplicarse. */
export const BULK_JOB_AUTO_RETRY: Record<BulkJobType, boolean> = {
  products: true,
  employees: true,
  inventory_adjustments: true,
  customers: false,
};

export const bulkJobId = (logId: number) => `bulk-upload-${logId}`;
export const bulkJobResultsKey = (logId: number) =>
  `bulk-upload:job:${logId}:results`;
export const bulkJobLockKey = (storeId: number, type: BulkJobType) =>
  `bulk-upload:active:${storeId}:${type}`;

export interface BulkJobCursor {
  /** Siguiente fila a procesar (0 = nada hecho). Único punto de confirmación. */
  offset: number;
  /** Lotes terminados. */
  batch: number;
  successful: number;
  failed: number;
  skipped: number;
  /** `null` mientras ningún lote reporte creados (el tipo no lo distingue). */
  created: number | null;
  total: number;
  /** Solo tipos sin reintento automático: lote en vuelo (no se re-ejecuta). */
  in_flight_offset: number | null;
}

export interface BulkJobError {
  kind: 'data' | 'technical';
  code: string | null;
  message: string;
}

export interface BulkJobRetryInfo {
  attempt: number;
  max_attempts: number;
  next_retry_at: string;
  message: string;
}

/** Foto del usuario que encola (el worker nunca toma esto del payload del cliente). */
export interface BulkJobUserSnapshot {
  id: number;
  email?: string;
  organization_id?: number;
  store_id?: number;
  roles?: string[];
  user_roles?: unknown[];
}

export interface BulkUploadJobData {
  log_id: number;
  upload_type: BulkJobType;
  store_id: number;
  organization_id?: number;
  user_id?: number;
  roles: string[];
  permissions: string[];
  request_id?: string;
  user: BulkJobUserSnapshot;
  file_name: string;
  file_hash: string;
  /** Parámetros propios del tipo (sesión, ubicación, clave S3, …). */
  params: Record<string, unknown>;
  cursor: BulkJobCursor;
  enqueued_at: string;
  started_at: string | null;
  finished_at: string | null;
  deadline_at: string;
  retry: BulkJobRetryInfo | null;
  error: BulkJobError | null;
  incident_ticket_number: string | null;
}

/** Lo que el runner necesita de un job de BullMQ (facilita los specs). */
export interface BulkJobHandle {
  id?: string;
  data: BulkUploadJobData;
  updateData(data: BulkUploadJobData): Promise<void>;
}

export interface BulkJobPageResult {
  /** Total de filas del archivo (lo trae cada página). */
  total: number;
  successful: number;
  failed: number;
  skipped: number;
  created?: number | null;
  /** Filas del lote (se guardan sin objetos anidados). */
  rows: Array<Record<string, unknown>>;
  /** Última página del archivo. */
  done: boolean;
}

/** Cada dominio registra el suyo en `onModuleInit` (ver `BulkUploadHandlerRegistry`). */
export interface BulkUploadJobHandler {
  readonly type: BulkJobType;
  /** `false` en clientes: un fallo técnico no se reintenta solo. */
  readonly autoRetry: boolean;
  /**
   * Procesa `[offset, offset + limit)`. Se ejecuta dentro del contexto del
   * tenant restaurado. Lanza `HttpException` 4xx (salvo 408/429) para errores
   * de datos; cualquier otro error es técnico.
   */
  runPage(
    data: BulkUploadJobData,
    offset: number,
    limit: number,
  ): Promise<BulkJobPageResult>;
  /**
   * Borra los temporales. Se llama al terminar `completed|partial` o `failed`
   * de datos; NO en `failed` técnico (el reintento manual los necesita).
   */
  cleanup(data: BulkUploadJobData): Promise<void>;
}

export type BulkJobOutcome = 'completed' | 'failed_data' | 'failed_technical';

export interface BulkUploadJobView {
  id: number;
  upload_type: BulkJobType;
  status: BulkUploadStatus;
  file_name: string;
  user_id: number | null;
  total_rows: number;
  processed_rows: number;
  successful_rows: number;
  failed_rows: number;
  skipped_rows: number;
  created_rows: number | null;
  batch_current: number;
  batch_total: number | null;
  retry: BulkJobRetryInfo | null;
  error: BulkJobError | null;
  incident_ticket_number: string | null;
  can_retry: boolean;
  auto_retry: boolean;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  deadline_at: string | null;
}

export type BulkUploadJobResultRow = Record<string, unknown> & {
  row_number?: number | null;
  status: string;
  message?: string | null;
};

export const emptyCursor = (total = 0): BulkJobCursor => ({
  offset: 0,
  batch: 0,
  successful: 0,
  failed: 0,
  skipped: 0,
  created: null,
  total,
  in_flight_offset: null,
});

/** `HttpException` 4xx (salvo 408/429) = error de datos; el resto, técnico. */
export function classifyBulkError(error: unknown): 'data' | 'technical' {
  const status = (error as { getStatus?: () => number })?.getStatus?.();
  if (
    typeof status === 'number' &&
    status >= 400 &&
    status < 500 &&
    status !== 408 &&
    status !== 429
  ) {
    return 'data';
  }
  return 'technical';
}

export function bulkErrorCode(error: unknown): string | null {
  const e = error as {
    errorCode?: string;
    getResponse?: () => unknown;
  };
  if (typeof e?.errorCode === 'string') return e.errorCode;
  const response = e?.getResponse?.() as { error_code?: string } | undefined;
  return typeof response?.error_code === 'string' ? response.error_code : null;
}

export function bulkErrorMessage(error: unknown): string {
  const raw = (error as { message?: unknown })?.message;
  const message = typeof raw === 'string' && raw ? raw : 'Error desconocido';
  return message.length > 300 ? `${message.slice(0, 300)}...` : message;
}
