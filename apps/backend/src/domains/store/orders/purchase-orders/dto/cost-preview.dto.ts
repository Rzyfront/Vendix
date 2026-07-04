import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { tax_type_enum } from '@prisma/client';

/** Allowed fiscal tax classifications for a preview line (F1 IVA lifecycle). */
const TAX_TYPE_VALUES = Object.values(tax_type_enum) as string[];

export class CostPreviewItemDto {
  @IsInt()
  @Min(1)
  product_id: number;

  @IsOptional()
  @IsInt()
  product_variant_id?: number;

  @IsInt()
  @Min(1)
  quantity: number;

  /**
   * Gross unit cost the operator typed on the line. F1 derives the NET cost
   * from this using `tax_rate` + the effective `prices_include_tax` mode, so
   * the preview mirrors what `create`/`receive` will persist.
   */
  @IsNumber()
  @Min(0.0001)
  unit_cost: number;

  /** F1: line tax rate (percentage, e.g. 19 for 19%). */
  @IsNumber()
  @IsOptional()
  tax_rate?: number;

  /** F1: line tax type (iva | inc | ...). Defaults to iva. */
  @IsIn(TAX_TYPE_VALUES)
  @IsOptional()
  tax_type?: string;

  /** F1: per-line override of the header `prices_include_tax` (mixed invoices). */
  @IsBoolean()
  @IsOptional()
  prices_include_tax?: boolean;
}

export class CostPreviewDto {
  @IsInt()
  @Min(1)
  location_id: number;

  /** F1: dominant invoice tax mode. true = the entered unit_cost already includes tax. */
  @IsBoolean()
  @IsOptional()
  prices_include_tax?: boolean;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CostPreviewItemDto)
  items: CostPreviewItemDto[];
}
