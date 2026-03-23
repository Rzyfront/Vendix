import { IsOptional, IsString, IsNumber, IsIn } from 'class-validator';
import { Type } from 'class-transformer';

export class QueryAdvanceDto {
  @IsOptional()
  @IsString()
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
  sort_by?: string = 'created_at';

  @IsOptional()
  @IsIn(['asc', 'desc'])
  sort_order?: 'asc' | 'desc' = 'desc';

  @IsOptional()
  @IsIn(['pending', 'approved', 'repaying', 'paid', 'rejected', 'cancelled'])
  status?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  employee_id?: number;
}
