import { IsArray, IsInt } from 'class-validator';
import { Type } from 'class-transformer';

export class UpdateProductPromotionsDto {
  @IsArray()
  @IsInt({ each: true })
  @Type(() => Number)
  promotion_ids: number[];
}
