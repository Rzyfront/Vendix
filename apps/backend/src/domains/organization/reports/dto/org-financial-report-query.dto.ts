import { IsDateString, IsNumber, IsOptional } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Query DTO para reportes financieros consolidados (`/organization/reports/financial/*`).
 *
 * `fiscal_period_id` es obligatorio (igual que en el equivalente store).
 * `store_id` opcional → breakdown por tienda (validado contra la org).
 *
 * NOTA: `account_id` se exige sólo en `general-ledger` y se valida en el
 * controller para no sobrecomplicar este DTO.
 */
export class OrgFinancialReportQueryDto {
  @Type(() => Number)
  @IsNumber()
  fiscal_period_id!: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  store_id?: number;

  @IsOptional()
  @IsDateString()
  date_from?: string;

  @IsOptional()
  @IsDateString()
  date_to?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  account_id?: number;
}
