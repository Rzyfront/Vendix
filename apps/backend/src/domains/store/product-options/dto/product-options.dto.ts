import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class ProductOptionInputDto {
  @ApiProperty({ required: false, description: 'Con id se actualiza; sin id se crea' })
  @IsOptional()
  @IsInt()
  id?: number;

  @ApiProperty({ example: 'Fresas' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name: string;

  @ApiProperty({ example: 5000, description: 'Valor adicional sobre el precio de la línea' })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Type(() => Number)
  price_delta: number;

  @ApiProperty({ enum: ['ingredient', 'recipe', 'product'] })
  @IsIn(['ingredient', 'recipe', 'product'])
  component_type: 'ingredient' | 'recipe' | 'product';

  // Opcional en el DTO para responder con el mensaje de negocio
  // (OPT_COMPONENT_REQUIRED) en vez de un error genérico de validación.
  @ApiProperty({ required: false, example: 12 })
  @IsOptional()
  @IsInt()
  component_product_id?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  component_variant_id?: number | null;

  @ApiProperty({ example: 80, description: 'Cantidad del componente por adición' })
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0.0001)
  @Type(() => Number)
  quantity: number;

  @ApiProperty({ required: false, example: 'g' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  uom?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  sort_order?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}

export class ProductOptionAssignmentInputDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  product_id?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  category_id?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  sort_order?: number;
}

export class ProductOptionGroupInputDto {
  @ApiProperty({ example: 'Frutas' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiProperty({ example: 0 })
  @IsInt()
  @Min(0)
  min_select: number;

  @ApiProperty({ example: 2 })
  @IsInt()
  @Min(1)
  max_select: number;

  @ApiProperty({ example: false })
  @IsBoolean()
  is_required: boolean;

  @ApiProperty({ enum: ['per_unit', 'per_line'] })
  @IsIn(['per_unit', 'per_line'])
  scope: 'per_unit' | 'per_line';

  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  sort_order?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  is_active?: boolean;

  @ApiProperty({ type: [ProductOptionInputDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => ProductOptionInputDto)
  options: ProductOptionInputDto[];

  @ApiProperty({ type: [ProductOptionAssignmentInputDto], required: false })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => ProductOptionAssignmentInputDto)
  assignments?: ProductOptionAssignmentInputDto[];
}
