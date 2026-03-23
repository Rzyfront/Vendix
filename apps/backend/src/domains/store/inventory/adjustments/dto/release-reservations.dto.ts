import { IsInt, IsOptional } from 'class-validator';
import { Type } from 'class-transformer';

export class ReleaseReservationsByProductDto {
  @IsInt()
  @Type(() => Number)
  product_id: number;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  product_variant_id?: number;
}
