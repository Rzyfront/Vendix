import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PURCHASE_ORDER_ITEMS_MAX } from './create-purchase-order.dto';

/** Línea «nueva» (sin product_id) cuyo SKU / código se quiere contrastar. */
export class NewItemConflictLineDto {
  /** Posición de la línea en el formulario; se devuelve tal cual. */
  @IsInt()
  @Min(0)
  line_index: number;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  sku?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  barcode?: string;
}

export class NewItemConflictsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(PURCHASE_ORDER_ITEMS_MAX)
  @ValidateNested({ each: true })
  @Type(() => NewItemConflictLineDto)
  items: NewItemConflictLineDto[];
}
