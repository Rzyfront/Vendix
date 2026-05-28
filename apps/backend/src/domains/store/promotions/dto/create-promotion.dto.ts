import {
  IsString,
  IsOptional,
  IsNumber,
  IsBoolean,
  IsInt,
  IsEnum,
  IsArray,
  IsDateString,
  Min,
  MaxLength,
  ValidateIf,
  ArrayNotEmpty,
  ArrayUnique,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreatePromotionDto {
  @IsString()
  @MaxLength(255)
  name: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  code?: string;

  @IsEnum(['percentage', 'fixed_amount'])
  type: 'percentage' | 'fixed_amount';

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Type(() => Number)
  value: number;

  @IsOptional()
  @IsEnum(['order', 'product', 'category'])
  scope?: 'order' | 'product' | 'category' = 'order';

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Type(() => Number)
  min_purchase_amount?: number;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Type(() => Number)
  max_discount_amount?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  usage_limit?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Type(() => Number)
  per_customer_limit?: number;

  @IsDateString()
  start_date: string;

  @IsOptional()
  @IsDateString()
  end_date?: string;

  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  is_auto_apply?: boolean = false;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Type(() => Number)
  priority?: number = 0;

  @ValidateIf((o) => o.scope === 'product')
  @IsArray({ message: 'Debes proporcionar la lista de productos' })
  @ArrayNotEmpty({
    message: 'Selecciona al menos un producto para esta promocion',
  })
  @ArrayUnique({ message: 'No se permiten productos duplicados' })
  @IsInt({ each: true, message: 'Cada producto debe ser un id valido' })
  @Type(() => Number)
  product_ids?: number[];

  @ValidateIf((o) => o.scope === 'category')
  @IsArray({ message: 'Debes proporcionar la lista de categorias' })
  @ArrayNotEmpty({
    message: 'Selecciona al menos una categoria para esta promocion',
  })
  @ArrayUnique({ message: 'No se permiten categorias duplicadas' })
  @IsInt({ each: true, message: 'Cada categoria debe ser un id valido' })
  @Type(() => Number)
  category_ids?: number[];
}
