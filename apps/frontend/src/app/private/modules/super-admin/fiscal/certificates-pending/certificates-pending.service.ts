import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';

import { environment } from '../../../../../../environments/environment';
import type { ApiResponse } from '../interfaces/superadmin-fiscal.interface';
import type {
  IdentityDocumentWithUrl,
  PendingCertificateRequest,
} from './certificates-pending.interface';

/**
 * QUI-657 — cola de plataforma para tramitar certificados de firma DIAN.
 *
 * Todo detrás de `superadmin:*` en el backend. Cruza tenants a propósito: es
 * una cola de operación de plataforma, no una vista de tienda.
 */
@Injectable({ providedIn: 'root' })
export class CertificatesPendingService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/super-admin/fiscal/certificates-pending`;

  /** Expedientes esperando trámite, el más antiguo primero. */
  getPending(statuses?: string[]): Observable<PendingCertificateRequest[]> {
    const query = statuses?.length
      ? `?status=${encodeURIComponent(statuses.join(','))}`
      : '';
    return this.http
      .get<ApiResponse<PendingCertificateRequest[]>>(`${this.base}${query}`)
      .pipe(map((res) => (res?.success ? (res.data ?? []) : [])));
  }

  /**
   * Pide la URL firmada de UN documento, en el momento de abrirlo.
   *
   * Se pide de a uno y bajo demanda —no al cargar la tabla— porque cada URL
   * emitida es una copia del documento de identidad circulando fuera de la
   * sesión, y caduca en 5 minutos. Pedirlas todas por adelantado emitiría
   * enlaces para documentos que nadie va a abrir.
   */
  getDocumentUrl(
    config_id: number,
    document_id: number,
  ): Observable<IdentityDocumentWithUrl | null> {
    return this.http
      .get<ApiResponse<IdentityDocumentWithUrl>>(
        `${this.base}/${config_id}/documents/${document_id}`,
      )
      .pipe(map((res) => (res?.success ? res.data : null)));
  }

  /** Marca el expediente como en trámite ante la entidad emisora. */
  markIssuing(config_id: number): Observable<boolean> {
    return this.http
      .post<ApiResponse<unknown>>(`${this.base}/${config_id}/mark-issuing`, {})
      .pipe(map((res) => !!res?.success));
  }

  /** Devuelve el expediente al tenant con un motivo. */
  reject(config_id: number, reason: string): Observable<boolean> {
    return this.http
      .post<ApiResponse<unknown>>(`${this.base}/${config_id}/reject`, { reason })
      .pipe(map((res) => !!res?.success));
  }

  /**
   * Carga el `.p12` expedido.
   *
   * `FormData` sin cabecera `Content-Type` explícita a propósito: el navegador
   * tiene que poner el `boundary` del multipart, y fijarla a mano lo omite y
   * deja al backend con un body que no sabe parsear.
   */
  uploadIssuedCertificate(
    config_id: number,
    file: File,
    password: string,
  ): Observable<boolean> {
    const form = new FormData();
    form.append('certificate', file);
    form.append('password', password);
    return this.http
      .post<ApiResponse<unknown>>(
        `${this.base}/${config_id}/upload-certificate`,
        form,
      )
      .pipe(map((res) => !!res?.success));
  }
}
