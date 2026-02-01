import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { environment } from '../../../../../../../environments/environment';
import {
    StoreLegalDocument,
    CreateStoreDocumentDto,
    UpdateStoreDocumentDto,
} from '../interfaces/store-legal-document.interface';

interface ApiResponse<T> {
    success: boolean;
    data: T;
    message?: string;
}

@Injectable({
    providedIn: 'root',
})
export class StoreLegalDocumentsService {
    private http = inject(HttpClient);
    private apiUrl = `${environment.apiUrl}/store/legal-documents`;

    getDocuments(filters?: {
        type?: string;
        search?: string;
        is_active?: boolean;
    }): Observable<StoreLegalDocument[]> {
        let params = new HttpParams();
        if (filters?.type) params = params.set('document_type', filters.type);
        if (filters?.search) params = params.set('search', filters.search);
        if (filters?.is_active !== undefined) params = params.set('is_active', filters.is_active.toString());

        return this.http
            .get<ApiResponse<StoreLegalDocument[]>>(this.apiUrl, { params })
            .pipe(map((res) => res.data));
    }

    getDocument(id: number): Observable<StoreLegalDocument> {
        return this.http
            .get<ApiResponse<StoreLegalDocument>>(`${this.apiUrl}/${id}`)
            .pipe(map((res) => res.data));
    }

    createDocument(dto: CreateStoreDocumentDto): Observable<StoreLegalDocument> {
        return this.http
            .post<ApiResponse<StoreLegalDocument>>(this.apiUrl, dto)
            .pipe(map((res) => res.data));
    }

    updateDocument(id: number, dto: UpdateStoreDocumentDto): Observable<StoreLegalDocument> {
        return this.http
            .patch<ApiResponse<StoreLegalDocument>>(`${this.apiUrl}/${id}`, dto)
            .pipe(map((res) => res.data));
    }

    activateDocument(id: number): Observable<StoreLegalDocument> {
        return this.http
            .patch<ApiResponse<StoreLegalDocument>>(`${this.apiUrl}/${id}/activate`, {})
            .pipe(map((res) => res.data));
    }

    deactivateDocument(id: number): Observable<StoreLegalDocument> {
        return this.http
            .patch<ApiResponse<StoreLegalDocument>>(`${this.apiUrl}/${id}/deactivate`, {})
            .pipe(map((res) => res.data));
    }

    deleteDocument(id: number): Observable<any> {
        return this.http.delete(`${this.apiUrl}/${id}`);
    }
}
