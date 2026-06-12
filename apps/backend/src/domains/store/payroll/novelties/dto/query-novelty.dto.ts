import {
  IsDateString,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
} from 'class-validator';
import { Type } from 'class-transformer';
import { NOVELTY_TYPES, NoveltyType } from './create-novelty.dto';

export class QueryNoveltyDto {
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
  sort_by?: string = 'date_start';

  @IsOptional()
  @IsIn(['asc', 'desc'])
  sort_order?: 'asc' | 'desc' = 'desc';

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  employee_id?: number;

  @IsOptional()
  @IsIn(NOVELTY_TYPES)
  novelty_type?: NoveltyType;

  @IsOptional()
  @IsIn(['pending', 'applied', 'cancelled'])
  status?: 'pending' | 'applied' | 'cancelled';

  @IsOptional()
  @IsDateString()
  date_from?: string;

  @IsOptional()
  @IsDateString()
  date_to?: string;
}
