import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class QueryMarketingAdCreativesDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 12;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsIn(['draft', 'processing', 'completed', 'failed'])
  status?: 'draft' | 'processing' | 'completed' | 'failed';

  @IsOptional()
  @IsIn(['square', 'story', 'landscape'])
  format?: 'square' | 'story' | 'landscape';
}
