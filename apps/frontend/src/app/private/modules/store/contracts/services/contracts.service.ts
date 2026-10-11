import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { catchError, map } from 'rxjs/operators';
import { environment } from '../../../../../../environments/environment';
import { extractApiErrorMessage } from '../../../../../core/utils/api-error-handler';
import { parseApiError } from '../../../../../core/utils/parse-api-error';
import {
  Contract,
  ContractStatus,
  ContractLineView,
  ContractInvoiceRef,
  ContractEconomicLineView,
  ContractEconomicTotalsView,
  ContractProfileView,
  ContractQuotationProfileView,
  ContractTransitionTarget,
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

function readText(record: Record<string, unknown> | null, key: string): string | null {
  return typeof record?.[key] === 'string' ? record[key] as string : null;
}

/** Convert the frozen quote economics for display only; never recompute totals. */
function mapEconomicSnapshot(value: unknown): Contract['economic'] {
  const economic = asRecord(value);
  if (!economic || finiteAmount(economic['schema_version']) !== 1) return null;

  const invoiceProfile = asRecord(economic['invoice_profile']);
  const profileConfig = asRecord(invoiceProfile?.['config']);
  const aiuConfig = asRecord(profileConfig?.['aiu']);
  const componentShares = asRecord(aiuConfig?.['components']);
  const components: Record<string, number | null> | null = componentShares
    ? Object.fromEntries(Object.entries(componentShares).map(([key, share]) => [key, finiteAmount(share)]))
    : null;
  const calculation = asRecord(economic['calculation']);
  const rawTotals = asRecord(calculation?.['totals']);
  const totals: ContractEconomicTotalsView | null = rawTotals ? {
    gross_subtotal: finiteAmount(rawTotals['gross_subtotal']),
    discount_amount: finiteAmount(rawTotals['discount_amount']),
    total_before_tax: finiteAmount(rawTotals['total_before_tax']),
    tax_amount: finiteAmount(rawTotals['tax_amount']),
    tax_iva: finiteAmount(rawTotals['tax_iva']),
    tax_inc: finiteAmount(rawTotals['tax_inc']),
    tax_ica: finiteAmount(rawTotals['tax_ica']),
    tax_other: finiteAmount(rawTotals['tax_other']),
    total_amount: finiteAmount(rawTotals['total_amount']),
  } : null;
  const aiuSummary = asRecord(calculation?.['aiu']);
  const rawComponents = Array.isArray(aiuSummary?.['components']) ? aiuSummary['components'] : [];
  const aiu = aiuSummary ? {
    contract_value: finiteAmount(aiuSummary['contract_value']),
    aiu_value: finiteAmount(aiuSummary['aiu_value']),
    taxable_base: finiteAmount(aiuSummary['taxable_base']),
    minimum_base: finiteAmount(aiuSummary['minimum_base']),
    components: rawComponents.flatMap((value) => {
      const component = asRecord(value);
      if (!component) return [];
      const name = readText(component, 'component') ?? readText(component, 'bucket');
      return name ? [{ component: name, amount: finiteAmount(component['amount'] ?? component['value']) }] : [];
    }),
  } : null;
  const rawInvoiceLines = Array.isArray(economic['invoice_lines']) ? economic['invoice_lines'] : [];
  const calculationLines = Array.isArray(calculation?.['lines']) ? calculation['lines'] : [];
  const invoiceLines: ContractEconomicLineView[] = rawInvoiceLines.flatMap((value, index) => {
    const line = asRecord(value);
    if (!line) return [];
    const calculated = asRecord(calculationLines[index]);
    const rawTaxes = Array.isArray(calculated?.['taxes']) ? calculated['taxes'] : [];
    const taxes = rawTaxes.flatMap((value) => {
      const tax = asRecord(value);
      const name = readText(tax, 'tax_name');
      return tax && name ? [{
        tax_name: name,
        tax_type: readText(tax, 'tax_type'),
        tax_rate: finiteAmount(tax['tax_rate']),
        rate_basis: readText(tax, 'rate_basis'),
        tax_amount: finiteAmount(tax['tax_amount']),
      }] : [];
    });
    return [{
      description: readText(line, 'description') ?? 'Línea económica sin descripción',
      bucket: readText(line, 'bucket') ?? readText(line, 'aiu_component'),
      quantity: finiteAmount(line['quantity']),
      unit_price: finiteAmount(line['unit_price']),
      discount_amount: finiteAmount(line['discount_amount']),
      base_amount: finiteAmount(calculated?.['line_extension_amount']),
      tax_amount: finiteAmount(calculated?.['tax_amount']),
      total_amount: finiteAmount(calculated?.['total_amount']),
      taxes,
    }];
  });
  const quoteProfile = asRecord(economic['quotation_profile']);
  const quotationProfile: ContractQuotationProfileView | null = quoteProfile ? {
    profile_id: finiteAmount(quoteProfile['profile_id']),
    version: finiteAmount(quoteProfile['version']),
    config: asRecord(quoteProfile['config']),
  } : null;
  const profile: ContractProfileView | null = invoiceProfile ? {
    profile_id: finiteAmount(invoiceProfile['profile_id']),
    version: finiteAmount(invoiceProfile['version']),
    name: readText(invoiceProfile, 'name'),
    config: profileConfig,
    // Absence stays visible; never call profile normalizers/default resolvers here.
    taxable_basis: readText(aiuConfig, 'taxable_basis') ?? readText(aiuConfig, 'regime'),
    components_basis: readText(aiuConfig, 'components_basis'),
    accounting_model: readText(aiuConfig, 'accounting_model'),
    components,
  } : null;

  return {
    schema_version: 1,
    contract_object: readText(economic, 'contract_object'),
    direct_cost: finiteAmount(economic['direct_cost']),
    contract_value: finiteAmount(economic['contract_value']),
    aiu_value: finiteAmount(economic['aiu_value']),
    invoice_profile: profile,
    quotation_profile: quotationProfile,
    invoice_lines: invoiceLines,
    totals,
    aiu,
  };
}

function mapContractDto(value: unknown): Contract {
  const dto = asRecord(value);
  if (!dto) throw new Error('Respuesta de contrato inválida.');
  const rawSnapshot = asRecord(dto['snapshot']);
  const snapshot = isContractSnapshot(rawSnapshot) ? rawSnapshot : null;
  const quotation = asRecord(rawSnapshot?.['quotation']);
  const quotationProfileData = asRecord(rawSnapshot?.['profile']);
  const economic = mapEconomicSnapshot(asRecord(rawSnapshot?.['economic']));
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
  const profileId = finiteAmount(dto['profile_id'] ?? quotationProfileData?.['profile_id']);
  const profileVersion = finiteAmount(dto['profile_version'] ?? quotationProfileData?.['version']);
  const quotationProfile: ContractQuotationProfileView | null = quotationProfileData
    ? {
        profile_id: finiteAmount(quotationProfileData['profile_id']),
        version: finiteAmount(quotationProfileData['version']),
        config: asRecord(quotationProfileData['config']),
      }
    : economic?.quotation_profile ?? null;
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
  const administrativeStatusValue = dto['administrative_status'];
  const administrativeStatus: ContractStatus | null = typeof administrativeStatusValue === 'string' &&
    ['draft', 'active', 'invoiced', 'cancelled'].includes(administrativeStatusValue)
      ? administrativeStatusValue as ContractStatus
      : null;
  const readText = (record: Record<string, unknown> | null, key: string): string | null =>
    typeof record?.[key] === 'string' ? record[key] as string : null;
  const totals = economic?.totals;
  const profileComponents = economic?.invoice_profile?.components;

  return {
    snapshot,
    // The contractual object must be an explicit field, never notes/profile notes.
    id,
    store_id: storeId,
    contract_number: contractNumber,
    status,
    quotation_id: quotationId,
    contract_object: economic?.contract_object ?? null,
    // Keep explicit top-level legacy display values for historical rows only;
    // quotation-profile config is never a fiscal source and frozen economics win.
    administration_percentage: economic
      ? profileComponents?.['administracion'] ?? null
      : finiteAmount(dto['administration_percentage']),
    contingency_percentage: economic
      ? profileComponents?.['imprevistos'] ?? null
      : finiteAmount(dto['contingency_percentage']),
    profit_percentage: economic
      ? profileComponents?.['utilidad'] ?? null
      : finiteAmount(dto['profit_percentage']),
    subtotal_amount: economic ? totals?.gross_subtotal ?? null : pickAmount(quotation?.['subtotal_amount'], dto['subtotal_amount']),
    discount_amount: economic ? totals?.discount_amount ?? null : pickAmount(quotation?.['discount_amount'], dto['discount_amount']),
    tax_amount: economic ? totals?.tax_amount ?? null : pickAmount(quotation?.['tax_amount'], dto['tax_amount']),
    grand_total: economic ? totals?.total_amount ?? null : pickAmount(quotation?.['grand_total'], dto['grand_total']),
    notes: rawSnapshot ? readText(quotation, 'notes') : readText(dto, 'notes'),
    terms_and_conditions: rawSnapshot ? readText(quotation, 'terms_and_conditions') : readText(dto, 'terms_and_conditions'),
    valid_until: rawSnapshot ? readText(quotation, 'valid_until') : readText(dto, 'valid_until'),
    items,
    economic,
    profile: economic?.invoice_profile ?? null,
    quotation_profile: quotationProfile,
    profile_id: profileId,
    profile_version: profileVersion,
    administrative_status: administrativeStatus,
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
   * P1.4 + ERR-06: transición administrativa. `invoiced` deriva de aceptación
   * fiscal y nunca se envía mediante PATCH. Una transición inválida responde 422
   * `CONTRACT_STATUS_001` y el error conserva el codigo para pintarlo.
   */
  transitionContractStatus(id: number, status: ContractTransitionTarget): Observable<Contract> {
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
