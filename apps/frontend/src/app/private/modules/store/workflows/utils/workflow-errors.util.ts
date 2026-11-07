import { parseApiError } from '../../../../../core/utils/parse-api-error';
import { WorkflowApiError } from '../interfaces/workflow.interfaces';

/** Error codes whose backend message is already curated Spanish copy. */
const CURATED_PREFIXES = ['WORKFLOW_', 'DOCUMENT_'];

/**
 * Normalizes an `HttpErrorResponse` into `{code, message, status, details}`.
 * For workflow/document codes the backend message is the product copy
 * ("Falta: Soporte de compra", "Esta solicitud cambió; recarga."), so it wins
 * over the generic parser.
 */
export function toWorkflowError(error: unknown): WorkflowApiError {
  const raw = error as { status?: number; error?: unknown } | null;
  const body = (raw?.error ?? raw) as {
    error_code?: string;
    message?: unknown;
  } | null;
  const parsed = parseApiError(error);
  const code = parsed.errorCode;
  const curated =
    code !== null &&
    CURATED_PREFIXES.some((prefix) => code.startsWith(prefix)) &&
    typeof body?.message === 'string' &&
    body.message.trim().length > 0;
  return {
    code,
    message: curated ? (body?.message as string) : parsed.userMessage,
    status: typeof raw?.status === 'number' ? raw.status : null,
    details: parsed.details,
  };
}

/** `true` for the codes that mean "your view is outdated: reload". */
export function isStaleCode(code: string | null): boolean {
  return code === 'WORKFLOW_STALE' || code === 'WORKFLOW_TASK_CLOSED';
}
