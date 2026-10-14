import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ReceiveItemDto } from './receive-purchase-order.dto';

/** Tope de líneas de la recepción asíncrona (el job las parte en lotes de 100). */
export const PURCHASE_ORDER_RECEIVE_ASYNC_ITEMS_MAX = 10000;

/**
 * Mismo shape que `ReceivePurchaseOrderDto` pero con tope de 10.000 líneas.
 * Se declara completo (no `extends`): class-validator ACUMULA los decoradores
 * heredados, así que el `@ArrayMaxSize(100)` del padre seguiría rechazando.
 */
export class ReceivePurchaseOrderAsyncDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(PURCHASE_ORDER_RECEIVE_ASYNC_ITEMS_MAX)
  @ValidateNested({ each: true })
  @Type(() => ReceiveItemDto)
  items: ReceiveItemDto[];

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsString()
  supplier_invoice_number?: string;

  @IsOptional()
  @IsDateString()
  supplier_invoice_date?: string;
}
