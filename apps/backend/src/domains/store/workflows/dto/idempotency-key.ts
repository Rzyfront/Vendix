import { ErrorCodes, VendixHttpException } from '@common/errors';

export const IDEMPOTENCY_KEY_MAX = 80;

/** `Idempotency-Key` header: required, non-empty, at most 80 characters. */
export function requireIdempotencyKey(raw: string | string[] | undefined): string {
  const value = (Array.isArray(raw) ? raw[0] : raw)?.trim();
  if (!value || value.length > IDEMPOTENCY_KEY_MAX) {
    throw new VendixHttpException(ErrorCodes.WORKFLOW_IDEMPOTENCY_KEY_REQUIRED);
  }
  return value;
}
