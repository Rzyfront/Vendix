import { Product } from '../../products/interfaces/product.interface';

export type AdCreativeStatus = 'draft' | 'processing' | 'completed' | 'failed';
export type AdCreativeFormat = 'square' | 'story' | 'landscape';

export interface MarketingAdCreativeProduct {
  id: number;
  creative_id: number;
  product_id: number;
  product: Pick<
    Product,
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

export interface CreateManualMarketingAdCreativeDto extends CreateMarketingAdCreativeDto {
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

export interface AdCreativeStreamEvent {
  type: 'progress' | 'partial_image' | 'completed' | 'done' | 'error';
  message?: string;
  imageBase64?: string;
  partialImageIndex?: number;
  creative?: MarketingAdCreative;
  error?: string;
  error_code?: string;
  details?: Record<string, unknown>;
}
