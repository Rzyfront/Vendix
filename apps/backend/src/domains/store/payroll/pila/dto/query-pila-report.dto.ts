import { IsInt, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class QueryPilaReportDto {
  @IsInt()
  @Min(2020)
  @Max(2099)
  @Type(() => Number)
  year: number;

  @IsInt()
  @Min(1)
  @Max(12)
  @Type(() => Number)
  month: number;
}
