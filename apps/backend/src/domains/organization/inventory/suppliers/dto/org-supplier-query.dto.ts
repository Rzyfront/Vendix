import { IsOptional, IsNumber, IsString, IsEnum, IsInt } from 'class-validator';
import { Type } from 'class-transformer';
import { supplier_state_enum } from '@prisma/client';

/**
 * Org-wide supplier listing query. The store-domain `SuppliersService` already
 * resolves operating_scope (ORGANIZATION → suppliers with store_id=null),
 * but ORG_ADMIN tokens may not call /store/* under the new domain guard. This
 * DTO mirrors `SupplierQueryDto` minus tenant fields (always derived from the
 * RequestContext / org scope).
 */
export class OrgSupplierQueryDto {
  /** Optional breakdown filter; only meaningful when operating_scope=ORGANIZATION. */
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  store_id?: number;

  @IsOptional()
  @IsString()
  search?: string;

  /** Omitirlo excluye los archivados; pasar `archived` los consulta. */
  @IsOptional()
  @IsEnum(supplier_state_enum)
  state?: supplier_state_enum;

  @IsOptional()
  @IsString()
  email?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  page?: number = 1;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  limit?: number = 10;
}
