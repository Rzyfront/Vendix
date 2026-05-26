import {
  IsOptional,
  IsString,
  IsInt,
  IsBoolean,
  IsIn,
  Min,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { AIModelType } from '../../../../ai-engine/interfaces/ai-provider.interface';
import { AI_MODEL_TYPES } from './create-ai-config.dto';

export class AIConfigQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number = 10;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsString()
  @IsIn(['openai_compatible', 'anthropic_compatible'])
  sdk_type?: string;

  @IsOptional()
  @IsString()
  @IsIn(AI_MODEL_TYPES)
  model_type?: AIModelType;

  @IsOptional()
  @Transform(({ value }) => value === 'true')
  @IsBoolean()
  is_active?: boolean;

  @IsOptional()
  @IsString()
  sort_by?: string = 'created_at';

  @IsOptional()
  @IsIn(['asc', 'desc'])
  sort_order?: 'asc' | 'desc' = 'desc';
}
