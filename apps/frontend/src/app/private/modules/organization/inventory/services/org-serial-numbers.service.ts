import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { environment } from '../../../../../../environments/environment';
import {
  ApiResponse,
  OrgSerialNumberRow,
  OrgSerialNumberStatus,
} from './org-inventory.service';

export interface OrgSerialNumberListQuery {
  store_id?: number | string;
  product_id?: number | string;
  product_variant_id?: number | string;
  location_id?: number | string;
  batch_id?: number | string;
  status?: OrgSerialNumberStatus | string;
  serial_number?: string;
  page?: number;
  limit?: number;
}

/**
 * Read-only org-wide listing of `inventory_serial_numbers`.
 *
 * Backend tenancy is enforced via `products.organization_id`; this service
 * only forwards filters and never performs writes.
 */
@Injectable({ providedIn: 'root' })
export class OrgSerialNumbersService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = environment.apiUrl;

  list(
    query?: OrgSerialNumberListQuery,
  ): Observable<ApiResponse<OrgSerialNumberRow[]>> {
    return this.http.get<ApiResponse<OrgSerialNumberRow[]>>(
      `${this.apiUrl}/organization/inventory/serial-numbers`,
      { params: this.toParams(query) },
    );
  }

  getById(id: number): Observable<ApiResponse<OrgSerialNumberRow>> {
    return this.http.get<ApiResponse<OrgSerialNumberRow>>(
      `${this.apiUrl}/organization/inventory/serial-numbers/${id}`,
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
