import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, catchError, throwError, map } from 'rxjs';
import { tap, shareReplay } from 'rxjs/operators';
import { environment } from '../../../../../../environments/environment';
import {
    Customer,
    CreateCustomerRequest,
    UpdateCustomerRequest,
    CustomerStats,
    CustomerFilters,
} from '../models/customer.model';

export interface PaginatedResponse<T> {
    data: T[];
    meta: {
        total: number;
        page: number;
        limit: number;
        totalPages: number;
    };
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
                return throwError(() => new Error('Failed to fetch customer stats'));
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
}
