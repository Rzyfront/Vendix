import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, catchError, throwError } from 'rxjs';
import { environment } from '../../../../../../environments/environment';
import {
    Supplier,
    CreateSupplierDto,
    UpdateSupplierDto,
    SupplierQueryDto,
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

    deleteSupplier(id: number): Observable<ApiResponse<void>> {
        return this.http
            .delete<ApiResponse<void>>(`${this.api_url}/${id}`)
            .pipe(catchError(this.handleError));
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

    private handleError(error: any): Observable<never> {
        console.error('SuppliersService Error:', error);
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
            error_message = 'Supplier not found';
        } else if (error.status === 409) {
            error_message = 'Supplier with this code already exists';
        } else if (error.status >= 500) {
            error_message = 'Server error. Please try again later';
        }

        return throwError(() => error_message);
    }
}
