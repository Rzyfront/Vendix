import { Injectable } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';

/**
 * ApiErrorService
 *
 * Centralized helper to humanize HttpErrorResponse instances into Spanish
 * user-facing messages. Used across ORG_ADMIN consolidated module listings
 * (accounting, inventory, reports, purchase-orders) so error rendering stays
 * consistent.
 *
 * Recognizes Vendix error_code conventions and falls back to message arrays
 * (validation), strings, or a caller-provided default.
 */
@Injectable({ providedIn: 'root' })
export class ApiErrorService {
  /**
   * Convert an HttpErrorResponse into a single human-readable Spanish message.
   * @param err Angular HttpErrorResponse
   * @param fallback Optional fallback when nothing else can be derived
   */
  humanize(err: HttpErrorResponse | unknown, fallback?: string): string {
    const e = err as HttpErrorResponse | undefined;
    const status = e?.status;
    const code = (e?.error as any)?.error_code as string | undefined;

    if (status === 0) {
      return 'Sin conexión al servidor. Verifica tu red e inténtalo de nuevo.';
    }

    if (
      code === 'AUTH_PERM_001' ||
      status === 401 ||
      (status === 403 && !code)
    ) {
      return 'No tienes permisos para esta acción. Si tus permisos se actualizaron, cierra sesión y vuelve a iniciar.';
    }

    if (status === 404) {
      const msg404 = this.extractMessage(e);
      return msg404 ?? 'Recurso no encontrado.';
    }

    if (status === 409) {
      const msg = this.extractMessage(e);
      return msg ?? 'Conflicto: el recurso está en un estado que impide la operación.';
    }

    const msg = this.extractMessage(e);
    if (msg) return msg;

    if (status && status >= 500) {
      return 'El servidor tuvo un problema procesando tu solicitud. Inténtalo de nuevo en unos minutos.';
    }

    return fallback ?? 'Ocurrió un error inesperado.';
  }

  private extractMessage(err: HttpErrorResponse | undefined): string | null {
    if (!err) return null;
    const body = err.error;
    if (!body) return null;

    if (Array.isArray(body?.message)) {
      const joined = body.message.filter(Boolean).join('. ');
      return joined || null;
    }
    if (typeof body?.message === 'string' && body.message.trim()) {
      return body.message.trim();
    }
    if (typeof body === 'string' && body.trim()) {
      return body.trim();
    }
    return null;
  }
}
