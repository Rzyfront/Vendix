import { UnrecoverableError } from 'bullmq';
import { VendixHttpException, findErrorCodeEntry } from '@common/errors';

/**
 * Who is to blame for a failed AI job (QUI-1020). The user sees a different
 * message for each, and only the last two alert Vendix:
 * - `document`: the file itself (unreadable, wrong type, empty, too many rows).
 * - `technical`: Vendix failed (S3, a bug, a 5xx, a crash).
 * - `ai_unavailable`: the AI service cannot answer (no credits, rate limited,
 *   not configured) or the store's plan ran out of AI quota.
 */
export type AiJobFailureCategory = 'document' | 'technical' | 'ai_unavailable';

export type AiUnavailableReason =
  | 'credits'
  | 'rate_limited'
  | 'not_configured'
  | 'plan_quota';

export interface AiJobFailureClass {
  category: AiJobFailureCategory;
  reason?: AiUnavailableReason;
}

/** Codes that mean "the AI service cannot answer", whatever their HTTP status. */
const AI_UNAVAILABLE_CODES: Readonly<Record<string, AiUnavailableReason>> = {
  AI_PROVIDER_003: 'credits',
  AI_PROVIDER_004: 'rate_limited',
  AI_APP_004: 'rate_limited',
  AI_APP_001: 'not_configured',
  AI_APP_003: 'not_configured',
  AI_VISION_001: 'not_configured',
  AI_CONFIG_001: 'not_configured',
  AI_PROVIDER_002: 'not_configured',
};

/**
 * 4xx codes that are NOT the document's fault: the job lost its tenant
 * context, which is a Vendix bug.
 */
const TECHNICAL_4XX_CODES: ReadonlySet<string> = new Set([
  'STORE_CONTEXT_001',
  'UPLOAD_STORE_CONTEXT_001',
  'AI_QUEUE_001',
  'AI_QUEUE_002',
  // The model returned unusable JSON for the landing: nothing the user did.
  'CRM_LANDING_003',
]);

/**
 * Classifies the `failedReason` of an AI job. The processors store the
 * Vendix error CODE there; anything that is not a known code (a raw message,
 * an unknown kind, a crash) is a technical failure.
 */
export function classifyAiJobFailure(
  failedReason: string | null | undefined,
): AiJobFailureClass {
  const code = (failedReason ?? '').trim();
  const unavailable = AI_UNAVAILABLE_CODES[code];
  if (unavailable) return { category: 'ai_unavailable', reason: unavailable };
  if (code.startsWith('SUBSCRIPTION_')) {
    return { category: 'ai_unavailable', reason: 'plan_quota' };
  }
  const status = findErrorCodeEntry(code)?.httpStatus;
  if (
    status !== undefined &&
    status >= 400 &&
    status < 500 &&
    status !== 429 &&
    !TECHNICAL_4XX_CODES.has(code)
  ) {
    return { category: 'document' };
  }
  return { category: 'technical' };
}

/**
 * Whether Vendix must hear about this failure: technical failures and an AI
 * service Vendix pays for or configures. A spent store plan and a bad document
 * are the tenant's business, not an incident.
 */
export function failureNeedsIncident(failure: AiJobFailureClass): boolean {
  if (failure.category === 'document') return false;
  if (failure.category === 'ai_unavailable') {
    return failure.reason !== 'plan_quota';
  }
  return true;
}

/**
 * What an AI job worker throws so BullMQ keeps the Vendix error CODE as
 * `failedReason` (the status endpoint classifies it and the client maps it to
 * a message): a 4xx other than 429 is the input's fault and is not retried;
 * any other Vendix error is retried. `retryCodes` lists 4xx codes that are
 * model failures, not input faults, and stay retryable. Anything else passes through untouched.
 */
export function toAiJobFailure(
  error: unknown,
  opts?: { retryCodes?: readonly string[] },
): unknown {
  if (error instanceof VendixHttpException) {
    const status = error.getStatus();
    // Non-deterministic model failures (parse/AI read) are worth a retry even
    // though they carry a 4xx status.
    if (opts?.retryCodes?.includes(error.errorCode)) {
      return new Error(error.errorCode);
    }
    if (status >= 400 && status < 500 && status !== 429) {
      return new UnrecoverableError(error.errorCode);
    }
    return new Error(error.errorCode);
  }
  return error;
}
