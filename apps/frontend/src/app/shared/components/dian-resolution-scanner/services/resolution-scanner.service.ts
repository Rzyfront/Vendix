import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { environment } from '../../../../../environments/environment';
import {
  ResolutionScanApiResponse,
  ResolutionScannerScope,
} from '../interfaces/resolution-scan-result.interface';

/**
 * Cliente HTTP del escáner de resoluciones DIAN.
 *
 * Los dos namespaces no comparten prefijo — la tienda cuelga de
 * `store/invoicing/resolutions` y la plataforma de
 * `superadmin/subscriptions/fiscal/resolutions` — así que el scope se resuelve
 * con un mapa explícito. Interpolar el scope crudo es lo que hizo que el
 * escáner de RUT devolviera 404 para todo super-admin, y aquí el scope es
 * obligatorio justamente para no repetirlo.
 */
@Injectable({ providedIn: 'root' })
export class ResolutionScannerService {
  private readonly http = inject(HttpClient);

  /**
   * Sube una resolución DIAN (imagen o PDF) para extracción con IA.
   *
   * El endpoint no escribe nada: devuelve los campos anotados. Guardar sigue
   * siendo un `POST`/`PATCH` aparte que dispara el usuario.
   */
  scanResolution(
    file: File,
    scope: ResolutionScannerScope,
  ): Observable<ResolutionScanApiResponse> {
    const formData = new FormData();
    formData.append('file', file);

    return this.http.post<ResolutionScanApiResponse>(
      this.scanUrl(scope),
      formData,
    );
  }

  private scanUrl(scope: ResolutionScannerScope): string {
    const path =
      scope === 'platform'
        ? 'superadmin/subscriptions/fiscal/resolutions'
        : 'store/invoicing/resolutions';
    return `${environment.apiUrl}/${path}/scan`;
  }
}
