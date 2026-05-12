import {
  IsArray,
  IsInt,
  IsNumber,
  IsOptional,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CostPreviewItemDto {
  @IsInt()
  @Min(1)
  product_id: number;

  @IsOptional()
  @IsInt()
  product_variant_id?: number;

  @IsInt()
  @Min(1)
  quantity: number;

  @IsNumber()
  @Min(0.0001)
  unit_cost: number;
}

export class CostPreviewDto {
  @IsInt()
  @Min(1)
  location_id: number;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CostPreviewItemDto)
  items: CostPreviewItemDto[];
}
