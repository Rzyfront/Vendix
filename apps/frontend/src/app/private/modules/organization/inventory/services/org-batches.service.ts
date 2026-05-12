import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';

import { environment } from '../../../../../../environments/environment';
import { ApiResponse } from './org-inventory.service';

export interface OrgBatchRow {
  id: number;
  batch_number: string;
  quantity: number;
  quantity_used: number;
  available_quantity: number;
  manufacturing_date: string | null;
  expiration_date: string | null;
  created_at: string | null;
  updated_at: string | null;
  product_id: number;
  product_name: string | null;
  product_sku: string | null;
  product_variant_id: number | null;
  variant_name: string | null;
  variant_sku: string | null;
  location_id: number | null;
  location_name: string | null;
  store_id: number | null;
  store_name: string | null;
  serial_numbers_count: number;
}

export interface OrgBatchesQuery {
  store_id?: number | string;
  product_id?: number | string;
  location_id?: number | string;
  batch_number?: string;
  expires_before?: string;
  expires_after?: string;
  has_stock?: boolean | string;
  page?: number;
  limit?: number;
}

/**
 * Read-only org-wide consolidated view of inventory_batches.
 *
 * Tenancy is enforced server-side via products.organization_id; the optional
 * `store_id` filter performs a per-store breakdown for ORG-scope orgs.
 */
@Injectable({ providedIn: 'root' })
export class OrgBatchesService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = environment.apiUrl;

  list(query?: OrgBatchesQuery): Observable<ApiResponse<OrgBatchRow[]>> {
    return this.http.get<ApiResponse<OrgBatchRow[]>>(
      `${this.apiUrl}/organization/inventory/batches`,
      { params: this.toParams(query) },
    );
  }

  getById(id: number): Observable<ApiResponse<OrgBatchRow>> {
    return this.http.get<ApiResponse<OrgBatchRow>>(
      `${this.apiUrl}/organization/inventory/batches/${id}`,
    );
  }

  getExpiringSoon(query?: OrgBatchesQuery): Observable<ApiResponse<OrgBatchRow[]>> {
    return this.http.get<ApiResponse<OrgBatchRow[]>>(
      `${this.apiUrl}/organization/inventory/batches/expiring-soon`,
      { params: this.toParams(query) },
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
