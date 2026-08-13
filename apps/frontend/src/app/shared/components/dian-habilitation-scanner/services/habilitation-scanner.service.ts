import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { environment } from '../../../../../environments/environment';
import {
  HabilitationScanApiResponse,
  HabilitationScannerScope,
} from '../interfaces/habilitation-scan-result.interface';

/** Tope duro del backend (`MAX_HABILITATION_SCAN_FILES`). */
export const MAX_HABILITATION_SCAN_FILES = 3;

/**
 * Cliente HTTP del escáner de habilitación DIAN.
 *
 * El scope es obligatorio: el asistente de activación fiscal corre bajo
 * `store` o bajo `organization` según el app type del usuario, y deducirlo
 * dentro del servicio es lo que hizo que el escáner de RUT devolviera 404 para
 * super-admin. Acá el llamador ya sabe cuál es (`FiscalActivationWizardService.userScope()`).
 */
@Injectable({ providedIn: 'root' })
export class HabilitationScannerService {
  private readonly http = inject(HttpClient);

  /**
   * Sube 1-3 documentos de habilitación (imagen o PDF) para extracción con IA.
   *
   * Van en UNA sola petición a propósito: los datos que el formulario necesita
   * están repartidos entre la pantalla del software (SoftwareID, PIN,
   * TestSetId) y la resolución de pruebas (prefijo, rango, clave técnica), y
   * mandarlas juntas deja que el modelo arme un solo resultado.
   *
   * El endpoint no escribe nada: guardar sigue siendo el POST/PATCH que el
   * usuario dispara después de revisar.
   */
  scanHabilitation(
    files: File[],
    scope: HabilitationScannerScope,
  ): Observable<HabilitationScanApiResponse> {
    const formData = new FormData();
    for (const file of files.slice(0, MAX_HABILITATION_SCAN_FILES)) {
      formData.append('files', file);
    }

    return this.http.post<HabilitationScanApiResponse>(
      this.scanUrl(scope),
      formData,
    );
  }

  private scanUrl(scope: HabilitationScannerScope): string {
    return `${environment.apiUrl}/${scope}/invoicing/dian-config/scan-habilitation`;
  }
}
