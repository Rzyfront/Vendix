import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { environment } from '../../../environments/environment';

/**
 * Resultado del endpoint genérico de upload (`POST {apiUrl}/upload`).
 * El backend persiste keys de S3 (no URLs firmadas) y devuelve además una URL
 * firmada lista para previsualización.
 */
export interface UploadResult {
  key: string;
  url: string;
  thumbKey?: string;
  thumbUrl?: string;
}

/**
 * Resultado del preview seguro de imagen remota
 * (`POST {apiUrl}/upload/remote-image-preview`).
 * Convierte una URL externa en un data URL editable en cliente.
 */
export interface RemoteImagePreview {
  dataUrl: string;
  fileName: string;
  contentType: string;
  byteLength: number;
}

/**
 * Opciones para `uploadFile`. Solo se adjuntan al `FormData` los campos
 * presentes, replicando el contrato esperado por el backend.
 */
export interface UploadFileOptions {
  entityId?: string;
  isMainImage?: boolean;
  /**
   * Tienda destino para uploads store-scoped (logo/favicon/banner). Cuando se
   * envía, el backend usa esta tienda en vez de la del `RequestContext`,
   * validando que pertenezca a la organización del usuario.
   */
  storeId?: number;
}

/**
 * Servicio compartido para flujos de carga de imágenes de display.
 *
 * Centraliza el consumo de los endpoints genéricos `/upload` y
 * `/upload/remote-image-preview`, reutilizando los patrones ya existentes en
 * `ProductsService.getRemoteImagePreview` y `StoreSettingsService.uploadStoreLogo`.
 */
@Injectable({ providedIn: 'root' })
export class ImageUploadService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = environment.apiUrl;

  /**
   * Obtiene un preview seguro de una imagen remota a partir de su URL.
   * El endpoint devuelve el objeto crudo (sin envoltorio `{ success, data }`).
   */
  getRemoteImagePreview(url: string): Observable<RemoteImagePreview> {
    return this.http.post<RemoteImagePreview>(
      `${this.apiUrl}/upload/remote-image-preview`,
      { url },
    );
  }

  /**
   * Sube un archivo al endpoint genérico de upload.
   *
   * Adjunta siempre `file` y `entityType`. Los campos `entityId` e
   * `isMainImage` solo se incluyen cuando vienen en `opts`; `isMainImage` se
   * serializa como string `'true'`/`'false'` tal como espera el backend.
   *
   * El backend puede responder con o sin envoltorio `{ data }`, por lo que se
   * normaliza con `response.data ?? response`.
   */
  uploadFile(
    file: File,
    entityType: string,
    opts?: UploadFileOptions,
  ): Observable<UploadResult> {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('entityType', entityType);

    if (opts?.entityId !== undefined) {
      formData.append('entityId', opts.entityId);
    }
    if (opts?.isMainImage !== undefined) {
      formData.append('isMainImage', opts.isMainImage ? 'true' : 'false');
    }
    if (opts?.storeId !== undefined) {
      formData.append('storeId', String(opts.storeId));
    }

    return this.http
      .post<UploadResult | { data: UploadResult }>(
        `${this.apiUrl}/upload`,
        formData,
      )
      .pipe(
        map((response) =>
          'data' in response && response.data
            ? response.data
            : (response as UploadResult),
        ),
      );
  }
}
