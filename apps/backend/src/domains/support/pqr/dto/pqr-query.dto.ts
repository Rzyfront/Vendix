import {
  IsEnum,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';
import {
  ticket_priority_enum,
  ticket_status_enum,
} from '@prisma/client';

/**
 * Admin-only query for the PQR list endpoint.
 * Reuses the existing `ticket_status_enum` and `ticket_priority_enum`,
 * and constrains `pqr_type` to the PQR-only enum values added in
 * schema.prisma (`PETITION | COMPLAINT | CLAIM`).
 */
export class PqrQueryDto {
  @IsOptional()
  @IsEnum(ticket_status_enum)
  status?: ticket_status_enum;

  @IsOptional()
  @IsIn(['PETITION', 'COMPLAINT', 'CLAIM'])
  pqr_type?: 'PETITION' | 'COMPLAINT' | 'CLAIM';

  @IsOptional()
  @IsEnum(ticket_priority_enum)
  priority?: ticket_priority_enum;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  search?: string;

  @IsOptional()
  @IsISO8601()
  date_from?: string;

  @IsOptional()
  @IsISO8601()
  date_to?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  assigned_to_user_id?: number;

  /**
   * Optional store filter — scopes the list to a single tienda within
   * the org. The org-admin controller already enforces
   * `organization_id = ctx.organizationId` server-side, so this
   * filter is just an additional narrowing within that scope.
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  store_id?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number = 20;
}