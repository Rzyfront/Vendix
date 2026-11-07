import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { environment } from '../../../../../../../environments/environment';
import {
  ApiResponse,
  FileDownloadResult,
  PaginatedApiResponse,
} from '../../interfaces/workflow.interfaces';
import {
  CollectionBody,
  CollectionView,
  CreateCollectionBody,
  RecordDetail,
  RecordListQuery,
  RecordRow,
  RecordStartResult,
  RecordUploadResult,
  RecordValues,
} from '../interfaces/records.interfaces';

/** Typed client of `store/workflows/collections` and `store/workflows/records`. */
@Injectable({ providedIn: 'root' })
export class RecordsApiService {
  private readonly http = inject(HttpClient);
  private readonly collectionsBase = `${environment.apiUrl}/store/workflows/collections`;
  private readonly recordsBase = `${environment.apiUrl}/store/workflows/records`;

  // ---- collections -------------------------------------------------------

  listCollections(): Observable<CollectionView[]> {
    return this.http
      .get<ApiResponse<CollectionView[]>>(this.collectionsBase)
      .pipe(map((res) => res.data ?? []));
  }

  getCollection(id: number): Observable<CollectionView> {
    return this.http
      .get<ApiResponse<CollectionView>>(`${this.collectionsBase}/${id}`)
      .pipe(map((res) => res.data));
  }

  createCollection(body: CreateCollectionBody): Observable<CollectionView> {
    return this.http
      .post<ApiResponse<CollectionView>>(this.collectionsBase, body)
      .pipe(map((res) => res.data));
  }

  updateCollection(id: number, body: Partial<CollectionBody>): Observable<CollectionView> {
    return this.http
      .patch<ApiResponse<CollectionView>>(`${this.collectionsBase}/${id}`, body)
      .pipe(map((res) => res.data));
  }

  archiveCollection(id: number): Observable<CollectionView> {
    return this.http
      .delete<ApiResponse<CollectionView>>(`${this.collectionsBase}/${id}`)
      .pipe(map((res) => res.data));
  }

  // ---- records -----------------------------------------------------------

  listRecords(query: RecordListQuery): Observable<PaginatedApiResponse<RecordRow>> {
    return this.http.get<PaginatedApiResponse<RecordRow>>(this.recordsBase, {
      params: this.params(query),
    });
  }

  getRecord(id: number): Observable<RecordDetail> {
    return this.http
      .get<ApiResponse<RecordDetail>>(`${this.recordsBase}/${id}`)
      .pipe(map((res) => res.data));
  }

  createRecord(collectionId: number, values: RecordValues): Observable<RecordRow> {
    return this.http
      .post<ApiResponse<RecordRow>>(this.recordsBase, { collection_id: collectionId, values })
      .pipe(map((res) => res.data));
  }

  /** `null` clears an optional value. */
  updateRecord(id: number, values: Record<string, unknown>): Observable<RecordRow> {
    return this.http
      .patch<ApiResponse<RecordRow>>(`${this.recordsBase}/${id}`, { values })
      .pipe(map((res) => res.data));
  }

  archiveRecord(id: number): Observable<RecordRow> {
    return this.http
      .delete<ApiResponse<RecordRow>>(`${this.recordsBase}/${id}`)
      .pipe(map((res) => res.data));
  }

  uploadFile(id: number, file: File): Observable<RecordUploadResult> {
    const body = new FormData();
    body.append('file', file, file.name);
    return this.http
      .post<ApiResponse<RecordUploadResult>>(`${this.recordsBase}/${id}/files`, body)
      .pipe(map((res) => res.data));
  }

  getFileDownload(id: number, fileId: number): Observable<FileDownloadResult> {
    return this.http
      .get<ApiResponse<FileDownloadResult>>(`${this.recordsBase}/${id}/files/${fileId}/download`)
      .pipe(map((res) => res.data));
  }

  /** `idempotencyKey`: one per user action; reuse it when retrying that action. */
  startFlow(id: number, definitionId: number, idempotencyKey: string): Observable<RecordStartResult> {
    return this.http
      .post<ApiResponse<RecordStartResult>>(
        `${this.recordsBase}/${id}/start`,
        { definition_id: definitionId },
        { headers: new HttpHeaders({ 'Idempotency-Key': idempotencyKey.slice(0, 80) }) },
      )
      .pipe(map((res) => res.data));
  }

  private params(query: object): HttpParams {
    let params = new HttpParams();
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null || value === '') continue;
      params = params.set(key, String(value));
    }
    return params;
  }
}
