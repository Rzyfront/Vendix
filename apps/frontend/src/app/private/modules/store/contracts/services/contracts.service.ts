import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { environment } from '../../../../../../environments/environment';
import { extractApiErrorMessage } from '../../../../../core/utils/api-error-handler';
import { parseApiError } from '../../../../../core/utils/parse-api-error';
import {
  Contract,
  ContractLineView,
  ContractInvoiceRef,
  ContractStatus,
  ContractStatusTransitionDto,
  PaginatedContractsResponse,
} from '../interfaces/contract.interface';
import type { ContractSnapshot } from '../interfaces/contract-snapshot.interface';

/**
 * C.2 (FB-07): lectura y transiciones del contrato via API, sin escrituras
 * directas. El backend de contratos lo crea C.1; si aun no existe (404) el
 * error sube con su codigo para que la ficha lo muestre accionable (ERR-06:
 * nunca pantalla en blanco).
 */
export class ContractApiError extends Error {
  readonly code: string | null;
  readonly status: number | null;
  readonly details: Record<string, unknown>;
  constructor(message: string, code: string | null, status: number | null = null, details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'ContractApiError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function toContractApiError(error: unknown): ContractApiError {
  const parsed = parseApiError(error);
  const errorRecord = asRecord(error);
  const body = asRecord(errorRecord?.['error']) ?? {};
  const nestedError = asRecord(body['error']);
  const code =
    parsed.errorCode ??
    (typeof nestedError?.['code'] === 'string' ? nestedError['code'] : null) ??
    (typeof body['code'] === 'string' ? body['code'] : null);
  const status = typeof errorRecord?.['status'] === 'number' ? errorRecord['status'] : null;
  const message = parsed.userMessage || extractApiErrorMessage(error);
  const details = parsed.details && typeof parsed.details === 'object' && !Array.isArray(parsed.details)
    ? parsed.details as Record<string, unknown>
    : {};
  return new ContractApiError(code ? `${message} (${code})` : message, code, status, details);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

/** Parse finite display values only. Raw snapshot strings remain untouched. */
function finiteAmount(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function isContractSnapshot(value: Record<string, unknown> | null): value is Record<string, unknown> & ContractSnapshot {
  const quotation = asRecord(value?.['quotation']);
  return typeof value?.['frozen_at'] === 'string' && !!quotation;
}

function mapContractDto(value: unknown): Contract {
  const dto = asRecord(value);
  if (!dto) throw new Error('Respuesta de contrato inválida.');
  const rawSnapshot = asRecord(dto['snapshot']);
  const snapshot = isContractSnapshot(rawSnapshot) ? rawSnapshot : null;
  const quotation = asRecord(rawSnapshot?.['quotation']);
  const profile = asRecord(rawSnapshot?.['profile']);
  const config = asRecord(profile?.['config']);
  const invoiceDto = asRecord(dto['invoice']);
  const snapshotItems = Array.isArray(quotation?.['items']) ? quotation['items'] : null;
  const rowItems = Array.isArray(dto['items']) ? dto['items'] : [];
  const rawItems: unknown[] = snapshotItems ?? rowItems;
  const items: ContractLineView[] = rawItems.flatMap((value) => {
    const item = asRecord(value);
    if (!item) return [];
    return [{
      product_name: typeof item['product_name'] === 'string' ? item['product_name'] : 'Ítem sin nombre',
      quantity: finiteAmount(item['quantity']),
      unit_price: finiteAmount(item['unit_price']),
      discount_amount: finiteAmount(item['discount_amount']),
      tax_rate: finiteAmount(item['tax_rate']),
      tax_amount_item: finiteAmount(item['tax_amount_item']),
      total_price: finiteAmount(item['total_price']),
      notes: typeof item['notes'] === 'string' ? item['notes'] : null,
    }];
  });
  const pickAmount = (snapshotValue: unknown, legacyValue: unknown): number | null =>
    finiteAmount(rawSnapshot ? snapshotValue : legacyValue);
  const id = finiteAmount(dto['id']);
  const storeId = finiteAmount(dto['store_id']);
  const contractNumber = dto['contract_number'];
  const rawStatus = dto['status'];
  const status: ContractStatus | null = typeof rawStatus === 'string' &&
    ['draft', 'active', 'invoiced', 'cancelled'].includes(rawStatus)
      ? rawStatus as ContractStatus
      : null;
  const quotationId = finiteAmount(dto['quotation_id'] ?? quotation?.['id']);
  if (id === null || storeId === null || quotationId === null || typeof contractNumber !== 'string' ||
      status === null) {
    throw new Error('La respuesta del contrato no contiene sus datos de identificación.');
  }
  const profileId = finiteAmount(profile?.['profile_id']);
  const profileVersion = finiteAmount(profile?.['version']);
  const profileView = profile
    ? { profile_id: profileId, version: profileVersion, config }
    : null;
  const invoiceId = finiteAmount(invoiceDto?.['id']);
  const invoice: ContractInvoiceRef | null = invoiceDto && invoiceId !== null ? {
    id: invoiceId,
    invoice_number: typeof invoiceDto['invoice_number'] === 'string' ? invoiceDto['invoice_number'] : undefined,
    status: typeof invoiceDto['status'] === 'string' ? invoiceDto['status'] : undefined,
    total_amount: finiteAmount(invoiceDto['total_amount']),
    dian_status: typeof invoiceDto['dian_status'] === 'string' ? invoiceDto['dian_status'] : null,
  } : null;
  const quotationDto = asRecord(dto['quotation']);
  const quotationRefId = finiteAmount(quotationDto?.['id']);
  const quotationRef: Contract['quotation'] = quotationDto && quotationRefId !== null ? {
    id: quotationRefId,
    quotation_number: typeof quotationDto['quotation_number'] === 'string' ? quotationDto['quotation_number'] : '',
    status: typeof quotationDto['status'] === 'string' ? quotationDto['status'] : undefined,
  } : null;
  const explicitObject = typeof dto['contract_object'] === 'string' ? dto['contract_object'] : null;
  const snapshotObject = typeof rawSnapshot?.['contract_object'] === 'string' ? rawSnapshot['contract_object'] :
    typeof quotation?.['contract_object'] === 'string' ? quotation['contract_object'] : null;
  const readText = (record: Record<string, unknown> | null, key: string): string | null =>
    typeof record?.[key] === 'string' ? record[key] as string : null;

  return {
    snapshot,
    // The contractual object must be an explicit field, never notes/profile notes.
    id,
    store_id: storeId,
    contract_number: contractNumber,
    status,
    quotation_id: quotationId,
    contract_object: snapshotObject ?? explicitObject,
    administration_percentage: finiteAmount(rawSnapshot ? config?.['admin_percent'] : dto['administration_percentage']),
    contingency_percentage: finiteAmount(rawSnapshot ? config?.['contingency_percent'] : dto['contingency_percentage']),
    profit_percentage: finiteAmount(rawSnapshot ? config?.['profit_percent'] : dto['profit_percentage']),
    subtotal_amount: pickAmount(quotation?.['subtotal_amount'], dto['subtotal_amount']),
    discount_amount: pickAmount(quotation?.['discount_amount'], dto['discount_amount']),
    tax_amount: pickAmount(quotation?.['tax_amount'], dto['tax_amount']),
    grand_total: pickAmount(quotation?.['grand_total'], dto['grand_total']),
    notes: rawSnapshot ? readText(quotation, 'notes') : readText(dto, 'notes'),
    terms_and_conditions: rawSnapshot ? readText(quotation, 'terms_and_conditions') : readText(dto, 'terms_and_conditions'),
    valid_until: rawSnapshot ? readText(quotation, 'valid_until') : readText(dto, 'valid_until'),
    items,
    profile: profileView,
    profile_id: profileId,
    profile_version: profileVersion,
    invoice,
    quotation: quotationRef,
    created_at: readText(dto, 'created_at'),
    updated_at: readText(dto, 'updated_at'),
  };
}

function unwrapResponse(value: unknown): unknown {
  const record = asRecord(value);
  return record?.['data'] ?? value;
}

function mapPaginatedContracts(response: unknown): PaginatedContractsResponse {
  const body = unwrapResponse(response);
  const envelope = asRecord(body);
  const responseEnvelope = asRecord(response);
  // Current contracts controller: data:{data, pagination}; canonical envelope: data + meta.
  const rows: unknown[] = Array.isArray(body) ? body : Array.isArray(envelope?.['data']) ? envelope['data'] : [];
  const pagination = asRecord(envelope?.['pagination']) ?? asRecord(envelope?.['meta']) ?? asRecord(responseEnvelope?.['meta']) ?? {};
  return {
    data: rows.map(mapContractDto),
    pagination: {
      total: finiteAmount(pagination['total']) ?? rows.length,
      page: finiteAmount(pagination['page']) ?? 1,
      limit: finiteAmount(pagination['limit']) ?? rows.length,
      totalPages: finiteAmount(pagination['totalPages'] ?? pagination['total_pages']) ?? 0,
    },
  };
}

@Injectable({
  providedIn: 'root',
})
export class ContractsService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = environment.apiUrl;

  /** FB-07: ficha del contrato. */
  getContractById(id: number): Observable<Contract> {
    return this.http.get<unknown>(`${this.apiUrl}/store/contracts/${id}`).pipe(
      map((r) => mapContractDto(unwrapResponse(r))),
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
    return this.http.get<unknown>(url).pipe(
      map(mapPaginatedContracts),
      catchError((error) => throwError(() => toContractApiError(error))),
    );
  }

  /** Create the administrative contract from an accepted contract quotation. */
  createFromQuotation(id: number): Observable<Contract> {
    return this.http.post<unknown>(`${this.apiUrl}/store/contracts/from-quotation/${id}`, {}).pipe(
      map((r) => mapContractDto(unwrapResponse(r))),
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
    return this.http.patch<unknown>(`${this.apiUrl}/store/contracts/${id}`, dto).pipe(
      map((r) => mapContractDto(unwrapResponse(r))),
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
