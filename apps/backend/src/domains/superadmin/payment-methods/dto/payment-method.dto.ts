import { Type, Transform } from 'class-transformer';
import {
  IsString,
  IsOptional,
  IsNotEmpty,
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
  // Sin @IsNotEmpty() un name=" " o name="" pasaba validación y ensuciaba
  // la unicidad de la columna. UpdatePaymentMethodDto ya lo tiene.
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  display_name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsEnum(payment_methods_type_enum)
  type: payment_methods_type_enum;

  @IsString()
  @IsNotEmpty()
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
  // QUI-176: `name`, `type` y `provider` faltaban aquí, así que el
  // ValidationPipe global (forbidNonWhitelisted) rechazaba el PATCH con
  // "property name should not exist" y el método de pago no se podía editar
  // desde el panel de superadmin. `name` es @unique en la tabla: al cambiarlo
  // Prisma puede lanzar P2002, que el service traduce a 409.
  // `@IsNotEmpty()` es necesario además de `@IsString()`: sin él una cadena
  // vacía pasa la validación y `name` es @unique en la tabla.
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsEnum(payment_methods_type_enum)
  type?: payment_methods_type_enum;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  provider?: string;

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
