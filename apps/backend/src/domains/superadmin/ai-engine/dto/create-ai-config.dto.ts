import {
  IsString,
  IsOptional,
  IsBoolean,
  IsNotEmpty,
  IsIn,
  IsUrl,
  IsObject,
  MaxLength,
} from 'class-validator';

export class CreateAIConfigDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  provider: string;

  @IsString()
  @IsNotEmpty()
  @IsIn(['openai_compatible', 'anthropic_compatible'])
  sdk_type: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  label: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  model_id: string;

  @IsOptional()
  @IsString()
  @IsUrl({}, { message: 'base_url must be a valid URL' })
  @MaxLength(500)
  base_url?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  api_key_ref?: string;

  @IsOptional()
  @IsBoolean()
  is_default?: boolean;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;

  @IsOptional()
  @IsObject()
  settings?: Record<string, any>;
}
