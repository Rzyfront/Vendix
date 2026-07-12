/**
 * Types for the Marketing — Anuncios (Ad Creatives) module.
 *
 * Mirror of the backend DTOs in `apps/backend/src/domains/store/marketing-ad-creatives/dto/`
 * + the full response shape in `apps/frontend/.../anuncios/anuncios.interface.ts`.
 *
 * All enums/fields are kept verbatim from the backend and the web interface
 * to preserve the contract as documented in
 * `docs/parity-audit-anuncios.md` §8 (Consumed endpoints).
 *
 * NEVER imported directly from backend source (mobile-dev RULE 4).
 */

export type AdCreativeStatus = 'draft' | 'processing' | 'completed' | 'failed';
export type AdCreativeFormat = 'square' | 'story' | 'landscape';

export interface MarketingAdCreativeProduct {
  id: number;
  creative_id: number;
  product_id: number;
  product: Pick<
    ProductRef,
    'id' | 'name' | 'sku' | 'base_price' | 'sale_price' | 'description'
  >;
}

export interface MarketingAdCreativeImage {
  id: number;
  creative_id: number;
  product_image_id?: number | null;
  image_url?: string | null;
  image_key?: string | null;
  source_type: string;
  sort_order?: number | null;
}

export interface MarketingAdCreative {
  id: number;
  title: string;
  description?: string | null;
  prompt?: string | null;
  post_copy?: string | null;
  format: AdCreativeFormat;
  status: AdCreativeStatus;
  image_url?: string | null;
  image_key?: string | null;
  thumb_url?: string | null;
  thumb_key?: string | null;
  ai_app_key: string;
  provider_model?: string | null;
  error_message?: string | null;
  generation_metadata?: Record<string, unknown> | null;
  created_at?: string | null;
  updated_at?: string | null;
  completed_at?: string | null;
  creative_products?: MarketingAdCreativeProduct[];
  creative_images?: MarketingAdCreativeImage[];
}

/**
 * Minimal product ref — we only need these fields for the wizard's products picker
 * and the preview card detail. Mirrors `Product` shape used by products.service.
 */
export interface ProductRef {
  id: number;
  name: string;
  sku?: string | null;
  base_price?: number | string | null;
  sale_price?: number | string | null;
  description?: string | null;
  product_images?: Array<{
    id: number;
    image_url?: string | null;
    is_main?: boolean | null;
    sort_order?: number | null;
  }>;
  online_purchase_qr_code?: string | null;
  product_type?: string | null;
}

export interface MarketingAdReferenceImageDto {
  image_url?: string;
  image_base64?: string;
  source_type?: string;
  label?: string;
}

export interface CreateMarketingAdCreativeDto {
  title: string;
  description?: string;
  prompt?: string;
  intent?: string;
  channel?: string;
  cta?: string;
  visual_style?: string;
  brief?: string;
  format: AdCreativeFormat;
  product_ids?: number[];
  product_image_ids?: number[];
  reference_images?: MarketingAdReferenceImageDto[];
}

export interface CreateManualMarketingAdCreativeDto
  extends CreateMarketingAdCreativeDto {
  image_base64: string;
}

export interface UpdateMarketingAdCreativeDetailsDto {
  title?: string;
  description?: string;
}

export interface SuggestMarketingAdPromptDto {
  intent?: string;
  channel?: string;
  cta?: string;
  visual_style?: string;
  brief?: string;
  format?: AdCreativeFormat;
  product_ids?: number[];
  selected_resource_types?: string[];
}

export interface SuggestedMarketingAdPrompt {
  suggested_prompt: string;
  suggested_title?: string;
  notes?: string;
}

export interface MarketingAdCreativeSummary {
  total: number;
  completed: number;
  processing: number;
  failed: number;
}

export interface MarketingAdEcommerceDomain {
  id: number;
  hostname: string;
  url?: string | null;
  app_type?: string | null;
  status?: string | null;
  is_primary?: boolean | null;
}

export interface ApiResponse<T> {
  success: boolean;
  data: T;
  meta?: {
    total?: number;
    page?: number;
    limit?: number;
    total_pages?: number;
  };
  message?: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
    hasNext?: boolean;
    hasPrev?: boolean;
  };
}

export interface QueryMarketingAdCreativesParams {
  page?: number;
  limit?: number;
  search?: string;
  status?: AdCreativeStatus;
  format?: AdCreativeFormat;
}

export type AdCreativeStreamEvent =
  | { type: 'progress'; message?: string }
  | {
      type: 'partial_image';
      imageBase64?: string;
      partialImageIndex?: number;
    }
  | {
      type: 'completed';
      creative?: MarketingAdCreative;
      post_copy?: string;
      usage?: unknown;
      model?: string;
      revisedPrompt?: string;
    }
  | {
      type: 'post_copy';
      post_copy?: string;
      creative?: MarketingAdCreative;
    }
  | { type: 'done' }
  | {
      type: 'error';
      error?: string;
      error_code?: string;
      details?: Record<string, unknown>;
    };

/** Shape returned by aiEngine.run for the marketing_ad_prompt_specialist app. */
export interface PromptSuggestionResponse {
  suggested_prompt: string;
  suggested_title?: string;
  notes?: string;
}
