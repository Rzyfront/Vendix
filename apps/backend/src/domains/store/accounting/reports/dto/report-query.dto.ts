import { IsNumber, IsOptional } from 'class-validator';
import { Type } from 'class-transformer';
import { BaseReportQueryDto } from '../../../../../common/reports/base-report-query.dto';

/**
 * DTO compartido por los 4 endpoints de reportes contables:
 * `trial-balance`, `balance-sheet`, `income-statement`, `general-ledger`.
 *
 * Extiende `BaseReportQueryDto` para heredar `date_from`, `date_to`,
 * `page`, `limit` (sin forkear; evita el bug donde `ValidationPipe`
 * rechaza esos params por `forbidNonWhitelisted`).
 *
 * Campos específicos del dominio contable: `fiscal_period_id`
 * (obligatorio, se valida contra `fiscal_periods`), `account_id`
 * (obligatorio solo en `general-ledger`, se valida inline), y
 * `store_id` (deprecado para endpoints `/store/*` — `StorePrismaService`
 * auto-scopes por contexto de request).
 */
export class ReportQueryDto extends BaseReportQueryDto {
  @IsNumber()
  @Type(() => Number)
  fiscal_period_id: number;

  // store_id is deprecated for /store/* endpoints — StorePrismaService
  // auto-scopes by request context, so AccountingReportsService ignores
  // this field. ConsolidatedReportsService still threads it through to
  // satisfy the call shape used during the per-store iteration; keep
  // optional for back-compat with internal callers.
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  store_id?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  account_id?: number;
}
