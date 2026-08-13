import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../../../environments/environment';
import type { ApiResponse, InvoiceListResponse } from '../interfaces/invoice.interface';
import type {
  CreateSupportDocumentDto,
  SupportDocumentQuery,
  SupportDocumentRow,
} from '../interfaces/support-document.interface';

/**
 * Servicio del tab "Documentos soporte" (QUI-682).
 *
 * Reutiliza el endpoint base `/store/invoicing` que ya existe y que el plan
 * `docs/plans/qui-308-scope-report.md` (sección C.1) extendió para aceptar los
 * 9 valores de `invoice_type` en `QueryInvoiceDto` y los filtros `cuds` /
 * `supplier_id` (cerrado en este mismo commit).
 *
 * Mantener este servicio aparte de `InvoicingService` evita que la consola de
 * super admin y los efectos existentes importen accidentalmente tipos de
 * soporte; las dos superficies comparten solo el HTTP, no la fachada.
 */
@Injectable({
  providedIn: 'root',
})
export class SupportDocumentService {
  private http = inject(HttpClient);

  private getApiUrl(endpoint: string): string {
    return `${environment.apiUrl}/store/invoicing${endpoint ? '/' + endpoint : ''}`;
  }

  /**
   * Lista documentos soporte aplicando los filtros del query.
   *
   * Sólo se envían al backend los filtros definidos (evita mandar `''` o
   * `undefined` y que el ValidationPipe los rechace con 400).
   */
  list(query: SupportDocumentQuery): Observable<InvoiceListResponse> {
    const params: Record<string, string | number | boolean> = {};
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== '') {
        params[key] = value;
      }
    }
    return this.http.get<InvoiceListResponse>(this.getApiUrl(''), { params });
  }

  /** Detalle de un documento soporte por id. */
  getById(id: number): Observable<ApiResponse<SupportDocumentRow>> {
    return this.http.get<ApiResponse<SupportDocumentRow>>(this.getApiUrl(`${id}`));
  }

  /**
   * Crea un documento soporte (o su nota de ajuste, según `dto.invoice_type`).
   *
   * El endpoint `POST /store/invoicing` ya distingue ambos casos por el campo
   * `invoice_type`; la lógica de carga del proveedor vive en
   * `InvoicingService.loadSupportDocumentSupplier` y se ejecuta sin cambio
   * alguno desde la UI nueva.
   */
  create(
    dto: CreateSupportDocumentDto,
  ): Observable<ApiResponse<SupportDocumentRow>> {
    return this.http.post<ApiResponse<SupportDocumentRow>>(this.getApiUrl(''), dto);
  }
}