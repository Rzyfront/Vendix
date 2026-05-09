import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../../../environments/environment';

export interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
}

export interface PaginatedResponse<T> {
  success: boolean;
  message: string;
  data: T[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages?: number;
    hasNextPage?: boolean;
    hasPreviousPage?: boolean;
  };
}

export interface OrgPurchaseOrderRow {
  id: number;
  po_number?: string;
  status?: string;
  supplier_id?: number | null;
  supplier_name?: string | null;
  store_id?: number | null;
  store_name?: string | null;
  location_id?: number | null;
  location_name?: string | null;
  total?: string | number;
  currency_code?: string;
  expected_date?: string | null;
  created_at?: string;
}

export interface OrgPurchaseOrderLineInput {
  product_id: number;
  variant_id?: number | null;
  quantity: number;
  unit_cost: number;
  description?: string;
}

export interface CreateOrgPurchaseOrderDto {
  supplier_id: number;
  location_id: number;
  expected_date?: string;
  notes?: string;
  currency_code?: string;
  lines: OrgPurchaseOrderLineInput[];
}

export interface ReceivePurchaseOrderItemInput {
  line_id: number;
  received_quantity: number;
}

export interface ReceiveOrgPurchaseOrderDto {
  items: ReceivePurchaseOrderItemInput[];
  notes?: string;
}

export interface OrgPurchaseOrderStats {
  total?: number;
  draft?: number;
  pending?: number;
  approved?: number;
  received?: number;
  cancelled?: number;
  [k: string]: any;
}

/**
 * Organization-scoped purchase orders service.
 *
 * Reads consolidate across stores; writes delegate to the store context
 * resolved from `location_id` on the backend.
 */
@Injectable({ providedIn: 'root' })
export class OrgPurchaseOrdersService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = environment.apiUrl;

  getStats(): Observable<ApiResponse<OrgPurchaseOrderStats>> {
    return this.http.get<ApiResponse<OrgPurchaseOrderStats>>(
      `${this.apiUrl}/organization/purchase-orders/stats`,
    );
  }

  findAll(query?: {
    store_id?: number | string;
    status?: string;
    page?: number;
    limit?: number;
    search?: string;
  }): Observable<PaginatedResponse<OrgPurchaseOrderRow>> {
    return this.http.get<PaginatedResponse<OrgPurchaseOrderRow>>(
      `${this.apiUrl}/organization/purchase-orders`,
      { params: this.toParams(query) },
    );
  }

  findOne(id: number): Observable<ApiResponse<OrgPurchaseOrderRow & { lines?: any[] }>> {
    return this.http.get<ApiResponse<OrgPurchaseOrderRow & { lines?: any[] }>>(
      `${this.apiUrl}/organization/purchase-orders/${id}`,
    );
  }

  create(dto: CreateOrgPurchaseOrderDto): Observable<ApiResponse<OrgPurchaseOrderRow>> {
    return this.http.post<ApiResponse<OrgPurchaseOrderRow>>(
      `${this.apiUrl}/organization/purchase-orders`,
      dto,
    );
  }

  approve(id: number): Observable<ApiResponse<OrgPurchaseOrderRow>> {
    return this.http.patch<ApiResponse<OrgPurchaseOrderRow>>(
      `${this.apiUrl}/organization/purchase-orders/${id}/approve`,
      {},
    );
  }

  cancel(id: number): Observable<ApiResponse<OrgPurchaseOrderRow>> {
    return this.http.patch<ApiResponse<OrgPurchaseOrderRow>>(
      `${this.apiUrl}/organization/purchase-orders/${id}/cancel`,
      {},
    );
  }

  receive(id: number, dto: ReceiveOrgPurchaseOrderDto): Observable<ApiResponse<OrgPurchaseOrderRow>> {
    return this.http.post<ApiResponse<OrgPurchaseOrderRow>>(
      `${this.apiUrl}/organization/purchase-orders/${id}/receive`,
      dto,
    );
  }

  private toParams(query?: Record<string, any>): HttpParams {
    let params = new HttpParams();
    if (!query) return params;
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null && v !== '') {
        params = params.set(k, String(v));
      }
    }
    return params;
  }
}
