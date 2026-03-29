import { Injectable } from '@angular/core';
import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { TenantFacade } from '../../../../core/store/tenant/tenant.facade';
import { environment } from '../../../../../environments/environment';

export interface ReviewsResponse {
  success: boolean;
  reviews: any[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
  rating_distribution: Record<number, number>;
  avg_rating: number;
  total_count: number;
}

export interface ReviewsQuery {
  page?: number;
  limit?: number;
  sort_by?: string;
  rating?: number;
}

@Injectable({
  providedIn: 'root',
})
export class EcommerceReviewsService {
  private api_url = `${environment.apiUrl}/ecommerce/reviews`;

  constructor(
    private http: HttpClient,
    private domain_service: TenantFacade,
  ) { }

  private getHeaders(): HttpHeaders {
    const domainConfig = this.domain_service.getCurrentDomainConfig();
    const storeId = domainConfig?.store_id;
    return new HttpHeaders({
      'x-store-id': storeId?.toString() || '',
    });
  }

  getProductReviews(
    productId: number,
    query: ReviewsQuery = {},
  ): Observable<ReviewsResponse> {
    let params = new HttpParams();

    if (query.page) params = params.set('page', query.page.toString());
    if (query.limit) params = params.set('limit', query.limit.toString());
    if (query.sort_by) params = params.set('sort_by', query.sort_by);
    if (query.rating) params = params.set('rating', query.rating.toString());

    return this.http.get<ReviewsResponse>(
      `${this.api_url}/product/${productId}`,
      {
        headers: this.getHeaders(),
        params,
      },
    );
  }

  canReview(
    productId: number,
  ): Observable<{ success: boolean; data: { can_review: boolean; reason?: string } }> {
    return this.http.get<{ success: boolean; data: { can_review: boolean; reason?: string } }>(
      `${this.api_url}/can-review/${productId}`,
      {
        headers: this.getHeaders(),
      },
    );
  }

  submitReview(
    data: { product_id: number; rating: number; title?: string; comment: string },
  ): Observable<{ success: boolean; data: any }> {
    return this.http.post<{ success: boolean; data: any }>(
      this.api_url,
      data,
      {
        headers: this.getHeaders(),
      },
    );
  }

  updateReview(
    id: number,
    data: { rating?: number; title?: string; comment?: string },
  ): Observable<{ success: boolean; data: any }> {
    return this.http.patch<{ success: boolean; data: any }>(
      `${this.api_url}/${id}`,
      data,
      {
        headers: this.getHeaders(),
      },
    );
  }

  deleteReview(
    id: number,
  ): Observable<{ success: boolean }> {
    return this.http.delete<{ success: boolean }>(
      `${this.api_url}/${id}`,
      {
        headers: this.getHeaders(),
      },
    );
  }

  voteReview(
    id: number,
    is_helpful: boolean,
  ): Observable<{ success: boolean; data: any }> {
    return this.http.post<{ success: boolean; data: any }>(
      `${this.api_url}/${id}/vote`,
      { is_helpful },
      {
        headers: this.getHeaders(),
      },
    );
  }

  reportReview(
    id: number,
    reason: string,
  ): Observable<{ success: boolean; data: any }> {
    return this.http.post<{ success: boolean; data: any }>(
      `${this.api_url}/${id}/report`,
      { reason },
      {
        headers: this.getHeaders(),
      },
    );
  }
}
