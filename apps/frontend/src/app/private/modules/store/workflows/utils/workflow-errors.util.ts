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

/**
 * `true` for a Flows plan limit (402). The paywall interceptor already opened
 * "Límite de Flujos alcanzado" with "Mejorar plan", so the screen adds no
 * error of its own on top of it.
 */
export function isPlanLimit(error: WorkflowApiError): boolean {
  return error.status === 402 || error.code === 'WORKFLOW_PLAN_LIMIT_REACHED';
}

/** `true` for the codes that mean "your view is outdated: reload". */
export function isStaleCode(code: string | null): boolean {
  return code === 'WORKFLOW_STALE' || code === 'WORKFLOW_TASK_CLOSED';
}

/**
 * The message the API itself sent (permission refusals included), else the
 * normalized one. For errors whose own text matters to the person (403s).
 */
export function apiErrorMessage(error: unknown): string {
  const raw = error as { error?: { message?: unknown } } | null;
  const message = raw?.error?.message;
  if (typeof message === 'string' && message.trim().length > 0) return message;
  if (Array.isArray(message) && typeof message[0] === 'string') return message[0];
  return toWorkflowError(error).message;
}
