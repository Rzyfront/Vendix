/**
 * QUI-1004 — registro liviano de cargas masivas (contrato con
 * `store/bulk-uploads`). Una fila por carga; nunca el archivo ni las filas.
 */
export type BulkUploadType =
  | 'products'
  | 'product_images'
  | 'employees'
  | 'inventory_adjustments'
  | 'customers'
  | 'bank_statements'
  | 'purchase_orders'
  | 'memberships'
  | 'customers_ai'
  | 'dispatch_notes';

/**
 * `queued`/`running` solo los tienen las cargas que corren como trabajo del
 * servidor (QUI-1009): la fila nace al encolar y termina en uno de los tres
 * estados finales.
 */
export type BulkUploadStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'partial'
  | 'failed';

export const BULK_UPLOAD_TYPE_LABELS: Record<BulkUploadType, string> = {
  products: 'Productos',
  product_images: 'Imágenes de productos',
  employees: 'Empleados',
  inventory_adjustments: 'Ajustes de inventario',
  customers: 'Clientes',
  bank_statements: 'Extractos bancarios',
  purchase_orders: 'Compras',
  memberships: 'Padrón de miembros',
  customers_ai: 'Clientes con IA',
  dispatch_notes: 'Remisiones de compra',
};

export const BULK_UPLOAD_STATUS_LABELS: Record<BulkUploadStatus, string> = {
  queued: 'En cola',
  running: 'En curso',
  completed: 'Completada',
  partial: 'Parcial',
  failed: 'Fallida',
};

/** Carga anterior con la misma huella en esta tienda y tipo. */
export interface BulkUploadDuplicateInfo {
  id: number;
  created_at: string;
  user_name: string | null;
  file_name: string;
  status: BulkUploadStatus | string;
  result_reference: string | null;
}

/** Lo que el analyze de las cargas del servidor agrega a su respuesta. */
export interface BulkUploadFileInfo {
  file_name?: string;
  file_hash?: string;
  duplicate_of?: BulkUploadDuplicateInfo | null;
}

/**
 * Huella que devuelve el encolado de un escaneo con IA (padrón de miembros,
 * clientes con IA). Lo que no tenga la forma esperada se descarta.
 */
export function toBulkUploadFileInfo(
  data: Record<string, unknown> | null | undefined,
): BulkUploadFileInfo {
  const file_name = typeof data?.['file_name'] === 'string' ? data['file_name'] : undefined;
  const file_hash = typeof data?.['file_hash'] === 'string' ? data['file_hash'] : undefined;
  const duplicate = data?.['duplicate_of'];
  return {
    file_name,
    file_hash,
    duplicate_of:
      duplicate && typeof duplicate === 'object'
        ? (duplicate as BulkUploadDuplicateInfo)
        : null,
  };
}

export interface BulkUploadLog {
  id: number;
  upload_type: BulkUploadType;
  file_name: string;
  file_hash: string;
  total_rows: number;
  successful_rows: number;
  /** Parte de las cargadas que creó un producto; null = el tipo no lo distingue. */
  created_rows: number | null;
  failed_rows: number;
  skipped_rows: number;
  status: BulkUploadStatus;
  result_reference: string | null;
  user_name: string | null;
  created_at: string;
}

export interface BulkUploadLogQuery {
  upload_type?: BulkUploadType | '';
  date_from?: string;
  date_to?: string;
  page?: number;
  limit?: number;
}

export interface RegisterBulkUploadRequest {
  upload_type: Extract<
    BulkUploadType,
    'purchase_orders' | 'customers' | 'dispatch_notes'
  >;
  file_name: string;
  file_hash: string;
  total_rows: number;
  successful_rows: number;
  created_rows?: number;
  failed_rows: number;
  skipped_rows: number;
  accessory_step_failed?: boolean;
  result_reference?: string;
}

// ── Trabajo de carga en el servidor (QUI-1009) ───────────────────────────────

/** Tipos de carga que corren como trabajo durable del servidor. */
export type BulkUploadJobType = Extract<
  BulkUploadType,
  'products' | 'employees' | 'inventory_adjustments' | 'customers'
>;

export type BulkUploadJobStatus = BulkUploadStatus;

/** Fallo técnico que el servidor está reintentando solo («reintentando (n/3)»). */
export interface BulkUploadJobRetryNotice {
  attempt: number;
  max_attempts: number;
  next_retry_at: string;
  message: string;
}

/**
 * Por qué terminó en `failed`: `data` = algo del archivo o de la sesión que el
 * usuario corrige; `technical` = la plataforma falló (hay ticket de incidente).
 */
export interface BulkUploadJobError {
  kind: 'data' | 'technical';
  code: string | null;
  message: string;
}

/**
 * Estado de un trabajo de carga (`GET store/bulk-uploads/jobs/:id`). `id` es
 * el de la fila del historial: la carga y su registro son la misma cosa.
 */
export interface BulkUploadJobView {
  id: number;
  upload_type: BulkUploadJobType;
  status: BulkUploadJobStatus;
  file_name: string;
  user_id: number | null;
  /** 0 mientras el servidor no leyó el archivo. */
  total_rows: number;
  processed_rows: number;
  successful_rows: number;
  failed_rows: number;
  skipped_rows: number;
  created_rows: number | null;
  /** Lotes terminados. */
  batch_current: number;
  batch_total: number | null;
  retry: BulkUploadJobRetryNotice | null;
  error: BulkUploadJobError | null;
  incident_ticket_number: string | null;
  /** `failed` técnico que se puede reanudar desde el lote que falló. */
  can_retry: boolean;
  /** `false` en clientes: un fallo técnico no se reintenta solo. */
  auto_retry: boolean;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  deadline_at: string | null;
}

/**
 * Fila del resultado: la misma forma que devuelve la página de cada tipo (p. ej.
 * `sku`, `product_name`, `action` en productos), sin objetos anidados.
 */
export type BulkUploadJobResultRow = Record<string, unknown> & {
  row_number?: number | null;
  status: string;
  message?: string | null;
};

/** Cuerpo de `POST …/bulk/jobs` según el tipo. */
export interface BulkUploadJobRequestMap {
  products: {
    session_id: string;
    initial_load_ack?: boolean;
    file_name: string;
    file_hash: string;
  };
  employees: { session_id: string; file_name: string; file_hash: string };
  inventory_adjustments: {
    session_id: string;
    location_id: number;
    adjustment_type?: string;
    description?: string;
    initial_load_ack?: boolean;
    file_name: string;
    file_hash: string;
  };
  customers: {
    customers: Record<string, unknown>[];
    file_name: string;
    /** Opcional: si el navegador no pudo calcularla, el servidor usa la de las filas. */
    file_hash?: string;
  };
}
