export {
  IcaRatesQueryDto,
  IcaCalculateDto,
  IcaReportQueryDto,
} from './ica-query.dto';

import {
  IsString,
  IsOptional,
  IsInt,
  IsBoolean,
  IsNumber,
  IsDecimal,
  MaxLength,
  Min,
  Max,
  IsEnum,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { PartialType } from '@nestjs/mapped-types';

// Enums
export enum TaxStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
}

export enum TaxType {
  PERCENTAGE = 'percentage',
  FIXED = 'fixed',
}

/**
 * Fiscal classification of a tax. Distinct from {@link TaxType}, which is the
 * calculation method (percentage vs fixed amount). This is the value that routes
 * a tax to its DIAN scheme code, its PUC account in accounting entries, and its
 * fiscal declaration. String values mirror the Prisma `tax_type_enum`.
 */
export enum TaxFiscalType {
  IVA = 'iva',
  INC = 'inc',
  ICA = 'ica',
  WITHHOLDING = 'withholding',
  RETEIVA = 'reteiva',
  RETEICA = 'reteica',
}

// Create Tax Category DTO
export class CreateTaxCategoryDto {
  @IsString()
  @MaxLength(255)
  name: string;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  description?: string;

  @IsEnum(TaxType)
  type: TaxType;

  /**
   * Fiscal classification (iva/inc/ica/...). Optional for backward compatibility
   * with callers that predate fiscal typing; the service defaults absent values
   * to IVA. The frontend always sends it after the tax-typing rollout.
   */
  @IsEnum(TaxFiscalType)
  @IsOptional()
  tax_type?: TaxFiscalType;

  /**
   * F-084 (CP-pos-exclusive-tax-double-charge, QUI-832): este campo es
   * PORCENTAJE (0-100, ej. `19` = 19 %), NO la fracción que se persiste.
   * `TaxesService.create`/`OrgTaxesService.create`/`.update` hacen
   * `Number(rate) / 100` antes de escribir en `tax_rates.rate`
   * (`Decimal(6,5)`, contrato fracción, tope real 9,99999). Verificado contra
   * el formulario (`tax-form-modal.component.ts`: "Tasa (%)", helper text
   * "Se guarda como fracción (19% → 0.19)") y ambos servicios de creación.
   * Por eso `@Max(100)` es CORRECTO para este campo — bajarlo a `0.99999`
   * (la cota de la columna) rompería toda tasa real: 19 > 0.99999 haría
   * fallar la validación del IVA general. `@Min(0)`/`@Max(100)` acotan el
   * porcentaje; tras `/100` el máximo posible es 1.0, siempre dentro del
   * tope de la columna.
   *
   * `maxDecimalPlaces` SÍ estaba desalineado: 4 decimales de porcentaje
   * producen 6 decimales de fracción tras `/100` (ej. `19.1234` → `0.191234`),
   * uno más de lo que la columna admite (`Decimal(6,5)` = 5 decimales) —
   * Postgres redondea el sexto dígito en silencio. Con 3 decimales de
   * porcentaje el resultado tiene como máximo 5 decimales de fracción,
   * calzando exacto con la columna.
   */
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  @Max(100)
  @Type(() => Number)
  rate: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  store_id?: number;

  @IsInt()
  @IsOptional()
  @Min(1)
  organization_id?: number;

  @IsBoolean()
  @IsOptional()
  is_inclusive?: boolean = false;

  @IsBoolean()
  @IsOptional()
  is_compound?: boolean = false;

  @IsInt()
  @IsOptional()
  @Min(0)
  sort_order?: number = 0;

  @IsEnum(TaxStatus)
  @IsOptional()
  status?: TaxStatus = TaxStatus.ACTIVE;
}

// Update Tax Category DTO
export class UpdateTaxCategoryDto extends PartialType(CreateTaxCategoryDto) {
  @IsInt()
  @IsOptional()
  @Min(1)
  store_id?: number;

  @IsInt()
  @IsOptional()
  @Min(1)
  organization_id?: number;
}

// Tax Category Query DTO
export class TaxCategoryQueryDto {
  @IsOptional()
  @Transform(({ value }) => parseInt(value))
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Transform(({ value }) => parseInt(value))
  @IsInt()
  @Min(1)
  limit?: number = 10;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @Transform(({ value }) => parseInt(value))
  @IsInt()
  @Min(1)
  store_id?: number;

  @IsOptional()
  @Transform(({ value }) => parseInt(value))
  @IsInt()
  @Min(1)
  organization_id?: number;

  @IsOptional()
  @IsEnum(TaxType)
  type?: TaxType;

  @IsOptional()
  @IsEnum(TaxStatus)
  status?: TaxStatus;

  @IsOptional()
  @Transform(({ value }) => value === 'true')
  @IsBoolean()
  is_inclusive?: boolean;

  @IsOptional()
  @Transform(({ value }) => value === 'true')
  @IsBoolean()
  is_compound?: boolean;

  @IsOptional()
  @IsString()
  sort_by?: string = 'sort_order';

  @IsOptional()
  @IsString()
  sort_order?: 'asc' | 'desc' = 'asc';

  @IsOptional()
  @Transform(({ value }) => value === 'true')
  @IsBoolean()
  include_inactive?: boolean = false;
}

// Seed Default Taxes DTO
export class SeedDefaultTaxesDto {
  /**
   * When true, default tax templates are upserted even if the store already
   * has tax_categories rows. Without this flag, an existing catalogue causes
   * TAXES_ALREADY_SEEDED (409).
   */
  @IsOptional()
  @IsBoolean()
  force?: boolean;

  @IsOptional()
  @Transform(({ value }) => parseInt(value))
  @IsInt()
  @Min(1)
  store_id?: number;
}

// Tax Calculation DTO
export class TaxCalculationDto {
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Type(() => Number)
  subtotal: number;

  @IsInt()
  @Min(1)
  store_id: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  product_id?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  shipping_address_id?: number;
}

// Tax Calculation Result DTO
export class TaxCalculationResultDto {
  subtotal: number;
  total_tax: number;
  total_amount: number;
  tax_breakdown: {
    tax_category_id: number;
    name: string;
    type: TaxType;
    rate: number;
    is_inclusive: boolean;
    is_compound: boolean;
    tax_amount: number;
  }[];
}
