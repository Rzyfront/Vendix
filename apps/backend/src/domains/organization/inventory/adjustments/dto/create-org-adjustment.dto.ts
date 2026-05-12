import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

import {
  ORG_ADJUSTMENT_TYPES,
  OrgAdjustmentType,
} from './query-org-adjustment.dto';

/**
 * Single-row org-level inventory adjustment create payload. Mirrors the
 * store-side `CreateAdjustmentDto` shape (one product per row) but is invoked
 * from the organization domain, where `organization_id` and the actor user
 * come from `RequestContextService` and never from the body.
 */
export class CreateOrgAdjustmentDto {
  @IsInt()
  @Type(() => Number)
  product_id!: number;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  product_variant_id?: number;

  @IsInt()
  @Type(() => Number)
  location_id!: number;

  /**
   * Optional batch-level adjustment. When set, the adjustment targets the
   * specific lot inside the location instead of the aggregate stock_level.
   */
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  batch_id?: number;

  @IsEnum(ORG_ADJUSTMENT_TYPES)
  type!: OrgAdjustmentType;

  /**
   * Resulting on-hand quantity after the adjustment is applied. The service
   * computes `quantity_change = quantity_after - quantity_before` and applies
   * the delta via `StockLevelManager.updateStock`.
   */
  @IsNumber()
  @Type(() => Number)
  quantity_after!: number;

  @IsOptional()
  @IsString()
  reason_code?: string;

  /**
   * Free-form description / reason. Used both for the adjustment row and as
   * the audit-log `reason` metadata.
   */
  @IsOptional()
  @IsString()
  description?: string;

  /**
   * When `true`, the adjustment is auto-approved by the actor on creation
   * (mirrors store-side `batchCreateAndComplete`). Defaults to `false` so the
   * adjustment lands in `pending` state and a separate `POST :id/approve`
   * call records the approver.
   */
  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  auto_approve?: boolean;
}

/**
 * Bulk variant — creates one adjustment row per item, all targeting the same
 * `location_id`. Wraps the same single-row creation logic (one transaction
 * per row, audited individually).
 */
export class CreateOrgAdjustmentItemDto {
  @IsInt()
  @Type(() => Number)
  product_id!: number;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  product_variant_id?: number;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  batch_id?: number;

  @IsEnum(ORG_ADJUSTMENT_TYPES)
  type!: OrgAdjustmentType;

  @IsNumber()
  @Type(() => Number)
  quantity_after!: number;

  @IsOptional()
  @IsString()
  reason_code?: string;

  @IsOptional()
  @IsString()
  description?: string;
}

export class CreateOrgAdjustmentBulkDto {
  @IsInt()
  @Type(() => Number)
  location_id!: number;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateOrgAdjustmentItemDto)
  items!: CreateOrgAdjustmentItemDto[];

  /**
   * When `true`, every created row is auto-approved by the actor. Defaults
   * to `false`.
   */
  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  auto_approve?: boolean;

  @IsOptional()
  @IsString()
  @IsNotEmpty()
  reason?: string;
}
