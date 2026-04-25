import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { environment } from '../../../../../../environments/environment';
import {
  SubscriptionPlan,
  PartnerOrganization,
  PromotionalPlan,
  StoreSubscription,
  DunningSubscription,
  PartnerPayout,
  SubscriptionEvent,
  SubscriptionStats,
  CreatePlanDto,
  UpdatePlanDto,
  UpdatePartnerDto,
  CreatePromotionalDto,
  UpdatePromotionalDto,
  PayoutApprovalDto,
} from '../interfaces/subscription-admin.interface';

export interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
}

export interface PaginatedResponse<T> {
  success: boolean;
  data: T[];
  meta: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

@Injectable({ providedIn: 'root' })
export class SubscriptionAdminService {
  private readonly apiUrl = environment.apiUrl;

  constructor(private http: HttpClient) {}

  // ─── Plans ───

  private toBackendPlanPayload(data: Partial<CreatePlanDto> | Partial<UpdatePlanDto>): Record<string, any> {
    const d = data as any;
    const pricingFirst = Array.isArray(d.pricing) && d.pricing.length
      ? (d.pricing.find((p: any) => p.is_default) ?? d.pricing[0])
      : null;

    const payload: Record<string, any> = {};
    if (d.name !== undefined) payload['name'] = d.name;
    if (d.description !== undefined) payload['description'] = d.description;
    if (d.slug !== undefined) payload['code'] = d.slug;
    if (d.is_active !== undefined) payload['state'] = d.is_active ? 'active' : 'draft';
    if (d.is_public !== undefined) payload['resellable'] = d.is_public;
    if (d.ai_feature_flags !== undefined) payload['ai_feature_flags'] = d.ai_feature_flags;
    if (d.grace_threshold_days !== undefined) {
      payload['grace_period_soft_days'] = d.grace_threshold_days;
      payload['grace_period_hard_days'] = d.grace_threshold_days;
    }
    if (pricingFirst) {
      payload['billing_cycle'] = pricingFirst.billing_cycle;
      payload['base_price'] = Number(pricingFirst.price);
      if (pricingFirst.currency_code) payload['currency'] = pricingFirst.currency_code;
    }
    payload['feature_matrix'] = d.feature_matrix ?? {};
    return payload;
  }

  private toFrontendPlan(raw: any): SubscriptionPlan {
    const basePrice = raw.base_price != null ? Number(raw.base_price) : 0;
    return {
      id: String(raw.id),
      name: raw.name,
      slug: raw.code,
      description: raw.description ?? '',
      is_active: raw.state === 'active',
      is_public: Boolean(raw.resellable),
      ai_feature_flags: raw.ai_feature_flags ?? {},
      pricing: [
        {
          id: `${raw.id}-${raw.billing_cycle}`,
          billing_cycle: raw.billing_cycle,
          price: basePrice,
          currency_code: raw.currency ?? 'COP',
          is_default: true,
        },
      ],
      grace_threshold_days: raw.grace_period_soft_days ?? 0,
      created_at: raw.created_at,
      updated_at: raw.updated_at,
    } as SubscriptionPlan;
  }

  getPlans(query?: { page?: number; limit?: number; search?: string; is_active?: boolean }): Observable<PaginatedResponse<SubscriptionPlan>> {
    let params = new HttpParams();
    if (query?.page) params = params.set('page', query.page.toString());
    if (query?.limit) params = params.set('limit', query.limit.toString());
    if (query?.search) params = params.set('search', query.search);
    if (query?.is_active !== undefined) {
      params = params.set('state', query.is_active ? 'active' : 'draft');
    }

    return this.http
      .get<PaginatedResponse<any>>(`${this.apiUrl}/superadmin/subscriptions/plans`, { params })
      .pipe(
        map((res) => ({
          ...res,
          data: (res.data ?? []).map((row) => this.toFrontendPlan(row)),
        })),
      );
  }

  getPlanById(id: string): Observable<ApiResponse<SubscriptionPlan>> {
    return this.http
      .get<ApiResponse<any>>(`${this.apiUrl}/superadmin/subscriptions/plans/${id}`)
      .pipe(map((res) => ({ ...res, data: this.toFrontendPlan(res.data) })));
  }

  createPlan(data: CreatePlanDto): Observable<ApiResponse<SubscriptionPlan>> {
    const payload = this.toBackendPlanPayload(data);
    return this.http
      .post<ApiResponse<any>>(`${this.apiUrl}/superadmin/subscriptions/plans`, payload)
      .pipe(map((res) => ({ ...res, data: this.toFrontendPlan(res.data) })));
  }

  updatePlan(id: string, data: UpdatePlanDto): Observable<ApiResponse<SubscriptionPlan>> {
    const payload = this.toBackendPlanPayload(data);
    return this.http
      .patch<ApiResponse<any>>(`${this.apiUrl}/superadmin/subscriptions/plans/${id}`, payload)
      .pipe(map((res) => ({ ...res, data: this.toFrontendPlan(res.data) })));
  }

  deletePlan(id: string): Observable<ApiResponse<void>> {
    return this.http.delete<ApiResponse<void>>(`${this.apiUrl}/superadmin/subscriptions/plans/${id}`);
  }

  // ─── Partners ───

  getPartners(query?: { page?: number; limit?: number; search?: string }): Observable<PaginatedResponse<PartnerOrganization>> {
    let params = new HttpParams();
    if (query?.page) params = params.set('page', query.page.toString());
    if (query?.limit) params = params.set('limit', query.limit.toString());
    if (query?.search) params = params.set('search', query.search);

    return this.http.get<PaginatedResponse<PartnerOrganization>>(`${this.apiUrl}/superadmin/subscriptions/partners`, { params });
  }

  getPartnerById(id: string): Observable<ApiResponse<PartnerOrganization>> {
    return this.http.get<ApiResponse<PartnerOrganization>>(`${this.apiUrl}/superadmin/subscriptions/partners/${id}`);
  }

  updatePartner(id: string, data: UpdatePartnerDto): Observable<ApiResponse<PartnerOrganization>> {
    return this.http.patch<ApiResponse<PartnerOrganization>>(`${this.apiUrl}/superadmin/subscriptions/partners/${id}`, data);
  }

  // ─── Promotional Plans ───

  getPromotionalPlans(query?: { page?: number; limit?: number; is_active?: boolean }): Observable<PaginatedResponse<PromotionalPlan>> {
    let params = new HttpParams();
    if (query?.page) params = params.set('page', query.page.toString());
    if (query?.limit) params = params.set('limit', query.limit.toString());
    if (query?.is_active !== undefined) params = params.set('is_active', String(query.is_active));

    return this.http.get<PaginatedResponse<PromotionalPlan>>(`${this.apiUrl}/superadmin/subscriptions/promotional`, { params });
  }

  getPromotionalPlanById(id: string): Observable<ApiResponse<PromotionalPlan>> {
    return this.http.get<ApiResponse<PromotionalPlan>>(`${this.apiUrl}/superadmin/subscriptions/promotional/${id}`);
  }

  createPromotionalPlan(data: CreatePromotionalDto): Observable<ApiResponse<PromotionalPlan>> {
    return this.http.post<ApiResponse<PromotionalPlan>>(`${this.apiUrl}/superadmin/subscriptions/promotional`, data);
  }

  updatePromotionalPlan(id: string, data: UpdatePromotionalDto): Observable<ApiResponse<PromotionalPlan>> {
    return this.http.patch<ApiResponse<PromotionalPlan>>(`${this.apiUrl}/superadmin/subscriptions/promotional/${id}`, data);
  }

  deletePromotionalPlan(id: string): Observable<ApiResponse<void>> {
    return this.http.delete<ApiResponse<void>>(`${this.apiUrl}/superadmin/subscriptions/promotional/${id}`);
  }

  // ─── Active Subscriptions ───

  getStoreSubscriptions(query?: { page?: number; limit?: number; status?: string; search?: string }): Observable<PaginatedResponse<StoreSubscription>> {
    let params = new HttpParams();
    if (query?.page) params = params.set('page', query.page.toString());
    if (query?.limit) params = params.set('limit', query.limit.toString());
    if (query?.status) params = params.set('status', query.status);
    if (query?.search) params = params.set('search', query.search);

    return this.http.get<PaginatedResponse<StoreSubscription>>(`${this.apiUrl}/superadmin/subscriptions/active`, { params });
  }

  // ─── Dunning ───

  getDunningSubscriptions(query?: { page?: number; limit?: number; status?: string }): Observable<PaginatedResponse<DunningSubscription>> {
    let params = new HttpParams();
    if (query?.page) params = params.set('page', query.page.toString());
    if (query?.limit) params = params.set('limit', query.limit.toString());
    if (query?.status) params = params.set('status', query.status);

    return this.http.get<PaginatedResponse<DunningSubscription>>(`${this.apiUrl}/superadmin/subscriptions/dunning`, { params });
  }

  // ─── Partner Payouts ───

  getPayouts(query?: { page?: number; limit?: number; status?: string }): Observable<PaginatedResponse<PartnerPayout>> {
    let params = new HttpParams();
    if (query?.page) params = params.set('page', query.page.toString());
    if (query?.limit) params = params.set('limit', query.limit.toString());
    if (query?.status) params = params.set('status', query.status);

    return this.http.get<PaginatedResponse<PartnerPayout>>(`${this.apiUrl}/superadmin/subscriptions/payouts`, { params });
  }

  approvePayout(id: string, data: PayoutApprovalDto): Observable<ApiResponse<PartnerPayout>> {
    return this.http.post<ApiResponse<PartnerPayout>>(`${this.apiUrl}/superadmin/subscriptions/payouts/${id}/approve`, data);
  }

  // ─── Events ───

  getSubscriptionEvents(subscriptionId: string, query?: { page?: number; limit?: number }): Observable<PaginatedResponse<SubscriptionEvent>> {
    let params = new HttpParams();
    if (query?.page) params = params.set('page', query.page.toString());
    if (query?.limit) params = params.set('limit', query.limit.toString());

    return this.http.get<PaginatedResponse<SubscriptionEvent>>(`${this.apiUrl}/superadmin/subscriptions/events/${subscriptionId}`, { params });
  }

  // ─── Stats ───

  getStats(): Observable<ApiResponse<SubscriptionStats>> {
    return this.http.get<ApiResponse<SubscriptionStats>>(`${this.apiUrl}/superadmin/subscriptions/stats`);
  }
}
