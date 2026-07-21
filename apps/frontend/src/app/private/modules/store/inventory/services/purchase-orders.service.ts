import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, catchError, throwError, timer, map, switchMap, filter, takeWhile, take, timeout } from 'rxjs';
import { environment } from '../../../../../../environments/environment';
import {
    PurchaseOrder,
    CreatePurchaseOrderDto,
    UpdatePurchaseOrderDto,
    PurchaseOrderQueryDto,
    ReceivePurchaseOrderItemDto,
    PurchaseOrderReception,
    PurchaseOrderAttachment,
    PurchaseOrderPayment,
    PurchaseOrderTimelineEntry,
    ApiResponse,
    CostPreviewRequest,
    CostPreviewResponse,
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
        items: ReceivePurchaseOrderItemDto[],
        notes?: string
    ): Observable<ApiResponse<PurchaseOrder>> {
        const body: { items: ReceivePurchaseOrderItemDto[]; notes?: string } = { items };
        if (notes) body.notes = notes;
        return this.http
            .patch<ApiResponse<PurchaseOrder>>(`${this.api_url}/${id}/receive`, body)
            .pipe(catchError(this.handleError));
    }

    // ============================================================
    // Receptions
    // ============================================================

    getPurchaseOrderReceptions(id: number): Observable<ApiResponse<PurchaseOrderReception[]>> {
        return this.http
            .get<ApiResponse<PurchaseOrderReception[]>>(`${this.api_url}/${id}/receptions`)
            .pipe(catchError(this.handleError));
    }

    // ============================================================
    // Cost Summary
    // ============================================================

    getPurchaseOrderCostSummary(id: number): Observable<ApiResponse<unknown[]>> {
        return this.http
            .get<ApiResponse<unknown[]>>(`${this.api_url}/${id}/cost-summary`)
            .pipe(catchError(this.handleError));
    }

    getCostPreview(data: CostPreviewRequest): Observable<ApiResponse<CostPreviewResponse>> {
        return this.http
            .post<ApiResponse<CostPreviewResponse>>(`${this.api_url}/cost-preview`, data)
            .pipe(catchError(this.handleError));
    }

    // ============================================================
    // Timeline
    // ============================================================

    getPurchaseOrderTimeline(id: number): Observable<ApiResponse<PurchaseOrderTimelineEntry[]>> {
        return this.http
            .get<ApiResponse<PurchaseOrderTimelineEntry[]>>(`${this.api_url}/${id}/timeline`)
            .pipe(catchError(this.handleError));
    }

    // ============================================================
    // Attachments
    // ============================================================

    getPurchaseOrderAttachments(id: number): Observable<ApiResponse<PurchaseOrderAttachment[]>> {
        return this.http
            .get<ApiResponse<PurchaseOrderAttachment[]>>(`${this.api_url}/${id}/attachments`)
            .pipe(catchError(this.handleError));
    }

    uploadPurchaseOrderAttachment(id: number, file: File, metadata: Record<string, unknown> = {}): Observable<ApiResponse<PurchaseOrderAttachment>> {
        const formData = new FormData();
        formData.append('file', file);
        Object.keys(metadata).forEach(key => {
            if (metadata[key] != null) formData.append(key, String(metadata[key]));
        });
        return this.http
            .post<ApiResponse<PurchaseOrderAttachment>>(`${this.api_url}/${id}/attachments`, formData)
            .pipe(catchError(this.handleError));
    }

    removePurchaseOrderAttachment(id: number, attachmentId: number): Observable<ApiResponse<void>> {
        return this.http
            .delete<ApiResponse<void>>(`${this.api_url}/${id}/attachments/${attachmentId}`)
            .pipe(catchError(this.handleError));
    }

    // ============================================================
    // FASE TRACK B5 — AI scan async de comprobantes de pago (enqueue → poll)
    // ============================================================
    // Calque del patron expenses `scanInvoiceAsync` (apps/frontend/src/app/
    // private/modules/store/expenses/services/expense-scanner.service.ts).
    //
    //   POST .../payments/scan       → 202 {job_id}        (enqueue)
    //   GET  .../payments/scan/:jobId → {status, result?}   (poll con IDOR backend)
    //
    // `scanPaymentReceipt()` es el helper que el componente llama: hace enqueue
    // + poll en un Observable unico, con timeout 120s (skill vendix-ai-queue v2.2:
    // debe exceder el presupuesto de retry backend attempts:3 + backoff exponencial).

    private readonly PAYMENT_SCAN_POLL_INTERVAL_MS = 1800;
    private readonly PAYMENT_SCAN_TIMEOUT_MS = 120_000;

    enqueuePaymentScan(poId: number, file: File): Observable<string> {
        const formData = new FormData();
        formData.append('file', file);
        return this.http
            .post<ApiResponse<{ job_id: string }>>(
                `${this.api_url}/${poId}/payments/scan`,
                formData,
            )
            .pipe(
                map(res => {
                    const jobId = res?.data?.job_id;
                    if (!jobId) throw new Error('enqueuePaymentScan: missing job_id');
                    return String(jobId);
                }),
                catchError(this.handleError),
            );
    }

    pollPaymentScan(poId: number, jobId: string): Observable<PaymentScanJobStatus> {
        return this.http
            .get<ApiResponse<PaymentScanJobStatus>>(
                `${this.api_url}/${poId}/payments/scan/${jobId}`,
            )
            .pipe(
                map(res => res.data),
                catchError(this.handleError),
            );
    }

    scanPaymentReceipt(poId: number, file: File): Observable<PaymentScanResult> {
        return this.enqueuePaymentScan(poId, file).pipe(
            switchMap(jobId =>
                timer(0, this.PAYMENT_SCAN_POLL_INTERVAL_MS).pipe(
                    switchMap(() => this.pollPaymentScan(poId, jobId)),
                    takeWhile(
                        s => s.status !== 'completed' && s.status !== 'failed',
                        /* inclusive */ true,
                    ),
                    filter(s => s.status === 'completed' || s.status === 'failed'),
                    take(1),
                    // Mapear de {status, result?, error?} a PaymentScanResult.
                    // En 'failed' no hay result → throw para que el componente
                    // lo maneje como error suave (no destructivo).
                    map((s): PaymentScanResult => {
                        if (s.status === 'completed' && s.result) {
                            return s.result;
                        }
                        throw new Error(s.error || 'scan_payment_failed');
                    }),
                ),
            ),
            timeout({
                first: this.PAYMENT_SCAN_TIMEOUT_MS,
                with: () =>
                    throwError(() => new Error('scan_payment_timeout')),
            }),
            take(1),
            catchError(err => {
                // 404 tardío por eviction de Redis → error suave (job ya paso)
                if (err?.status === 404) {
                    return throwError(() => new Error('scan_payment_not_found'));
                }
                throw err;
            }),
        );
    }

    // ============================================================
    // Payments
    // ============================================================

    getPurchaseOrderPayments(id: number): Observable<ApiResponse<PurchaseOrderPayment[]>> {
        return this.http
            .get<ApiResponse<PurchaseOrderPayment[]>>(`${this.api_url}/${id}/payments`)
            .pipe(catchError(this.handleError));
    }

    registerPurchaseOrderPayment(id: number, payment: Record<string, unknown>): Observable<ApiResponse<PurchaseOrderPayment>> {
        return this.http
            .post<ApiResponse<PurchaseOrderPayment>>(`${this.api_url}/${id}/payments`, payment)
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

// =================================================================
// FASE TRACK B5 — tipos para el AI scan async de comprobantes de pago
// =================================================================
// Espejo del `PaymentReceiptScanJobStatusResult` del backend (skill vendix-ai-queue v2.2).
// Solo declaramos lo que el frontend consume: el estado de la cola, el resultado
// parseado, y el mensaje de error si el processor revento.

export type PaymentScanStatus =
    | 'waiting'
    | 'active'
    | 'completed'
    | 'failed'
    | 'delayed';

export interface PaymentScanResult {
    amount: number;
    payment_date: string;
    payment_method: string;
    reference: string | null;
    currency: string | null;
    notes: string | null;
    confidence: number;
}

export interface PaymentScanJobStatus {
    status: PaymentScanStatus;
    result?: PaymentScanResult;
    error?: string;
}
