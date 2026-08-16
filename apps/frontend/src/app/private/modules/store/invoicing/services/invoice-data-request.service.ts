import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../../../environments/environment';
import type { ApiResponse } from '../interfaces/invoice.interface';
import type {
  InvoiceDataRequestRow,
  InvoiceDataRequestStatus,
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
   * `GET /store/invoice-data-requests`. `status` vacío = todas.
   *
   * `params` se ANOTA como `Record<string, string>` a propósito. Sin la
   * anotación, `status ? { status } : {}` infiere la unión `{status} | {}`, y con
   * `{}` TypeScript elige la sobrecarga de `HttpClient.get` que devuelve
   * `Observable<ArrayBuffer>` en lugar de la genérica — el error viaja hasta el
   * tipo de retorno y sólo lo caza el compilador AOT, nunca el parser.
   */
  list(
    status?: InvoiceDataRequestStatus | '',
  ): Observable<ApiResponse<InvoiceDataRequestRow[]>> {
    const params: Record<string, string> = status ? { status } : {};
    return this.http.get<ApiResponse<InvoiceDataRequestRow[]>>(
      this.getApiUrl(),
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
