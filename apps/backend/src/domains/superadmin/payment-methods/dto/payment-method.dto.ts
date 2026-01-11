import { Type, Transform } from 'class-transformer';
import {
  IsString,
  IsOptional,
  IsEnum,
  IsBoolean,
  IsObject,
  IsArray,
  IsNumber,
  Min,
  MaxLength,
} from 'class-validator';
import { payment_methods_type_enum } from '@prisma/client';

export enum FeeType {
  FIXED = 'fixed',
  PERCENTAGE = 'percentage',
  MIXED = 'mixed',
}

export class CreatePaymentMethodDto {
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
  requires_config?: boolean = false;

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
  @IsEnum(FeeType)
  processing_fee_type?: FeeType;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  processing_fee_value?: number;
}

export class UpdatePaymentMethodDto {
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
  @IsEnum(FeeType)
  processing_fee_type?: FeeType;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  processing_fee_value?: number;
}
