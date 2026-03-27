import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../../../../environments/environment';
import { Review, ReviewStats, ReviewFilters } from '../models/review.model';

@Injectable({ providedIn: 'root' })
export class AdminReviewsService {
  private http = inject(HttpClient);
  private apiUrl = `${environment.apiUrl}/store/reviews`;

  getAll(filters: ReviewFilters = {}): Observable<any> {
    let params = new HttpParams();
    if (filters.page) params = params.set('page', filters.page.toString());
    if (filters.limit) params = params.set('limit', filters.limit.toString());
    if (filters.search) params = params.set('search', filters.search);
    if (filters.state) params = params.set('state', filters.state);
    if (filters.rating) params = params.set('rating', filters.rating.toString());
    if (filters.sort_by) params = params.set('sort_by', filters.sort_by);
    if (filters.sort_order) params = params.set('sort_order', filters.sort_order);
    return this.http.get(this.apiUrl, { params });
  }

  getStats(): Observable<any> {
    return this.http.get(`${this.apiUrl}/stats`);
  }

  getOne(id: number): Observable<any> {
    return this.http.get(`${this.apiUrl}/${id}`);
  }

  approve(id: number): Observable<any> {
    return this.http.patch(`${this.apiUrl}/${id}/approve`, {});
  }

  reject(id: number): Observable<any> {
    return this.http.patch(`${this.apiUrl}/${id}/reject`, {});
  }

  hide(id: number): Observable<any> {
    return this.http.patch(`${this.apiUrl}/${id}/hide`, {});
  }

  delete(id: number): Observable<any> {
    return this.http.delete(`${this.apiUrl}/${id}`);
  }

  createResponse(reviewId: number, content: string): Observable<any> {
    return this.http.post(`${this.apiUrl}/${reviewId}/response`, { content });
  }

  updateResponse(reviewId: number, content: string): Observable<any> {
    return this.http.patch(`${this.apiUrl}/${reviewId}/response`, { content });
  }

  deleteResponse(reviewId: number): Observable<any> {
    return this.http.delete(`${this.apiUrl}/${reviewId}/response`);
  }
}
