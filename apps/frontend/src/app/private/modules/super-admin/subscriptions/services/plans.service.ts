import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, map } from 'rxjs';
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

/** Forma real que devuelve `GET superadmin/subscriptions/stats`. */
interface SubscriptionGlobalStats {
  totalPlans: number;
  activePlans: number;
  totalSubscriptions: number;
  activeSubscriptions: number;
  graceSubscriptions: number;
  suspendedSubscriptions: number;
  totalPartners: number;
  totalMonthlyRevenue: number;
  currencyCode: string;
}

@Injectable({ providedIn: 'root' })
export class PlansService {
  private http = inject(HttpClient);
  private apiUrl = `${environment.apiUrl}/superadmin/subscriptions/plans`;
  private statsUrl = `${environment.apiUrl}/superadmin/subscriptions/stats`;

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

  // PATCH, no PUT: `plans.controller.ts` declara `@Patch(':id')`. Con PUT no
  // existe ruta, Nest contestaba 404 y editar un plan de suscripción no
  // guardaba nada.
  updatePlan(id: number, data: UpdatePlanDto): Observable<ApiResponse<Plan>> {
    return this.http.patch<ApiResponse<Plan>>(`${this.apiUrl}/${id}`, data);
  }

  archivePlan(id: number): Observable<ApiResponse<void>> {
    return this.http.patch<ApiResponse<void>>(`${this.apiUrl}/${id}/archive`, {});
  }

  /**
   * Estadísticas globales de suscripciones.
   *
   * La ruta correcta es `superadmin/subscriptions/stats`
   * (`SubscriptionsStatsController`), NO `.../plans/stats`: esa última caía en
   * el `@Get(':id')` de `plans.controller.ts`, cuyo `ParseIntPipe` rechazaba
   * `"stats"` con 400 y dejaba las tarjetas del módulo en cero.
   *
   * El backend expone `totalMonthlyRevenue`; la vista consume `monthlyRevenue`.
   * Se adapta aquí para no propagar el nombre del backend por toda la UI.
   */
  getStats(): Observable<ApiResponse<PlanStats>> {
    return this.http
      .get<ApiResponse<SubscriptionGlobalStats>>(`${this.statsUrl}`)
      .pipe(
        map((response) => ({
          ...response,
          data: {
            totalPlans: response.data?.totalPlans ?? 0,
            activePlans: response.data?.activePlans ?? 0,
            activeSubscriptions: response.data?.activeSubscriptions ?? 0,
            monthlyRevenue: response.data?.totalMonthlyRevenue ?? 0,
          },
        })),
      );
  }
}
