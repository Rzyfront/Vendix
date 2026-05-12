import { IsBoolean, IsNumber, IsOptional, Min } from 'class-validator';
import { Type, Transform } from 'class-transformer';

export class QueryTransactionsDto {
  // TODO: phase3-round2-keep-justification — store_id used as breakdown filter
  // for intercompany transactions (matches from_store_id OR to_store_id).
  // Legitimate filter for cross-store consolidation drilldown, even though
  // this controller lives under /store/*. Re-evaluate after route migration.
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  store_id?: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  account_id?: number;

  @IsOptional()
  @Transform(({ value }) => {
    if (value === 'true') return true;
    if (value === 'false') return false;
    return value;
  })
  @IsBoolean()
  eliminated?: boolean;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Type(() => Number)
  page?: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Type(() => Number)
  limit?: number;
}
