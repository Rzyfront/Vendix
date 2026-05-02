import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { environment } from '../../../../../../environments/environment';
import {
  SubscriptionPlan,
  PlanPricing,
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
  DunningPreviewResponse,
  DunningPreviewTargetState,
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

  /** Decimal-string | number | null | undefined -> number | null */
  private toNumber(v: any): number | null {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  /** Same but returns 0 instead of null (for non-nullable numeric fields) */
  private toNumberOrZero(v: any): number {
    return this.toNumber(v) ?? 0;
  }

  private toBackendPlanPayload(data: Partial<CreatePlanDto> | Partial<UpdatePlanDto>): Record<string, any> {
    const d = data as any;
    const payload: Record<string, any> = {};

    // Identity
    if (d.code !== undefined) payload['code'] = d.code;
    if (d.name !== undefined) payload['name'] = d.name;
    if (d.description !== undefined) payload['description'] = d.description;

    // Type / state / billing
    if (d.plan_type !== undefined) payload['plan_type'] = d.plan_type;
    if (d.state !== undefined) payload['state'] = d.state;
    if (d.billing_cycle !== undefined) payload['billing_cycle'] = this.normalizeBillingCycle(d.billing_cycle);

    // Money (Prisma Decimal accepts number on input)
    if (d.base_price !== undefined && d.base_price !== null) {
      payload['base_price'] = Number(d.base_price);
    }
    if (d.currency !== undefined) payload['currency'] = d.currency;
    if (d.setup_fee !== undefined) {
      payload['setup_fee'] = d.setup_fee === null ? null : Number(d.setup_fee);
    }
    if (d.is_free !== undefined) payload['is_free'] = Boolean(d.is_free);

    // Grace + dunning
    if (d.grace_period_soft_days !== undefined) payload['grace_period_soft_days'] = Number(d.grace_period_soft_days);
    if (d.grace_period_hard_days !== undefined) payload['grace_period_hard_days'] = Number(d.grace_period_hard_days);
    if (d.suspension_day !== undefined) payload['suspension_day'] = Number(d.suspension_day);
    if (d.cancellation_day !== undefined) payload['cancellation_day'] = Number(d.cancellation_day);

    // Partner
    if (d.resellable !== undefined) payload['resellable'] = Boolean(d.resellable);
    if (d.max_partner_margin_pct !== undefined) {
      payload['max_partner_margin_pct'] =
        d.max_partner_margin_pct === null ? null : Number(d.max_partner_margin_pct);
    }

    // Promotional
    if (d.is_promotional !== undefined) payload['is_promotional'] = Boolean(d.is_promotional);
    if (d.redemption_code !== undefined) {
      const code = typeof d.redemption_code === 'string' ? d.redemption_code.trim() : '';
      payload['redemption_code'] = code || null;
    }
    if (d.promo_priority !== undefined) payload['promo_priority'] = Number(d.promo_priority);

    // Display
    if (d.is_popular !== undefined) payload['is_popular'] = Boolean(d.is_popular);
    if (d.sort_order !== undefined) payload['sort_order'] = Number(d.sort_order);
    if (d.is_default !== undefined) payload['is_default'] = Boolean(d.is_default);

    // Feature matrices
    if (d.ai_feature_flags !== undefined) payload['ai_feature_flags'] = d.ai_feature_flags;
    if (d.feature_matrix !== undefined) payload['feature_matrix'] = d.feature_matrix ?? {};

    // ---- Backwards-compat shim (legacy callers using slug / is_active / is_public / grace_threshold_days / pricing[]) ----
    if (payload['code'] === undefined && d.slug !== undefined) payload['code'] = d.slug;
    if (payload['state'] === undefined && d.is_active !== undefined) payload['state'] = d.is_active ? 'active' : 'draft';
    if (payload['resellable'] === undefined && d.is_public !== undefined) payload['resellable'] = Boolean(d.is_public);
    if (d.grace_threshold_days !== undefined) {
      if (payload['grace_period_soft_days'] === undefined) payload['grace_period_soft_days'] = Number(d.grace_threshold_days);
      if (payload['grace_period_hard_days'] === undefined) payload['grace_period_hard_days'] = Number(d.grace_threshold_days);
    }
    if (Array.isArray(d.pricing) && d.pricing.length) {
      const pricingFirst = d.pricing.find((p: any) => p.is_default) ?? d.pricing[0];
      if (payload['billing_cycle'] === undefined && pricingFirst.billing_cycle) {
        payload['billing_cycle'] = this.normalizeBillingCycle(pricingFirst.billing_cycle);
      }
      if (payload['base_price'] === undefined && pricingFirst.price !== undefined) {
        payload['base_price'] = Number(pricingFirst.price);
      }
      if (payload['currency'] === undefined && pricingFirst.currency_code) {
        payload['currency'] = pricingFirst.currency_code;
      }
    }

    return payload;
  }

  private toFrontendPlan(raw: any): SubscriptionPlan {
    const base_price = this.toNumberOrZero(raw.base_price);
    const setup_fee = this.toNumber(raw.setup_fee);
    const max_partner_margin_pct = this.toNumber(raw.max_partner_margin_pct);
    const billing_cycle = this.normalizeBillingCycle(raw.billing_cycle ?? 'monthly') as SubscriptionPlan['billing_cycle'];
    const currency = raw.currency ?? 'COP';
    const grace_period_soft_days = Number(raw.grace_period_soft_days ?? 0);

    return {
      id: String(raw.id),
      code: raw.code ?? '',
      name: raw.name ?? '',
      description: raw.description ?? '',

      plan_type: (raw.plan_type ?? 'base') as SubscriptionPlan['plan_type'],
      state: (raw.state ?? 'draft') as SubscriptionPlan['state'],
      billing_cycle,

      base_price,
      currency,
      setup_fee,
      is_free: Boolean(raw.is_free),

      grace_period_soft_days,
      grace_period_hard_days: Number(raw.grace_period_hard_days ?? 0),
      suspension_day: Number(raw.suspension_day ?? 0),
      cancellation_day: Number(raw.cancellation_day ?? 0),

      feature_matrix: raw.feature_matrix ?? {},
      ai_feature_flags: raw.ai_feature_flags ?? ({} as any),

      resellable: Boolean(raw.resellable),
      max_partner_margin_pct,

      is_promotional: Boolean(raw.is_promotional),
      redemption_code: raw.redemption_code ?? null,
      promo_rules: raw.promo_rules ?? null,
      promo_priority: Number(raw.promo_priority ?? 0),

      is_popular: Boolean(raw.is_popular),
      sort_order: Number(raw.sort_order ?? 0),
      is_default: Boolean(raw.is_default),

      parent_plan_id: raw.parent_plan_id ?? null,
      created_at: raw.created_at,
      updated_at: raw.updated_at,
      archived_at: raw.archived_at ?? null,

      // Derived legacy
      slug: raw.code ?? '',
      is_active: raw.state === 'active',
      is_public: Boolean(raw.resellable),
      pricing: [
        {
          id: `${raw.id}-${billing_cycle}`,
          billing_cycle: (billing_cycle as PlanPricing['billing_cycle']),
          price: base_price,
          currency_code: currency,
          is_default: true,
        },
      ],
      grace_threshold_days: grace_period_soft_days,
    };
  }

  private normalizeBillingCycle(value: unknown): string {
    return value === 'biannual' ? 'semiannual' : String(value || 'monthly');
  }

  // ─── Subscription transformers (Phase B) ───

  private mapBackendStateToStatus(state: string): StoreSubscription['status'] {
    if (state === 'grace_soft' || state === 'grace_hard') return 'grace';
    if (state === 'expired' || state === 'cancelled') return 'cancelled';
    if (state === 'blocked' || state === 'suspended') return 'suspended';
    if (state === 'trial') return 'trial';
    return 'active';
  }

  private toFrontendStoreSubscription(raw: any): StoreSubscription {
    return {
      id: String(raw.id),
      store_id: String(raw.store_id),
      store_name: raw.store?.name ?? '—',
      organization_name: raw.store?.organizations?.name ?? raw.organization?.name ?? '—',
      plan_name: raw.partner_override?.custom_name ?? raw.plan?.name ?? '—',
      billing_cycle: raw.plan?.billing_cycle ?? 'monthly',
      price: Number(raw.effective_price ?? 0),
      currency_code: raw.currency ?? 'COP',
      status: this.mapBackendStateToStatus(raw.state),
      current_period_start: raw.current_period_start,
      current_period_end: raw.current_period_end,
      grace_period_end: raw.grace_hard_until ?? raw.grace_soft_until ?? null,
      auto_renew: Boolean(raw.auto_renew),
      partner_id: raw.partner_override?.organization_id ? String(raw.partner_override.organization_id) : null,
      partner_margin_amount: Number(raw.partner_margin_amount ?? 0),
      created_at: raw.created_at,
    };
  }

  private toFrontendDunning(raw: any): DunningSubscription {
    const base = this.toFrontendStoreSubscription(raw);
    const invoice = raw.invoices?.[0] ?? raw.latest_invoice ?? null;
    const dueAt = invoice?.due_at ? new Date(invoice.due_at) : null;
    const days_overdue = dueAt
      ? Math.max(0, Math.floor((Date.now() - dueAt.getTime()) / 86400000))
      : 0;
    return {
      id: base.id,
      store_id: base.store_id,
      store_name: base.store_name,
      organization_name: base.organization_name,
      plan_name: base.plan_name,
      price: base.price,
      currency_code: base.currency_code,
      status: base.status === 'grace' ? 'grace' : 'suspended',
      current_period_end: base.current_period_end,
      grace_period_end: base.grace_period_end,
      days_overdue,
      payment_attempts: invoice?.payments?.length ?? 0,
      last_payment_attempt: invoice?.payments?.[invoice.payments.length - 1]?.created_at ?? null,
    };
  }

  private toFrontendPayout(raw: any): PartnerPayout {
    const rawState = raw.state ?? 'pending';
    const mappedStatus = (rawState === 'draft'
      ? 'pending'
      : rawState === 'sent'
        ? 'approved'
        : rawState) as PartnerPayout['status'];
    return {
      id: String(raw.id),
      partner_id: String(raw.partner_organization_id),
      partner_name: raw.organization?.name ?? raw.partner_organization?.name ?? '—',
      period_start: raw.period_start,
      period_end: raw.period_end,
      total_amount: Number(raw.total_amount ?? 0),
      currency_code: raw.currency ?? 'COP',
      store_count: raw._count?.commissions ?? 0,
      status: mappedStatus,
      approved_at: raw.sent_at ?? null,
      paid_at: raw.paid_at ?? null,
      created_at: raw.created_at,
    };
  }

  private describeEvent(raw: any): string {
    const from = raw.from_state ? `${raw.from_state} → ` : '';
    const to = raw.to_state ?? '';
    if (from || to) return `${from}${to}`;
    return raw.type;
  }

  private toFrontendEvent(raw: any): SubscriptionEvent {
    const userFull = raw.triggered_by
      ? `${raw.triggered_by.first_name ?? ''} ${raw.triggered_by.last_name ?? ''}`.trim() || raw.triggered_by.email
      : null;
    return {
      id: String(raw.id),
      subscription_id: String(raw.store_subscription_id),
      event_type: raw.type,
      description: this.describeEvent(raw),
      metadata: (raw.payload ?? {}) as Record<string, unknown>,
      created_at: raw.created_at,
      user_id: raw.triggered_by_user_id ? String(raw.triggered_by_user_id) : null,
      user_name: userFull ?? raw.triggered_by_job ?? null,
    };
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

    return this.http
      .get<PaginatedResponse<any>>(`${this.apiUrl}/superadmin/subscriptions/active`, { params })
      .pipe(
        map((res) => ({
          ...res,
          data: (res.data ?? []).map((row: any) => this.toFrontendStoreSubscription(row)),
        })),
      );
  }

  // ─── Dunning ───

  getDunningSubscriptions(query?: { page?: number; limit?: number; status?: string }): Observable<PaginatedResponse<DunningSubscription>> {
    let params = new HttpParams();
    if (query?.page) params = params.set('page', query.page.toString());
    if (query?.limit) params = params.set('limit', query.limit.toString());
    if (query?.status) params = params.set('status', query.status);

    return this.http
      .get<PaginatedResponse<any>>(`${this.apiUrl}/superadmin/subscriptions/dunning`, { params })
      .pipe(
        map((res) => ({
          ...res,
          data: (res.data ?? []).map((row: any) => this.toFrontendDunning(row)),
        })),
      );
  }

  /**
   * Compute side-effects of forcing a state transition on a dunning
   * subscription WITHOUT mutating it. Used by DunningPreviewModalComponent
   * before the actual force-transition is fired.
   */
  previewDunningTransition(
    subscriptionId: string,
    target_state: DunningPreviewTargetState,
  ): Observable<ApiResponse<DunningPreviewResponse>> {
    return this.http.post<ApiResponse<DunningPreviewResponse>>(
      `${this.apiUrl}/superadmin/subscriptions/dunning/${subscriptionId}/preview-transition`,
      { target_state },
    );
  }

  // ─── Partner Payouts ───

  getPayouts(query?: { page?: number; limit?: number; status?: string }): Observable<PaginatedResponse<PartnerPayout>> {
    let params = new HttpParams();
    if (query?.page) params = params.set('page', query.page.toString());
    if (query?.limit) params = params.set('limit', query.limit.toString());
    if (query?.status) params = params.set('status', query.status);

    return this.http
      .get<PaginatedResponse<any>>(`${this.apiUrl}/superadmin/subscriptions/payouts`, { params })
      .pipe(
        map((res) => ({
          ...res,
          data: (res.data ?? []).map((row: any) => this.toFrontendPayout(row)),
        })),
      );
  }

  approvePayout(id: string, data: PayoutApprovalDto): Observable<ApiResponse<PartnerPayout>> {
    return this.http.post<ApiResponse<PartnerPayout>>(`${this.apiUrl}/superadmin/subscriptions/payouts/${id}/approve`, data);
  }

  // ─── Events ───

  getSubscriptionEvents(subscriptionId: string, query?: { page?: number; limit?: number }): Observable<PaginatedResponse<SubscriptionEvent>> {
    let params = new HttpParams();
    if (query?.page) params = params.set('page', query.page.toString());
    if (query?.limit) params = params.set('limit', query.limit.toString());

    return this.http
      .get<PaginatedResponse<any>>(`${this.apiUrl}/superadmin/subscriptions/events/${subscriptionId}`, { params })
      .pipe(
        map((res) => ({
          ...res,
          data: (res.data ?? []).map((row: any) => this.toFrontendEvent(row)),
        })),
      );
  }

  // ─── Stats ───

  getStats(): Observable<ApiResponse<SubscriptionStats>> {
    return this.http.get<ApiResponse<SubscriptionStats>>(`${this.apiUrl}/superadmin/subscriptions/stats`);
  }

  // ─── Metrics (MRR, Churn, ARPU, LTV) ───

  getMetrics(
    period:
      | 'last_30'
      | 'last_90'
      | 'last_365'
      | { start: string; end: string },
    evolutionMonths = 12,
  ): Observable<ApiResponse<SubscriptionMetricsResponse>> {
    let params = new HttpParams().set(
      'evolution_months',
      String(evolutionMonths),
    );
    if (typeof period === 'string') {
      params = params.set('period', period);
    } else {
      params = params
        .set('period', 'custom')
        .set('start', period.start)
        .set('end', period.end);
    }
    return this.http.get<ApiResponse<SubscriptionMetricsResponse>>(
      `${this.apiUrl}/superadmin/subscriptions/metrics`,
      { params },
    );
  }
}

// ─── Metrics types ───
export interface SubscriptionMetricsResponse {
  period: { preset: string; start: string; end: string };
  mrr: { value: string; monthly_avg: string; currency: string };
  churn: { rate_pct: number; cancelled_count: number; active_at_start: number };
  arpu: { value: string; currency: string; active_subs: number };
  ltv: { value: string | null; currency: string };
  active_breakdown: {
    by_state: Record<string, number>;
    by_plan: Array<{ plan_id: number; plan_name: string; count: number }>;
  };
  mrr_evolution: Array<{ month: string; mrr: string }>;
}
