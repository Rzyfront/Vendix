import {
  IsArray,
  IsInt,
  IsOptional,
  IsNumber,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class ValidateMultipleConsolidatedStockDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProductQuantityDto)
  products: ProductQuantityDto[];

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  @Min(1, { message: 'El ID de organización debe ser mayor a 0' })
  organization_id?: number;
}

export class ProductQuantityDto {
  @IsInt()
  @Type(() => Number)
  product_id: number;

  @IsNumber()
  @Type(() => Number)
  @Min(1, { message: 'La cantidad debe ser mayor a 0' })
  quantity: number;
}
