import { IsString, IsOptional, IsNumber, MaxLength, IsDateString } from 'class-validator';
import { Type } from 'class-transformer';

export class QueryPayrollRunDto {
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
  @IsString()
  @MaxLength(20)
  status?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  frequency?: string;

  @IsOptional()
  @IsDateString()
  date_from?: string;

  @IsOptional()
  @IsDateString()
  date_to?: string;
}
