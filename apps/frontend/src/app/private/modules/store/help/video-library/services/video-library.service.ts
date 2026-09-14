import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../../../../environments/environment';
import {
  Video,
  VideosResponse,
  VideoCategory,
  VideoQuery,
} from '../models/video.model';

@Injectable({
  providedIn: 'root',
})
export class VideoLibraryService {
  private readonly api_url = `${environment.apiUrl}/video-library`;
  private http = inject(HttpClient);

  getVideos(query: VideoQuery = {}): Observable<VideosResponse> {
    let params = new HttpParams();
    if (query.page) params = params.set('page', query.page.toString());
    if (query.limit) params = params.set('limit', query.limit.toString());
    if (query.category) params = params.set('category', query.category);
    if (query.module) params = params.set('module', query.module);
    if (query.search) params = params.set('search', query.search);

    return this.http.get<VideosResponse>(`${this.api_url}/videos`, { params });
  }

  searchVideos(q: string, limit = 10): Observable<Video[]> {
    const params = new HttpParams().set('q', q).set('limit', limit.toString());
    return this.http.get<Video[]>(`${this.api_url}/videos/search`, { params });
  }

  getVideoBySlug(slug: string): Observable<Video> {
    return this.http.get<Video>(`${this.api_url}/videos/${slug}`);
  }

  incrementView(id: number): Observable<{ view_count: number }> {
    return this.http.post<{ view_count: number }>(`${this.api_url}/videos/${id}/view`, {});
  }

  getCategories(): Observable<VideoCategory[]> {
    return this.http.get<VideoCategory[]>(`${this.api_url}/categories`);
  }
}
