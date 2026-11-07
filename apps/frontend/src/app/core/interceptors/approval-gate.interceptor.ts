import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';
import { ToastService } from '../../shared/components/toast/toast.service';

/**
 * Codes the approval gate answers with (HTTP 409): a request deciding, a
 * rejected one, or a route that cannot ask approval (use the one that does).
 */
export const APPROVAL_GATE_CODES: readonly string[] = [
  'WORKFLOW_APPROVAL_PENDING',
  'WORKFLOW_APPROVAL_REJECTED',
  'WORKFLOW_APPROVAL_REQUIRED',
];

/**
 * A governed operation (purchase order, expense, adjustment, credit note…)
 * waits for its approval request. The server message already names the
 * request ("Pendiente de aprobación (...): solicitud FLU-..."), so it is shown
 * as a warning, never as a generic failure. The error is always re-thrown;
 * `ToastService.error` drops the duplicate red toast the screen would raise
 * for the same message.
 */
export const approvalGateInterceptor: HttpInterceptorFn = (req, next) => {
  const toast = inject(ToastService);
  return next(req).pipe(
    catchError((err: unknown) => {
      if (err instanceof HttpErrorResponse) {
        const body = err.error as { error_code?: string; message?: unknown } | null | undefined;
        const code = body?.error_code;
        if (code && APPROVAL_GATE_CODES.includes(code) && typeof body?.message === 'string' && body.message.trim()) {
          toast.approvalWarning(body.message.trim(), 'Aprobación requerida');
        }
      }
      return throwError(() => err);
    }),
  );
};
