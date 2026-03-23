import { IsBoolean, IsNumber, IsOptional } from 'class-validator';
import { Type, Transform } from 'class-transformer';

export class QueryTransactionsDto {
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  store_id?: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  account_id?: number;

  @IsOptional()
  @Transform(({ value }) => {
    if (value === 'true') return true;
    if (value === 'false') return false;
    return value;
  })
  @IsBoolean()
  eliminated?: boolean;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  page?: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  limit?: number;
}
