import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, catchError, throwError } from 'rxjs';
import { environment } from '../../../../../../environments/environment';
import { extractApiErrorMessage } from '../../../../../core/utils/api-error-handler';
import {
    Supplier,
    SupplierAssignableState,
    CreateSupplierDto,
    UpdateSupplierDto,
    SupplierQueryDto,
    SupplierSummary,
    SupplierPurchaseOrderRow,
    SupplierPayableRow,
    ApiResponse,
    PaginatedResponse,
} from '../interfaces';

@Injectable({
    providedIn: 'root',
})
export class SuppliersService {
    private readonly api_url = `${environment.apiUrl}/store/inventory/suppliers`;

    constructor(private http: HttpClient) { }

    // ============================================================
    // CRUD Operations
    // ============================================================

    getSuppliers(query: SupplierQueryDto = {}): Observable<ApiResponse<Supplier[]>> {
        const params = this.buildParams(query);
        return this.http
            .get<ApiResponse<Supplier[]>>(this.api_url, { params })
            .pipe(catchError(this.handleError));
    }

    getSupplierById(id: number): Observable<ApiResponse<Supplier>> {
        return this.http
            .get<ApiResponse<Supplier>>(`${this.api_url}/${id}`)
            .pipe(catchError(this.handleError));
    }

    // ============================================================
    // QUI-656 — Perfil del proveedor
    // ============================================================

    /**
     * Resumen del perfil. Los agregados salen del contrato de métrica del
     * backend, así que estas cifras cuadran con Compras por Proveedor.
     */
    getSupplierSummary(id: number): Observable<ApiResponse<SupplierSummary>> {
        return this.http
            .get<ApiResponse<SupplierSummary>>(`${this.api_url}/${id}/summary`)
            .pipe(catchError(this.handleError));
    }

    getSupplierPurchaseOrders(
        id: number,
        page = 1,
        limit = 10,
    ): Observable<PaginatedResponse<SupplierPurchaseOrderRow>> {
        const params = new HttpParams()
            .set('page', String(page))
            .set('limit', String(limit));
        return this.http
            .get<PaginatedResponse<SupplierPurchaseOrderRow>>(
                `${this.api_url}/${id}/purchase-orders`,
                { params },
            )
            .pipe(catchError(this.handleError));
    }

    getSupplierPayables(
        id: number,
        page = 1,
        limit = 10,
    ): Observable<PaginatedResponse<SupplierPayableRow>> {
        const params = new HttpParams()
            .set('page', String(page))
            .set('limit', String(limit));
        return this.http
            .get<PaginatedResponse<SupplierPayableRow>>(
                `${this.api_url}/${id}/payables`,
                { params },
            )
            .pipe(catchError(this.handleError));
    }

    createSupplier(data: CreateSupplierDto): Observable<ApiResponse<Supplier>> {
        return this.http
            .post<ApiResponse<Supplier>>(this.api_url, data)
            .pipe(catchError(this.handleError));
    }

    updateSupplier(id: number, data: UpdateSupplierDto): Observable<ApiResponse<Supplier>> {
        return this.http
            .patch<ApiResponse<Supplier>>(`${this.api_url}/${id}`, data)
            .pipe(catchError(this.handleError));
    }

    /**
     * Archiva el proveedor: deja de aparecer en listados y selectores, pero su
     * historia de compras se conserva. Responde 409
     * `SUPPLIER_ARCHIVE_HAS_OPEN_DOCUMENTS` si tiene documentos abiertos.
     *
     * No usa `handleError`: ese mapper aplasta el error a un string y perdería
     * el `error_code` y los conteos que el componente necesita para ofrecer
     * inactivar como alternativa.
     */
    archiveSupplier(id: number): Observable<ApiResponse<void>> {
        return this.http.delete<ApiResponse<void>>(`${this.api_url}/${id}`);
    }

    /** Transición activo ↔ inactivo. `archived` no es destino válido aquí. */
    setSupplierState(
        id: number,
        state: SupplierAssignableState,
    ): Observable<ApiResponse<Supplier>> {
        return this.http.patch<ApiResponse<Supplier>>(
            `${this.api_url}/${id}/state`,
            { state },
        );
    }

    // ============================================================
    // Utilities
    // ============================================================

    private buildParams(query: SupplierQueryDto): HttpParams {
        let params = new HttpParams();
        Object.keys(query).forEach((key) => {
            const value = query[key as keyof SupplierQueryDto];
            if (value !== undefined && value !== null) {
                params = params.set(key, value.toString());
            }
        });
        return params;
    }

    // Un solo traductor de errores para toda la app: `extractApiErrorMessage`
    // resuelve el `error_code` tipado contra ERROR_MESSAGES y sólo cae a los
    // genéricos por status si no hay código. La versión previa mostraba el
    // `message` del backend —el mensaje de DESARROLLO, en inglés— directo al
    // usuario, que es justo lo que parse-api-error prohíbe.
    private handleError(error: any): Observable<never> {
        console.error('SuppliersService Error:', error);
        return throwError(() => extractApiErrorMessage(error));
    }
}
