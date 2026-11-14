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
  | 'purchase_orders';

export type BulkUploadStatus = 'completed' | 'partial' | 'failed';

export const BULK_UPLOAD_TYPE_LABELS: Record<BulkUploadType, string> = {
  products: 'Productos',
  product_images: 'Imágenes de productos',
  employees: 'Empleados',
  inventory_adjustments: 'Ajustes de inventario',
  customers: 'Clientes',
  bank_statements: 'Extractos bancarios',
  purchase_orders: 'Compras',
};

export const BULK_UPLOAD_STATUS_LABELS: Record<BulkUploadStatus, string> = {
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
  upload_type: Extract<BulkUploadType, 'purchase_orders' | 'customers'>;
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
