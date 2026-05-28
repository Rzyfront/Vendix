import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { VendixHttpException } from '../errors';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    // Extract error_code and details based on exception type
    let errorCode: string | undefined;
    let details: any;
    let message: any;

    if (exception instanceof VendixHttpException) {
      errorCode = exception.errorCode;
      const resp = exception.getResponse() as any;
      message = resp.message || resp;
      details = resp.details;
    } else if (exception instanceof HttpException) {
      const resp = exception.getResponse() as any;
      if (resp?.error_code) errorCode = resp.error_code;
      details = resp?.details;

      const rawMessage =
        resp && typeof resp === 'object'
          ? (resp.message ?? resp.error ?? exception.message)
          : (resp ?? exception.message);

      if (Array.isArray(rawMessage)) {
        errorCode = 'SYS_VALIDATION_001';
        details = { validationErrors: rawMessage };
        message = 'Validation failed';
      } else if (typeof rawMessage === 'string') {
        message = rawMessage;
      } else {
        message = exception.message || 'Request failed';
      }
    } else {
      errorCode = 'SYS_INTERNAL_001';
      message = 'Internal server error';
      console.error(
        `[AllExceptionsFilter] Unhandled exception on ${request.method} ${request.url}:`,
        exception,
      );
    }

    const responseBody: Record<string, any> = {
      statusCode: status,
      ...(errorCode && { error_code: errorCode }),
      message,
      ...(details && { details }),
      timestamp: new Date().toISOString(),
      path: request.url,
    };

    // Dev-friendly error details
    if (process.env.NODE_ENV !== 'production') {
      responseBody['devDetails'] = {
        name: exception instanceof Error ? exception.name : 'UnknownException',
        error: exception,
        stack: exception instanceof Error ? exception.stack : undefined,
      };
    }

    response.status(status).json(responseBody);
  }
}
