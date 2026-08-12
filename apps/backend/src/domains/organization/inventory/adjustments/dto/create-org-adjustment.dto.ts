import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
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
   *
   * Entero y no negativo: es un conteo físico resultante en la unidad mínima de
   * stock, que es `Int` en la base. Sin estas cotas un decimal reventaba como
   * 500 opaco desde Prisma, y un negativo era peor — `updateStock` clampea
   * `quantity_on_hand` a 0 pero la fila persistía `quantity_after: -N`, dejando
   * el libro de ajustes divergiendo del stock en silencio y para siempre, con un
   * asiento emitido sobre un movimiento que no existió. El DTO hermano de tienda
   * (`batch-create-adjustments.dto.ts`) ya traía `@Min(0)`.
   */
  @IsInt()
  @Min(0)
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

  /** Entero no negativo, por la misma razón que en `CreateOrgAdjustmentDto`. */
  @IsInt()
  @Min(0)
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

  // Tope de lote: `createBulk` recorre los items abriendo UNA transacción por
  // fila, así que un lote grande que falla a mitad deja las anteriores
  // commiteadas y devuelve un 500 opaco. Hasta que el endpoint reporte por fila,
  // el tope acota el daño y alinea con `vendix-bulk-operations` (100).
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
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
