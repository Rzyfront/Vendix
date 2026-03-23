import { IsNumber } from 'class-validator';
import { Type } from 'class-transformer';

export class RunDepreciationDto {
  @IsNumber()
  @Type(() => Number)
  year: number;

  @IsNumber()
  @Type(() => Number)
  month: number;
}
