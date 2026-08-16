import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../../../environments/environment';
import type { ApiResponse } from '../interfaces/invoice.interface';
import type {
  InvoiceDataRequestListResponse,
  InvoiceDataRequestQuery,
  InvoiceDataRequestRow,
  InvoiceDataRequestSummary,
} from '../interfaces/invoice-data-request.interface';

/**
 * Cliente de `store/invoice-data-requests`.
 *
 * Raíz de controlador PROPIA, no `store/invoicing`: por eso no vive dentro de
 * `InvoicingService` ni usa su `getApiUrl`. Mismo criterio que
 * `SupportDocumentService` — las superficies comparten el HTTP, no la fachada.
 *
 * Sin NgRx a propósito: la pestaña es una lista con un botón y no comparte
 * estado con nadie. Meterla en el store de facturación obligaría a extender
 * `InvoicingState` con tres campos que ningún otro selector leería.
 */
@Injectable({ providedIn: 'root' })
export class InvoiceDataRequestService {
  private http = inject(HttpClient);

  private getApiUrl(endpoint = ''): string {
    return `${environment.apiUrl}/store/invoice-data-requests${
      endpoint ? '/' + endpoint : ''
    }`;
  }

  /**
   * `GET /store/invoice-data-requests` — sobre paginado.
   *
   * Los parámetros vacíos se OMITEN, no se mandan en blanco: el backend valida
   * el query con `QueryInvoiceDataRequestsDto` bajo el
   * `forbidNonWhitelisted: true` global, y un `?status=` vacío no es miembro del
   * enum. (El DTO además lo normaliza del otro lado; acá se evita el viaje.)
   *
   * `params` se ANOTA como `Record<string, string | number>` a propósito. Sin la
   * anotación, un literal que puede quedar vacío infiere la unión con `{}`, y
   * con `{}` TypeScript elige la sobrecarga de `HttpClient.get` que devuelve
   * `Observable<ArrayBuffer>` en lugar de la genérica — el error viaja hasta el
   * tipo de retorno y sólo lo caza el compilador AOT, nunca el parser.
   */
  list(
    query: InvoiceDataRequestQuery = {},
  ): Observable<InvoiceDataRequestListResponse> {
    const params: Record<string, string | number> = {};
    if (query.status) params['status'] = query.status;
    if (query.search?.trim()) params['search'] = query.search.trim();
    if (query.page) params['page'] = query.page;
    if (query.limit) params['limit'] = query.limit;

    return this.http.get<InvoiceDataRequestListResponse>(this.getApiUrl(), {
      params,
    });
  }

  /**
   * `GET /store/invoice-data-requests/summary` — conteo por estado.
   *
   * Deliberadamente NO recibe `status`: las tarjetas son el mapa completo de la
   * pestaña y a la vez el atajo para filtrar por cada estado. Si el conteo
   * siguiera el filtro activo, al elegir un estado las otras cinco tarjetas
   * caerían a cero y dejarían de servir para navegar.
   */
  summary(search?: string): Observable<ApiResponse<InvoiceDataRequestSummary>> {
    const params: Record<string, string> = {};
    if (search?.trim()) params['search'] = search.trim();

    return this.http.get<ApiResponse<InvoiceDataRequestSummary>>(
      this.getApiUrl('summary'),
      { params },
    );
  }

  /**
   * `POST /store/invoice-data-requests/:id/process` — reintento manual.
   *
   * Sólo avanza si la fila está en `submitted`: el backend hace un
   * compare-and-swap (`updateMany` con `status: 'submitted'`) para que el
   * listener automático y este botón no puedan procesar la misma solicitud dos
   * veces. Cuando otro trabajador ya la reclamó, responde 200 con `data: null`
   * — que NO es un fallo, es «alguien más la está haciendo».
   */
  process(
    id: number,
  ): Observable<ApiResponse<InvoiceDataRequestRow | null>> {
    return this.http.post<ApiResponse<InvoiceDataRequestRow | null>>(
      this.getApiUrl(`${id}/process`),
      {},
    );
  }
}
