import { Type } from 'class-transformer';
import {
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

  // REFUND OVERHAUL — required when refund_method='bank_transfer'. The
  // destination bank account is persisted on refund_items.bank_account_id for
  // audit trail and journal entry routing. Ignored for other methods.
  @IsOptional()
  @IsInt()
  bank_account_id?: number;
}

export class CreateRefundDto {
  @IsArray()
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
