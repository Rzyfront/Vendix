import { Type } from 'class-transformer';
import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class CreateRefundItemDto {
  @IsInt()
  order_item_id: number;

  @IsInt()
  @Min(1)
  quantity: number;

  @IsIn(['restock', 'write_off', 'no_return'])
  inventory_action: 'restock' | 'write_off' | 'no_return';

  @IsOptional()
  @IsInt()
  location_id?: number;

  @IsOptional()
  @IsString()
  reason?: string;

  // REFUND OVERHAUL — bank_account_id es OPCIONAL y se persiste como
  // metadata de auditoría en refund_items.bank_account_id. La ejecución del
  // refund con refund_method='bank_transfer' no exige una cuenta destino a
  // nivel de DTO; la responsabilidad de seleccionar/capturar la cuenta
  // destino es del flujo operativo (no del contrato HTTP).
  @IsOptional()
  @IsInt()
  bank_account_id?: number;
}

export class CreateRefundDto {
  @IsArray()
  @ArrayUnique((item: CreateRefundItemDto) => item?.order_item_id, {
    message: 'Each order_item_id must appear only once in items',
  })
  @ValidateNested({ each: true })
  @Type(() => CreateRefundItemDto)
  items: CreateRefundItemDto[];

  @IsBoolean()
  include_shipping: boolean;

  @IsIn(['original_payment', 'cash', 'bank_transfer', 'store_credit'])
  refund_method: string;

  @IsString()
  @MaxLength(500)
  reason: string;

  @IsOptional()
  @IsString()
  notes?: string;
}
