import { ErrorCodes, VendixHttpException } from '@common/errors';
import type { ErrorCodeEntry } from '@common/errors/error-codes';
import { AiExtractionError } from './ai-extraction.service';

export interface ScannerErrorCodes {
  /** The model answered but its JSON is unusable even after the repair. */
  parseFail: ErrorCodeEntry;
  /** The provider did not answer (not credits nor rate limit). */
  aiFail: ErrorCodeEntry;
  /** Spanish message of `aiFail` with the provider error ("La IA no pudo leer el RUT: …"). */
  aiFailMessage?: (providerError: string) => string;
}

/**
 * Keeps a scanner's own error contract on top of ai-ingest (plan ia-cargas F5b):
 *
 * - invalid JSON after the repair → the scanner's `*_PARSE_FAIL`;
 * - provider failure → its `*_AI_FAIL` WITH the provider message, because
 *   "the linked model does not accept images" is not fixed by another photo;
 * - credits / rate limit → `AI_PROVIDER_003` / `AI_PROVIDER_004` (the queue and
 *   the modal show them as "AI unavailable", not as a bad document);
 * - answer cut even after splitting → `AI_INGEST_INCOMPLETE` (document problem).
 *
 * Anything that is not an {@link AiExtractionError} (`AI_INGEST_*` of the
 * pages service, a 4xx of the scanner) is returned untouched.
 */
export function toScannerError(error: unknown, codes: ScannerErrorCodes): unknown {
  if (!(error instanceof AiExtractionError)) return error;
  if (error.failure === 'invalid') {
    return new VendixHttpException(codes.parseFail);
  }
  if (error.failure === 'truncated') {
    return new VendixHttpException(ErrorCodes.AI_INGEST_INCOMPLETE);
  }
  const reason = error.response?.failure_reason;
  if (reason === 'credits' || reason === 'rate_limited') {
    return error.toHttpException();
  }
  const providerError = error.response?.error ?? error.message;
  return new VendixHttpException(
    codes.aiFail,
    providerError && codes.aiFailMessage ? codes.aiFailMessage(providerError) : undefined,
  );
}
