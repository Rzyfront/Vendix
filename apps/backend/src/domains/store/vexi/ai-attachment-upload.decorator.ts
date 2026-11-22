import {
  applyDecorators,
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  PayloadTooLargeException,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Observable, catchError, throwError } from 'rxjs';
import { VendixHttpException, ErrorCodes } from '../../../common/errors';
import { AI_ATTACHMENT_LABEL, AI_ATTACHMENT_MAX_BYTES } from './ai-attachments';

/**
 * Multer limits of the chat attachment routes (Vex and Vexi): the real cap
 * and one file per request. Multer stops reading one byte past the cap, so an
 * oversized upload is never buffered whole in memory before the service's own
 * size check runs.
 */
export const AI_ATTACHMENT_UPLOAD_LIMITS = {
  fileSize: AI_ATTACHMENT_MAX_BYTES,
  files: 1,
} as const;

export const AI_ATTACHMENT_TOO_LARGE_MESSAGE = `El archivo pesa más de ${AI_ATTACHMENT_MAX_BYTES / 1024 / 1024} MB, que es el máximo. Acepto: ${AI_ATTACHMENT_LABEL}.`;

/**
 * Multer reports the cap as `PayloadTooLargeException('File too large')`;
 * this turns it into the same 400 and wording the service uses for a file
 * over the limit, so the person reads one message whichever check fires.
 */
@Injectable()
export class AiAttachmentTooLargeInterceptor implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      catchError((error: unknown) =>
        throwError(() =>
          error instanceof PayloadTooLargeException
            ? new VendixHttpException(
                ErrorCodes.INV_SCAN_INVALID_FILE,
                AI_ATTACHMENT_TOO_LARGE_MESSAGE,
              )
            : error,
        ),
      ),
    );
  }
}

/**
 * Upload of one chat attachment in field `file`, bounded by
 * `AI_ATTACHMENT_UPLOAD_LIMITS`. Declare it after the guards: Nest runs guards
 * first, so a blocked request is rejected before Multer reads the body.
 */
export function AiAttachmentUpload(): MethodDecorator & ClassDecorator {
  return applyDecorators(
    UseInterceptors(
      AiAttachmentTooLargeInterceptor,
      FileInterceptor('file', { limits: AI_ATTACHMENT_UPLOAD_LIMITS }),
    ),
  );
}
