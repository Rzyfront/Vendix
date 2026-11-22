/** Límites y tipos permitidos del módulo documental (flujos-documental S5). */
export const MB = 1024 * 1024;
/** Tope por defecto cuando el requisito/campo no declara `max_size_mb`. */
export const DEFAULT_MAX_FILE_BYTES = 10 * MB;
/** Tope duro: ningún requisito puede subirlo. */
export const HARD_MAX_FILE_BYTES = 25 * MB;

export const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
export const XLSX_MIME =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** MIME permitido → extensiones que lo representan. */
export const ALLOWED_MIME_EXTENSIONS: Readonly<Record<string, readonly string[]>> = {
  'application/pdf': ['pdf'],
  'image/jpeg': ['jpg', 'jpeg'],
  'image/png': ['png'],
  'image/webp': ['webp'],
  [DOCX_MIME]: ['docx'],
  [XLSX_MIME]: ['xlsx'],
  'text/plain': ['txt'],
};

export const ALLOWED_MIME_TYPES = Object.keys(ALLOWED_MIME_EXTENSIONS);

/** Vida de la URL firmada de descarga (máximo 5 minutos). */
export const DOWNLOAD_URL_TTL_SECONDS = 300;

/** Registros donde Vex puede guardar un adjunto del chat (una tool de escritura por cada uno, T44). */
export const ATTACHABLE_ENTITY_TYPES = [
  'customer',
  'order',
  'purchase_order',
  'supplier',
  'expense',
  'product',
] as const;
export type AttachableEntityType = (typeof ATTACHABLE_ENTITY_TYPES)[number];

/**
 * Read permission of each record's own controller (`GET :id`). It opens the
 * record's documents (`store/record-documents`, B1) and lets a person read a
 * chat attachment someone else already saved into that record (B2).
 */
export const RECORD_READ_PERMISSION: Readonly<
  Record<AttachableEntityType, string>
> = {
  customer: 'store:customers:read',
  order: 'store:orders:read',
  purchase_order: 'store:orders:purchase_orders:read',
  supplier: 'store:inventory:suppliers:read',
  expense: 'store:expenses:read',
  product: 'store:products:read',
};
