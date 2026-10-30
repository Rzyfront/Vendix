import {
  IsArray,
  ArrayMinSize,
  ArrayMaxSize,
  IsInt,
  IsOptional,
  IsNumber,
  ValidateNested,
} from 'class-validator';
import { Type, Transform } from 'class-transformer';
import { CreateOrderItemDto } from './create-order.dto';

/**
 * N2 (PR #1003): `option_ids` se declara solo para responder un error claro
 * (`OPT_DRAFT_ADD_LOCKED`) en vez de un 400 genérico del whitelist: este
 * endpoint no vende adiciones y el servicio rechaza cualquier línea que las
 * traiga.
 */
export class UpdateOrderItemDto extends CreateOrderItemDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsInt({ each: true })
  @Type(() => Number)
  option_ids?: number[];
}

export class UpdateOrderItemsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => UpdateOrderItemDto)
  items: UpdateOrderItemDto[];

  @IsOptional()
  @Transform(({ value }) => parseFloat(value))
  @IsNumber({ maxDecimalPlaces: 2 })
  subtotal?: number;

  @IsOptional()
  @Transform(({ value }) => parseFloat(value))
  @IsNumber({ maxDecimalPlaces: 2 })
  tax_amount?: number;

  @IsOptional()
  @Transform(({ value }) => parseFloat(value))
  @IsNumber({ maxDecimalPlaces: 2 })
  discount_amount?: number;

  @IsOptional()
  @Transform(({ value }) => parseFloat(value))
  @IsNumber({ maxDecimalPlaces: 2 })
  total_amount?: number;
}
