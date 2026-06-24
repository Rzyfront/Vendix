import {
  IsString,
  IsOptional,
  IsInt,
  IsEnum,
  IsArray,
  IsNumber,
  IsDateString,
  ValidateNested,
  ArrayMinSize,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import { serial_status_enum } from '@prisma/client';

/**
 * QUI-431 — DTOs for the serial-number pool service.
 *
 * Rewritten against the REAL schema (snake_case, Int ids, no organization_id
 * column on serials/batches). Status uses the generated `serial_status_enum`.
 * Scope is enforced by `StorePrismaService` (relational via
 * inventory_locations.store_id), so DTOs no longer carry organizationId.
 */

export class CreateInventorySerialNumberDto {
  @IsString()
  serial_number: string;

  @IsInt()
  @Type(() => Number)
  product_id: number;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  product_variant_id?: number;

  @IsInt()
  @Type(() => Number)
  location_id: number;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  batch_id?: number;

  @IsOptional()
  @IsEnum(serial_status_enum)
  status?: serial_status_enum;

  @IsOptional()
  @Type(() => Number)
  cost?: number;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class CreateSerialNumbersForBatchDto {
  @IsInt()
  @Type(() => Number)
  batch_id: number;

  @IsArray()
  @IsString({ each: true })
  serial_numbers: string[];
}

export class UpdateInventorySerialNumberDto {
  @IsOptional()
  @IsEnum(serial_status_enum)
  status?: serial_status_enum;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  location_id?: number;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class GetSerialNumbersDto {
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  product_id?: number;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  product_variant_id?: number;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  batch_id?: number;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  location_id?: number;

  @IsOptional()
  @IsEnum(serial_status_enum)
  status?: serial_status_enum;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  @Min(1)
  page?: number;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  @Min(1)
  limit?: number;
}

export class GetAvailableSerialNumbersDto {
  @IsInt()
  @Type(() => Number)
  product_id: number;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  product_variant_id?: number;

  @IsInt()
  @Type(() => Number)
  location_id: number;
}

/**
 * QUI-431 (continuation) — Backfill serials over EXISTING stock.
 *
 * One serial to register against units already on hand. No status field: the
 * service forces `in_stock` (backfill only registers identities for sellable
 * units, it never mutates quantity_on_hand).
 */
export class BulkBackfillSerialNumberItemDto {
  @IsString()
  serial_number: string;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  cost?: number;

  @IsOptional()
  @IsDateString()
  warranty_expiry?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

/**
 * Bulk backfill payload: a product/variant at a location plus the list of
 * serial identities to register. The service enforces parity against
 * stock_levels.quantity_on_hand (cannot register more serials than units in
 * stock) and never touches stock.
 */
export class BulkBackfillSerialNumbersDto {
  @IsInt()
  @Type(() => Number)
  product_id: number;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  product_variant_id?: number;

  @IsInt()
  @Type(() => Number)
  location_id: number;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => BulkBackfillSerialNumberItemDto)
  items: BulkBackfillSerialNumberItemDto[];
}

/**
 * Generic PATCH /:id — edit the descriptive fields of a serial row.
 * Status changes go through PATCH /:id/status (UpdateInventorySerialNumberDto);
 * this DTO deliberately omits status and location_id so the generic edit
 * endpoint cannot bypass the lifecycle/parity rules.
 */
export class PatchSerialNumberDto {
  @IsOptional()
  @IsString()
  serial_number?: string;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  cost?: number;
}
