import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, catchError, throwError } from 'rxjs';
import { environment } from '../../../../../../environments/environment';
import {
    PurchaseOrder,
    CreatePurchaseOrderDto,
    UpdatePurchaseOrderDto,
    PurchaseOrderQueryDto,
    ReceivePurchaseOrderItemDto,
    ApiResponse,
} from '../interfaces';

@Injectable({
    providedIn: 'root',
})
export class PurchaseOrdersService {
    private readonly api_url = `${environment.apiUrl}/store/orders/purchase-orders`;

    constructor(private http: HttpClient) { }

    // ============================================================
    // CRUD Operations
    // ============================================================

    getPurchaseOrders(query: PurchaseOrderQueryDto = {}): Observable<ApiResponse<PurchaseOrder[]>> {
        const params = this.buildParams(query);
        return this.http
            .get<ApiResponse<PurchaseOrder[]>>(this.api_url, { params })
            .pipe(catchError(this.handleError));
    }

    getPurchaseOrderById(id: number): Observable<ApiResponse<PurchaseOrder>> {
        return this.http
            .get<ApiResponse<PurchaseOrder>>(`${this.api_url}/${id}`)
            .pipe(catchError(this.handleError));
    }

    createPurchaseOrder(data: CreatePurchaseOrderDto): Observable<ApiResponse<PurchaseOrder>> {
        return this.http
            .post<ApiResponse<PurchaseOrder>>(this.api_url, data)
            .pipe(catchError(this.handleError));
    }

    updatePurchaseOrder(id: number, data: UpdatePurchaseOrderDto): Observable<ApiResponse<PurchaseOrder>> {
        return this.http
            .patch<ApiResponse<PurchaseOrder>>(`${this.api_url}/${id}`, data)
            .pipe(catchError(this.handleError));
    }

    deletePurchaseOrder(id: number): Observable<ApiResponse<void>> {
        return this.http
            .delete<ApiResponse<void>>(`${this.api_url}/${id}`)
            .pipe(catchError(this.handleError));
    }

    // ============================================================
    // Status Management
    // ============================================================

    submitPurchaseOrder(id: number): Observable<ApiResponse<PurchaseOrder>> {
        return this.http
            .patch<ApiResponse<PurchaseOrder>>(`${this.api_url}/${id}/submit`, {})
            .pipe(catchError(this.handleError));
    }

    approvePurchaseOrder(id: number): Observable<ApiResponse<PurchaseOrder>> {
        return this.http
            .patch<ApiResponse<PurchaseOrder>>(`${this.api_url}/${id}/approve`, {})
            .pipe(catchError(this.handleError));
    }

    cancelPurchaseOrder(id: number): Observable<ApiResponse<PurchaseOrder>> {
        return this.http
            .patch<ApiResponse<PurchaseOrder>>(`${this.api_url}/${id}/cancel`, {})
            .pipe(catchError(this.handleError));
    }

    // ============================================================
    // Receiving
    // ============================================================

    receivePurchaseOrder(
        id: number,
        items: ReceivePurchaseOrderItemDto[]
    ): Observable<ApiResponse<PurchaseOrder>> {
        return this.http
            .patch<ApiResponse<PurchaseOrder>>(`${this.api_url}/${id}/receive`, { items })
            .pipe(catchError(this.handleError));
    }

    // ============================================================
    // Utilities
    // ============================================================

    private buildParams(query: PurchaseOrderQueryDto): HttpParams {
        let params = new HttpParams();
        Object.keys(query).forEach((key) => {
            const value = query[key as keyof PurchaseOrderQueryDto];
            if (value !== undefined && value !== null) {
                params = params.set(key, value.toString());
            }
        });
        return params;
    }

    private handleError(error: any): Observable<never> {
        console.error('PurchaseOrdersService Error:', error);
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
            error_message = 'Purchase order not found';
        } else if (error.status >= 500) {
            error_message = 'Server error. Please try again later';
        }

        return throwError(() => error_message);
    }
}
