import {
  IsArray,
  IsDate,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateOrgTransferItemDto {
  @IsInt()
  @IsNotEmpty()
  product_id!: number;

  @IsOptional()
  @IsInt()
  product_variant_id?: number;

  @IsNumber()
  @IsPositive()
  quantity!: number;

  @IsOptional()
  @IsNumber()
  cost_per_unit?: number;

  @IsOptional()
  @IsString()
  notes?: string;
}

/**
 * Org-level cross-store / central-warehouse stock transfer creation payload.
 *
 * Locations may be central-warehouse or any store-bound warehouse within the
 * organization (validated via `OperatingScopeService.enforceLocationAccess`
 * with `allowCentral: true`).
 */
export class CreateOrgTransferDto {
  @IsInt()
  @IsNotEmpty()
  from_location_id!: number;

  @IsInt()
  @IsNotEmpty()
  to_location_id!: number;

  @IsOptional()
  @IsDate()
  @Type(() => Date)
  expected_date?: Date;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateOrgTransferItemDto)
  items!: CreateOrgTransferItemDto[];
}
