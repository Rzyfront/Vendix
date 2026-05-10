import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../../../environments/environment';

export interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
  meta?: {
    total?: number;
    page?: number;
    limit?: number;
    totalPages?: number;
    pagination?: {
      total: number;
      page: number;
      limit: number;
      totalPages: number;
    };
  };
}

export interface OrgStockLevelRow {
  id: number;
  product_id?: number;
  product_name?: string;
  variant_id?: number | null;
  variant_name?: string | null;
  location_id?: number;
  location_name?: string | null;
  store_id?: number | null;
  store_name?: string | null;
  quantity?: number | string;
  reserved_quantity?: number | string;
  available_quantity?: number | string;
  min_stock_threshold?: number | string | null;
}

export type OrgLocationType = 'warehouse' | 'store' | 'virtual' | 'transit';

export interface OrgLocationRow {
  id: number;
  name: string;
  code?: string;
  type?: OrgLocationType;
  store_id?: number | null;
  store_name?: string | null;
  is_active?: boolean;
  is_default?: boolean;
  is_central_warehouse?: boolean;
  address_id?: number | null;
}

export interface CreateOrgLocationRequest {
  name: string;
  code: string;
  type?: OrgLocationType;
  is_active?: boolean;
  is_default?: boolean;
  is_central_warehouse?: boolean;
  store_id?: number | null;
  address_id?: number | null;
}

export type UpdateOrgLocationRequest = Partial<CreateOrgLocationRequest>;

export interface OrgMovementRow {
  id: number;
  created_at?: string;
  movement_type?: string;
  quantity?: number | string;
  product_id?: number;
  product_name?: string;
  location_id?: number | null;
  location_name?: string | null;
  store_id?: number | null;
  store_name?: string | null;
  reference?: string | null;
  notes?: string | null;
  user_id?: number | null;
  user_name?: string | null;
}

export interface OrgSupplierRow {
  id: number;
  name: string;
  code?: string;
  contact_person?: string | null;
  document_number?: string | null;
  tax_id?: string | null;
  email?: string | null;
  phone?: string | null;
  mobile?: string | null;
  website?: string | null;
  payment_terms?: string | null;
  currency?: string | null;
  lead_time_days?: number | null;
  notes?: string | null;
  is_active?: boolean;
  store_id?: number | null;
  store_name?: string | null;
}

export interface CreateOrgSupplierRequest {
  name: string;
  code: string;
  store_id?: number | null;
  contact_person?: string;
  email?: string;
  phone?: string;
  mobile?: string;
  website?: string;
  tax_id?: string;
  tax_regime?: string;
  document_type?: string;
  verification_digit?: string;
  payment_terms?: string;
  currency?: string;
  lead_time_days?: number;
  notes?: string;
  address_id?: number;
  is_active?: boolean;
}

export type UpdateOrgSupplierRequest = Partial<CreateOrgSupplierRequest>;

export type OrgSerialNumberStatus =
  | 'in_stock'
  | 'reserved'
  | 'sold'
  | 'returned'
  | 'damaged'
  | 'expired'
  | 'in_transit';

export interface OrgSerialNumberRow {
  id: number;
  serial_number: string;
  status?: OrgSerialNumberStatus | string;
  product_id?: number;
  product_name?: string | null;
  product_sku?: string | null;
  variant_id?: number | null;
  variant_name?: string | null;
  variant_sku?: string | null;
  location_id?: number | null;
  location_name?: string | null;
  store_id?: number | null;
  store_name?: string | null;
  batch_id?: number | null;
  batch_number?: string | null;
  batch_expiration_date?: string | null;
  /** Decimal monetary value serialised as string (use Vendix CurrencyPipe). */
  cost?: string | null;
  sold_date?: string | null;
  warranty_expiry?: string | null;
  notes?: string | null;
  created_at?: string | null;
}

export interface OrgTransferRow {
  id: number;
  transfer_number?: string;
  status?: string;
  origin_location_id?: number | null;
  origin_location_name?: string | null;
  destination_location_id?: number | null;
  destination_location_name?: string | null;
  origin_store_id?: number | null;
  destination_store_id?: number | null;
  origin_store_name?: string | null;
  destination_store_name?: string | null;
  created_at?: string;
}

/**
 * Organization-scoped consolidated inventory service.
 *
 * Read endpoints consolidate listings across all stores in the organization
 * (with optional `store_id` breakdown). Write endpoints (locations + suppliers)
 * call the org-level CRUD routes added in P2.1/P2.2 and require the
 * `organization:inventory:{locations|suppliers}:{create|update|delete}`
 * permissions.
 *
 * No shareReplay caches are used here — each call hits the network and the
 * caller (page components) drives reload after mutations.
 */
@Injectable({ providedIn: 'root' })
export class OrgInventoryService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = environment.apiUrl;

  // ─── Stock levels ────────────────────────────────────────────────────────
  getStockLevels(query?: {
    store_id?: number | string;
    location_id?: number | string;
    search?: string;
    limit?: number;
    page?: number;
  }): Observable<ApiResponse<OrgStockLevelRow[]>> {
    return this.http.get<ApiResponse<OrgStockLevelRow[]>>(
      `${this.apiUrl}/organization/inventory/stock-levels`,
      { params: this.toParams(query) },
    );
  }

  // ─── Locations: read ────────────────────────────────────────────────────
  getLocations(query?: {
    store_id?: number | string;
    type?: OrgLocationType;
    is_active?: boolean | string;
    page?: number;
    limit?: number;
    search?: string;
  }): Observable<ApiResponse<OrgLocationRow[]>> {
    return this.http.get<ApiResponse<OrgLocationRow[]>>(
      `${this.apiUrl}/organization/inventory/locations`,
      { params: this.toParams(query) },
    );
  }

  getLocation(id: number): Observable<ApiResponse<OrgLocationRow>> {
    return this.http.get<ApiResponse<OrgLocationRow>>(
      `${this.apiUrl}/organization/inventory/locations/${id}`,
    );
  }

  // ─── Locations: write ───────────────────────────────────────────────────
  createLocation(dto: CreateOrgLocationRequest): Observable<ApiResponse<OrgLocationRow>> {
    return this.http.post<ApiResponse<OrgLocationRow>>(
      `${this.apiUrl}/organization/inventory/locations`,
      dto,
    );
  }

  updateLocation(
    id: number,
    dto: UpdateOrgLocationRequest,
  ): Observable<ApiResponse<OrgLocationRow>> {
    return this.http.patch<ApiResponse<OrgLocationRow>>(
      `${this.apiUrl}/organization/inventory/locations/${id}`,
      dto,
    );
  }

  deleteLocation(id: number): Observable<ApiResponse<void>> {
    return this.http.delete<ApiResponse<void>>(
      `${this.apiUrl}/organization/inventory/locations/${id}`,
    );
  }

  ensureCentralWarehouse(): Observable<ApiResponse<OrgLocationRow>> {
    return this.http.post<ApiResponse<OrgLocationRow>>(
      `${this.apiUrl}/organization/inventory/locations/central-warehouse/ensure`,
      {},
    );
  }

  // ─── Movements ──────────────────────────────────────────────────────────
  getMovements(query?: { store_id?: number | string; product_id?: number | string }): Observable<ApiResponse<OrgMovementRow[]>> {
    return this.http.get<ApiResponse<OrgMovementRow[]>>(
      `${this.apiUrl}/organization/inventory/movements`,
      { params: this.toParams(query) },
    );
  }

  // ─── Suppliers: read ────────────────────────────────────────────────────
  getSuppliers(query?: {
    store_id?: number | string;
    search?: string;
    is_active?: boolean | string;
    page?: number;
    limit?: number;
  }): Observable<ApiResponse<OrgSupplierRow[]>> {
    return this.http.get<ApiResponse<OrgSupplierRow[]>>(
      `${this.apiUrl}/organization/inventory/suppliers`,
      { params: this.toParams(query) },
    );
  }

  getSupplier(id: number): Observable<ApiResponse<OrgSupplierRow>> {
    return this.http.get<ApiResponse<OrgSupplierRow>>(
      `${this.apiUrl}/organization/inventory/suppliers/${id}`,
    );
  }

  // ─── Suppliers: write ───────────────────────────────────────────────────
  createSupplier(dto: CreateOrgSupplierRequest): Observable<ApiResponse<OrgSupplierRow>> {
    return this.http.post<ApiResponse<OrgSupplierRow>>(
      `${this.apiUrl}/organization/inventory/suppliers`,
      dto,
    );
  }

  updateSupplier(
    id: number,
    dto: UpdateOrgSupplierRequest,
  ): Observable<ApiResponse<OrgSupplierRow>> {
    return this.http.patch<ApiResponse<OrgSupplierRow>>(
      `${this.apiUrl}/organization/inventory/suppliers/${id}`,
      dto,
    );
  }

  deleteSupplier(id: number): Observable<ApiResponse<void>> {
    return this.http.delete<ApiResponse<void>>(
      `${this.apiUrl}/organization/inventory/suppliers/${id}`,
    );
  }

  // ─── Transfers ──────────────────────────────────────────────────────────
  getTransfers(query?: { store_id?: number | string; status?: string }): Observable<ApiResponse<OrgTransferRow[]>> {
    return this.http.get<ApiResponse<OrgTransferRow[]>>(
      `${this.apiUrl}/organization/inventory/transfers`,
      { params: this.toParams(query) },
    );
  }

  // ─── Helpers ────────────────────────────────────────────────────────────
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
