import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, catchError, throwError } from 'rxjs';
import { environment } from '../../../../../../environments/environment';
import { extractApiErrorMessage } from '../../../../../core/utils/api-error-handler';
import {
    InventoryLocation,
    CreateLocationDto,
    UpdateLocationDto,
    ApiResponse,
} from '../interfaces';

@Injectable({
    providedIn: 'root',
})
export class LocationsService {
    private readonly api_url = `${environment.apiUrl}/store/inventory/locations`;

    constructor(private http: HttpClient) { }

    // ============================================================
    // CRUD Operations
    // ============================================================

    getLocations(query: any = {}): Observable<ApiResponse<InventoryLocation[]>> {
        const params = this.buildParams(query);
        return this.http
            .get<ApiResponse<InventoryLocation[]>>(this.api_url, { params })
            .pipe(catchError(this.handleError));
    }

    getLocationById(id: number): Observable<ApiResponse<InventoryLocation>> {
        return this.http
            .get<ApiResponse<InventoryLocation>>(`${this.api_url}/${id}`)
            .pipe(catchError(this.handleError));
    }

    createLocation(data: CreateLocationDto): Observable<ApiResponse<InventoryLocation>> {
        const payload = this.sanitizeLocationPayload(data);
        return this.http
            .post<ApiResponse<InventoryLocation>>(this.api_url, payload)
            .pipe(catchError(this.handleError));
    }

    updateLocation(id: number, data: UpdateLocationDto): Observable<ApiResponse<InventoryLocation>> {
        const payload = this.sanitizeLocationPayload(data);
        return this.http
            .patch<ApiResponse<InventoryLocation>>(`${this.api_url}/${id}`, payload)
            .pipe(catchError(this.handleError));
    }

    deleteLocation(id: number): Observable<ApiResponse<void>> {
        return this.http
            .delete<ApiResponse<void>>(`${this.api_url}/${id}`)
            .pipe(catchError(this.handleError));
    }

    /**
     * Marca una ubicación como la bodega principal (default) del store.
     * El backend desmarcará automáticamente la ubicación previa.
     *
     * Requiere permiso: `store:inventory:set-default-location`.
     */
    setAsDefault(id: number): Observable<ApiResponse<InventoryLocation>> {
        return this.http
            .patch<ApiResponse<InventoryLocation>>(
                `${this.api_url}/${id}/set-default`,
                {},
            )
            .pipe(catchError(this.handleError));
    }

    // ============================================================
    // Utilities
    // ============================================================

    private buildParams(query: any): HttpParams {
        let params = new HttpParams();
        Object.keys(query).forEach((key) => {
            const value = query[key];
            if (value !== undefined && value !== null) {
                params = params.set(key, value.toString());
            }
        });
        return params;
    }

    private sanitizeLocationPayload<T extends CreateLocationDto | UpdateLocationDto>(data: T): Omit<T, 'is_default'> {
        const { is_default: _is_default, ...payload } = data;
        return payload;
    }

    // Un solo traductor de errores para toda la app: `extractApiErrorMessage`
    // resuelve el `error_code` tipado contra ERROR_MESSAGES y sólo cae a los
    // genéricos por status si no hay código. La versión previa mostraba el
    // `message` del backend —el mensaje de DESARROLLO, en inglés— directo al
    // usuario, que es justo lo que parse-api-error prohíbe.
    private handleError(error: any): Observable<never> {
        console.error('LocationsService Error:', error);
        return throwError(() => extractApiErrorMessage(error));
    }
}
