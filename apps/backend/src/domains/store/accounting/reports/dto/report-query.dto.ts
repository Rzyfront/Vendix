import { IsNumber, IsOptional, IsDateString } from 'class-validator';
import { Type } from 'class-transformer';

export class ReportQueryDto {
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
