import { IsArray, ValidateNested, IsInt, IsNumber, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class BudgetLineItemDto {
  @IsInt()
  @Type(() => Number)
  account_id: number;

  @IsNumber()
  @Min(0)
  @Type(() => Number)
  month_01: number;

  @IsNumber()
  @Min(0)
  @Type(() => Number)
  month_02: number;

  @IsNumber()
  @Min(0)
  @Type(() => Number)
  month_03: number;

  @IsNumber()
  @Min(0)
  @Type(() => Number)
  month_04: number;

  @IsNumber()
  @Min(0)
  @Type(() => Number)
  month_05: number;

  @IsNumber()
  @Min(0)
  @Type(() => Number)
  month_06: number;

  @IsNumber()
  @Min(0)
  @Type(() => Number)
  month_07: number;

  @IsNumber()
  @Min(0)
  @Type(() => Number)
  month_08: number;

  @IsNumber()
  @Min(0)
  @Type(() => Number)
  month_09: number;

  @IsNumber()
  @Min(0)
  @Type(() => Number)
  month_10: number;

  @IsNumber()
  @Min(0)
  @Type(() => Number)
  month_11: number;

  @IsNumber()
  @Min(0)
  @Type(() => Number)
  month_12: number;
}

export class UpdateBudgetLinesDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BudgetLineItemDto)
  lines: BudgetLineItemDto[];
}
