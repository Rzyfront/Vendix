import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export class MarketingAdReferenceImageDto {
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  image_url?: string;

  @IsOptional()
  @IsString()
  @MaxLength(16_000_000)
  @Matches(/^data:image\/(png|jpeg|jpg|webp);base64,[A-Za-z0-9+/=]+$/)
  image_base64?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  source_type?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  label?: string;
}

export class CreateMarketingAdCreativeDto {
  @IsString()
  @MaxLength(255)
  title: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  prompt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  intent?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  channel?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  cta?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  visual_style?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1500)
  brief?: string;

  @IsOptional()
  @IsIn(['square', 'story', 'landscape'])
  format?: 'square' | 'story' | 'landscape';

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(12)
  @Type(() => Number)
  @IsInt({ each: true })
  product_ids?: number[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(12)
  @Type(() => Number)
  @IsInt({ each: true })
  product_image_ids?: number[];

  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Matches(/^[a-z][a-z0-9_]*$/)
  ai_app_key?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(12)
  @ValidateNested({ each: true })
  @Type(() => MarketingAdReferenceImageDto)
  reference_images?: MarketingAdReferenceImageDto[];
}

export class SuggestMarketingAdPromptDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  intent?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  channel?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  cta?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  visual_style?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1500)
  brief?: string;

  @IsOptional()
  @IsIn(['square', 'story', 'landscape'])
  format?: 'square' | 'story' | 'landscape';

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(12)
  @Type(() => Number)
  @IsInt({ each: true })
  product_ids?: number[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(24)
  @IsString({ each: true })
  selected_resource_types?: string[];
}

export class CreateManualMarketingAdCreativeDto extends CreateMarketingAdCreativeDto {
  @IsString()
  @MaxLength(16_000_000)
  @Matches(/^data:image\/(png|jpeg|jpg|webp);base64,[A-Za-z0-9+/=]+$/)
  image_base64: string;
}

export class UpdateMarketingAdCreativeDetailsDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  title?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;
}
