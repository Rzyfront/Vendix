import { IsEnum, IsInt, IsOptional, IsString } from 'class-validator';
import { Type } from 'class-transformer';
import { serial_status_enum } from '@prisma/client';

/**
 * Query DTO for `/api/organization/inventory/serial-numbers`.
 *
 * Filters operate on the consolidated org-wide listing. `store_id` is an
 * optional breakdown filter when operating_scope=ORGANIZATION (and required
 * when STORE — enforced by `OrganizationPrismaService.getScopedWhere`).
 */
export class ListOrgSerialNumbersDto {
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  store_id?: number;

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
  location_id?: number;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  batch_id?: number;

  @IsOptional()
  @IsEnum(serial_status_enum)
  status?: serial_status_enum;

  /** Search by serial_number (contains, case-insensitive in DB collation). */
  @IsOptional()
  @IsString()
  serial_number?: string;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  page?: number;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  limit?: number;
}
