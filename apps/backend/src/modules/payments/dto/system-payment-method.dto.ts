import {
  IsString,
  IsOptional,
  IsBoolean,
  IsEnum,
  IsObject,
  IsArray,
  IsNumber,
  Min,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import { payment_methods_type_enum } from '@prisma/client';

// Temporary enum until migration is applied
enum fee_type_enum {
  fixed = 'fixed',
  percentage = 'percentage',
  mixed = 'mixed',
}

export class CreateSystemPaymentMethodDto {
  @IsString()
  @MaxLength(100)
  name: string;

  @IsString()
  @MaxLength(100)
  display_name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsEnum(payment_methods_type_enum)
  type: payment_methods_type_enum;

  @IsString()
  @MaxLength(100)
  provider: string;

  @IsOptional()
  @IsString()
  logo_url?: string;

  @IsOptional()
  @IsBoolean()
  requires_config?: boolean;

  @IsOptional()
  @IsObject()
  config_schema?: any;

  @IsOptional()
  @IsObject()
  default_config?: any;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  supported_currencies?: string[];

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  min_amount?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  max_amount?: number;

  @IsOptional()
  @IsEnum(fee_type_enum)
  processing_fee_type?: fee_type_enum;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  processing_fee_value?: number;
}

export class UpdateSystemPaymentMethodDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  display_name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  logo_url?: string;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;

  @IsOptional()
  @IsBoolean()
  requires_config?: boolean;

  @IsOptional()
  @IsObject()
  config_schema?: any;

  @IsOptional()
  @IsObject()
  default_config?: any;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  supported_currencies?: string[];

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  min_amount?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  max_amount?: number;

  @IsOptional()
  @IsEnum(fee_type_enum)
  processing_fee_type?: fee_type_enum;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  processing_fee_value?: number;
}
