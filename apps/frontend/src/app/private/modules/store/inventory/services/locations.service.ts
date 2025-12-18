import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, catchError, throwError } from 'rxjs';
import { environment } from '../../../../../../environments/environment';
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
        return this.http
            .post<ApiResponse<InventoryLocation>>(this.api_url, data)
            .pipe(catchError(this.handleError));
    }

    updateLocation(id: number, data: UpdateLocationDto): Observable<ApiResponse<InventoryLocation>> {
        return this.http
            .patch<ApiResponse<InventoryLocation>>(`${this.api_url}/${id}`, data)
            .pipe(catchError(this.handleError));
    }

    deleteLocation(id: number): Observable<ApiResponse<void>> {
        return this.http
            .delete<ApiResponse<void>>(`${this.api_url}/${id}`)
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

    private handleError(error: any): Observable<never> {
        console.error('LocationsService Error:', error);
        let error_message = 'An error occurred';

        if (error.error?.message) {
            error_message = error.error.message;
        } else if (error.status === 400) {
            error_message = 'Invalid data provided';
        } else if (error.status === 401) {
            error_message = 'Unauthorized access';
        } else if (error.status === 403) {
            error_message = 'Insufficient permissions';
        } else if (error.status === 404) {
            error_message = 'Location not found';
        } else if (error.status >= 500) {
            error_message = 'Server error. Please try again later';
        }

        return throwError(() => error_message);
    }
}
