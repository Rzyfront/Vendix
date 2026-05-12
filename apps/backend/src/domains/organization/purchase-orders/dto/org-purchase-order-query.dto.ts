import {
  IsOptional,
  IsNumber,
  IsString,
  IsEnum,
  IsDateString,
  IsInt,
} from 'class-validator';
import { Type } from 'class-transformer';
import { purchase_order_status_enum } from '@prisma/client';

/**
 * Query DTO for `/api/organization/purchase-orders`.
 *
 * Operating-scope semantics (resolved by
 * `OrganizationPrismaService.getScopedWhere`):
 *  - `operating_scope=ORGANIZATION` + `store_id` ausente → consolidado.
 *  - `operating_scope=ORGANIZATION` + `store_id` presente → breakdown por tienda.
 *  - `operating_scope=STORE` → `store_id` obligatorio (deriva de la tienda
 *    única del contexto org cuando aplica).
 */
export class OrgPurchaseOrderQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  limit?: number;

  /**
   * Breakdown filter. Restringe los resultados a OCs cuya bodega
   * (`location_id`) pertenezca a la tienda indicada.
   */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  store_id?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  supplier_id?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  location_id?: number;

  @IsOptional()
  @IsEnum(purchase_order_status_enum)
  status?: purchase_order_status_enum;

  @IsOptional()
  @IsDateString()
  start_date?: string;

  @IsOptional()
  @IsDateString()
  end_date?: string;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  min_total?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  max_total?: number;

  @IsOptional()
  @IsString()
  sort_by?: string;

  @IsOptional()
  @IsEnum(['asc', 'desc'])
  sort_order?: 'asc' | 'desc';
}
