import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

/** Tipos de cancelación aceptados al quitar un plato ya disparado a cocina. */
export const ORDER_ITEM_CHANGE_CANCELLATION_TYPES = [
  'after_fire_waste',
  'after_fire_reused',
] as const;
export type OrderItemChangeCancellationType =
  (typeof ORDER_ITEM_CHANGE_CANCELLATION_TYPES)[number];

export class OrderItemChangeAddDto {
  @IsInt()
  @Min(1)
  product_id: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  product_variant_id?: number | null;

  @IsInt()
  @Min(1)
  quantity: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

export class OrderItemChangeUpdateDto {
  @IsInt()
  @Min(1)
  order_item_id: number;

  @IsInt()
  @Min(1)
  quantity: number;
}

export class OrderItemChangeRemoveDto {
  @IsInt()
  @Min(1)
  order_item_id: number;

  @IsOptional()
  @IsIn(ORDER_ITEM_CHANGE_CANCELLATION_TYPES)
  cancellation_type?: OrderItemChangeCancellationType;
}

/**
 * Cambia la tarifa de una línea existente (tarifa preferencial del cliente).
 * `price_tier_id` null (u omitido) restaura el precio regular del catálogo.
 * El precio lo resuelve el servidor; la cantidad no cambia.
 */
export class OrderItemChangeRetierDto {
  @IsInt()
  @Min(1)
  order_item_id: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  price_tier_id?: number | null;
}

/**
 * Change-set por diferencia sobre las líneas de una orden (QUI-650).
 * Las reglas cruzadas (vacío, ids repetidos, motivo/versión obligatorios en
 * apply) las valida `OrderItemChangesService`.
 */
export class OrderItemChangesDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => OrderItemChangeAddDto)
  add?: OrderItemChangeAddDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => OrderItemChangeUpdateDto)
  update?: OrderItemChangeUpdateDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => OrderItemChangeRemoveDto)
  remove?: OrderItemChangeRemoveDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => OrderItemChangeRetierDto)
  retier?: OrderItemChangeRetierDto[];

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  expected_version?: string;
}
