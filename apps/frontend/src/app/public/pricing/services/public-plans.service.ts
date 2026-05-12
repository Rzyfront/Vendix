import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../../environments/environment';
import { PricingCardPlan } from '../../../shared/components/pricing-card/pricing-card.component';

/**
 * Public plan shape returned by GET /api/public/plans.
 *
 * The backend whitelists only public-safe fields. `ai_features` is the public
 * subset of `ai_feature_flags` (NEVER includes cost_*, partner_*, internal_*).
 *
 * `PricingCardPlan` is intersected to keep backwards compatibility with
 * the existing card layout while adding the comparison-table fields.
 */
export interface PublicPlan extends PricingCardPlan {
  plan_type?: string;
  is_promotional?: boolean;
  sort_order?: number;
  /**
   * Public AI feature flags map. Keys are AIFeatureKey
   * (text_generation, streaming_chat, conversations, tool_agents,
   * rag_embeddings, async_queue). Values describe enable + caps.
   */
  ai_features?: Record<string, AIFeatureValue | undefined>;
}

export interface AIFeatureValue {
  enabled?: boolean;
  monthly_tokens_cap?: number | null;
  daily_messages_cap?: number | null;
  retention_days?: number | null;
  tools_allowed?: string[];
  indexed_docs_cap?: number | null;
  monthly_jobs_cap?: number | null;
  degradation?: 'warn' | 'block';
}

export interface PublicPlansResponse {
  success: boolean;
  data: PublicPlan[];
  message?: string;
}

@Injectable({ providedIn: 'root' })
export class PublicPlansService {
  private http = inject(HttpClient);
  private apiUrl = `${environment.apiUrl}/public/plans`;

  list$ = this.http.get<PublicPlansResponse>(this.apiUrl);
}
