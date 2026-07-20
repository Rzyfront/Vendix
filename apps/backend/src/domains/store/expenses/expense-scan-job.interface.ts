import { ExpenseScanResponse } from './dto/scan-expense.dto';

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
 * La imagen ya viene preprocesada (sharp resize ≤1536 / JPEG q85) como data URI
 * desde el ENQUEUE — el controller tiene el buffer multer y llama a
 * `ExpenseScannerService.prepareImage(file)` antes de encolar. El worker solo
 * corre la parte pesada (OCR + parse + matching) vía `scanFromImage`.
 */
export interface ExpenseScanJob {
  dataUri: string;
  mimeType: string;
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
