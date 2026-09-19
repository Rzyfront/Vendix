import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { environment } from '../../../../../../environments/environment';
import {
  Video,
  VideosResponse,
  VideoCategory,
  VideoStats,
} from '../../../store/help/video-library/models/video.model';

@Injectable({
  providedIn: 'root',
})
export class VideoLibraryAdminService {
  private readonly api_url = `${environment.apiUrl}/superadmin/video-library`;
  private http = inject(HttpClient);

  getVideos(query: {
    page?: number;
    limit?: number;
    status?: string;
    category?: string;
    search?: string;
  } = {}): Observable<VideosResponse> {
    let params = new HttpParams();
    if (query.page) params = params.set('page', query.page.toString());
    if (query.limit) params = params.set('limit', query.limit.toString());
    if (query.status) params = params.set('status', query.status);
    if (query.category) params = params.set('category', query.category);
    if (query.search) params = params.set('search', query.search);

    return this.http
      .get<{ success: boolean; data: VideosResponse }>(`${this.api_url}/videos`, { params })
      .pipe(map((res) => res.data));
  }

  getVideoStats(): Observable<VideoStats> {
    return this.http
      .get<{ success: boolean; data: VideoStats }>(`${this.api_url}/videos/stats`)
      .pipe(map((res) => res.data));
  }

  getVideoById(id: number): Observable<Video> {
    return this.http
      .get<{ success: boolean; data: Video }>(`${this.api_url}/videos/${id}`)
      .pipe(map((res) => res.data));
  }

  createVideo(dto: any): Observable<Video> {
    return this.http
      .post<{ success: boolean; data: Video }>(`${this.api_url}/videos`, dto)
      .pipe(map((res) => res.data));
  }

  updateVideo(id: number, dto: any): Observable<Video> {
    return this.http
      .patch<{ success: boolean; data: Video }>(`${this.api_url}/videos/${id}`, dto)
      .pipe(map((res) => res.data));
  }

  deleteVideo(id: number): Observable<void> {
    return this.http.delete<void>(`${this.api_url}/videos/${id}`);
  }

  getCategories(): Observable<VideoCategory[]> {
    return this.http
      .get<{ success: boolean; data: VideoCategory[] }>(`${this.api_url}/categories`)
      .pipe(map((res) => res.data));
  }

  createCategory(dto: any): Observable<VideoCategory> {
    return this.http
      .post<{ success: boolean; data: VideoCategory }>(`${this.api_url}/categories`, dto)
      .pipe(map((res) => res.data));
  }

  updateCategory(id: number, dto: any): Observable<VideoCategory> {
    return this.http
      .patch<{ success: boolean; data: VideoCategory }>(`${this.api_url}/categories/${id}`, dto)
      .pipe(map((res) => res.data));
  }

  deleteCategory(id: number): Observable<void> {
    return this.http.delete<void>(`${this.api_url}/categories/${id}`);
  }

  uploadThumbnail(file: File): Observable<{ key: string; url: string }> {
    const formData = new FormData();
    formData.append('file', file);
    return this.http
      .post<{ success: boolean; data: { key: string; url: string } }>(
        `${this.api_url}/upload-thumbnail`,
        formData,
      )
      .pipe(map((res) => res.data));
  }
}
