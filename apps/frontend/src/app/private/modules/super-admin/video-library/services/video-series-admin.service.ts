import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { environment } from '../../../../../../environments/environment';
import {
  VideoSeriesDetail,
  VideoSeriesListItem,
  VideoSeriesPayload,
} from '../models/video-series.model';

interface ApiResponse<T> {
  success: boolean;
  data: T;
}

@Injectable({ providedIn: 'root' })
export class VideoSeriesAdminService {
  private http = inject(HttpClient);
  private readonly api_url = `${environment.apiUrl}/superadmin/video-library/series`;

  list(page = 1, limit = 50): Observable<VideoSeriesListItem[]> {
    const params = new HttpParams().set('page', page).set('limit', limit);
    return this.http
      .get<ApiResponse<VideoSeriesListItem[]>>(this.api_url, { params })
      .pipe(map((res) => res.data));
  }

  get(id: number): Observable<VideoSeriesDetail> {
    return this.http
      .get<ApiResponse<VideoSeriesDetail>>(`${this.api_url}/${id}`)
      .pipe(map((res) => res.data));
  }

  create(dto: VideoSeriesPayload): Observable<VideoSeriesListItem> {
    return this.http
      .post<ApiResponse<VideoSeriesListItem>>(this.api_url, dto)
      .pipe(map((res) => res.data));
  }

  update(id: number, dto: VideoSeriesPayload): Observable<VideoSeriesListItem> {
    return this.http
      .patch<ApiResponse<VideoSeriesListItem>>(`${this.api_url}/${id}`, dto)
      .pipe(map((res) => res.data));
  }

  publish(id: number): Observable<VideoSeriesListItem> {
    return this.http
      .post<ApiResponse<VideoSeriesListItem>>(`${this.api_url}/${id}/publish`, {})
      .pipe(map((res) => res.data));
  }

  unpublish(id: number): Observable<VideoSeriesListItem> {
    return this.http
      .post<ApiResponse<VideoSeriesListItem>>(`${this.api_url}/${id}/unpublish`, {})
      .pipe(map((res) => res.data));
  }

  remove(id: number): Observable<unknown> {
    return this.http.delete(`${this.api_url}/${id}`);
  }
}
