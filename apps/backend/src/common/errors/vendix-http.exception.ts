import { HttpException } from '@nestjs/common';
import { ErrorCodeEntry } from './error-codes';

export class VendixHttpException extends HttpException {
  public readonly errorCode: string;

  constructor(
    entry: ErrorCodeEntry,
    detail?: string,
    details?: Record<string, any>,
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
