import {
  IsString,
  IsOptional,
  IsBoolean,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsIn,
  MaxLength,
  Min,
  Max,
  Matches,
} from 'class-validator';
import { AIModelType } from '../../../../ai-engine/interfaces/ai-provider.interface';
import { AI_MODEL_TYPES } from './create-ai-config.dto';

/**
 * Canonical AI feature keys (F1). Keep in sync with `AI_FEATURE_KEYS` in
 * `apps/backend/src/domains/store/subscriptions/types/access.types.ts` and
 * with the admin selector in `ai-engine-app-modal.component.ts`.
 * Note: `realtime_voice` was missing from this DTO before F1, so voice apps
 * could not be created through the validated API surface.
 */
export const AI_APP_FEATURE_CATEGORIES = [
  'text_generation',
  'streaming_chat',
  'conversations',
  'tool_agents',
  'rag_embeddings',
  'async_queue',
  'realtime_voice',
] as const;

export type AIAppFeatureCategory =
  (typeof AI_APP_FEATURE_CATEGORIES)[number];

export class CreateAIAppDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  @Matches(/^[a-z][a-z0-9_]*$/, {
    message: 'key must be snake_case (e.g. product_description)',
  })
  key: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsNumber()
  config_id?: number | null;

  @IsOptional()
  @IsString()
  system_prompt?: string;

  @IsOptional()
  @IsString()
  prompt_template?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(2)
  temperature?: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(100000)
  max_tokens?: number;

  @IsOptional()
  @IsString()
  @IsIn([
    'text',
    'json',
    'markdown',
    'html',
    'image',
    'embedding',
    'audio',
    'video',
    'rerank',
    'speech',
    'transcription',
  ])
  output_format?: string;

  @IsOptional()
  @IsString()
  @IsIn(AI_MODEL_TYPES)
  model_type?: AIModelType;

  @IsOptional()
  @IsObject()
  rate_limit?: { maxRequests: number; windowSeconds: number };

  @IsOptional()
  @IsObject()
  retry_config?: { maxRetries: number; delayMs: number };

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;

  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;

  @IsString()
  @IsNotEmpty()
  @IsIn(AI_APP_FEATURE_CATEGORIES)
  ai_feature_category: string;
}
