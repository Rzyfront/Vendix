import {
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsDate,
  ValidateNested,
  IsArray,
  IsInt,
  Min,
  ArrayMinSize,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateTransferItemDto {
  @IsNumber()
  @IsNotEmpty()
  product_id: number;

  @IsOptional()
  @IsNumber()
  product_variant_id?: number;

  // Unidades de stock (las mismas de `stock_levels`, columna Int): la compra
  // ya convierte su unidad de compra a unidad de stock al recibir.
  @IsInt()
  @Min(1)
  quantity: number;

  @IsOptional()
  @IsNumber()
  cost_per_unit?: number;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class CreateTransferDto {
  @IsNumber()
  @IsNotEmpty()
  from_location_id: number;

  @IsNumber()
  @IsNotEmpty()
  to_location_id: number;

  @IsOptional()
  @IsDate()
  @Type(() => Date)
  expected_date?: Date;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateTransferItemDto)
  items: CreateTransferItemDto[];
}
