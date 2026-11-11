import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, catchError, throwError, map, of } from 'rxjs';
import { tap, shareReplay } from 'rxjs/operators';
import { environment } from '../../../../../../environments/environment';
import {
    Customer,
    CustomerAddress,
    AddCustomerLocationResult,
    CreateCustomerRequest,
    UpdateCustomerRequest,
    CustomerStats,
    CustomerFilters,
    ExternalCustomerLookupResult,
    PersonType,
    TaxRegime,
} from '../models/customer.model';

/**
 * Payload para `POST /store/addresses` (alta de dirección de envío de un
 * cliente). Usa los nombres del DTO del backend (`address_line_1`, `state`,
 * `country` con guion bajo y nombres cortos), que el service backend mapea
 * a las columnas `address_line1`/`state_province`/`country_code`.
 */
export interface CustomerAddressPayload {
    address_line_1: string;
    address_line_2?: string;
    city: string;
    state: string;
    country: string;
    postal_code?: string;
    type?: 'shipping' | 'billing' | 'headquarters' | 'branch_office' | 'warehouse' | 'legal' | 'store_physical';
    is_primary?: boolean;
    customer_id?: number;
    latitude?: string;
    longitude?: string;
    /**
     * Código DANE (Divipola) del municipio → `addresses.municipality_code`.
     * Es lo que la facturación electrónica lee para `customer_address.city_code`;
     * sin él el validador fiscal bloquea la emisión con `CITY_CODE_REQUIRED`.
     */
    municipality_code?: string;
    /** Nombre de la sede / establecimiento. */
    label?: string;
    phone_number?: string;
}

/** Payload de `POST /store/customers/:id/locations`. */
export type CustomerLocationPayload = Omit<
    CustomerAddressPayload,
    'type' | 'customer_id' | 'state'
> & { state?: string };

/** Estructural: evita importar el componente compartido en el servicio. */
interface LocationAddressInput {
    address_line1: string | null;
    address_line2: string | null;
    city: string | null;
    state_province: string | null;
    country_code: string | null;
    postal_code: string | null;
    phone_number: string | null;
    latitude: number | null;
    longitude: number | null;
    municipality_code?: string | null;
}

/** Mapea el payload del formulario de dirección al DTO de ubicación del backend. */
export function addressToLocationPayload(
    addr: LocationAddressInput,
    label?: string,
): CustomerLocationPayload {
    return {
        address_line_1: addr.address_line1 ?? '',
        address_line_2: addr.address_line2 || undefined,
        city: addr.city ?? '',
        state: addr.state_province ?? '',
        country: addr.country_code ?? '',
        postal_code: addr.postal_code || undefined,
        municipality_code: addr.municipality_code || undefined,
        phone_number: addr.phone_number || undefined,
        latitude: addr.latitude != null ? String(addr.latitude) : undefined,
        longitude: addr.longitude != null ? String(addr.longitude) : undefined,
        label: label?.trim() || undefined,
    };
}

export interface PaginatedResponse<T> {
    data: T[];
    meta: {
        total: number;
        page: number;
        limit: number;
        totalPages: number;
    };
}

/**
 * Payload de `POST /store/customers/resolve` (espejo permisivo de
 * `ResolveCustomerDto`: sin validación cruzada de formato de documento —
 * el lookup normaliza antes de comparar). Todos opcionales; el servicio
 * exige al menos email o documento.
 */
export interface ResolveCustomerRequest {
    email?: string | null;
    first_name?: string | null;
    last_name?: string | null;
    legal_name?: string | null;
    phone?: string | null;
    document_type?: string | null;
    document_number?: string | null;
    verification_digit?: string | null;
    tax_regime?: TaxRegime | null;
    person_type?: PersonType | null;
    fiscal_responsibilities?: string[];
    ciiu_code?: string | null;
    is_withholding_agent?: boolean;
}

/** Respuesta desempaquetada de `POST /store/customers/resolve`. */
export interface ResolveCustomerResult {
    customer: Customer;
    was_created: boolean;
    was_updated: boolean;
    matched_by: 'email' | 'document' | 'name' | null;
    document_conflict: boolean;
}

// Caché estático global (persiste entre instancias del servicio)
interface CacheEntry<T> {
  observable: T;
  lastFetch: number;
}

const storeCustomersStatsCache = new Map<number, CacheEntry<Observable<CustomerStats>>>();

@Injectable({
    providedIn: 'root',
})
export class CustomersService {
    private apiUrl = `${environment.apiUrl}/store/customers`;
    private readonly CACHE_TTL = 30000; // 30 segundos

    constructor(private http: HttpClient) { }

    getStats(storeId: number): Observable<CustomerStats> {
        const now = Date.now();
        const cached = storeCustomersStatsCache.get(storeId);

        if (cached && (now - cached.lastFetch) < this.CACHE_TTL) {
            return cached.observable;
        }

        const observable$ = this.http.get<any>(`${this.apiUrl}/stats/store/${storeId}`).pipe(
            shareReplay({ bufferSize: 1, refCount: false }),
            map((response: any) => response.data || response),
            tap(() => {
                const entry = storeCustomersStatsCache.get(storeId);
                if (entry) {
                    entry.lastFetch = Date.now();
                }
            }),
            catchError((error) => {
                console.error('Error fetching customer stats:', error);
                return throwError(() => error);
            }),
        );

        storeCustomersStatsCache.set(storeId, {
            observable: observable$,
            lastFetch: now,
        });

        return observable$;
    }

    getCustomers(
        page: number = 1,
        limit: number = 10,
        filters?: CustomerFilters
    ): Observable<PaginatedResponse<Customer>> {
        let params = new HttpParams()
            .set('page', page.toString())
            .set('limit', limit.toString());

        if (filters?.search) {
            params = params.set('search', filters.search);
        }

        // Example fitlers
        // if (filters?.state) {
        //   params = params.set('state', filters.state);
        // }

        return this.http.get<PaginatedResponse<Customer>>(this.apiUrl, { params });
    }

    getCustomer(id: number): Observable<Customer> {
        return this.http.get<Customer>(`${this.apiUrl}/${id}`);
    }

    /**
     * Tarifa preferencial del cliente (`GET /store/customers/:id/price-tier`).
     * `null` sin tarifa o si la lectura falla: el aviso no debe romper el flujo.
     */
    getCustomerPriceTier(id: number): Observable<{ id: number; name: string } | null> {
        return this.http.get<any>(`${this.apiUrl}/${id}/price-tier`).pipe(
            map((response) => {
                const tier = (response?.data ?? response)?.price_tier;
                return tier?.id ? { id: Number(tier.id), name: String(tier.name) } : null;
            }),
            catchError(() => of(null)),
        );
    }

    /**
     * Paso 5 — `GET /store/customers/lookup?document_number=&document_type=`.
     * Busca el titular en la organización (el backend lo vincula al store si
     * falta el link). `null` = sin coincidencia. Los errores resuelven a
     * `null` para que el llamador caiga al `resolve` (mismo patrón que
     * `PosCustomerService.lookupByDocument`).
     */
    lookupByDocument(documentNumber: string, documentType?: string): Observable<Customer | null> {
        let params = new HttpParams().set('document_number', documentNumber);
        if (documentType) {
            params = params.set('document_type', documentType);
        }

        return this.http.get<any>(`${this.apiUrl}/lookup`, { params }).pipe(
            map((response) => {
                const data = response?.data;
                if (!data) return null;
                return (data.customer ?? null) as Customer | null;
            }),
            catchError(() => of(null)),
        );
    }

    /**
     * `GET /store/customers/lookup/external?document_number=` — consulta RUES
     * en vivo. Nunca lanza: cualquier error (400/429/red) se traduce a
     * `{ found:false, unavailable:true }`.
     */
    lookupExternalByDocument(documentNumber: string): Observable<ExternalCustomerLookupResult> {
        const params = new HttpParams().set('document_number', documentNumber);
        return this.http.get<any>(`${this.apiUrl}/lookup/external`, { params }).pipe(
            map((response): ExternalCustomerLookupResult => {
                const data = response?.data;
                if (!data || typeof data.found !== 'boolean') {
                    return { found: false, unavailable: true };
                }
                return data as ExternalCustomerLookupResult;
            }),
            catchError(() => of<ExternalCustomerLookupResult>({ found: false, unavailable: true })),
        );
    }

    /**
     * Paso 5 — `POST /store/customers/resolve`: encuentra (por email o
     * documento, con update parcial de campos vacíos) o crea al cliente.
     * Desempaqueta el envelope de `ResponseService`. Los errores propagan
     * para que el llamador muestre el toast y conserve el modal abierto.
     */
    resolveCustomer(request: ResolveCustomerRequest): Observable<ResolveCustomerResult> {
        return this.http.post<any>(`${this.apiUrl}/resolve`, request).pipe(
            map((response) => {
                const payload = response?.data ?? response;
                return {
                    customer: payload.customer as Customer,
                    was_created: !!payload.was_created,
                    was_updated: !!payload.was_updated,
                    matched_by: (payload.matched_by ?? null) as ResolveCustomerResult['matched_by'],
                    document_conflict: !!payload.document_conflict,
                };
            }),
        );
    }

    createCustomer(data: CreateCustomerRequest): Observable<Customer> {
        return this.http.post<Customer>(this.apiUrl, data);
    }

    updateCustomer(id: number, data: UpdateCustomerRequest): Observable<Customer> {
        return this.http.patch<Customer>(`${this.apiUrl}/${id}`, data);
    }

    deleteCustomer(id: number): Observable<void> {
        return this.http.delete<void>(`${this.apiUrl}/${id}`);
    }

    /**
     * Invalida el caché de estadísticas
     * Útil después de crear/editar/eliminar clientes
     * @param storeId - ID de la tienda. Si no se proporciona, se limpia todo el caché
     */
    invalidateCache(storeId?: number): void {
        if (storeId) {
            storeCustomersStatsCache.delete(storeId);
        } else {
            storeCustomersStatsCache.clear();
        }
    }

    /**
     * Descarga la plantilla de carga masiva de clientes
     */
    getBulkUploadTemplate(): Observable<Blob> {
        return this.http.get(`${this.apiUrl}/bulk/template/download`, {
            responseType: 'blob',
        });
    }

    /**
     * Sube clientes en formato JSON para carga masiva
     */
    uploadBulkCustomersJson(customers: any[]): Observable<any> {
        return this.http.post(`${this.apiUrl}/bulk/upload`, { customers });
    }

    // ── Direcciones de envío del cliente ──────────────────────

    /**
     * POST /store/addresses
     * Crea una dirección de envío y la vincula al cliente vía `customer_id`.
     * Devuelve la dirección creada (incluye `id`).
     */
    createCustomerAddress(
        payload: CustomerAddressPayload,
    ): Observable<{ id: number } & Record<string, unknown>> {
        const url = `${environment.apiUrl}/store/addresses`;
        return this.http.post<any>(url, payload).pipe(
            map((r) => r.data || r),
            catchError((error) => {
                console.error('Error creating customer address:', error);
                return throwError(() => error);
            }),
        );
    }

    /**
     * PATCH /store/addresses/:id
     * Actualiza una dirección de envío existente.
     */
    updateCustomerAddress(
        addressId: number,
        payload: Partial<CustomerAddressPayload>,
    ): Observable<{ id: number } & Record<string, unknown>> {
        const url = `${environment.apiUrl}/store/addresses/${addressId}`;
        return this.http.patch<any>(url, payload).pipe(
            map((r) => r.data || r),
            catchError((error) => {
                console.error('Error updating customer address:', error);
                return throwError(() => error);
            }),
        );
    }
    // ── Ubicaciones (sedes) del cliente ───────────────────────

    /** GET /store/addresses?customer_id=&type=shipping — ubicaciones del cliente. */
    listCustomerLocations(customerId: number): Observable<CustomerAddress[]> {
        const params = new HttpParams()
            .set('customer_id', String(customerId))
            .set('type', 'shipping')
            .set('limit', '100');
        return this.http
            .get<any>(`${environment.apiUrl}/store/addresses`, { params })
            .pipe(map((r) => (r?.data ?? r) as CustomerAddress[]));
    }

    /**
     * POST /store/customers/:id/locations — agrega una ubicación; no duplica
     * una dirección idéntica (`created: false`).
     */
    addCustomerLocation(
        customerId: number,
        payload: CustomerLocationPayload,
    ): Observable<AddCustomerLocationResult> {
        return this.http
            .post<any>(`${this.apiUrl}/${customerId}/locations`, payload)
            .pipe(map((r) => (r?.data ?? r) as AddCustomerLocationResult));
    }

    /** PATCH /store/addresses/:id — edita la ubicación (o la marca principal). */
    updateCustomerLocation(
        addressId: number,
        payload: Partial<CustomerAddressPayload>,
    ): Observable<CustomerAddress> {
        return this.http
            .patch<any>(`${environment.apiUrl}/store/addresses/${addressId}`, payload)
            .pipe(map((r) => (r?.data ?? r) as CustomerAddress));
    }

    /** DELETE /store/addresses/:id — 400 si la ubicación está en uso. */
    deleteCustomerLocation(addressId: number): Observable<void> {
        return this.http
            .delete<void>(`${environment.apiUrl}/store/addresses/${addressId}`);
    }

    /** Marca la ubicación como principal (el backend mueve la marca atómicamente). */
    setPrimaryLocation(addressId: number): Observable<CustomerAddress> {
        return this.updateCustomerLocation(addressId, { is_primary: true });
    }
}
