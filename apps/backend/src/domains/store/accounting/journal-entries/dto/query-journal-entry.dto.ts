import {
  IsString,
  IsOptional,
  IsNumber,
  IsDateString,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';

export class QueryJournalEntryDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  limit?: number = 10;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  sort_by?: string = 'created_at';

  @IsOptional()
  @IsString()
  sort_order?: 'asc' | 'desc' = 'desc';

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  fiscal_period_id?: number;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  entry_type?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  status?: string;

  @IsOptional()
  @IsDateString()
  date_from?: string;

  @IsOptional()
  @IsDateString()
  date_to?: string;

  // store_id is deprecated for /store/* endpoints (StorePrismaService auto-scopes
  // by the request context). However, /organization/accounting/journal-entries
  // reuses this DTO and accepts store_id as a per-store breakdown filter
  // (validated against the org via OrgAccountingScopeService). Keep optional.
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  store_id?: number;
}
