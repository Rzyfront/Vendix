import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Observable, of } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { environment } from '../../../../../../environments/environment';

/**
 * Los cinco desenlaces que el cajero necesita distinguir. Espejo exacto de
 * `apps/backend/src/domains/store/invoicing/pos/pos-fiscal-status.interface.ts`:
 * si allá se agrega un estado, acá también, o el indicador se queda mudo.
 */
export type PosFiscalState =
  | 'not_applicable'
  | 'pending'
  | 'issued'
  | 'contingency'
  | 'failed';

/**
 * Un hallazgo del validador fiscal único. Trae `problem` (qué está mal) y `fix`
 * (dónde se corrige) porque el cajero no puede hacer nada con un código.
 */
export interface PosFiscalBlocker {
  code: string;
  severity: string;
  category: string;
  field: string;
  problem: string;
  fix: string;
  details?: Record<string, unknown>;
}

export interface PosFiscalStatus {
  order_id: number;
  state: PosFiscalState;
  message: string;
  invoice_id: number | null;
  invoice_number: string | null;
  invoice_status: string | null;
  cufe: string | null;
  pdf_url: string | null;
  blockers: PosFiscalBlocker[];
  retry: {
    attempts: number;
    max_attempts: number;
    next_retry_at: string;
    last_error: string | null;
  } | null;
  contingency_deadline: string | null;
  invoice_data_token: string | null;
}

/**
 * Cliente del carril fiscal del POS.
 *
 * Dos rutas y ninguna más: mirar el estado y pedir la emisión. Ambas devuelven
 * SIEMPRE un `PosFiscalStatus`, incluso cuando la DIAN falla — el backend
 * responde 200 con el estado a propósito, porque la venta ya está cobrada y un
 * 5xx sólo le quitaría al POS la única información útil que hay.
 *
 * Ningún método de este servicio lanza: un error de red degrada a un estado
 * describible. El indicador es NO MODAL y no puede convertirse en un bloqueo
 * por un fallo del propio indicador.
 */
@Injectable({
  providedIn: 'root',
})
export class PosFiscalService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = `${environment.apiUrl}/store/invoicing/pos`;

  /** Estado fiscal de una venta ya cobrada. Sólo lee; nunca emite. */
  getFiscalStatus(orderId: number): Observable<PosFiscalStatus> {
    return this.http
      .get<any>(`${this.apiUrl}/orders/${orderId}/fiscal-status`)
      .pipe(
        map((response) => this.unwrap(response, orderId)),
        catchError((error) => of(this.unreachable(orderId, error))),
      );
  }

  /**
   * Emisión bajo demanda: el cajero pide el documento de una venta ya cobrada,
   * o reintenta una que quedó pendiente. La venta NO depende de esto.
   */
  emit(orderId: number): Observable<PosFiscalStatus> {
    return this.http
      .post<any>(`${this.apiUrl}/orders/${orderId}/emit`, {})
      .pipe(
        map((response) => this.unwrap(response, orderId)),
        catchError((error) => of(this.unreachable(orderId, error))),
      );
  }

  private unwrap(response: any, orderId: number): PosFiscalStatus {
    const data = response?.data ?? response;
    if (!data || typeof data !== 'object' || !data.state) {
      return this.unreachable(orderId);
    }
    return {
      ...(data as PosFiscalStatus),
      blockers: Array.isArray(data.blockers) ? data.blockers : [],
    };
  }

  /**
   * El backend no contestó, y lo que se responde depende de POR QUÉ.
   *
   * - **No podemos preguntar** (401/403 sin permiso, 400 de ruta mal formada,
   *   404): `not_applicable`, que el indicador no pinta. Devolver `pending`
   *   aquí dejaba al cajero mirando «Enviando a la DIAN…» sobre una consulta que
   *   nunca iba a resolverse, y el indicador reconsultando doce veces contra un
   *   403 que va a seguir siendo 403.
   * - **No pudimos preguntar AHORA** (red caída, 5xx, timeout): `pending`. Es
   *   además el estado real más probable, porque el oyente post-commit ya
   *   disparó la emisión del lado del servidor; la reconsulta tiene sentido.
   *
   * En ninguno de los dos casos se responde `failed`: eso significa que el
   * documento fue rechazado y necesita intervención, y eso es precisamente lo
   * que NO sabemos cuando la respuesta no llegó.
   */
  private unreachable(orderId: number, error?: unknown): PosFiscalStatus {
    const status = error instanceof HttpErrorResponse ? error.status : 0;
    const cannot_ask = status === 400 || status === 401 || status === 403 || status === 404;

    return {
      order_id: orderId,
      state: cannot_ask ? 'not_applicable' : 'pending',
      message: cannot_ask
        ? 'No hay estado fiscal disponible para esta venta.'
        : 'No se pudo consultar el estado fiscal. La venta ya está registrada.',
      invoice_id: null,
      invoice_number: null,
      invoice_status: null,
      cufe: null,
      pdf_url: null,
      blockers: [],
      retry: null,
      contingency_deadline: null,
      invoice_data_token: null,
    };
  }
}
