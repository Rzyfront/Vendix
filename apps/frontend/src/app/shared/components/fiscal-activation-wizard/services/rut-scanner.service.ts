import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

import { environment } from '../../../../../environments/environment';
import { AuthFacade } from '../../../../core/store/auth/auth.facade';
import {
  RutScanApiResponse,
  RutScannerScope,
} from '../interfaces/rut-scan-result.interface';

/**
 * Frontend HTTP client for the AI-powered RUT scanner.
 *
 * Posts a single multipart `file` field to
 * `${apiUrl}/${scope}/settings/rut-scanner/scan` and returns the extracted
 * fiscal data. The scope is tenant-aware: ORG_ADMIN users hit the
 * `organization` namespace, everyone else hits `store` — mirroring the
 * `baseUrl()` pattern in `FiscalActivationWizardService`.
 *
 * The caller may pass an explicit `scope` (e.g. when the parent already knows
 * the active app type). When omitted, the scope is resolved from
 * `AuthFacade.selectedAppType()`.
 */
@Injectable({
  providedIn: 'root',
})
export class RutScannerService {
  private readonly http = inject(HttpClient);
  private readonly authFacade = inject(AuthFacade);

  /**
   * Upload a RUT image/PDF for AI extraction.
   *
   * @param file Single RUT document (image/jpeg, image/png, image/webp or
   *   application/pdf, ≤10MB — validated by the caller before invoking).
   * @param scope Optional explicit tenant scope. Falls back to the active app
   *   type when not provided.
   */
  scanRut(
    file: File,
    scope?: RutScannerScope,
  ): Observable<RutScanApiResponse> {
    const formData = new FormData();
    formData.append('file', file);

    return this.http.post<RutScanApiResponse>(
      `${this.scanUrl(scope)}`,
      formData,
    );
  }

  /**
   * `store` y `organization` cuelgan de `{scope}/settings/rut-scanner`, pero la
   * plataforma no: su namespace es `super-admin/fiscal`, igual que hace
   * `FiscalOperationsService.baseUrl()`. Interpolar el scope crudo producía
   * `/platform/settings/rut-scanner/scan`, una ruta que no existe — por eso el
   * escáner devolvía 404 para todo super-admin.
   */
  private scanUrl(scope?: RutScannerScope): string {
    const resolved = this.resolveScope(scope);
    const path =
      resolved === 'platform'
        ? 'super-admin/fiscal/identity/rut-scanner'
        : `${resolved}/settings/rut-scanner`;
    return `${environment.apiUrl}/${path}/scan`;
  }

  private resolveScope(scope?: RutScannerScope): RutScannerScope {
    if (scope) {
      return scope;
    }
    return this.authFacade.selectedAppType() === 'ORG_ADMIN'
      ? 'organization'
      : 'store';
  }
}
