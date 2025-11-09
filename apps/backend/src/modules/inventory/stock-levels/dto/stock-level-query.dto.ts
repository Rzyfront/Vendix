import { IsOptional, IsInt } from 'class-validator';
import { Type } from 'class-transformer';

export class StockLevelQueryDto {
  @IsOptional()
  @IsInt()
  @Type(() => Number)
  product_id?: number;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  product_variant_id?: number;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  location_id?: number;
}
