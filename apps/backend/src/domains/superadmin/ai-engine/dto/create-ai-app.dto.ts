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

  @IsOptional()
  @IsString()
  @IsIn([
    'text_generation',
    'streaming_chat',
    'conversations',
    'tool_agents',
    'rag_embeddings',
    'async_queue',
  ])
  ai_feature_category?: string;
}
