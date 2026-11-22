import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { environment } from '../../../../environments/environment';
import { LibraryFile } from '../../../private/modules/store/documents/interfaces/document-library.interfaces';
import {
  ApiResponse,
  FileDownloadResult,
  PaginatedApiResponse,
} from '../../../private/modules/store/workflows/interfaces/workflow.interfaces';

/**
 * Documents of one record (order, customer, …) for its detail page. Talks to
 * `store/record-documents`, which every industry can reach with the record's
 * read permission (the document library itself is an Administration module).
 */
@Injectable({ providedIn: 'root' })
export class RecordDocumentsApiService {
  private readonly http = inject(HttpClient);
  private readonly base = `${environment.apiUrl}/store/record-documents`;

  list(
    subjectType: string,
    subjectId: number,
    query: { limit?: number } = {},
  ): Observable<LibraryFile[]> {
    let params = new HttpParams();
    if (query.limit) params = params.set('limit', String(query.limit));
    return this.http
      .get<PaginatedApiResponse<LibraryFile>>(
        `${this.base}/${encodeURIComponent(subjectType)}/${subjectId}`,
        { params },
      )
      .pipe(map((res) => res.data ?? []));
  }

  download(
    subjectType: string,
    subjectId: number,
    fileId: number,
  ): Observable<FileDownloadResult> {
    return this.http
      .get<ApiResponse<FileDownloadResult>>(
        `${this.base}/${encodeURIComponent(subjectType)}/${subjectId}/files/${fileId}/download`,
      )
      .pipe(map((res) => res.data));
  }
}
