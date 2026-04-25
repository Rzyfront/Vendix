import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../../../../environments/environment';
import {
  Plan,
  CreatePlanDto,
  UpdatePlanDto,
  PlanStats,
  PaginatedResponse,
  ApiResponse,
  QueryDto,
} from '../interfaces/subscription.interface';

@Injectable({ providedIn: 'root' })
export class PlansService {
  private http = inject(HttpClient);
  private apiUrl = `${environment.apiUrl}/superadmin/subscriptions/plans`;

  getPlans(query?: QueryDto): Observable<PaginatedResponse<Plan>> {
    let params = new HttpParams();
    if (query) {
      if (query.page) params = params.set('page', query.page);
      if (query.limit) params = params.set('limit', query.limit);
      if (query.search) params = params.set('search', query.search);
      if (query.sort_by) params = params.set('sort_by', query.sort_by);
      if (query.sort_order) params = params.set('sort_order', query.sort_order);
    }
    return this.http.get<PaginatedResponse<Plan>>(this.apiUrl, { params });
  }

  getPlan(id: number): Observable<ApiResponse<Plan>> {
    return this.http.get<ApiResponse<Plan>>(`${this.apiUrl}/${id}`);
  }

  createPlan(data: CreatePlanDto): Observable<ApiResponse<Plan>> {
    return this.http.post<ApiResponse<Plan>>(this.apiUrl, data);
  }

  updatePlan(id: number, data: UpdatePlanDto): Observable<ApiResponse<Plan>> {
    return this.http.put<ApiResponse<Plan>>(`${this.apiUrl}/${id}`, data);
  }

  archivePlan(id: number): Observable<ApiResponse<void>> {
    return this.http.patch<ApiResponse<void>>(`${this.apiUrl}/${id}/archive`, {});
  }

  getStats(): Observable<ApiResponse<PlanStats>> {
    return this.http.get<ApiResponse<PlanStats>>(`${this.apiUrl}/stats`);
  }
}
