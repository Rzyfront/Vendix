import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { environment } from '../../../../../../environments/environment';
import {
  ApiResponse,
  PaginatedApiResponse,
} from '../../workflows/interfaces/workflow.interfaces';
import { DossierDetail, DossierRow } from '../interfaces/document.interfaces';

/** Typed client of `/api/store/documents/dossiers` (read only). */
@Injectable({ providedIn: 'root' })
export class DocumentsApiService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/store/documents`;

  listDossiers(query: {
    page?: number;
    limit?: number;
    search?: string;
  }): Observable<PaginatedApiResponse<DossierRow>> {
    let params = new HttpParams();
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null || value === '') continue;
      params = params.set(key, String(value));
    }
    return this.http.get<PaginatedApiResponse<DossierRow>>(
      `${this.base}/dossiers`,
      { params },
    );
  }

  getDossier(id: number): Observable<DossierDetail> {
    return this.http
      .get<ApiResponse<DossierDetail>>(`${this.base}/dossiers/${id}`)
      .pipe(map((res) => res.data));
  }
}
