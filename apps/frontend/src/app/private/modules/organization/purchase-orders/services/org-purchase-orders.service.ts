import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, map, switchMap, throwError } from 'rxjs';
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

export interface OrgPurchaseOrderLine {
  id: number;
  product_id: number;
  product_name?: string | null;
  sku?: string | null;
  variant_id?: number | null;
  variant_name?: string | null;
  variant_sku?: string | null;
  quantity: number;
  quantity_received?: number;
  unit_cost: number | string;
  total_cost?: number | string | null;
  notes?: string | null;
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
  lines?: OrgPurchaseOrderLine[];
}

/**
 * Single PO item payload. Field names match the backend DTO
 * (`CreateOrgPurchaseOrderItemDto`) — global ValidationPipe runs in
 * `whitelist: true` mode, so any rename here would be silently stripped.
 *
 * Prebulk: when `product_id === 0` and `product_name` is set, the backend
 * autocreates the product before linking.
 */
export interface OrgPurchaseOrderItemInput {
  product_id: number;
  product_variant_id?: number | null;
  quantity: number;
  unit_price: number;
  discount_percentage?: number;
  tax_rate?: number;
  notes?: string;

  // Prebulk (temporary product not in catalog yet)
  product_name?: string;
  sku?: string;
  product_description?: string;
  base_price?: number;
}

export interface CreateOrgPurchaseOrderDto {
  supplier_id: number;
  destination_location_id: number;
  expected_date?: string;
  notes?: string;
  items: OrgPurchaseOrderItemInput[];
}

/**
 * `id` = purchase_order_items.id (the line). `quantity_received` is the
 * delta to add. Field names mirror the backend DTO so ValidationPipe in
 * `whitelist` mode keeps them.
 */
export interface ReceivePurchaseOrderItemInput {
  id: number;
  quantity_received: number;
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
    return this.http
      .get<PaginatedResponse<any>>(
        `${this.apiUrl}/organization/purchase-orders`,
        { params: this.toParams(query) },
      )
      .pipe(
        map((res) => ({
          ...res,
          data: (res?.data ?? []).map((row) => this.normalizeRow(row)),
        })),
      );
  }

  findOne(id: number): Observable<ApiResponse<OrgPurchaseOrderRow>> {
    return this.http
      .get<ApiResponse<any>>(
        `${this.apiUrl}/organization/purchase-orders/${id}`,
      )
      .pipe(
        map((res) => ({
          ...res,
          data: this.normalizeRow(res?.data ?? {}),
        })),
      );
  }

  /**
   * Normaliza la respuesta cruda de Prisma (relaciones anidadas + nombres
   * raw como `order_number` / `total_amount`) al shape plano que consumen
   * los componentes de listado/detalle. Mantener este mapeo en un único
   * lugar evita filtraciones de la forma del backend en el árbol de UI.
   */
  private normalizeRow(raw: any): OrgPurchaseOrderRow {
    if (!raw || typeof raw !== 'object') {
      return { id: 0 };
    }
    const items = Array.isArray(raw.purchase_order_items)
      ? raw.purchase_order_items
      : [];
    const lines: OrgPurchaseOrderLine[] = items.map((it: any) => ({
      id: it.id,
      product_id: it.product_id,
      product_name: it.products?.name ?? null,
      sku: it.products?.sku ?? null,
      variant_id: it.product_variant_id ?? null,
      variant_name: it.product_variants?.name ?? null,
      variant_sku: it.product_variants?.sku ?? null,
      quantity: Number(it.quantity_ordered ?? 0),
      quantity_received: Number(it.quantity_received ?? 0),
      unit_cost: it.unit_cost,
      total_cost: it.total_cost ?? null,
      notes: it.notes ?? null,
    }));

    return {
      id: raw.id,
      po_number: raw.order_number ?? raw.po_number ?? undefined,
      status: raw.status,
      supplier_id: raw.supplier_id ?? null,
      supplier_name: raw.suppliers?.name ?? raw.supplier_name ?? null,
      location_id: raw.location_id ?? null,
      location_name: raw.location?.name ?? raw.location_name ?? null,
      store_id: raw.location?.store_id ?? raw.store_id ?? null,
      store_name:
        raw.location?.stores?.name ?? raw.store_name ?? null,
      total: raw.total_amount ?? raw.total ?? 0,
      currency_code: raw.currency_code,
      expected_date: raw.expected_date ?? null,
      created_at: raw.created_at,
      lines,
    };
  }

  create(dto: CreateOrgPurchaseOrderDto): Observable<ApiResponse<OrgPurchaseOrderRow>> {
    return this.http
      .post<ApiResponse<any>>(
        `${this.apiUrl}/organization/purchase-orders`,
        dto,
      )
      .pipe(map((res) => this.normalizeResponse(res)));
  }

  approve(id: number): Observable<ApiResponse<OrgPurchaseOrderRow>> {
    return this.http
      .patch<ApiResponse<any>>(
        `${this.apiUrl}/organization/purchase-orders/${id}/approve`,
        {},
      )
      .pipe(map((res) => this.normalizeResponse(res)));
  }

  cancel(id: number): Observable<ApiResponse<OrgPurchaseOrderRow>> {
    return this.http
      .patch<ApiResponse<any>>(
        `${this.apiUrl}/organization/purchase-orders/${id}/cancel`,
        {},
      )
      .pipe(map((res) => this.normalizeResponse(res)));
  }

  receive(id: number, dto: ReceiveOrgPurchaseOrderDto): Observable<ApiResponse<OrgPurchaseOrderRow>> {
    return this.http
      .post<ApiResponse<any>>(
        `${this.apiUrl}/organization/purchase-orders/${id}/receive`,
        dto,
      )
      .pipe(map((res) => this.normalizeResponse(res)));
  }

  createApproveAndReceive(
    dto: CreateOrgPurchaseOrderDto,
    receiveNotes?: string,
  ): Observable<ApiResponse<OrgPurchaseOrderRow>> {
    return this.create(dto).pipe(
      switchMap((createdResponse) => {
        const created = createdResponse?.data;
        if (!created?.id) {
          return throwError(
            () => new Error('No se pudo identificar la orden creada.'),
          );
        }

        const items = this.buildFullReceptionItems(created);
        if (items.length === 0) {
          return throwError(
            () => new Error('La orden creada no tiene líneas para recibir.'),
          );
        }

        return this.approve(created.id).pipe(
          switchMap(() =>
            this.receive(created.id, {
              items,
              ...(receiveNotes ? { notes: receiveNotes } : {}),
            }),
          ),
        );
      }),
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

  private normalizeResponse(res: ApiResponse<any>): ApiResponse<OrgPurchaseOrderRow> {
    return {
      ...res,
      data: this.normalizeRow(res?.data ?? {}),
    };
  }

  private buildFullReceptionItems(
    po: OrgPurchaseOrderRow,
  ): ReceivePurchaseOrderItemInput[] {
    return (po.lines ?? [])
      .map((line) => {
        const quantity = Number(line.quantity ?? 0);
        const received = Number(line.quantity_received ?? 0);
        return {
          id: line.id,
          quantity_received: Math.max(0, quantity - received),
        };
      })
      .filter((item) => item.id > 0 && item.quantity_received > 0);
  }
}
