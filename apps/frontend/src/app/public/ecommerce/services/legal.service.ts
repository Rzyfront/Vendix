import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { environment } from '../../../../environments/environment';
import { TenantFacade } from '../../../core/store';

export interface PendingDocument {
    document_id: number;
    document_type: string;
    title: string;
    version: string;
    is_required: boolean;
    content: string;
}

interface ApiResponse<T> {
    success: boolean;
    data: T;
}

@Injectable({
    providedIn: 'root',
})
export class LegalService {
    private http = inject(HttpClient);
    private tenantFacade = inject(TenantFacade);
    private apiUrl = `${environment.apiUrl}/ecommerce/legal`;

    private getHeaders(): HttpHeaders {
        const storeId = this.tenantFacade.getCurrentStoreId();
        return new HttpHeaders({
            'x-store-id': storeId?.toString() || '',
        });
    }

    getPendingDocumentsForCustomer(): Observable<PendingDocument[]> {
        return this.http
            .get<ApiResponse<PendingDocument[]>>(`${this.apiUrl}/pending`, { headers: this.getHeaders() })
            .pipe(map((res) => res.data));
    }

    acceptDocument(documentId: number, metadata?: { ip?: string; userAgent?: string }): Observable<any> {
        const body = metadata ? { accepted: true, context: 'ecommerce', ...metadata } : { accepted: true, context: 'ecommerce' };
        return this.http.post(`${this.apiUrl}/${documentId}/accept`, body, { headers: this.getHeaders() });
    }
}
