import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../../../../environments/environment';
import {
  Promotion,
  CreatePromotionDto,
  UpdatePromotionDto,
  QueryPromotionsDto,
  PromotionsSummary,
  ApiResponse,
} from '../interfaces/promotion.interface';

@Injectable({ providedIn: 'root' })
export class PromotionsService {
  private http = inject(HttpClient);

  private getApiUrl(): string {
    return `${environment.apiUrl}/store/promotions`;
  }

  getPromotions(query: QueryPromotionsDto): Observable<ApiResponse<Promotion[]>> {
    const params: Record<string, any> = {};
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== '') {
        params[key] = value;
      }
    }
    return this.http.get<ApiResponse<Promotion[]>>(this.getApiUrl(), { params });
  }

  getPromotion(id: number): Observable<ApiResponse<Promotion>> {
    return this.http.get<ApiResponse<Promotion>>(`${this.getApiUrl()}/${id}`);
  }

  getSummary(): Observable<ApiResponse<PromotionsSummary>> {
    return this.http.get<ApiResponse<PromotionsSummary>>(`${this.getApiUrl()}/summary`);
  }

  createPromotion(dto: CreatePromotionDto): Observable<ApiResponse<Promotion>> {
    return this.http.post<ApiResponse<Promotion>>(this.getApiUrl(), dto);
  }

  updatePromotion(id: number, dto: UpdatePromotionDto): Observable<ApiResponse<Promotion>> {
    return this.http.patch<ApiResponse<Promotion>>(`${this.getApiUrl()}/${id}`, dto);
  }

  activatePromotion(id: number): Observable<ApiResponse<Promotion>> {
    return this.http.post<ApiResponse<Promotion>>(`${this.getApiUrl()}/${id}/activate`, {});
  }

  pausePromotion(id: number): Observable<ApiResponse<Promotion>> {
    return this.http.post<ApiResponse<Promotion>>(`${this.getApiUrl()}/${id}/pause`, {});
  }

  cancelPromotion(id: number): Observable<ApiResponse<Promotion>> {
    return this.http.post<ApiResponse<Promotion>>(`${this.getApiUrl()}/${id}/cancel`, {});
  }

  deletePromotion(id: number): Observable<ApiResponse<null>> {
    return this.http.delete<ApiResponse<null>>(`${this.getApiUrl()}/${id}`);
  }
}
