import { HttpException } from '@nestjs/common';
import { ErrorCodeEntry } from './error-codes';

/**
 * Public, client-safe metadata attached to a `VendixHttpException`.
 * Surfaced to API consumers under the `details` key — never include secrets,
 * stack traces, or internal IDs that aren't meant to be public.
 *
 * Use `devDetails` (server-side log only) for sensitive debugging info.
 */
export type VendixHttpExceptionDetails = Record<string, unknown>;

export class VendixHttpException extends HttpException {
  public readonly errorCode: string;

  constructor(
    entry: ErrorCodeEntry,
    detail?: string,
    details?: VendixHttpExceptionDetails,
  ) {
    super(
      {
        error_code: entry.code,
        message: detail || entry.devMessage,
        ...(details && { details }),
      },
      entry.httpStatus,
    );
    this.errorCode = entry.code;
  }
}
