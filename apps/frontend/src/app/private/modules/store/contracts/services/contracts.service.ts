import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { environment } from '../../../../../../environments/environment';
import { extractApiErrorMessage } from '../../../../../core/utils/api-error-handler';
import { parseApiError } from '../../../../../core/utils/parse-api-error';
import {
  Contract,
  ContractInvoiceRef,
  ContractStatus,
  ContractStatusTransitionDto,
  PaginatedContractsResponse,
} from '../interfaces/contract.interface';

/**
 * C.2 (FB-07): lectura y transiciones del contrato via API, sin escrituras
 * directas. El backend de contratos lo crea C.1; si aun no existe (404) el
 * error sube con su codigo para que la ficha lo muestre accionable (ERR-06:
 * nunca pantalla en blanco).
 */
export class ContractApiError extends Error {
  readonly code: string | null;
  readonly status: number | null;
  constructor(message: string, code: string | null, status: number | null = null) {
    super(message);
    this.name = 'ContractApiError';
    this.code = code;
    this.status = status;
  }
}

function toContractApiError(error: any): ContractApiError {
  const parsed = parseApiError(error);
  const body = error?.error ?? {};
  const code =
    parsed.errorCode ??
    (typeof body?.error?.code === 'string' ? body.error.code : null) ??
    (typeof body?.code === 'string' ? body.code : null);
  const status = typeof error?.status === 'number' ? (error.status as number) : null;
  const message = parsed.userMessage || extractApiErrorMessage(error);
  return new ContractApiError(code ? `${message} (${code})` : message, code, status);
}

@Injectable({
  providedIn: 'root',
})
export class ContractsService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = environment.apiUrl;

  /** FB-07: ficha del contrato. */
  getContractById(id: number): Observable<Contract> {
    return this.http.get<any>(`${this.apiUrl}/store/contracts/${id}`).pipe(
      map((r) => r.data || r),
      catchError((error) => throwError(() => toContractApiError(error))),
    );
  }

  /** Lista para el modulo (paginada en servidor cuando el backend la expone). */
  getContracts(query: { page?: number; limit?: number; search?: string; status?: string } = {}): Observable<PaginatedContractsResponse> {
    const params = new URLSearchParams();
    Object.entries(query).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        params.append(key, value.toString());
      }
    });
    const qs = params.toString();
    const url = `${this.apiUrl}/store/contracts${qs ? `?${qs}` : ''}`;
    return this.http.get<any>(url).pipe(
      map((r) => r.data || r),
      catchError((error) => throwError(() => toContractApiError(error))),
    );
  }

  /**
   * FB-07 + ERR-06: transicion de estado (`draft->active->invoiced`,
   * `*->cancelled`). Una transicion invalida responde 422
   * `CONTRACT_STATUS_001` y el error conserva el codigo para pintarlo.
   */
  transitionContractStatus(id: number, status: ContractStatus): Observable<Contract> {
    const dto: ContractStatusTransitionDto = { status };
    return this.http.patch<any>(`${this.apiUrl}/store/contracts/${id}`, dto).pipe(
      map((r) => r.data || r),
      catchError((error) => throwError(() => toContractApiError(error))),
    );
  }

  /**
   * D.2 (FB-08): genera el borrador de factura AIU precargado desde el
   * contrato vigente. El backend responde con el borrador (o
   * `{ contract, invoice }`); un segundo intento responde 409
   * `CONTRACT_INVOICE_001` sin crear fila. Escritura delegada al backend
   * atomico de D.1: este servicio no calcula ni emite nada.
   */
  generateContractInvoice(id: number): Observable<any> {
    return this.http.post<any>(`${this.apiUrl}/store/contracts/${id}/invoice`, {}).pipe(
      map((r) => r.data || r),
      catchError((error) => throwError(() => toContractApiError(error))),
    );
  }

  /**
   * D.2 (FB-09): factura ligada al contrato. Tolerante a proposito: si el
   * backend aun no expone el filtro (D.1 pendiente) el error sube y la ficha
   * lo ignora en silencio, conservando la referencia que ya trae el contrato.
   */
  getContractInvoice(contractId: number): Observable<ContractInvoiceRef | null> {
    const url = `${this.apiUrl}/store/invoicing?contract_id=${contractId}`;
    return this.http.get<any>(url).pipe(
      map((r) => {
        const body = r?.data ?? r;
        const list = Array.isArray(body) ? body : body?.data;
        if (Array.isArray(list)) return (list[0] as ContractInvoiceRef) ?? null;
        if (body && typeof body === 'object' && 'id' in body) {
          return body as ContractInvoiceRef;
        }
        return null;
      }),
      catchError((error) => throwError(() => toContractApiError(error))),
    );
  }
}
