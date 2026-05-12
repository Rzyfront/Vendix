import { IsOptional, IsInt, IsString, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class QueryBudgetDto {
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  fiscal_period_id?: number;

  @IsOptional()
  @IsString()
  status?: string;

  // store_id deprecated (phase3-round2): scope is derived from RequestContextService
  // (StorePrismaService auto-scopes) for /store/* endpoints.

  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  page?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  limit?: number;
}
