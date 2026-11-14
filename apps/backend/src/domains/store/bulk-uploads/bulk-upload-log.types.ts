/**
 * QUI-1004 — tipos del registro liviano de cargas masivas.
 *
 * Cada carga masiva de la app deja UNA fila con sus datos clave; nunca el
 * archivo ni el detalle por fila. Este archivo es la lista cerrada de tipos y
 * del permiso que autoriza cada uno.
 */

export const BULK_UPLOAD_TYPES = [
  'products',
  'product_images',
  'employees',
  'inventory_adjustments',
  'customers',
  'bank_statements',
  'purchase_orders',
  'memberships',
  'customers_ai',
] as const;

export type BulkUploadType = (typeof BULK_UPLOAD_TYPES)[number];

/**
 * Tipos cuya carga NO pasa el archivo por el servidor (el navegador lee el
 * Excel). Son los únicos que el cliente puede registrar por
 * `POST store/bulk-uploads`; el resto lo registra el servidor al procesar la
 * carga, así nadie puede fabricar una fila de un tipo que el servidor ve.
 */
export const CLIENT_REGISTERED_UPLOAD_TYPES = [
  'purchase_orders',
  'customers',
] as const;

export const BULK_UPLOAD_STATUSES = ['completed', 'partial', 'failed'] as const;

export type BulkUploadStatus = (typeof BULK_UPLOAD_STATUSES)[number];

/**
 * Permiso que ya autoriza cada carga. Consultar si un archivo está repetido o
 * registrar la carga exige el MISMO permiso que la carga en sí: quien no puede
 * cargar compras no puede preguntar por los archivos de compras.
 */
export const BULK_UPLOAD_TYPE_PERMISSIONS: Record<BulkUploadType, string> = {
  products: 'store:products:create',
  product_images: 'store:products:create',
  employees: 'store:payroll:employees:bulk:upload',
  inventory_adjustments: 'store:inventory:adjustments:create',
  customers: 'store:customers:create',
  bank_statements: 'store:accounting:bank_reconciliation:create',
  purchase_orders: 'store:orders:purchase_orders:create',
  memberships: 'store:memberships:bulk_import',
  customers_ai: 'store:customers:create',
};

export const BULK_UPLOAD_ANY_PERMISSION = Array.from(
  new Set(Object.values(BULK_UPLOAD_TYPE_PERMISSIONS)),
);

/** SHA-256 en hexadecimal minúscula. */
export const BULK_FILE_HASH_PATTERN = /^[a-f0-9]{64}$/;

export interface BulkUploadCounts {
  total_rows: number;
  successful_rows: number;
  /**
   * Parte de `successful_rows` que creó un producto (compras crea los que no
   * existen). `null`/ausente = el tipo de carga no lo distingue.
   */
  created_rows?: number | null;
  failed_rows: number;
  skipped_rows: number;
}

/**
 * Estado de una carga a partir de sus conteos:
 *  - `failed`: nada entró y hubo errores.
 *  - `partial`: hubo errores pero algo entró, o un paso accesorio falló
 *    (compras: pago o recepción) — `forcePartial`.
 *  - `completed`: sin errores (filas omitidas, p. ej. duplicadas, no cuentan
 *    como error).
 */
export function resolveBulkUploadStatus(
  counts: Pick<BulkUploadCounts, 'successful_rows' | 'failed_rows'>,
  forcePartial = false,
): BulkUploadStatus {
  if (counts.successful_rows === 0 && counts.failed_rows > 0) return 'failed';
  if (counts.failed_rows > 0 || forcePartial) return 'partial';
  return 'completed';
}

/** Lo que el aviso de archivo repetido muestra de la carga anterior. */
export interface BulkUploadDuplicateInfo {
  id: number;
  created_at: Date;
  user_name: string | null;
  file_name: string;
  status: string;
  result_reference: string | null;
}

/**
 * Resultado de una página (o de una carga completa) tal como lo devuelven los
 * servicios de carga existentes. Cada servicio nombra distinto sus conteos;
 * aquí se aceptan los nombres que ya usan.
 */
export interface BulkUploadPageResult {
  total?: number;
  total_processed?: number;
  successful?: number;
  created?: number;
  failed?: number;
  skipped?: number;
}

/** Datos del archivo que el commit de una carga paginada trae del analyze. */
export interface BulkUploadFileRef {
  file_name?: string;
  file_hash?: string;
}
