import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map, tap, shareReplay } from 'rxjs/operators';
import { environment } from '../../../../../../environments/environment';
import {
  LegalDocument,
  CreateSystemDocumentDto,
  UpdateSystemDocumentDto,
  DocumentStats,
} from '../interfaces/legal-document.interface';

interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
}

// Caché estático global (persiste entre instancias del servicio)
interface CacheEntry<T> {
  observable: T;
  lastFetch: number;
}

// Map para caché por ID de documento
const acceptanceStatsCache = new Map<number, CacheEntry<Observable<DocumentStats>>>();

@Injectable({
  providedIn: 'root',
})
export class LegalDocumentsService {
  private http = inject(HttpClient);
  private apiUrl = `${environment.apiUrl}/superadmin/legal-documents`;
  private readonly CACHE_TTL = 30000; // 30 segundos

  getSystemDocuments(filters?: {
    document_type?: string;
  }): Observable<LegalDocument[]> {
    let params = new HttpParams();
    if (filters?.document_type) {
      params = params.set('document_type', filters.document_type);
    }
    return this.http
      .get<ApiResponse<LegalDocument[]>>(this.apiUrl, { params })
      .pipe(map((res) => res.data));
  }

  getSystemDocument(id: number): Observable<LegalDocument> {
    return this.http
      .get<ApiResponse<LegalDocument>>(`${this.apiUrl}/${id}`)
      .pipe(map((res) => res.data));
  }

  createSystemDocument(
    dto: CreateSystemDocumentDto,
  ): Observable<LegalDocument> {
    return this.http
      .post<ApiResponse<LegalDocument>>(this.apiUrl, dto)
      .pipe(map((res) => res.data));
  }

  updateSystemDocument(
    id: number,
    dto: UpdateSystemDocumentDto,
  ): Observable<LegalDocument> {
    return this.http
      .patch<ApiResponse<LegalDocument>>(`${this.apiUrl}/${id}`, dto)
      .pipe(map((res) => res.data));
  }

  activateDocument(id: number): Observable<LegalDocument> {
    return this.http
      .patch<ApiResponse<LegalDocument>>(`${this.apiUrl}/${id}/activate`, {})
      .pipe(map((res) => res.data));
  }

  deactivateDocument(id: number): Observable<LegalDocument> {
    return this.http
      .patch<ApiResponse<LegalDocument>>(`${this.apiUrl}/${id}/deactivate`, {})
      .pipe(map((res) => res.data));
  }

  getDocumentHistory(documentType: string): Observable<LegalDocument[]> {
    return this.http
      .get<
        ApiResponse<LegalDocument[]>
      >(`${this.apiUrl}/history/${documentType}`)
      .pipe(map((res) => res.data));
  }

  getAcceptanceStats(id: number): Observable<DocumentStats> {
    const now = Date.now();
    const cached = acceptanceStatsCache.get(id);

    if (cached && (now - cached.lastFetch) < this.CACHE_TTL) {
      return cached.observable;
    }

    const observable$ = this.http
      .get<ApiResponse<DocumentStats>>(`${this.apiUrl}/${id}/stats`)
      .pipe(
        shareReplay({ bufferSize: 1, refCount: false }),
        map((res) => res.data),
        tap(() => {
          const entry = acceptanceStatsCache.get(id);
          if (entry) {
            entry.lastFetch = Date.now();
          }
        }),
      );

    acceptanceStatsCache.set(id, {
      observable: observable$,
      lastFetch: now,
    });

    return observable$;
  }

  /**
   * Invalida el caché de estadísticas
   * Útil después de editar un documento legal específico
   * @param id - ID del documento. Si no se proporciona, se limpia todo el caché
   */
  invalidateCache(id?: number): void {
    if (id) {
      acceptanceStatsCache.delete(id);
    } else {
      acceptanceStatsCache.clear();
    }
  }
}
