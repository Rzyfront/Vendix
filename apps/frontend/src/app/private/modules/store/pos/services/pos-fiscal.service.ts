import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
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
        catchError(() => of(this.unreachable(orderId))),
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
        catchError(() => of(this.unreachable(orderId))),
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
   * El backend no contestó. NO es `failed`: `failed` significa que el documento
   * fue rechazado y necesita intervención, y eso no es lo que sabemos. Lo que
   * sabemos es que no pudimos preguntar, así que se reporta como pendiente —
   * que es además el estado real más probable, porque el oyente post-commit ya
   * disparó la emisión del lado del servidor.
   */
  private unreachable(orderId: number): PosFiscalStatus {
    return {
      order_id: orderId,
      state: 'pending',
      message: 'No se pudo consultar el estado fiscal. La venta ya está registrada.',
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
