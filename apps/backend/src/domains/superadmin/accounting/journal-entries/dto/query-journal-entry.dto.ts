import {
  IsString,
  IsOptional,
  IsNumber,
  IsDateString,
  MaxLength,
  IsInt,
  Min,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';

export class QueryJournalEntryDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number = 10;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  sort_by?: string = 'entry_date';

  @IsOptional()
  @IsString()
  sort_order?: 'asc' | 'desc' = 'desc';

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  fiscal_period_id?: number;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  source_type?: string;

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

  @IsOptional()
  @IsString()
  @MaxLength(20)
  account_code?: string;
}
