import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';
import { FiscalGateService } from '../services/fiscal-gate.service';

/**
 * F4 — Interceptor del gate "no responsable de IVA".
 *
 * Clon del molde `subscriptionPaywallInterceptor`: escucha el
 * `error_code` `FISCAL_VAT_NOT_RESPONSIBLE_001` (HTTP 412) que el backend
 * emite cuando un comercio no responsable de IVA intenta asignar/cobrar IVA,
 * y abre el modal informativo vía `FiscalGateService`. El error SIEMPRE se
 * re-lanza para que el caller pueda manejarlo/loguearlo localmente.
 *
 * Orden: registrar DESPUÉS del auth interceptor (para que el refresh de token
 * en 401 ocurra primero), junto al `subscriptionPaywallInterceptor`.
 */
const FISCAL_VAT_BLOCK_CODE = 'FISCAL_VAT_NOT_RESPONSIBLE_001';

export const fiscalGateInterceptor: HttpInterceptorFn = (req, next) => {
  const gate = inject(FiscalGateService);
  return next(req).pipe(
    catchError((err: unknown) => {
      if (err instanceof HttpErrorResponse) {
        const body = err.error as { error_code?: string } | null | undefined;
        if (body?.error_code === FISCAL_VAT_BLOCK_CODE) {
          try {
            gate.openVatResponsibleGate();
          } catch {
            // No romper la propagación del error original si el modal falla.
          }
        }
      }
      return throwError(() => err);
    }),
  );
};
