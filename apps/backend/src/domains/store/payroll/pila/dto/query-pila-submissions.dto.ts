import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class QueryPilaSubmissionsDto {
  @IsOptional()
  @IsInt()
  @Min(2020)
  @Max(2099)
  @Type(() => Number)
  year?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(12)
  @Type(() => Number)
  month?: number;

  @IsOptional()
  @IsIn(['generated', 'exported', 'void'])
  status?: 'generated' | 'exported' | 'void';

  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  page?: number = 1;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  @Type(() => Number)
  limit?: number = 10;
}
