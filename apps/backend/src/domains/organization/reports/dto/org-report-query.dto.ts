import { IsDateString, IsNumber, IsOptional } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Org-level report query DTO. Default behaviour is consolidated across every
 * store of the organization. When `store_id` is provided the response is
 * filtered to that single store (breakdown) — pertenencia de la tienda a la
 * org se valida en `OrganizationPrismaService`.
 *
 * `date_from` / `date_to` siguen el mismo contrato que el DTO equivalente de
 * `/store/reports` (rango inclusivo en formato ISO).
 */
export class OrgReportQueryDto {
  @IsOptional()
  @IsDateString()
  date_from?: string;

  @IsOptional()
  @IsDateString()
  date_to?: string;

  /**
   * Filtro opcional por tienda. Cuando `operating_scope=ORGANIZATION` y se
   * pasa `store_id`, el reporte se restringe a esa sola tienda (breakdown).
   * Cuando `operating_scope=STORE`, este filtro es obligatorio (ver
   * `OrganizationPrismaService.getScopedWhere`).
   */
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  store_id?: number;
}
