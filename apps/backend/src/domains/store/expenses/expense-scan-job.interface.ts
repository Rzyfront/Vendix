import { ExpenseScanResponse } from './dto/scan-expense.dto';
import type { QueuedDocumentRef } from '@common/ai-ingest/documents/queued-document';

/**
 * Contexto multi-tenant serializado dentro del job de escaneo de factura de
 * gasto. El worker de BullMQ NO hereda el `AsyncLocalStorage` del request HTTP,
 * así que el matching organization-scoped (`matchCategory` →
 * `prisma.organizationWhere`) solo funciona si el processor restaura este
 * contexto con `RequestContextService.run(...)`.
 */
export interface ExpenseScanJobContext {
  store_id?: number;
  organization_id?: number;
  user_id?: number;
  request_id?: string;
}

/**
 * Payload del job encolado en la cola `expense-scan`.
 *
 * ia-cargas F5a: el controller detecta el tipo REAL por firma, guarda el
 * archivo original en S3 (`file_key`, mismo prefijo que la cola `ai-scan`) y
 * encola solo la key; Redis ya no lleva el archivo. El worker lo descarga y lo
 * lee por páginas (`ExpenseScannerService.scanFromFile`).
 *
 * Compatibilidad: un job encolado antes trae `dataUri` (imagen preparada o el
 * PDF crudo en base64) y sigue funcionando por el mismo lector.
 */
export interface ExpenseScanJob extends QueuedDocumentRef {
  context: ExpenseScanJobContext;
}

/**
 * Estados de job expuestos por el endpoint de polling `GET store/expenses/scan/:jobId`.
 * Espejo del subconjunto relevante de `JobState` de BullMQ.
 */
export type ExpenseScanJobState =
  | 'waiting'
  | 'active'
  | 'completed'
  | 'failed'
  | 'delayed';

/**
 * Forma de respuesta del polling de estado del job. `result` solo está presente
 * cuando `status === 'completed'`; `error` solo cuando `status === 'failed'`.
 */
export interface ExpenseScanJobStatus {
  status: ExpenseScanJobState;
  result?: ExpenseScanResponse;
  error?: string;
}
