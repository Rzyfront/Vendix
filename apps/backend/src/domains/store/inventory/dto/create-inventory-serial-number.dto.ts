import {
  IsString,
  IsOptional,
  IsInt,
  IsEnum,
  IsArray,
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
